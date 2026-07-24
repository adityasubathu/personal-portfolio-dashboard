"""Capital Gains computation — FIFO matching, Indian tax rules (FY 2020-21 onwards).

Tax law is date-driven:
  - Budget 2024 (23 Jul 2024): equity rates 15→20% STCG, 10→12.5% LTCG; debt LTCG 24m threshold.
  - §50AA (1 Apr 2023): debt MFs bought on/after → always slab, no LTCG benefit.
  - §112A grandfathering: equity lots bought before 1 Feb 2018 → cost = max(actual, min(FMV-31Jan18, sale)).
  - CII frozen at 2024-25 (indexation no longer applies to new periods).
"""
from __future__ import annotations

import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.price_history import PriceHistory
from app.models.trade import Trade

# ── Cost Inflation Index ──────────────────────────────────────────────────────
CII: dict[str, int] = {
    "2001-02": 100, "2002-03": 105, "2003-04": 109, "2004-05": 113,
    "2005-06": 117, "2006-07": 122, "2007-08": 129, "2008-09": 137,
    "2009-10": 148, "2010-11": 167, "2011-12": 184, "2012-13": 200,
    "2013-14": 220, "2014-15": 240, "2015-16": 254, "2016-17": 264,
    "2017-18": 272, "2018-19": 280, "2019-20": 289, "2020-21": 301,
    "2021-22": 317, "2022-23": 331, "2023-24": 348, "2024-25": 363,
}

# ── Boundary dates ────────────────────────────────────────────────────────────
_BUDGET_2024 = date(2024, 7, 23)
_DEBT_50AA_BOUNDARY = date(2023, 4, 1)
_GRANDFATHERING_CUTOFF = date(2018, 2, 1)
_GRANDFATHERING_FMV_DATE = date(2018, 1, 31)
_FY_FLOOR = "2020-21"

# ── Bucket metadata ───────────────────────────────────────────────────────────
BUCKET_META: dict[str, dict] = {
    "equity_stcg_15":       {"label": "Equity STCG (15%) §111A",          "rate": 15.0,  "term": "short"},
    "equity_stcg_20":       {"label": "Equity STCG (20%) §111A",          "rate": 20.0,  "term": "short"},
    "equity_ltcg_10":       {"label": "Equity LTCG (10%) §112A",          "rate": 10.0,  "term": "long",  "is_112a": True},
    "equity_ltcg_125":      {"label": "Equity LTCG (12.5%) §112A",        "rate": 12.5,  "term": "long",  "is_112a": True},
    "debt_slab":            {"label": "Debt / Specified MF — Slab rate",  "rate": None,  "term": "short"},
    "debt_ltcg_20_indexed": {"label": "Debt LTCG (20% + indexation)",     "rate": 20.0,  "term": "long",  "indexed": True},
    "debt_ltcg_125":        {"label": "Debt LTCG (12.5%)",                "rate": 12.5,  "term": "long"},
    "bond_stcg_slab":       {"label": "Bond STCG — Slab rate",            "rate": None,  "term": "short"},
    "bond_ltcg_10":         {"label": "Bond LTCG (10%)",                  "rate": 10.0,  "term": "long"},
    "bond_ltcg_125":        {"label": "Bond LTCG (12.5%)",                "rate": 12.5,  "term": "long"},
    "unknown_mf_slab":      {"label": "Unclassified MF — Slab (conservative)", "rate": None, "term": "short"},
}

_STCG_KEYS = {"equity_stcg_15", "equity_stcg_20", "debt_slab", "bond_stcg_slab", "unknown_mf_slab"}
_LTCG_KEYS = {"equity_ltcg_10", "equity_ltcg_125", "debt_ltcg_20_indexed", "debt_ltcg_125", "bond_ltcg_10", "bond_ltcg_125"}
_112A_KEYS = {"equity_ltcg_10", "equity_ltcg_125"}

# ── MF equity/debt classification ─────────────────────────────────────────────
_EQUITY_MF_RE = re.compile(
    r"\b(equity|elss|index|flexi.?cap|large.?cap|mid.?cap|small.?cap|multi.?cap|"
    r"aggressive.?hybrid|balanced.?advantage|nifty|sensex|arbitrage)",
    re.IGNORECASE,
)
_DEBT_MF_RE = re.compile(
    r"\b(debt|liquid|gilt|money.?market|low.?duration|ultra.?short|banking.?and.?psu|"
    r"credit.?risk|conservative.?hybrid|overnight|savings|floater|dynamic.?bond|"
    r"short.?duration|medium.?duration|long.?duration|corporate.?bond|psu.?bond)\b",
    re.IGNORECASE,
)


