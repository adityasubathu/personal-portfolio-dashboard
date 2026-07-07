"""
Demo data seed. Populates every table with a realistic fictional portfolio.
Called from main.py on startup when DEMO_MODE=true and demo_seeded flag is absent.

Data fixtures:
  data/demo/ohlc/<SYMBOL>.json  — daily OHLC rows
  data/demo/nav/<ISIN>.json     — daily NAV rows
"""

import json
import os
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.allocation_target import AllocationTarget, AssetClassTarget
from app.models.app_config import AppConfig
from app.models.holding import Holding
from app.models.import_log import CSVImportLog
from app.models.instrument import Instrument
from app.models.manual_asset import ManualAsset
from app.models.mf_breakdown import AmfiMarketCap, MfSchemeBreakdown
from app.models.nav_history import NavHistory
from app.models.nav_tracked_instrument import NavTrackedInstrument
from app.models.policy_trigger import PolicyTriggerState
from app.models.price_history import PriceHistory
from app.models.trade import Trade

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_OHLC_DIR = os.path.join(_REPO_ROOT, "data", "demo", "ohlc")
_NAV_DIR = os.path.join(_REPO_ROOT, "data", "demo", "nav")

# ---------------------------------------------------------------------------
# Instrument definitions
# ---------------------------------------------------------------------------

_STOCKS = [
    {"isin": "INE002A01018", "tradingsymbol": "RELIANCE",   "exchange": "NSE", "name": "Reliance Industries Ltd"},
    {"isin": "INE040A01034", "tradingsymbol": "HDFCBANK",   "exchange": "NSE", "name": "HDFC Bank Ltd"},
    {"isin": "INE009A01021", "tradingsymbol": "INFY",        "exchange": "NSE", "name": "Infosys Ltd"},
    {"isin": "INE262H01021", "tradingsymbol": "PERSISTENT", "exchange": "NSE", "name": "Persistent Systems Ltd"},
    {"isin": "INE918I01026", "tradingsymbol": "CDSL",        "exchange": "NSE", "name": "Central Depository Services Ltd"},
    {"isin": "INE670A01012", "tradingsymbol": "TATAELXSI",  "exchange": "NSE", "name": "Tata Elxsi Ltd"},
]

_MFS = [
    {"isin": "INF789F01YN0", "tradingsymbol": "INF789F01YN0", "exchange": "BSE", "name": "UTI Nifty 50 Index Fund - Direct Growth"},
    {"isin": "INF174KA1CK2", "tradingsymbol": "INF174KA1CK2", "exchange": "BSE", "name": "Kotak Emerging Equity Fund - Direct Growth"},
    {"isin": "INF247L01AP3", "tradingsymbol": "INF247L01AP3", "exchange": "BSE", "name": "Motilal Oswal Nasdaq 100 FOF - Direct Growth"},
]

_ETFS = [
    {"isin": "INF204KB17I5", "tradingsymbol": "GOLDBEES",    "exchange": "NSE", "name": "Nippon India ETF Gold BeES"},
    {"isin": "INF109KC1Y56", "tradingsymbol": "SILVERIETF",  "exchange": "NSE", "name": "Nippon India Silver ETF"},
]

_BONDS = [
    {"isin": None, "tradingsymbol": "SGBAUG29", "exchange": "NSE", "name": "Sovereign Gold Bond Aug 2029"},
]

_INDICES = [
    {"tradingsymbol": "NIFTY 50",         "exchange": "NSE", "name": "Nifty 50",          "ohlc_key": "NIFTY50"},
    {"tradingsymbol": "NIFTY NEXT 50",    "exchange": "NSE", "name": "Nifty Next 50",     "ohlc_key": "NIFTYNXT50"},
    {"tradingsymbol": "NIFTY MIDCAP 150", "exchange": "NSE", "name": "Nifty Midcap 150",  "ohlc_key": "NIFTYMIDCAP150"},
    {"tradingsymbol": "NIFTY SMLCAP 250", "exchange": "NSE", "name": "Nifty Smallcap 250","ohlc_key": "NIFTYSMLCAP250"},
    {"tradingsymbol": "INDIA VIX",        "exchange": "NSE", "name": "India VIX",          "ohlc_key": "INDIAVIX"},
]

