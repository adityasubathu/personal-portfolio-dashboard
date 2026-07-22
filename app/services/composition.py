from collections import defaultdict
from difflib import SequenceMatcher

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, EquitySectorOverride, MfSchemeBreakdown
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.models.trade import Trade
from app.services.allocation import _classify_stock_instrument, _load_amfi_lookups
from app.services.mf_ingest import COMMODITY_ETF_CATEGORY, _SGB_RE, normalize_company_name
from app.time_util import now_ist

_CAT_ORDER = ["Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Foreign", "Equity - Arbitrage", "Real Estate Trust", "Gold", "Silver", "Debt", "Cash", "Other"]

_NON_EQUITY_SECTORS = {"Fixed Income", "Liquid / Money Market", "Gold", "Silver"}


async def get_available_schemes(db: AsyncSession) -> list[dict]:
    scheme_isins = (await db.execute(
        select(MfSchemeBreakdown.scheme_isin).distinct()
    )).scalars().all()
    if not scheme_isins:
        return []

    instruments = (await db.execute(
        select(Instrument).where(Instrument.isin.in_(scheme_isins))
    )).scalars().all()
    isin_to_name = {i.isin: i.tradingsymbol or i.name or i.isin for i in instruments}

    result = []
    for isin in sorted(scheme_isins, key=lambda s: isin_to_name.get(s, s)):
        result.append({"scheme_isin": isin, "name": isin_to_name.get(isin, isin)})
    return result


async def get_scheme_breakdown(db: AsyncSession, scheme_isin: str) -> dict:
    rows = (await db.execute(
        select(MfSchemeBreakdown)
        .where(MfSchemeBreakdown.scheme_isin == scheme_isin)
        .order_by(MfSchemeBreakdown.holdings_pct.desc())
    )).scalars().all()

    if not rows:
        return {"holdings": [], "category_summary": []}

    # Resolve fund market value from the holding record
    holding_row = (await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.isin == scheme_isin)
    )).first()
    fund_value = 0.0
    if holding_row:
        h, _ = holding_row
        ltp = float(h.last_price) if h.last_price else None
        fund_value = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

    holdings = []
    cat_value_totals: dict[str, float] = {}
    cat_pct_totals: dict[str, float] = {}
    for r in rows:
        pct = float(r.holdings_pct)
        value = round(fund_value * (pct / 100.0), 2)
        holdings.append({
            "name": r.name,
            "type": r.holding_type,
            "category": r.category,
            "pct": round(pct, 4),
            "value": value,
        })
        cat_value_totals[r.category] = cat_value_totals.get(r.category, 0) + value
        cat_pct_totals[r.category] = cat_pct_totals.get(r.category, 0) + pct

    order = [
        "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity",
        "Equity - Foreign", "Equity - Arbitrage", "Real Estate Trust", "Gold", "Silver", "Debt", "Cash", "Other",
    ]
    category_summary = []
    for cat in order:
        pct_total = cat_pct_totals.get(cat, 0)
        if pct_total > 0:
            category_summary.append({
                "category": cat,
                "pct": round(pct_total, 2),
                "value": round(cat_value_totals.get(cat, 0), 2),
            })

    return {"holdings": holdings, "category_summary": category_summary}