def _classify_mf_orientation(name: str | None, tradingsymbol: str | None) -> str:
    combined = f"{tradingsymbol or ''} {name or ''}"
    if _EQUITY_MF_RE.search(combined):
        return "equity"
    if _DEBT_MF_RE.search(combined):
        return "debt_mf"
    return "unknown_mf"


# ── Date / FY helpers ─────────────────────────────────────────────────────────

def _fy_to_dates(fy: str) -> tuple[date, date]:
    """'2024-25' → (date(2024,4,1), date(2025,3,31))"""
    start_yr = int(fy[:4])
    return date(start_yr, 4, 1), date(start_yr + 1, 3, 31)


def _date_to_fy(d: date) -> str:
    """Return Indian FY string for a date."""
    yr = d.year if d.month >= 4 else d.year - 1
    return f"{yr}-{str(yr + 1)[-2:]}"


def _cii_fy(d: date) -> str:
    """Return CII FY key (e.g. '2022-23') for a date."""
    yr = d.year if d.month >= 4 else d.year - 1
    return f"{yr}-{str(yr + 1)[-2:]}"


def _holding_months(buy: date, sell: date) -> int:
    """Full calendar months from buy to sell (exclusive of buy month start)."""
    months = (sell.year - buy.year) * 12 + (sell.month - buy.month)
    if sell.day < buy.day:
        months -= 1
    return months


# ── Tax classification ────────────────────────────────────────────────────────

def classify_lot(asset_category: str, buy_date: date, sell_date: date) -> str:
    """Map (asset_category, buy_date, sell_date) → tax bucket key.

    asset_category: 'equity' | 'debt_mf' | 'bond' | 'unknown_mf'
    """
    months = _holding_months(buy_date, sell_date)

    if asset_category == "equity":
        is_lt = months >= 12
        if sell_date >= _BUDGET_2024:
            return "equity_ltcg_125" if is_lt else "equity_stcg_20"
        return "equity_ltcg_10" if is_lt else "equity_stcg_15"

    if asset_category == "debt_mf":
        if buy_date >= _DEBT_50AA_BOUNDARY:
            return "debt_slab"
        if sell_date < _BUDGET_2024:
            return "debt_ltcg_20_indexed" if months >= 36 else "debt_slab"
        return "debt_ltcg_125" if months >= 24 else "debt_slab"

    if asset_category == "bond":
        is_lt = months >= 12
        if sell_date >= _BUDGET_2024:
            return "bond_ltcg_125" if is_lt else "bond_stcg_slab"
        return "bond_ltcg_10" if is_lt else "bond_stcg_slab"

    # unknown_mf: conservative — slab rate, treat as short-term
    return "unknown_mf_slab"


# ── FIFO matching ─────────────────────────────────────────────────────────────

@dataclass
class RealizedLot:
    symbol: str
    name: str | None
    asset_category: str
    buy_date: date
    sell_date: date
    qty: float
    buy_value: float       # effective (after grandfathering)
    sell_value: float
    expenses: float        # apportioned brokerage (buy + sell)
    gain: float
    holding_days: int
    tax_bucket: str
    flags: list[str] = field(default_factory=list)


@dataclass
class _BuySlot:
    trade_date: date
    qty_remaining: float
    price: float
    brokerage_per_unit: float