# ---------------------------------------------------------------------------
# Trade schedule
# ---------------------------------------------------------------------------

# Each entry: (tradingsymbol, date_str, type, qty, price)
_STOCK_TRADES = [
    # RELIANCE — two buys
    ("RELIANCE", "2024-08-05", "BUY", 10, 2420.00),
    ("RELIANCE", "2025-01-15", "BUY",  5, 2580.00),
    # HDFCBANK — three buys, one small sell
    ("HDFCBANK", "2024-07-20", "BUY", 15, 1540.00),
    ("HDFCBANK", "2024-11-10", "BUY", 10, 1610.00),
    ("HDFCBANK", "2025-03-05", "BUY",  5, 1680.00),
    ("HDFCBANK", "2025-06-01", "SELL", 5, 1730.00),
    # INFY — two buys
    ("INFY",     "2024-09-02", "BUY", 15, 1390.00),
    ("INFY",     "2025-02-20", "BUY",  5, 1520.00),
    # PERSISTENT — one buy
    ("PERSISTENT","2024-10-14","BUY", 10, 4350.00),
    # CDSL — two buys
    ("CDSL",     "2024-07-10", "BUY", 20, 1580.00),
    ("CDSL",     "2025-01-08", "BUY", 10, 1720.00),
    # TATAELXSI — one buy
    ("TATAELXSI","2024-08-22", "BUY",  8, 6950.00),
]

# MF: SIP-like — (isin, date_str, qty, price)
_MF_TRADES = [
    # UTI Nifty 50 — monthly SIP
    ("INF789F01YN0","2024-08-01",58.82,170.00),("INF789F01YN0","2024-09-01",57.47,174.00),
    ("INF789F01YN0","2024-10-01",56.18,178.00),("INF789F01YN0","2024-11-01",54.95,182.00),
    ("INF789F01YN0","2024-12-01",53.76,186.00),("INF789F01YN0","2025-01-01",52.63,190.00),
    ("INF789F01YN0","2025-02-01",51.55,194.00),("INF789F01YN0","2025-03-01",50.51,198.00),
    ("INF789F01YN0","2025-04-01",49.50,202.00),("INF789F01YN0","2025-05-01",48.54,206.00),
    ("INF789F01YN0","2025-06-01",47.62,210.00),("INF789F01YN0","2025-07-01",46.73,214.00),
    # Kotak Emerging — quarterly
    ("INF174KA1CK2","2024-08-15",53.19,188.00),("INF174KA1CK2","2024-11-15",49.50,202.00),
    ("INF174KA1CK2","2025-02-15",46.30,216.00),("INF174KA1CK2","2025-05-15",43.48,230.00),
    # MON100 — bi-annual
    ("INF247L01AP3","2024-09-10",148.81,67.20),("INF247L01AP3","2025-03-10",136.05,73.50),
]

# ETF trades
_ETF_TRADES = [
    ("INF204KB17I5","2024-08-01",  5, 560.00),
    ("INF204KB17I5","2025-02-01",  3, 640.00),
    ("INF109KC1Y56","2024-10-01", 10, 105.00),
    ("INF109KC1Y56","2025-04-01",  5, 118.00),
]

# Bond trades
_BOND_TRADES = [
    ("SGBAUG29","2024-09-15", 4, 6280.00),
]

# ---------------------------------------------------------------------------
# MF scheme breakdown rows
# ---------------------------------------------------------------------------

