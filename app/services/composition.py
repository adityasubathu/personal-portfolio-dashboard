import json
from collections import defaultdict

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_config import AppConfig
from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, EquitySectorOverride, MfSchemeBreakdown, NseIndustryClassification
from app.services.allocation import _classify_stock_instrument, _load_amfi_lookups
from app.services.mf_ingest import COMMODITY_ETF_CATEGORY, MF_BREAKDOWN_CHECK_KEY, _SGB_RE, normalize_company_name
from app.services.nse_industry import (
    CLASSIFICATION_LEVELS,
    STATUS_CLASSIFIED,
    cascade_levels,
    load_classification_lookup,
    load_taxonomy_parents,
)
from app.time_util import now_ist


def _resolve_level(level: str) -> str:
    """Returns the requested taxonomy level, or "sector" for anything unrecognised
    so a bad query string never 500s the endpoint."""
    return level if level in CLASSIFICATION_LEVELS else "sector"

_CAT_ORDER = ["Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Foreign", "Equity - Arbitrage", "Real Estate Trust", "Gold", "Silver", "Debt", "Cash", "Derivatives - Leveraged", "Other"]

_NON_EQUITY_SECTORS = {"Fixed Income", "Liquid / Money Market", "Gold", "Silver"}

# Categories that carry genuine equity market exposure. Everything else — debt, cash,
# commodities, and arbitrage/derivative pairs that net to zero exposure — collapses into
# one Non-Equity bucket on the per-fund sector donut.
_EQUITY_CATEGORIES = {
    "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity",
    "Equity - Foreign", "Real Estate Trust",
}

NON_EQUITY_LABEL = "Non-Equity"