def _fifo_match(
    sorted_trades: list[dict],
    symbol: str,
    name: str | None,
    asset_category: str,
    fmv_jan2018: float | None,
) -> tuple[list[RealizedLot], list[dict], dict]:
    """FIFO match one instrument's trades.

    Returns (realized_lots, attention_items, intraday_info).
    attention_items are dicts flagged for missing cost basis or grandfathering issues.
    intraday_info = {"trades": n, "pnl": float}.
    """
    by_date: dict[date, list[dict]] = defaultdict(list)
    for t in sorted_trades:
        by_date[t["trade_date"]].append(t)

    intraday_trade_count = 0
    intraday_pnl = 0.0
    buy_queue: deque[_BuySlot] = deque()
    realized: list[RealizedLot] = []
    attention: list[dict] = []

    for d in sorted(by_date.keys()):
        day = by_date[d]
        buys = [t for t in day if t["trade_type"] == "BUY"]
        sells = [t for t in day if t["trade_type"] == "SELL"]

        total_buy_qty = sum(t["quantity"] for t in buys)
        total_sell_qty = sum(t["quantity"] for t in sells)
        intra_qty = min(total_buy_qty, total_sell_qty)

        if intra_qty > 1e-6:
            intraday_trade_count += len(buys) + len(sells)
            avg_buy_p = sum(t["quantity"] * t["price"] for t in buys) / total_buy_qty if total_buy_qty else 0
            avg_sell_p = sum(t["quantity"] * t["price"] for t in sells) / total_sell_qty if total_sell_qty else 0
            intraday_pnl += intra_qty * (avg_sell_p - avg_buy_p)

        # Net buy qty enters the queue
        net_buy_qty = total_buy_qty - intra_qty
        if net_buy_qty > 1e-6 and buys:
            avg_price = sum(t["quantity"] * t["price"] for t in buys) / total_buy_qty
            avg_brok = sum(t["brokerage"] for t in buys) / total_buy_qty
            buy_queue.append(_BuySlot(d, net_buy_qty, avg_price, avg_brok))

        # Net sell qty matched against FIFO queue
        net_sell_qty = total_sell_qty - intra_qty
        if net_sell_qty < 1e-6:
            continue

        avg_sell_price = sum(t["quantity"] * t["price"] for t in sells) / total_sell_qty
        avg_sell_brok = sum(t["brokerage"] for t in sells) / total_sell_qty

        qty_to_match = net_sell_qty
        while qty_to_match > 1e-6:
            if not buy_queue:
                attention.append({
                    "symbol": symbol,
                    "name": name,
                    "asset_category": asset_category,
                    "sell_date": d.isoformat(),
                    "qty": round(qty_to_match, 6),
                    "sell_value": round(qty_to_match * avg_sell_price, 2),
                    "flags": ["missing_cost_basis"],
                    "reason": "Sell exceeds tracked buys — position likely predates tradebook import or a corporate action (split/bonus) is untracked.",
                })
                qty_to_match = 0
                break

            front = buy_queue[0]
            matched = min(qty_to_match, front.qty_remaining)

            raw_buy_value = matched * front.price
            sell_value = matched * avg_sell_price
            expenses = matched * (front.brokerage_per_unit + avg_sell_brok)
            flags: list[str] = []

            # Grandfathering §112A: equity lots bought before 1 Feb 2018, held ≥12m
            effective_buy_value = raw_buy_value
            months = _holding_months(front.trade_date, d)
            if asset_category == "equity" and front.trade_date < _GRANDFATHERING_CUTOFF and months >= 12:
                if fmv_jan2018 is not None:
                    fmv_portion = matched * fmv_jan2018
                    lower_of = min(fmv_portion, sell_value)
                    effective_buy_value = max(raw_buy_value, lower_of)
                    if effective_buy_value != raw_buy_value:
                        flags.append("grandfathered")
                else:
                    flags.append("grandfathering_fmv_unavailable")

            tax_bucket = classify_lot(asset_category, front.trade_date, d)

            # Indexed buy value for debt LTCG with indexation
            if tax_bucket == "debt_ltcg_20_indexed":
                buy_cii = CII.get(_cii_fy(front.trade_date), 100)
                sell_cii = CII.get(_cii_fy(d), 363)
                effective_buy_value = effective_buy_value * (sell_cii / buy_cii)

            gain = sell_value - effective_buy_value - expenses

            realized.append(RealizedLot(
                symbol=symbol,
                name=name,
                asset_category=asset_category,
                buy_date=front.trade_date,
                sell_date=d,
                qty=matched,
                buy_value=effective_buy_value,
                sell_value=sell_value,
                expenses=expenses,
                gain=gain,
                holding_days=(d - front.trade_date).days,
                tax_bucket=tax_bucket,
                flags=flags,
            ))

            front.qty_remaining -= matched
            if front.qty_remaining < 1e-6:
                buy_queue.popleft()
            qty_to_match -= matched

    return realized, attention, {"trades": intraday_trade_count, "pnl": round(intraday_pnl, 2)}


# ── Set-off + §112A exemption ─────────────────────────────────────────────────