_MF_BREAKDOWN = {
    "INF789F01YN0": [  # UTI Nifty 50 — large-cap index
        ("Reliance Industries",          "Equity", 10.20, "Large Cap", "Oil & Gas"),
        ("HDFC Bank",                    "Equity",  8.50, "Large Cap", "Financial Services"),
        ("Infosys",                      "Equity",  6.80, "Large Cap", "Information Technology"),
        ("ICICI Bank",                   "Equity",  6.30, "Large Cap", "Financial Services"),
        ("TCS",                          "Equity",  5.90, "Large Cap", "Information Technology"),
        ("Bharti Airtel",                "Equity",  4.20, "Large Cap", "Telecom"),
        ("Kotak Mahindra Bank",          "Equity",  3.80, "Large Cap", "Financial Services"),
        ("Axis Bank",                    "Equity",  3.50, "Large Cap", "Financial Services"),
        ("L&T",                          "Equity",  3.20, "Large Cap", "Capital Goods"),
        ("HUL",                          "Equity",  2.90, "Large Cap", "FMCG"),
        ("Sun Pharma",                   "Equity",  2.80, "Large Cap", "Pharma"),
        ("Titan",                        "Equity",  2.10, "Large Cap", "Consumer Discretionary"),
        ("Bajaj Finance",                "Equity",  2.00, "Large Cap", "Financial Services"),
        ("Wipro",                        "Equity",  1.80, "Large Cap", "Information Technology"),
        ("NTPC",                         "Equity",  1.60, "Large Cap", "Power"),
        ("Cash and Equivalents",         "Cash",    3.40, "Cash", None),
    ],
    "INF174KA1CK2": [  # Kotak Emerging — mid-cap
        ("Persistent Systems",           "Equity",  4.50, "Mid Cap", "Information Technology"),
        ("CDSL",                         "Equity",  3.80, "Mid Cap", "Financial Services"),
        ("Coforge",                      "Equity",  3.60, "Mid Cap", "Information Technology"),
        ("Mphasis",                      "Equity",  3.40, "Mid Cap", "Information Technology"),
        ("Voltas",                       "Equity",  3.20, "Mid Cap", "Consumer Discretionary"),
        ("Oberoi Realty",                "Equity",  3.00, "Mid Cap", "Real Estate"),
        ("Crompton Greaves Consumer",    "Equity",  2.80, "Mid Cap", "Consumer Discretionary"),
        ("Sundaram Finance",             "Equity",  2.60, "Mid Cap", "Financial Services"),
        ("Tata Chemicals",               "Equity",  2.40, "Mid Cap", "Chemicals"),
        ("Birla Corporation",            "Equity",  2.20, "Mid Cap", "Cement"),
        ("Thermax",                      "Equity",  2.00, "Mid Cap", "Capital Goods"),
        ("JB Chemicals",                 "Equity",  1.80, "Mid Cap", "Pharma"),
        ("Schaeffler India",             "Equity",  1.60, "Mid Cap", "Auto Ancillaries"),
        ("Grindwell Norton",             "Equity",  1.40, "Mid Cap", "Capital Goods"),
        ("Cash and Equivalents",         "Cash",    2.00, "Cash", None),
    ],
    "INF247L01AP3": [  # MON100 / Nasdaq 100 — all foreign
        ("Apple Inc",                    "Equity", 12.50, "Equity - Foreign", "Information Technology"),
        ("Microsoft Corporation",        "Equity", 11.80, "Equity - Foreign", "Information Technology"),
        ("Nvidia Corporation",           "Equity",  9.20, "Equity - Foreign", "Information Technology"),
        ("Amazon.com Inc",               "Equity",  7.40, "Equity - Foreign", "Consumer Discretionary"),
        ("Alphabet Inc Class A",         "Equity",  5.60, "Equity - Foreign", "Information Technology"),
        ("Alphabet Inc Class C",         "Equity",  4.90, "Equity - Foreign", "Information Technology"),
        ("Meta Platforms Inc",           "Equity",  4.30, "Equity - Foreign", "Information Technology"),
        ("Tesla Inc",                    "Equity",  3.10, "Equity - Foreign", "Consumer Discretionary"),
        ("Broadcom Inc",                 "Equity",  2.80, "Equity - Foreign", "Information Technology"),
        ("Costco Wholesale",             "Equity",  2.20, "Equity - Foreign", "Consumer Staples"),
        ("Netflix Inc",                  "Equity",  1.90, "Equity - Foreign", "Communication Services"),
        ("Adobe Inc",                    "Equity",  1.60, "Equity - Foreign", "Information Technology"),
        ("Cash and Equivalents",         "Cash",    1.50, "Cash", None),
    ],
}

# ---------------------------------------------------------------------------
# AMFI market cap classification
# ---------------------------------------------------------------------------