def _summarize_sectors(rows: list[dict]) -> list[dict]:
    """Groups one fund's holding rows into sector buckets.

    Each row is {"category", "sector", "pct", "value"}. Equity rows bucket by their own
    sector (NULL sector -> "Unknown"); everything else merges into a single Non-Equity
    bucket that always sorts last. Buckets that net to zero or below are dropped.
    """
    pct_totals: dict[str, float] = {}
    value_totals: dict[str, float] = {}

    for r in rows:
        if r["category"] in _EQUITY_CATEGORIES:
            sector = r["sector"] or "Unknown"
        else:
            sector = NON_EQUITY_LABEL
        pct_totals[sector] = pct_totals.get(sector, 0) + r["pct"]
        value_totals[sector] = value_totals.get(sector, 0) + r["value"]

    summary = [
        {"sector": sec, "pct": round(pct, 2), "value": round(value_totals[sec], 2)}
        for sec, pct in pct_totals.items()
        if sec != NON_EQUITY_LABEL and pct > 0
    ]
    summary.sort(key=lambda x: x["pct"], reverse=True)

    non_equity_pct = pct_totals.get(NON_EQUITY_LABEL, 0)
    if non_equity_pct > 0:
        summary.append({
            "sector": NON_EQUITY_LABEL,
            "pct": round(non_equity_pct, 2),
            "value": round(value_totals[NON_EQUITY_LABEL], 2),
        })

    return summary


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

    last_check = (await db.execute(
        select(AppConfig).where(AppConfig.key == MF_BREAKDOWN_CHECK_KEY)
    )).scalar_one_or_none()
    last_check_data = json.loads(last_check.value_json) if last_check and last_check.value_json else {}
    freshness = {
        "last_checked_at": last_check_data.get("checked_at"),
        "server_latest_filing": last_check_data.get("server_latest_filing"),
        "server_latest_portfolio_count": last_check_data.get("server_latest_portfolio_count"),
    }

    if not rows:
        return {"holdings": [], "category_summary": [], "sector_summary": [], "as_of": None, "fetched_at": None, **freshness}

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
    sector_rows: list[dict] = []
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
        sector_rows.append({"category": r.category, "sector": r.sector, "pct": pct, "value": value})

    order = [
        "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity",
        "Equity - Foreign", "Equity - Arbitrage", "Real Estate Trust", "Gold", "Silver",
        "Debt", "Cash", "Derivatives - Leveraged", "Other",
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

    sector_summary = _summarize_sectors(sector_rows)

    as_of = rows[0].as_of
    fetched_at = max((r.updated_at for r in rows), default=None)

    return {
        "holdings": holdings,
        "category_summary": category_summary,
        "sector_summary": sector_summary,
        "as_of": as_of.isoformat() if as_of else None,
        "fetched_at": fetched_at.isoformat() if fetched_at else None,
        **freshness,
    }


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


async def get_sector_composition(db: AsyncSession, equity_only: bool = False, level: str = "sector") -> list[dict]:
    """Returns per-sector breakdown showing each contributing source and its value."""
    from app.services.manual_assets import get_manual_assets_summary

    level = _resolve_level(level)

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()

    # Classification lookup for direct stocks, keyed by ISIN only.
    classification_lookup = await load_classification_lookup(db)

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
            sec = getattr(row, level) or "Unknown"
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
            levels = classification_lookup.get(i.isin or "")
            sec = levels[level] if levels else None
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


async def get_sector_stock_breakdown(db: AsyncSession, level: str = "sector") -> list[dict]:
    """Per-sector breakdown listing underlying stock holdings aggregated across all funds and direct positions."""
    level = _resolve_level(level)

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
    # Names differ across disclosures ("Ltd." vs "Limited") for the same company —
    # bucket by normalized name, but keep a display name per bucket key.
    display_name: dict[str, str] = {}

    amfi_all = (await db.execute(select(AmfiMarketCap))).scalars().all()
    for a in amfi_all:
        display_name[a.name_normalized] = a.company_name

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
            sec = getattr(row, level) or "Unknown"
            key = normalize_company_name(row.name)
            display_name.setdefault(key, row.name)
            bucket = sector_stocks.setdefault(sec, {})
            bucket[key] = bucket.get(key, 0) + contrib

    classification_lookup = await load_classification_lookup(db)

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
        levels = classification_lookup.get(i.isin or "")
        sec = levels[level] if levels else None
        if sec in _NON_EQUITY_SECTORS:
            continue
        sec = sec or "Unknown"
        name = i.name or i.tradingsymbol or "Unknown"
        key = normalize_company_name(name)
        display_name.setdefault(key, name)
        bucket = sector_stocks.setdefault(sec, {})
        bucket[key] = bucket.get(key, 0) + val

    out = []
    for sec, stocks in sorted(sector_stocks.items(), key=lambda x: sum(x[1].values()), reverse=True):
        total = sum(stocks.values())
        holdings = sorted(
            [{"name": display_name.get(k, k), "value": round(v, 2), "pct": round(v / total * 100, 1)} for k, v in stocks.items()],
            key=lambda x: x["value"], reverse=True,
        )
        out.append({"sector": sec, "total": round(total, 2), "holdings": holdings})
    return out


async def save_sector_overrides(db: AsyncSession, rows: list[dict]) -> dict:
    """Store manual taxonomy fixes and apply them to matching breakdown rows.

    Each row is {"name", "level", "value"}. The chosen value cascades up NSE's
    hierarchy, so classifying at Industry also fills Sector and Macro. Levels
    already set on the override row survive a partial re-save.
    """
    parents = await load_taxonomy_parents(db)

    merged_by_name: dict[str, dict] = {}
    for r in rows:
        value = (r.get("value") or "").strip()
        if not value:
            continue
        level = _resolve_level(r.get("level") or "sector")
        norm = normalize_company_name(r["name"])
        entry = merged_by_name.setdefault(
            norm,
            {
                "name_normalized": norm,
                "raw_name": r["name"],
                **{lvl: None for lvl in CLASSIFICATION_LEVELS},
            },
        )
        for lvl, val in cascade_levels(parents, level, value).items():
            if val:
                entry[lvl] = val

    if not merged_by_name:
        return {"updated": 0, "rows_updated": 0}

    override_rows = [{**entry, "updated_at": now_ist()} for entry in merged_by_name.values()]
    stmt = pg_insert(EquitySectorOverride).values(override_rows)
    await db.execute(stmt.on_conflict_do_update(
        index_elements=["name_normalized"],
        set_={
            "raw_name": stmt.excluded.raw_name,
            "updated_at": stmt.excluded.updated_at,
            # COALESCE keeps a level set by an earlier save when this one leaves it blank.
            **{
                lvl: func.coalesce(getattr(stmt.excluded, lvl), getattr(EquitySectorOverride, lvl))
                for lvl in CLASSIFICATION_LEVELS
            },
        },
    ))

    breakdown = (await db.execute(select(MfSchemeBreakdown))).scalars().all()
    rows_updated = 0
    for row in breakdown:
        entry = merged_by_name.get(normalize_company_name(row.name))
        if not entry:
            continue
        touched = False
        for lvl in CLASSIFICATION_LEVELS:
            value = entry.get(lvl)
            if value and getattr(row, lvl) in (None, "Unknown"):
                setattr(row, lvl, value)
                touched = True
        if touched:
            rows_updated += 1

    await db.commit()
    return {"updated": len(merged_by_name), "rows_updated": rows_updated}


async def get_sector_list(db: AsyncSession, level: str = "sector") -> list[str]:
    """Values selectable at a taxonomy level: everything NSE has classified, plus
    anything already sitting on a holding row. Feeds the manual-classify dropdown."""
    level = _resolve_level(level)
    breakdown_col = getattr(MfSchemeBreakdown, level)
    nse_col = getattr(NseIndustryClassification, level)

    values: set[str] = set()
    statements = (
        select(breakdown_col).where(breakdown_col.is_not(None)).distinct(),
        select(nse_col).where(
            nse_col.is_not(None),
            NseIndustryClassification.status == STATUS_CLASSIFIED,
        ).distinct(),
    )
    for stmt in statements:
        for (value,) in (await db.execute(stmt)).all():
            if value and value != "Unknown":
                values.add(value)
    return sorted(values)