def _apply_setoff(bucket_gains: dict[str, float], fy: str) -> list[dict]:
    """Compute per-bucket taxable amounts after set-off and §112A exemption.

    Set-off order: STCL → STCG, then remaining STCL → LTCG, then LTCL → LTCG.
    §112A exemption: ₹1,00,000 (pre-FY 2024-25) or ₹1,25,000 (FY 2024-25+) on net equity LTCG.
    """
    _112a_limit = 125_000 if fy >= "2024-25" else 100_000

    # Separate positive gains and losses by term
    stcg_pos = {k: v for k, v in bucket_gains.items() if k in _STCG_KEYS and v > 0}
    stcg_neg = {k: v for k, v in bucket_gains.items() if k in _STCG_KEYS and v < 0}
    ltcg_pos = {k: v for k, v in bucket_gains.items() if k in _LTCG_KEYS and v > 0}
    ltcg_neg = {k: v for k, v in bucket_gains.items() if k in _LTCG_KEYS and v < 0}

    total_stcg = sum(stcg_pos.values())
    total_stcl = abs(sum(stcg_neg.values()))
    total_ltcg = sum(ltcg_pos.values())
    total_ltcl = abs(sum(ltcg_neg.values()))

    # Set-off step 1: STCL vs STCG
    stcl_on_stcg = min(total_stcl, total_stcg)
    remaining_stcl = total_stcl - stcl_on_stcg

    # Set-off step 2: remaining STCL and LTCL vs LTCG
    available_ltcg = max(0.0, total_ltcg - total_ltcl)
    stcl_on_ltcg = min(remaining_stcl, available_ltcg)
    available_ltcg_after_stcl = max(0.0, available_ltcg - stcl_on_ltcg)
    # LTCL was already subtracted above via total_ltcl

    remaining_ltcg_after_all = available_ltcg_after_stcl

    # §112A exemption: applied to equity LTCG portion only
    net_112a = sum(v for k, v in bucket_gains.items() if k in _112A_KEYS and v > 0)
    # Proportion of net_112a in total LTCG (for attribution)
    _112a_fraction = (net_112a / total_ltcg) if total_ltcg > 0 else 0.0
    _112a_of_remaining = remaining_ltcg_after_all * _112a_fraction
    exemption = min(_112a_limit, _112a_of_remaining)

    result: list[dict] = []
    for key, gross_gain in bucket_gains.items():
        if gross_gain == 0:
            continue
        meta = BUCKET_META.get(key, {"label": key, "rate": None, "term": "short"})

        setoff_applied = 0.0
        exemption_applied = 0.0

        if gross_gain > 0:
            if key in _STCG_KEYS and total_stcg > 0:
                setoff_applied = stcl_on_stcg * (gross_gain / total_stcg)
            elif key in _112A_KEYS and net_112a > 0:
                # Share of exemption proportional to this bucket's 112A gains
                exemption_applied = exemption * (gross_gain / net_112a)
                # Also share of set-off on LTCG
                ltcl_offset = (total_ltcl + stcl_on_ltcg) * (gross_gain / total_ltcg) if total_ltcg > 0 else 0
                setoff_applied = ltcl_offset
            elif key in _LTCG_KEYS and total_ltcg > 0:
                ltcl_offset = (total_ltcl + stcl_on_ltcg) * (gross_gain / total_ltcg)
                setoff_applied = ltcl_offset

        taxable = max(0.0, gross_gain - setoff_applied - exemption_applied)
        rate = meta.get("rate")
        est_tax = round(taxable * rate / 100, 2) if rate is not None else None

        result.append({
            "key": key,
            "label": meta["label"],
            "gross_gain": round(gross_gain, 2),
            "setoff_applied": round(setoff_applied, 2),
            "exemption_applied": round(exemption_applied, 2),
            "taxable": round(taxable, 2),
            "rate": rate,
            "est_tax": est_tax,
        })

    return result


# ── Public API ────────────────────────────────────────────────────────────────

async def get_available_fys(db: AsyncSession) -> list[str]:
    """FYs with at least one SELL trade, floor FY 2020-21, in ascending order."""
    result = await db.execute(
        select(Trade.trade_date).where(Trade.trade_type == "SELL").distinct()
    )
    sell_dates = [row[0] for row in result.all()]
    if not sell_dates:
        return []

    floor_start, _ = _fy_to_dates(_FY_FLOOR)
    fys: set[str] = set()
    for d in sell_dates:
        if d >= floor_start:
            fys.add(_date_to_fy(d))

    return sorted(fys)