_AMFI_ROWS = [
    # Large cap
    ("Reliance Industries Limited",  "INE002A01018", "RELIANCE",   "Large Cap", "Oil & Gas"),
    ("HDFC Bank Limited",            "INE040A01034", "HDFCBANK",   "Large Cap", "Financial Services"),
    ("Infosys Limited",              "INE009A01021", "INFY",        "Large Cap", "Information Technology"),
    ("ICICI Bank Limited",           "INE090A01021", "ICICIBANK",   "Large Cap", "Financial Services"),
    ("Tata Consultancy Services",    "INE467B01029", "TCS",         "Large Cap", "Information Technology"),
    ("Bharti Airtel Limited",        "INE397D01024", "BHARTIARTL",  "Large Cap", "Telecom"),
    ("Kotak Mahindra Bank Limited",  "INE237A01028", "KOTAKBANK",   "Large Cap", "Financial Services"),
    ("Axis Bank Limited",            "INE238A01034", "AXISBANK",    "Large Cap", "Financial Services"),
    ("Larsen & Toubro Limited",      "INE018A01030", "LT",          "Large Cap", "Capital Goods"),
    ("Hindustan Unilever Limited",   "INE030A01027", "HINDUNILVR",  "Large Cap", "FMCG"),
    ("Sun Pharmaceutical Industries","INE044A01036", "SUNPHARMA",   "Large Cap", "Pharma"),
    ("Titan Company Limited",        "INE280A01028", "TITAN",       "Large Cap", "Consumer Discretionary"),
    ("Bajaj Finance Limited",        "INE296A01024", "BAJFINANCE",  "Large Cap", "Financial Services"),
    ("Wipro Limited",                "INE075A01022", "WIPRO",       "Large Cap", "Information Technology"),
    ("NTPC Limited",                 "INE733E01010", "NTPC",        "Large Cap", "Power"),
    # Mid cap
    ("Persistent Systems Limited",   "INE262H01021", "PERSISTENT",  "Mid Cap", "Information Technology"),
    ("Central Depository Services",  "INE918I01026", "CDSL",        "Mid Cap", "Financial Services"),
    ("Coforge Limited",              "INE591G01017", "COFORGE",     "Mid Cap", "Information Technology"),
    ("Mphasis Limited",              "INE356A01018", "MPHASIS",     "Mid Cap", "Information Technology"),
    ("Voltas Limited",               "INE226A01021", "VOLTAS",      "Mid Cap", "Consumer Discretionary"),
    ("Sundaram Finance Limited",     "INE660A01013", "SUNDARMFIN",  "Mid Cap", "Financial Services"),
    # Small cap
    ("Tata Elxsi Limited",           "INE670A01012", "TATAELXSI",   "Small Cap", "Information Technology"),
]