async def get_category_composition(db: AsyncSession) -> list[dict]:
    """Returns per-category breakdown showing each contributing source and its value."""
    from app.services.manual_assets import get_manual_assets_summary

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()

    isin_to_cat, name_to_cat = await _load_amfi_lookups(db)

    # cat -> list of {name, source_type, fund_pct, contribution}
    composition: dict[str, list[dict]] = {}

    def _add(cat: str, entry: dict):
        composition.setdefault(cat, []).append(entry)

    # MF/ETF: group breakdown rows by (scheme_isin, category)
    fund_values: dict[str, tuple[float, str]] = {}
    for h, i in all_holdings:
        if i.instrument_type in ("MF", "ETF") and i.isin:
            ltp = float(h.last_price) if h.last_price else None
            val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
            commodity_cat = COMMODITY_ETF_CATEGORY.get(i.isin)
            if commodity_cat:
                _add(commodity_cat, {"name": i.name or i.tradingsymbol or i.isin, "source_type": "etf", "fund_pct": 100.0, "contribution": round(val, 2)})
            else:
                fund_values[i.isin] = (val, i.name or i.tradingsymbol or i.isin)

    if fund_values:
        breakdown_rows = (await db.execute(
            select(MfSchemeBreakdown).where(MfSchemeBreakdown.scheme_isin.in_(list(fund_values.keys())))
        )).scalars().all()

        scheme_cat: dict[tuple, float] = defaultdict(float)
        for row in breakdown_rows:
            scheme_cat[(row.scheme_isin, row.category)] += float(row.holdings_pct)

        for (isin, cat), pct in scheme_cat.items():
            fund_val, fund_name = fund_values[isin]
            contribution = fund_val * pct / 100
            if contribution <= 0:
                continue
            _add(cat, {"name": fund_name, "isin": isin, "source_type": "fund", "fund_pct": round(pct, 2), "contribution": round(contribution, 2), "fund_value": round(fund_val, 2)})

    # Direct stocks
    for h, i in all_holdings:
        if i.instrument_type == "STOCK":
            ltp = float(h.last_price) if h.last_price else None
            val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
            if val <= 0:
                continue
            cat = _classify_stock_instrument(i.isin, i.name, i.tradingsymbol, isin_to_cat, name_to_cat)
            _add(cat, {"name": i.name or i.tradingsymbol or "Unknown", "source_type": "stock", "fund_pct": 100.0, "contribution": round(val, 2)})

    # Bonds: SGB → Gold, everything else → Debt
    for h, i in all_holdings:
        if i.instrument_type == "BOND":
            ltp = float(h.last_price) if h.last_price else None
            val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
            if val <= 0:
                continue
            if i.tradingsymbol and _SGB_RE.match(i.tradingsymbol):
                _add("Gold", {"name": i.tradingsymbol, "source_type": "bond", "fund_pct": 100.0, "contribution": round(val, 2)})
            else:
                _add("Debt", {"name": i.tradingsymbol or i.name or "Govt Bond", "source_type": "bond", "fund_pct": 100.0, "contribution": round(val, 2)})

    # Manual assets
    manual = await get_manual_assets_summary(db)
    if manual["total_fd"] > 0:
        _add("Debt", {"name": "Fixed Deposits", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_fd"], 2)})
    if manual["total_ppf"] > 0:
        _add("Debt", {"name": "PPF", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_ppf"], 2)})
    if manual.get("nps"):
        nps_val = manual["nps"]["current_value"]
        if nps_val > 0:
            _add("Large Cap", {"name": "NPS (equity portion)", "source_type": "manual", "fund_pct": 75.0, "contribution": round(nps_val * 0.75, 2)})
            _add("Debt", {"name": "NPS (debt portion)", "source_type": "manual", "fund_pct": 25.0, "contribution": round(nps_val * 0.25, 2)})
    if manual.get("total_cash", 0) > 0:
        _add("Cash", {"name": "Savings / Cash", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_cash"], 2)})
    for fe in manual.get("foreign_equities", []):
        if fe["value_inr"] > 0:
            _add("Equity - Foreign", {"name": fe["label"], "source_type": "manual", "fund_pct": 100.0, "contribution": round(fe["value_inr"], 2)})

    # Build ordered list with totals and per-source share_pct
    out = []
    for cat in _CAT_ORDER:
        sources = composition.get(cat)
        if not sources:
            continue
        sources.sort(key=lambda x: x["contribution"], reverse=True)
        total = sum(s["contribution"] for s in sources)
        for s in sources:
            s["share_pct"] = round(s["contribution"] / total * 100, 1) if total else 0
        out.append({"category": cat, "total": round(total, 2), "sources": sources})

    return out


async def get_sector_composition(db: AsyncSession, equity_only: bool = False) -> list[dict]:
    """Returns per-sector breakdown showing each contributing source and its value."""
    from app.services.manual_assets import get_manual_assets_summary

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()

    # Sector lookups for direct stocks
    amfi_all = (await db.execute(select(AmfiMarketCap))).scalars().all()
    isin_to_sector: dict[str, str] = {a.isin: a.sector for a in amfi_all if a.isin and a.sector}
    name_to_sector: dict[str, str] = {a.name_normalized: a.sector for a in amfi_all if a.sector}

    composition: dict[str, list[dict]] = {}

    def _add(sector: str, entry: dict):
        composition.setdefault(sector, []).append(entry)

    # MF/ETF: group breakdown rows by (scheme_isin, sector)
    fund_values: dict[str, tuple[float, str]] = {}
    for h, i in all_holdings:
        if i.instrument_type in ("MF", "ETF") and i.isin:
            ltp = float(h.last_price) if h.last_price else None
            val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
            commodity_cat = COMMODITY_ETF_CATEGORY.get(i.isin)
            if commodity_cat:
                _add(commodity_cat, {"name": i.name or i.tradingsymbol or i.isin, "source_type": "etf", "fund_pct": 100.0, "contribution": round(val, 2)})
            else:
                fund_values[i.isin] = (val, i.name or i.tradingsymbol or i.isin)

    if fund_values:
        breakdown_rows = (await db.execute(
            select(MfSchemeBreakdown).where(
                MfSchemeBreakdown.scheme_isin.in_(list(fund_values.keys())),
                MfSchemeBreakdown.category != "Equity - Arbitrage",
            )
        )).scalars().all()

        scheme_sector: dict[tuple, float] = defaultdict(float)
        for row in breakdown_rows:
            sec = row.sector or "Unknown"
            scheme_sector[(row.scheme_isin, sec)] += float(row.holdings_pct)

        for (isin, sec), pct in scheme_sector.items():
            fund_val, fund_name = fund_values[isin]
            contribution = fund_val * pct / 100
            if contribution <= 0:
                continue
            _add(sec, {"name": fund_name, "isin": isin, "source_type": "fund", "fund_pct": round(pct, 2), "contribution": round(contribution, 2), "fund_value": round(fund_val, 2)})

    # Direct stocks
    for h, i in all_holdings:
        if i.instrument_type == "STOCK":
            ltp = float(h.last_price) if h.last_price else None
            val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
            if val <= 0:
                continue
            sec = isin_to_sector.get(i.isin or "")
            if sec is None and (i.name or i.tradingsymbol):
                norm = normalize_company_name(i.name or i.tradingsymbol or "")
                sec = name_to_sector.get(norm)
                if sec is None:
                    best_r, best_s = 0.0, None
                    for amfi_norm, amfi_sec in name_to_sector.items():
                        r = SequenceMatcher(None, norm, amfi_norm).ratio()
                        if r > best_r:
                            best_r, best_s = r, amfi_sec
                    if best_r >= 0.85:
                        sec = best_s
            _add(sec or "Unknown", {"name": i.name or i.tradingsymbol or "Unknown", "source_type": "stock", "fund_pct": 100.0, "contribution": round(val, 2)})

    if not equity_only:
        # Bonds: SGB → Gold sector, everything else → Fixed Income
        for h, i in all_holdings:
            if i.instrument_type == "BOND":
                ltp = float(h.last_price) if h.last_price else None
                val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
                if val <= 0:
                    continue
                if i.tradingsymbol and _SGB_RE.match(i.tradingsymbol):
                    _add("Gold", {"name": i.tradingsymbol, "source_type": "bond", "fund_pct": 100.0, "contribution": round(val, 2)})
                else:
                    _add("Fixed Income", {"name": i.tradingsymbol or i.name or "Govt Bond", "source_type": "bond", "fund_pct": 100.0, "contribution": round(val, 2)})

        # Manual assets
        manual = await get_manual_assets_summary(db)
        if manual["total_fd"] > 0:
            _add("Fixed Income", {"name": "Fixed Deposits", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_fd"], 2)})
        if manual["total_ppf"] > 0:
            _add("Fixed Income", {"name": "PPF", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_ppf"], 2)})
        if manual.get("nps"):
            nps_val = manual["nps"]["current_value"]
            if nps_val > 0:
                _add("Fixed Income", {"name": "NPS (debt portion)", "source_type": "manual", "fund_pct": 25.0, "contribution": round(nps_val * 0.25, 2)})
        if manual.get("total_cash", 0) > 0:
            _add("Liquid / Money Market", {"name": "Savings / Cash", "source_type": "manual", "fund_pct": 100.0, "contribution": round(manual["total_cash"], 2)})

    # Sort by total descending, excluding non-equity sectors when equity_only
    out = []
    for sec, sources in sorted(composition.items(), key=lambda x: sum(s["contribution"] for s in x[1]), reverse=True):
        if equity_only and sec in _NON_EQUITY_SECTORS:
            continue
        sources.sort(key=lambda x: x["contribution"], reverse=True)
        total = sum(s["contribution"] for s in sources)
        for s in sources:
            s["share_pct"] = round(s["contribution"] / total * 100, 1) if total else 0
        out.append({"sector": sec, "total": round(total, 2), "sources": sources})

    return out


async def get_sector_stock_breakdown(db: AsyncSession) -> list[dict]:
    """Per-sector breakdown listing underlying stock holdings aggregated across all funds and direct positions."""
    fund_result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")), Instrument.isin.isnot(None))
    )
    fund_values: dict[str, float] = {}
    for h, i in fund_result.all():
        ltp = float(h.last_price) if h.last_price else None
        val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
        if val > 0:
            fund_values[i.isin] = val

    sector_stocks: dict[str, dict[str, float]] = {}

    if fund_values:
        rows = (await db.execute(
            select(MfSchemeBreakdown).where(
                MfSchemeBreakdown.scheme_isin.in_(list(fund_values.keys())),
                MfSchemeBreakdown.category != "Equity - Arbitrage",
                or_(
                    MfSchemeBreakdown.sector.is_(None),
                    ~MfSchemeBreakdown.sector.in_(list(_NON_EQUITY_SECTORS)),
                ),
            )
        )).scalars().all()
        for row in rows:
            contrib = fund_values[row.scheme_isin] * float(row.holdings_pct) / 100
            if contrib <= 0:
                continue
            sec = row.sector or "Unknown"
            bucket = sector_stocks.setdefault(sec, {})
            bucket[row.name] = bucket.get(row.name, 0) + contrib

    amfi_all = (await db.execute(select(AmfiMarketCap))).scalars().all()
    isin_to_sector: dict[str, str] = {a.isin: a.sector for a in amfi_all if a.isin and a.sector}
    name_to_sector: dict[str, str] = {a.name_normalized: a.sector for a in amfi_all if a.sector}

    stock_result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type == "STOCK")
    )
    for h, i in stock_result.all():
        ltp = float(h.last_price) if h.last_price else None
        val = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
        if val <= 0:
            continue
        sec = isin_to_sector.get(i.isin or "")
        if sec is None:
            norm = normalize_company_name(i.name or i.tradingsymbol or "")
            sec = name_to_sector.get(norm)
            if sec is None:
                best_r, best_s = 0.0, None
                for amfi_norm, amfi_sec in name_to_sector.items():
                    r = SequenceMatcher(None, norm, amfi_norm).ratio()
                    if r > best_r:
                        best_r, best_s = r, amfi_sec
                if best_r >= 0.85:
                    sec = best_s
        if sec in _NON_EQUITY_SECTORS:
            continue
        sec = sec or "Unknown"
        name = i.name or i.tradingsymbol or "Unknown"
        bucket = sector_stocks.setdefault(sec, {})
        bucket[name] = bucket.get(name, 0) + val

    out = []
    for sec, stocks in sorted(sector_stocks.items(), key=lambda x: sum(x[1].values()), reverse=True):
        total = sum(stocks.values())
        holdings = sorted(
            [{"name": n, "value": round(v, 2), "pct": round(v / total * 100, 1)} for n, v in stocks.items()],
            key=lambda x: x["value"], reverse=True,
        )
        out.append({"sector": sec, "total": round(total, 2), "holdings": holdings})
    return out


async def get_direct_trade_breakdown(db: AsyncSession) -> list[dict]:
    trades_result = await db.execute(
        select(Trade, Instrument)
        .join(Instrument, Trade.instrument_id == Instrument.id)
        .where(Trade.trade_type.in_(["BUY", "SELL"]))
        .order_by(Instrument.tradingsymbol, Trade.trade_date)
    )
    rows = trades_result.all()
    if not rows:
        return []

    instrument_info: dict[int, dict] = {}
    # key: (instrument_id, trade_date, trade_type) → {qty, cost}
    instrument_buckets: dict[tuple, dict] = defaultdict(lambda: {"qty": 0.0, "cost": 0.0})

    for trade, instrument in rows:
        iid = instrument.id
        if iid not in instrument_info:
            instrument_info[iid] = {
                "symbol": instrument.tradingsymbol or "",
                "name": instrument.name or instrument.tradingsymbol or "",
                "instrument_type": instrument.instrument_type,
            }
        qty = float(trade.quantity)
        key = (iid, trade.trade_date, trade.trade_type)
        instrument_buckets[key]["qty"] += qty
        instrument_buckets[key]["cost"] += qty * float(trade.price)

    instrument_ids = list(instrument_info.keys())

    # LTP from holdings
    ltp_map: dict[int, float] = {}
    holdings_result = await db.execute(
        select(Holding.instrument_id, Holding.last_price)
        .where(Holding.instrument_id.in_(instrument_ids))
    )
    for iid, lp in holdings_result.all():
        if lp:
            ltp_map[iid] = float(lp)

    # Fall back to latest price_history close
    missing = [iid for iid in instrument_ids if iid not in ltp_map]
    if missing:
        latest_sub = (
            select(PriceHistory.instrument_id, func.max(PriceHistory.price_date).label("max_date"))
            .where(PriceHistory.instrument_id.in_(missing))
            .group_by(PriceHistory.instrument_id)
            .subquery()
        )
        ph_result = await db.execute(
            select(PriceHistory.instrument_id, PriceHistory.close)
            .join(latest_sub, and_(
                PriceHistory.instrument_id == latest_sub.c.instrument_id,
                PriceHistory.price_date == latest_sub.c.max_date,
            ))
        )
        for iid, close in ph_result.all():
            if close:
                ltp_map[iid] = float(close)

    # Fall back to latest nav_history for MFs/ETFs still missing
    missing = [iid for iid in instrument_ids if iid not in ltp_map]
    if missing:
        latest_nav_sub = (
            select(NavHistory.instrument_id, func.max(NavHistory.nav_date).label("max_date"))
            .where(NavHistory.instrument_id.in_(missing))
            .group_by(NavHistory.instrument_id)
            .subquery()
        )
        nav_result = await db.execute(
            select(NavHistory.instrument_id, NavHistory.nav)
            .join(latest_nav_sub, and_(
                NavHistory.instrument_id == latest_nav_sub.c.instrument_id,
                NavHistory.nav_date == latest_nav_sub.c.max_date,
            ))
        )
        for iid, nav in nav_result.all():
            if nav:
                ltp_map[iid] = float(nav)

    # Group buckets back by instrument, sorted by (date, type)
    iid_trades: dict[int, list] = defaultdict(list)
    for (iid, td, ttype), agg in instrument_buckets.items():
        iid_trades[iid].append((td, ttype, agg))

    result = []
    for iid in sorted(instrument_ids, key=lambda x: instrument_info[x]["symbol"]):
        info = instrument_info[iid]
        current_price = ltp_map.get(iid)
        trade_rows = []
        for td, ttype, agg in sorted(iid_trades[iid], key=lambda x: (x[0], x[1])):
            qty = round(agg["qty"], 6)
            price = round(agg["cost"] / qty, 4) if qty else 0.0
            amount = round(agg["cost"], 2)
            current_value = round(qty * current_price, 2) if current_price else None
            if current_price and price:
                raw_pct = (current_price - price) / price * 100
                pct_change = round(-raw_pct if ttype == "SELL" else raw_pct, 2)
            else:
                pct_change = None
            trade_rows.append({
                "date": str(td),
                "trade_type": ttype,
                "qty": qty,
                "price": price,
                "amount": amount,
                "current_value": current_value,
                "pct_change": pct_change,
            })
        result.append({
            "symbol": info["symbol"],
            "name": info["name"],
            "instrument_type": info["instrument_type"],
            "current_price": current_price,
            "trades": trade_rows,
        })
    return result


async def save_sector_overrides(db: AsyncSession, rows: list[dict]) -> int:
    """Upsert manual sector overrides and apply them to matching MfSchemeBreakdown rows."""
    override_rows = [
        {
            "name_normalized": normalize_company_name(r["name"]),
            "raw_name": r["name"],
            "sector": r["sector"],
            "updated_at": now_ist(),
        }
        for r in rows
    ]
    if override_rows:
        stmt = pg_insert(EquitySectorOverride).values(override_rows)
        await db.execute(stmt.on_conflict_do_update(
            index_elements=["name_normalized"],
            set_={
                "raw_name": stmt.excluded.raw_name,
                "sector": stmt.excluded.sector,
                "updated_at": stmt.excluded.updated_at,
            },
        ))

    norm_to_sector = {normalize_company_name(r["name"]): r["sector"] for r in rows}
    unknown_rows = (await db.execute(
        select(MfSchemeBreakdown).where(
            or_(MfSchemeBreakdown.sector.is_(None), MfSchemeBreakdown.sector == "Unknown")
        )
    )).scalars().all()

    updated = 0
    for row in unknown_rows:
        norm = normalize_company_name(row.name)
        if norm in norm_to_sector:
            row.sector = norm_to_sector[norm]
            updated += 1

    await db.commit()
    return updated


async def get_sector_list(db: AsyncSession) -> list[str]:
    """Return sorted distinct sector names currently in mf_scheme_breakdown, excluding Unknown."""
    rows = await db.execute(
        select(MfSchemeBreakdown.sector)
        .where(MfSchemeBreakdown.sector.is_not(None), MfSchemeBreakdown.sector != "Unknown")
        .distinct()
        .order_by(MfSchemeBreakdown.sector)
    )
    return [r for (r,) in rows.all() if r]