async def get_capital_gains(db: AsyncSession, fy: str) -> dict:
    """Compute realized capital gains for the given Indian FY (e.g. '2024-25').

    All trades across history are FIFO-matched; only lots with sell_date in [fy_start, fy_end]
    are included in the result. This is required for correct cost basis from prior years.
    """
    fy_start, fy_end = _fy_to_dates(fy)

    # Fetch all trades joined with instruments
    q = (
        select(Trade, Instrument)
        .join(Instrument, Trade.instrument_id == Instrument.id)
        .order_by(Trade.instrument_id, Trade.trade_date, Trade.id)
    )
    rows = (await db.execute(q)).all()

    # Identify equity instruments that might need §112A grandfathering
    # (bought before 1 Feb 2018 and sold in this FY)
    potential_grandfather_ids: set[int] = set()
    for trade, instrument in rows:
        if (
            instrument.instrument_type in ("STOCK", "ETF")
            and trade.trade_date < _GRANDFATHERING_CUTOFF
        ):
            potential_grandfather_ids.add(instrument.id)

    # Fetch 31 Jan 2018 closing prices for those instruments
    fmv_map: dict[int, float] = {}
    if potential_grandfather_ids:
        ph_rows = await db.execute(
            select(PriceHistory.instrument_id, PriceHistory.close)
            .where(
                PriceHistory.instrument_id.in_(potential_grandfather_ids),
                PriceHistory.price_date == _GRANDFATHERING_FMV_DATE,
            )
        )
        for instr_id, close in ph_rows.all():
            fmv_map[instr_id] = float(close)

    # Group trades by instrument
    by_instrument: dict[int, tuple[Instrument, list[dict]]] = {}
    for trade, instrument in rows:
        if instrument.id not in by_instrument:
            by_instrument[instrument.id] = (instrument, [])
        by_instrument[instrument.id][1].append({
            "trade_date": trade.trade_date,
            "trade_type": trade.trade_type,
            "quantity": float(trade.quantity),
            "price": float(trade.price),
            "brokerage": float(trade.brokerage),
        })

    all_realized: list[RealizedLot] = []
    all_attention: list[dict] = []
    intraday_totals: dict[str, float | int] = {"trades": 0, "pnl": 0.0}

    for instr_id, (instrument, trades) in by_instrument.items():
        itype = instrument.instrument_type  # STOCK / ETF / BOND / MF

        if itype in ("STOCK", "ETF"):
            asset_category = "equity"
        elif itype == "BOND":
            asset_category = "bond"
        elif itype == "MF":
            asset_category = _classify_mf_orientation(instrument.name, instrument.tradingsymbol)
        else:
            asset_category = "equity"  # fallback

        fmv = fmv_map.get(instr_id)
        symbol = instrument.tradingsymbol or instrument.name or str(instr_id)
        name = instrument.name

        realized, attention, intraday = _fifo_match(trades, symbol, name, asset_category, fmv)

        # Filter to requested FY by sell_date
        fy_realized = [lot for lot in realized if fy_start <= lot.sell_date <= fy_end]
        fy_attention = [a for a in attention if fy_start <= date.fromisoformat(a["sell_date"]) <= fy_end]

        all_realized.extend(fy_realized)
        all_attention.extend(fy_attention)
        intraday_totals["trades"] = int(intraday_totals["trades"]) + intraday["trades"]  # type: ignore[assignment]
        intraday_totals["pnl"] = round(float(intraday_totals["pnl"]) + intraday["pnl"], 2)  # type: ignore[assignment]

    # Aggregate gains per bucket
    bucket_gains: dict[str, float] = defaultdict(float)
    for lot in all_realized:
        bucket_gains[lot.tax_bucket] += lot.gain

    buckets = _apply_setoff(dict(bucket_gains), fy)

    total_gross = round(sum(lot.gain for lot in all_realized), 2)
    total_est_tax = round(sum(b["est_tax"] for b in buckets if b["est_tax"] is not None), 2)

    lots_out = [
        {
            "symbol": lot.symbol,
            "name": lot.name,
            "asset_category": lot.asset_category,
            "buy_date": lot.buy_date.isoformat(),
            "sell_date": lot.sell_date.isoformat(),
            "qty": round(lot.qty, 4),
            "buy_value": round(lot.buy_value, 2),
            "sell_value": round(lot.sell_value, 2),
            "expenses": round(lot.expenses, 2),
            "gain": round(lot.gain, 2),
            "holding_days": lot.holding_days,
            "tax_bucket": lot.tax_bucket,
            "flags": lot.flags,
        }
        for lot in sorted(all_realized, key=lambda x: (x.sell_date, x.symbol))
    ]

    return {
        "fy": fy,
        "buckets": buckets,
        "lots": lots_out,
        "intraday": intraday_totals,
        "attention": all_attention,
        "totals": {"gross_gain": total_gross, "est_tax": total_est_tax},
    }