def _norm_name(name: str) -> str:
    import re
    n = name.lower()
    n = re.sub(r"\b(limited|ltd|pvt|private|corporation|corp|inc|co)\b\.?", "", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_json(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)


def _ist_now() -> datetime:
    from app.time_util import now_ist
    return now_ist()


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------

async def seed_demo_data(db: AsyncSession) -> None:
    print("[demo] Seeding demo data...")

    # 1. Instruments
    sym_to_instr: dict[str, Instrument] = {}
    isin_to_instr: dict[str, Instrument] = {}

    async def _upsert_instrument(data: dict, itype: str) -> Instrument:
        isin = data.get("isin")
        sym = data["tradingsymbol"]
        if isin:
            existing = (await db.execute(select(Instrument).where(Instrument.isin == isin))).scalar_one_or_none()
        else:
            existing = (await db.execute(select(Instrument).where(Instrument.tradingsymbol == sym))).scalar_one_or_none()
        if existing:
            return existing
        instr = Instrument(
            isin=isin,
            tradingsymbol=sym,
            exchange=data["exchange"],
            instrument_type=itype,
            name=data["name"],
        )
        db.add(instr)
        await db.flush()
        return instr

    for s in _STOCKS:
        i = await _upsert_instrument(s, "STOCK")
        sym_to_instr[s["tradingsymbol"]] = i
        if s["isin"]:
            isin_to_instr[s["isin"]] = i

    for m in _MFS:
        i = await _upsert_instrument(m, "MF")
        sym_to_instr[m["tradingsymbol"]] = i
        isin_to_instr[m["isin"]] = i

    for e in _ETFS:
        i = await _upsert_instrument(e, "ETF")
        sym_to_instr[e["tradingsymbol"]] = i
        isin_to_instr[e["isin"]] = i

    for b in _BONDS:
        i = await _upsert_instrument(b, "BOND")
        sym_to_instr[b["tradingsymbol"]] = i

    index_instrs: dict[str, Instrument] = {}
    for idx in _INDICES:
        i = await _upsert_instrument(idx, "INDEX")
        index_instrs[idx["ohlc_key"]] = i

    await db.flush()
    print(f"[demo]   instruments: {len(sym_to_instr) + len(index_instrs)}")

    # 2. Trades + Holdings
    batch_id = str(uuid.uuid4())
    all_trades_by_sym: dict[str, list] = {}

    async def _add_trade(instr: Instrument, d: str, ttype: str, qty: float, price: float, segment: str):
        t = Trade(
            instrument_id=instr.id,
            trade_date=date.fromisoformat(d),
            trade_type=ttype,
            quantity=qty,
            price=price,
            amount=round(qty * price, 2),
            brokerage=0.0,
            exchange=instr.exchange,
            segment=segment,
            source="CSV_IMPORT",
            import_batch_id=batch_id,
        )
        db.add(t)
        all_trades_by_sym.setdefault(instr.tradingsymbol, []).append((date.fromisoformat(d), ttype, qty, price))

    for sym, d, ttype, qty, price in _STOCK_TRADES:
        await _add_trade(sym_to_instr[sym], d, ttype, qty, price, "EQ")

    for isin, d, qty, price in _MF_TRADES:
        await _add_trade(isin_to_instr[isin], d, "BUY", qty, price, "MF")

    for isin, d, qty, price in _ETF_TRADES:
        await _add_trade(isin_to_instr[isin], d, "BUY", qty, price, "ETF")

    for sym, d, qty, price in _BOND_TRADES:
        await _add_trade(sym_to_instr[sym], d, "BUY", qty, price, "BOND")

    await db.flush()
    print(f"[demo]   trades: {sum(len(v) for v in all_trades_by_sym.values())}")

    # 3. Holdings — compute from trades
    holding_defs = [
        # (symbol/isin, last_price, is_isin)
        ("RELIANCE",    3750.00, False),
        ("HDFCBANK",    1820.00, False),
        ("INFY",        1680.00, False),
        ("PERSISTENT",  5100.00, False),
        ("CDSL",        2050.00, False),
        ("TATAELXSI",   7400.00, False),
        ("INF789F01YN0", 171.50, True),
        ("INF174KA1CK2", 232.80, True),
        ("INF247L01AP3",  75.20, True),
        ("INF204KB17I5", 680.00, True),
        ("INF109KC1Y56", 125.00, True),
        ("SGBAUG29",    7450.00, False),
    ]

    ltp_at = _ist_now()
    for key, ltp, is_isin in holding_defs:
        instr = isin_to_instr.get(key) if is_isin else sym_to_instr.get(key)
        if not instr:
            continue
        trades_for = all_trades_by_sym.get(instr.tradingsymbol if not is_isin else key, [])
        if is_isin:
            trades_for = []
            for t_sym, t_list in all_trades_by_sym.items():
                if t_sym == key:
                    trades_for = t_list
                    break
            # also look up by isin — MF tradingsymbol == isin
            trades_for = all_trades_by_sym.get(key, [])

        net_qty = 0.0
        total_cost = 0.0
        for _, ttype, qty, price in trades_for:
            if ttype == "BUY":
                net_qty += qty
                total_cost += qty * price
            else:
                net_qty -= qty
                total_cost -= (total_cost / net_qty) * qty if net_qty > 0 else 0

        if net_qty <= 0:
            continue
        avg = total_cost / net_qty
        existing_h = (await db.execute(select(Holding).where(Holding.instrument_id == instr.id))).scalar_one_or_none()
        if existing_h:
            continue
        h = Holding(
            instrument_id=instr.id,
            quantity=round(net_qty, 6),
            average_price=round(avg, 4),
            total_cost=round(total_cost, 2),
            last_price=ltp,
            last_price_at=ltp_at,
            unrealised_pnl=round((ltp - avg) * net_qty, 2),
        )
        db.add(h)

    await db.flush()
    print("[demo]   holdings: done")

    # 4. Price history — stocks + bonds + indices
    ohlc_map = {
        "RELIANCE": sym_to_instr["RELIANCE"],
        "HDFCBANK": sym_to_instr["HDFCBANK"],
        "INFY":     sym_to_instr["INFY"],
        "PERSISTENT": sym_to_instr["PERSISTENT"],
        "CDSL":     sym_to_instr["CDSL"],
        "TATAELXSI": sym_to_instr["TATAELXSI"],
        "SGBAUG29": sym_to_instr["SGBAUG29"],
    }
    for ohlc_key, instr in index_instrs.items():
        ohlc_map[ohlc_key] = instr

    ph_count = 0
    for symbol, instr in ohlc_map.items():
        rows = _load_json(os.path.join(_OHLC_DIR, f"{symbol}.json"))
        if not rows:
            continue
        ph_rows = [
            {
                "instrument_id": instr.id,
                "price_date": r["date"],
                "open": r.get("open"),
                "high": r.get("high"),
                "low": r.get("low"),
                "close": r["close"],
            }
            for r in rows
        ]
        if ph_rows:
            stmt = pg_insert(PriceHistory).values(ph_rows).on_conflict_do_nothing(
                constraint="uq_price_history_instr_date"
            )
            await db.execute(stmt)
            ph_count += len(ph_rows)

    await db.flush()
    print(f"[demo]   price_history rows: {ph_count}")

    # 5. NAV history — MFs + ETFs
    nav_isin_map = {
        "INF789F01YN0": isin_to_instr["INF789F01YN0"],
        "INF174KA1CK2": isin_to_instr["INF174KA1CK2"],
        "INF247L01AP3": isin_to_instr["INF247L01AP3"],
        "INF204KB17I5": isin_to_instr["INF204KB17I5"],
        "INF109KC1Y56": isin_to_instr["INF109KC1Y56"],
    }
    nh_count = 0
    for isin, instr in nav_isin_map.items():
        rows = _load_json(os.path.join(_NAV_DIR, f"{isin}.json"))
        if not rows:
            continue
        nh_rows = [{"instrument_id": instr.id, "nav_date": r["date"], "nav": r["nav"]} for r in rows]
        if nh_rows:
            stmt = pg_insert(NavHistory).values(nh_rows).on_conflict_do_nothing(
                constraint="uq_nav_history_instr_date"
            )
            await db.execute(stmt)
            nh_count += len(nh_rows)

    await db.flush()
    print(f"[demo]   nav_history rows: {nh_count}")

    # 6. MF scheme breakdown
    bd_count = 0
    for isin, rows in _MF_BREAKDOWN.items():
        for name, htype, pct, cat, sector in rows:
            stmt = pg_insert(MfSchemeBreakdown).values(
                scheme_isin=isin,
                name=name,
                holding_type=htype,
                holdings_pct=pct,
                category=cat,
                sector=sector,
            ).on_conflict_do_update(
                constraint="uq_mf_breakdown_scheme_name_type",
                set_={"holdings_pct": pct, "category": cat, "sector": sector},
            )
            await db.execute(stmt)
            bd_count += 1

    await db.flush()
    print(f"[demo]   mf_scheme_breakdown rows: {bd_count}")

    # 7. AMFI market cap
    amc_count = 0
    for company, isin, ticker, cap, sector in _AMFI_ROWS:
        existing = (await db.execute(
            select(AmfiMarketCap).where(AmfiMarketCap.isin == isin)
        )).scalar_one_or_none()
        if existing:
            continue
        db.add(AmfiMarketCap(
            company_name=company,
            isin=isin,
            nse_symbol=ticker,
            primary_ticker=ticker,
            exchanges="NSE",
            categorization=cap,
            sector=sector,
            name_normalized=_norm_name(company),
        ))
        amc_count += 1

    await db.flush()
    print(f"[demo]   amfi_market_cap rows: {amc_count}")

    # 8. Allocation targets
    cat_targets = [
        ("Large Cap", 50.0), ("Mid Cap", 30.0), ("Small Cap", 20.0),
        ("Equity - Foreign", 20.0),
    ]
    for cat, pct in cat_targets:
        existing = (await db.execute(select(AllocationTarget).where(AllocationTarget.category == cat))).scalar_one_or_none()
        if not existing:
            db.add(AllocationTarget(category=cat, target_pct=pct))

    ac_targets = [("Equity", 65.0), ("Debt", 30.0), ("Precious Metals", 5.0)]
    for ac, pct in ac_targets:
        existing = (await db.execute(select(AssetClassTarget).where(AssetClassTarget.asset_class == ac))).scalar_one_or_none()
        if not existing:
            db.add(AssetClassTarget(asset_class=ac, target_pct=pct))

    await db.flush()
    print("[demo]   allocation targets: done")

    # 9. Manual assets
    manual_rows = [
        ManualAsset(asset_type="FD",   label="SBI Fixed Deposit",    principal=500000, interest_rate=7.1,  start_date=date(2025,1,15), maturity_date=date(2028,1,15), is_emergency_fund=False),
        ManualAsset(asset_type="FD",   label="HDFC Emergency FD",    principal=1000000, interest_rate=6.5, start_date=date(2025,6,1),  maturity_date=date(2026,6,1),  is_emergency_fund=True),
        ManualAsset(asset_type="PPF",  label="PPF",                  current_value=800000),
        ManualAsset(asset_type="NPS",  label="NPS",                  current_value=300000),
        ManualAsset(asset_type="CASH", label="Savings / Current",    current_value=150000),
        ManualAsset(asset_type="FOREIGN_EQ", label="US Tech (AAPL, GOOGL)", current_value=1200.0, principal=1050.0),
    ]
    for m in manual_rows:
        db.add(m)

    await db.flush()
    print("[demo]   manual assets: done")

    # 10. USDINR rate in app_config
    usdinr_payload = json.dumps({"rate": 85.50, "source": "demo", "fetched_at": datetime.now(timezone.utc).isoformat()})
    stmt = pg_insert(AppConfig).values(key="usdinr_rate", value_json=usdinr_payload).on_conflict_do_update(
        index_elements=["key"], set_={"value_json": usdinr_payload}
    )
    await db.execute(stmt)
    print("[demo]   usdinr rate: 85.50")

    # 11. CSV import log
    import_entries = [
        CSVImportLog(batch_id=batch_id,       filename="kite_tradebook_2024_2025.csv", row_count=62, success_count=62, error_count=0),
        CSVImportLog(batch_id=str(uuid.uuid4()), filename="kite_tradebook_2023_2024.csv", row_count=28, success_count=28, error_count=0),
    ]
    for entry in import_entries:
        db.add(entry)

    await db.flush()
    print("[demo]   import log: done")

    # 12. NavTrackedInstrument for MFs + ETFs
    for isin, instr in nav_isin_map.items():
        existing = (await db.execute(select(NavTrackedInstrument).where(NavTrackedInstrument.instrument_id == instr.id))).scalar_one_or_none()
        if not existing:
            db.add(NavTrackedInstrument(instrument_id=instr.id))

    await db.flush()
    print("[demo]   nav tracked instruments: done")

    # 13. Policy trigger state — one acknowledged trigger
    existing_pts = (await db.execute(select(PolicyTriggerState).where(PolicyTriggerState.key == "sp500_inflows_fy27"))).scalar_one_or_none()
    if not existing_pts:
        db.add(PolicyTriggerState(key="sp500_inflows_fy27", value_bool=True, acknowledged_at=_ist_now()))

    await db.flush()

    # 14. demo_seeded flag
    flag_payload = json.dumps("true")
    stmt = pg_insert(AppConfig).values(key="demo_seeded", value_json=flag_payload).on_conflict_do_update(
        index_elements=["key"], set_={"value_json": flag_payload}
    )
    await db.execute(stmt)

    await db.commit()
    print("[demo] Seed complete.")
