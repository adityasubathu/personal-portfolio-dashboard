"""
FIFO holdings engine.

Walks all trades for each instrument in chronological order and computes:
  - current quantity held
  - average cost (weighted by remaining lots)
  - total cost basis (FIFO-adjusted)
  - realised PnL (informational)

Updates the `holdings` table in place. Instruments with zero remaining
quantity have their holding row deleted (or quantity set to 0).
"""
from collections import deque
from datetime import date, datetime
from typing import Literal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.models.trade import Trade
from app.schemas.portfolio import DirectHoldingsResponse, HoldingRow, HoldingsSection
from app.services.xirr import compute_holdings_xirr
from app.time_util import now_ist

SORT_FIELDS = {"symbol", "type", "qty", "avg_price", "cost", "ltp", "as_of", "value", "pnl", "pnl_pct", "xirr", "day_chg_pct", "day_chg_abs"}

SECTION_ORDER = [
    ("Equity", {"STOCK", "ETF"}),
    ("Bonds", {"BOND"}),
    ("Mutual Funds", {"MF"}),
]


def _sort_key(row: dict, field: str):
    v = row.get(field)
    if v is None:
        return (1, 0)
    if isinstance(v, str):
        return (0, v.lower())
    return (0, v)


def _isodate(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def _range(vs):
    vs = [v for v in vs if v is not None]
    neg = [v for v in vs if v < 0]
    pos = [v for v in vs if v > 0]
    return (min(neg) if neg else None, max(pos) if pos else None)


async def get_direct_holdings(
    db: AsyncSession,
    sort: str = "symbol",
    direction: Literal["asc", "desc"] = "asc",
    sections: Literal["on", "off"] = "on",
    compare: Literal["prev_close", "open"] = "prev_close",
) -> DirectHoldingsResponse:
    if sort not in SORT_FIELDS:
        sort = "symbol"

    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    raw = result.all()

    today = date.today()
    xirrs = await compute_holdings_xirr(db, as_of=today)

    instr_ids = [instr.id for _, instr in raw]
    mf_instr_ids = {instr.id for _, instr in raw if instr.instrument_type == "MF"}
    non_mf_ids = [i for i in instr_ids if i not in mf_instr_ids]
    mf_id_list = [i for i in instr_ids if i in mf_instr_ids]
    prev_close_map: dict[int, tuple[float, date]] = {}
    today_open_map: dict[int, float] = {}
    ohlc_ltp_map: dict[int, tuple[float, date]] = {}

    if non_mf_ids:
        sub = select(
            PriceHistory.instrument_id,
            PriceHistory.price_date,
            PriceHistory.open,
            PriceHistory.close,
            func.row_number().over(
                partition_by=PriceHistory.instrument_id,
                order_by=PriceHistory.price_date.desc(),
            ).label("rn"),
        ).where(PriceHistory.instrument_id.in_(non_mf_ids)).subquery()
        all_rows = (await db.execute(select(sub).where(sub.c.rn <= 2))).all()

        by_instr: dict[int, list] = {}
        for r in all_rows:
            by_instr.setdefault(r.instrument_id, []).append(r)

        for iid, entries in by_instr.items():
            entries.sort(key=lambda e: e.price_date, reverse=True)
            ohlc_ltp_map[iid] = (float(entries[0].close), entries[0].price_date)
            if entries[0].open is not None:
                today_open_map[iid] = float(entries[0].open)
            if len(entries) >= 2:
                prev_close_map[iid] = (float(entries[1].close), entries[1].price_date)

    if mf_id_list:
        nav_sub = select(
            NavHistory.instrument_id,
            NavHistory.nav_date,
            NavHistory.nav,
            func.row_number().over(
                partition_by=NavHistory.instrument_id,
                order_by=NavHistory.nav_date.desc(),
            ).label("rn"),
        ).where(NavHistory.instrument_id.in_(mf_id_list)).subquery()
        nav_rows = (await db.execute(select(nav_sub).where(nav_sub.c.rn <= 2))).all()

        by_mf: dict[int, list] = {}
        for r in nav_rows:
            by_mf.setdefault(r.instrument_id, []).append(r)

        for iid, entries in by_mf.items():
            entries.sort(key=lambda e: e.nav_date, reverse=True)
            if len(entries) >= 2:
                prev_close_map[iid] = (float(entries[1].nav), entries[1].nav_date)

    etf_ids = [instr.id for _, instr in raw if instr.instrument_type == "ETF"]
    etf_nav: dict[int, tuple[float, date]] = {}
    if etf_ids:
        sub = (
            select(
                NavHistory.instrument_id,
                func.max(NavHistory.nav_date).label("max_date"),
            )
            .where(NavHistory.instrument_id.in_(etf_ids))
            .group_by(NavHistory.instrument_id)
            .subquery()
        )
        latest_q = select(NavHistory).join(
            sub,
            (NavHistory.instrument_id == sub.c.instrument_id)
            & (NavHistory.nav_date == sub.c.max_date),
        )
        for row in (await db.execute(latest_q)).scalars().all():
            etf_nav[row.instrument_id] = (float(row.nav), row.nav_date)

    enriched: list[dict] = []
    for h, instr in raw:
        cost = float(h.total_cost or 0)
        ohlc_entry = ohlc_ltp_map.get(instr.id)
        if instr.instrument_type != "MF":
            holding_ltp = float(h.last_price) if h.last_price else None
            holding_date = h.last_price_at.date() if h.last_price_at else None
            if ohlc_entry:
                ohlc_close, ohlc_date = ohlc_entry
                if holding_ltp is not None and holding_date is not None and holding_date >= ohlc_date:
                    ltp, ltp_as_of = holding_ltp, h.last_price_at
                else:
                    ltp, ltp_as_of = ohlc_close, ohlc_date
            else:
                ltp, ltp_as_of = holding_ltp, h.last_price_at
        else:
            ltp = float(h.last_price) if h.last_price else None
            ltp_as_of = h.last_price_at
        value = float(h.quantity) * ltp if ltp else cost
        pnl = value - cost
        pnl_pct = (pnl / cost * 100) if cost > 0 else None
        xirr_pct = xirrs[instr.id] * 100 if instr.id in xirrs else None
        nav = None
        nav_as_of = None
        nav_premium = None
        if instr.instrument_type == "ETF" and instr.id in etf_nav:
            nav, nav_as_of = etf_nav[instr.id]
            if ltp is not None and nav > 0:
                nav_premium = (ltp - nav) / nav * 100
        prev_close_entry = prev_close_map.get(instr.id)
        prev_close = prev_close_entry[0] if prev_close_entry else None
        prev_close_date = prev_close_entry[1] if prev_close_entry else None
        today_open = today_open_map.get(instr.id)
        ref_price = today_open if compare == "open" else prev_close
        day_chg_pct = ((ltp - ref_price) / ref_price * 100) if ltp is not None and ref_price else None
        day_chg_abs = ((ltp - ref_price) * float(h.quantity)) if ltp is not None and ref_price else None

        enriched.append({
            "instrument_id": instr.id,
            "symbol": instr.tradingsymbol or "",
            "type": instr.instrument_type or "",
            "isin": instr.isin,
            "name": instr.name,
            "qty": float(h.quantity),
            "avg_price": float(h.average_price) if h.average_price else None,
            "cost": cost,
            "ltp": ltp,
            "as_of": _isodate(ltp_as_of),
            "value": value,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "xirr": xirr_pct,
            "nav": nav,
            "nav_as_of": _isodate(nav_as_of),
            "nav_premium": nav_premium,
            "prev_close": prev_close,
            "prev_close_date": _isodate(prev_close_date),
            "day_chg_pct": day_chg_pct,
            "day_chg_abs": day_chg_abs,
        })

    total_cost = sum(r["cost"] for r in enriched)
    total_value = sum(r["value"] for r in enriched)
    total_day_chg = sum(r["day_chg_abs"] for r in enriched if r["day_chg_abs"] is not None)
    prev_total = total_value - total_day_chg
    total_day_chg_pct = (total_day_chg / prev_total * 100) if prev_total else None

    pnl_min, pnl_max = _range([r["pnl"] for r in enriched])
    pnl_pct_min, pnl_pct_max = _range([r["pnl_pct"] for r in enriched])
    xirr_min, xirr_max = _range([r["xirr"] for r in enriched])
    day_chg_abs_min, day_chg_abs_max = _range([r["day_chg_abs"] for r in enriched])

    reverse = direction == "desc"
    enriched.sort(key=lambda r: r["symbol"].lower())
    enriched.sort(key=lambda r: _sort_key(r, sort), reverse=reverse)

    sections_enabled = sections == "on"
    if sections_enabled:
        groups = []
        for label, types in SECTION_ORDER:
            group_rows = [r for r in enriched if r["type"] in types]
            if group_rows:
                gmin, gmax = _range([r["day_chg_abs"] for r in group_rows])
                groups.append({"label": label, "rows": group_rows, "day_chg_abs_min": gmin, "day_chg_abs_max": gmax})
    else:
        groups = [{"label": None, "rows": enriched, "day_chg_abs_min": day_chg_abs_min, "day_chg_abs_max": day_chg_abs_max}]

    return DirectHoldingsResponse(
        groups=[HoldingsSection(label=g["label"], rows=[HoldingRow(**r) for r in g["rows"]], day_chg_abs_min=g["day_chg_abs_min"], day_chg_abs_max=g["day_chg_abs_max"]) for g in groups],
        sections_enabled=sections_enabled,
        current_sort=sort,
        current_dir=direction,
        total_cost=total_cost,
        total_value=total_value,
        total_day_chg=total_day_chg,
        total_day_chg_pct=total_day_chg_pct,
        compare=compare,
        pnl_min=pnl_min, pnl_max=pnl_max,
        pnl_pct_min=pnl_pct_min, pnl_pct_max=pnl_pct_max,
        xirr_min=xirr_min, xirr_max=xirr_max,
        day_chg_abs_min=day_chg_abs_min, day_chg_abs_max=day_chg_abs_max,
    )


async def recompute_holdings(db: AsyncSession) -> dict:
    """
    Recompute all holdings from scratch from the trades table.
    Preserves last_price / last_price_at / kite_synced fields on existing rows
    so a CSV re-import doesn't wipe price data populated by Kite/AMFI sync.
    Returns { count, violations } where violations is a list of instruments whose
    cumulative SELL quantity exceeds BUY quantity (impossible for cash holdings of
    STOCK/ETF/BOND/MF — indicates missing buy trades in the imported data).
    """
    # Snapshot price fields from existing holdings, keyed by instrument_id
    existing = (await db.execute(select(Holding))).scalars().all()
    price_cache: dict[int, dict] = {
        h.instrument_id: {
            "last_price": h.last_price,
            "last_price_at": h.last_price_at,
            "unrealised_pnl": h.unrealised_pnl,
            "kite_synced": h.kite_synced,
            "kite_synced_at": h.kite_synced_at,
        }
        for h in existing
    }

    # Fetch all trades ordered by instrument then date
    result = await db.execute(
        select(Trade).order_by(Trade.instrument_id, Trade.trade_date, Trade.id)
    )
    trades = result.scalars().all()

    by_instrument: dict[int, list[Trade]] = {}
    for t in trades:
        by_instrument.setdefault(t.instrument_id, []).append(t)

    instrument_rows = (await db.execute(select(Instrument))).scalars().all()
    instruments = {i.id: i for i in instrument_rows}

    await db.execute(delete(Holding))

    upserted = 0
    violations: list[dict] = []
    for instrument_id, instrument_trades in by_instrument.items():
        ledger = _fifo_ledger(instrument_trades)

        if ledger["total_sell"] > ledger["total_buy"] + 1e-6:
            instr = instruments.get(instrument_id)
            violations.append({
                "instrument_id": instrument_id,
                "tradingsymbol": instr.tradingsymbol if instr else f"#{instrument_id}",
                "isin": instr.isin if instr else None,
                "instrument_type": instr.instrument_type if instr else "?",
                "total_buy": round(ledger["total_buy"], 6),
                "total_sell": round(ledger["total_sell"], 6),
                "net": round(ledger["total_buy"] - ledger["total_sell"], 6),
            })

        if ledger["quantity"] <= 0:
            continue

        cached = price_cache.get(instrument_id, {})
        last_price = cached.get("last_price")
        unrealised = None
        if last_price is not None:
            unrealised = round(
                ledger["quantity"] * (float(last_price) - ledger["average_price"]), 6
            )

        h = Holding(
            instrument_id=instrument_id,
            quantity=ledger["quantity"],
            average_price=ledger["average_price"],
            total_cost=ledger["total_cost"],
            last_price=last_price,
            last_price_at=cached.get("last_price_at"),
            unrealised_pnl=unrealised,
            kite_synced=cached.get("kite_synced", False),
            kite_synced_at=cached.get("kite_synced_at"),
            updated_at=now_ist(),
        )
        db.add(h)
        upserted += 1

    await db.flush()
    return {"count": upserted, "violations": violations}


def _fifo_ledger(trades: list[Trade]) -> dict:
    """
    Process a list of trades for a single instrument using FIFO.
    Returns { quantity, average_price, total_cost, realised_pnl, total_buy, total_sell }.
    """
    lots: deque[tuple[float, float]] = deque()
    realised_pnl = 0.0
    total_buy = 0.0
    total_sell = 0.0

    for trade in trades:
        qty = float(trade.quantity)
        price = float(trade.price)

        if trade.trade_type == "BUY":
            total_buy += qty
            lots.append((qty, price))

        elif trade.trade_type == "SELL":
            total_sell += qty
            remaining_sell = qty
            while remaining_sell > 0 and lots:
                lot_qty, lot_price = lots[0]
                if lot_qty <= remaining_sell:
                    realised_pnl += lot_qty * (price - lot_price)
                    remaining_sell -= lot_qty
                    lots.popleft()
                else:
                    realised_pnl += remaining_sell * (price - lot_price)
                    lots[0] = (lot_qty - remaining_sell, lot_price)
                    remaining_sell = 0

    total_qty = sum(q for q, _ in lots)
    total_cost = sum(q * p for q, p in lots)
    avg_price = total_cost / total_qty if total_qty > 0 else 0.0

    return {
        "quantity": round(total_qty, 6),
        "average_price": round(avg_price, 6),
        "total_cost": round(total_cost, 6),
        "realised_pnl": round(realised_pnl, 6),
        "total_buy": total_buy,
        "total_sell": total_sell,
    }
