from difflib import SequenceMatcher

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.allocation_target import AllocationTarget, AssetClassTarget
from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, MfSchemeBreakdown
from app.services.mf_ingest import COMMODITY_ETF_CATEGORY, _SGB_RE, normalize_company_name


async def _load_amfi_lookups(db: AsyncSession) -> tuple[dict[str, str], dict[str, str]]:
    """Returns (isin_to_cat, norm_name_to_cat) from AmfiMarketCap."""
    amfi_rows = (await db.execute(select(AmfiMarketCap))).scalars().all()
    isin_to_cat: dict[str, str] = {}
    name_to_cat: dict[str, str] = {}
    for a in amfi_rows:
        if a.isin:
            isin_to_cat[a.isin] = a.categorization
        name_to_cat[a.name_normalized] = a.categorization
    return isin_to_cat, name_to_cat


def _classify_stock_instrument(
    isin: str | None,
    name: str | None,
    tradingsymbol: str | None,
    isin_to_cat: dict[str, str],
    name_to_cat: dict[str, str],
) -> str:
    if isin and isin in isin_to_cat:
        return isin_to_cat[isin]
    for raw in (name, tradingsymbol):
        if not raw:
            continue
        norm = normalize_company_name(raw)
        cat = name_to_cat.get(norm)
        if cat:
            return cat
        best_ratio = 0.0
        best_cat = None
        for amfi_norm, amfi_cat in name_to_cat.items():
            r = SequenceMatcher(None, norm, amfi_norm).ratio()
            if r > best_ratio:
                best_ratio = r
                best_cat = amfi_cat
        if best_ratio >= 0.85 and best_cat:
            return best_cat
    return "Unclassified Equity"


async def get_stock_holdings_table(db: AsyncSession) -> list[dict]:
    isin_to_cat, name_to_cat = await _load_amfi_lookups(db)

    # Build ticker lookup from AMFI
    amfi_rows = (await db.execute(select(AmfiMarketCap))).scalars().all()
    ticker_lookup: dict[str, str] = {}
    for a in amfi_rows:
        ticker_lookup[normalize_company_name(a.company_name)] = a.nse_symbol or a.bse_symbol or ""

    # MF/ETF fund holdings
    fund_result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")))
    )
    fund_holdings = fund_result.all()

    fund_values: dict[str, float] = {}
    for h, i in fund_holdings:
        if not i.isin:
            continue
        ltp = float(h.last_price) if h.last_price else None
        fund_values[i.isin] = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

    stock_totals: dict[str, dict] = {}

    if fund_values:
        breakdown_rows = (await db.execute(
            select(MfSchemeBreakdown).where(
                MfSchemeBreakdown.scheme_isin.in_(list(fund_values.keys())),
                MfSchemeBreakdown.holding_type == "Equity",
            )
        )).scalars().all()

        for row in breakdown_rows:
            hv = fund_values.get(row.scheme_isin, 0)
            contribution = hv * (float(row.holdings_pct) / 100.0)
            if row.name not in stock_totals:
                ticker = ticker_lookup.get(normalize_company_name(row.name), "")
                stock_totals[row.name] = {"ticker": ticker, "category": row.category, "value": 0}
            stock_totals[row.name]["value"] += contribution

    # Direct stock holdings
    stock_result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type == "STOCK")
    )
    for h, i in stock_result.all():
        ltp = float(h.last_price) if h.last_price else None
        value = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)
        name = i.name or i.tradingsymbol or "Unknown"
        cat = _classify_stock_instrument(i.isin, i.name, i.tradingsymbol, isin_to_cat, name_to_cat)
        ticker = i.tradingsymbol or ""
        if name in stock_totals:
            stock_totals[name]["value"] += value
        else:
            stock_totals[name] = {"ticker": ticker, "category": cat, "value": value}

    total_equity = sum(s["value"] for s in stock_totals.values())
    if total_equity <= 0:
        return []

    stocks = []
    for name, info in stock_totals.items():
        if info["value"] <= 0:
            continue
        stocks.append({
            "name": name,
            "ticker": info["ticker"],
            "category": info["category"],
            "weight_pct": round(info["value"] / total_equity * 100, 4),
            "value": round(info["value"], 2),
        })

    stocks.sort(key=lambda s: s["value"], reverse=True)
    return stocks


async def _build_category_totals_full(db: AsyncSession, all_holdings, use_cost: bool) -> dict[str, float]:
    from app.services.manual_assets import get_manual_assets_summary

    isin_to_cat, name_to_cat = await _load_amfi_lookups(db)
    category_totals: dict[str, float] = {}
    fund_isins: list[str] = []

    for h, i in all_holdings:
        if use_cost:
            value = float(h.total_cost or 0)
        else:
            ltp = float(h.last_price) if h.last_price else None
            value = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

        if i.instrument_type == "STOCK":
            cat = _classify_stock_instrument(i.isin, i.name, i.tradingsymbol, isin_to_cat, name_to_cat)
            category_totals[cat] = category_totals.get(cat, 0) + value
        elif i.instrument_type == "BOND" and i.tradingsymbol and _SGB_RE.match(i.tradingsymbol):
            category_totals["Gold"] = category_totals.get("Gold", 0) + value
        elif i.instrument_type == "BOND":
            category_totals["Debt"] = category_totals.get("Debt", 0) + value
        elif i.instrument_type in ("MF", "ETF") and i.isin:
            commodity_cat = COMMODITY_ETF_CATEGORY.get(i.isin)
            if commodity_cat:
                category_totals[commodity_cat] = category_totals.get(commodity_cat, 0) + value
            else:
                fund_isins.append(i.isin)

    hv: dict[str, float] = {}
    for h, i in all_holdings:
        if i.isin and i.isin in fund_isins:
            if use_cost:
                hv[i.isin] = float(h.total_cost or 0)
            else:
                ltp = float(h.last_price) if h.last_price else None
                hv[i.isin] = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

    if hv:
        breakdown_rows = (await db.execute(
            select(MfSchemeBreakdown).where(
                MfSchemeBreakdown.scheme_isin.in_(list(hv.keys()))
            )
        )).scalars().all()
        for row in breakdown_rows:
            contribution = hv.get(row.scheme_isin, 0) * (float(row.holdings_pct) / 100.0)
            category_totals[row.category] = category_totals.get(row.category, 0) + contribution

    manual = await get_manual_assets_summary(db)
    debt = manual["total_fd"] + manual["total_ppf"]
    if manual["nps"]:
        nps_val = manual["nps"]["current_value"]
        category_totals["Large Cap"] = category_totals.get("Large Cap", 0) + nps_val * 0.75
        debt += nps_val * 0.25
    if debt > 0:
        category_totals["Debt"] = category_totals.get("Debt", 0) + debt
    if manual.get("total_cash", 0) > 0:
        category_totals["Cash"] = category_totals.get("Cash", 0) + manual["total_cash"]
    if manual.get("total_foreign_equity_inr", 0) > 0:
        category_totals["Equity - Foreign"] = category_totals.get("Equity - Foreign", 0) + manual["total_foreign_equity_inr"]

    return category_totals


async def get_breakdown_chart_data(db: AsyncSession) -> dict:
    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()
    category_totals = await _build_category_totals_full(db, all_holdings, use_cost=False)

    if not category_totals:
        return {"labels": [], "values": [], "total": 0}

    order = [
        "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity",
        "Equity - Foreign", "Equity - Arbitrage", "Real Estate Trust", "Gold", "Silver", "Debt", "Cash", "Other",
    ]
    labels = []
    values = []
    for cat in order:
        v = category_totals.get(cat, 0)
        if v > 0:
            labels.append(cat)
            values.append(round(v, 2))

    return {
        "labels": labels,
        "values": values,
        "total": round(sum(values), 2),
    }


DEFAULT_TARGETS = {
    "Large Cap": 50.0,
    "Mid Cap": 30.0,
    "Small Cap": 20.0,
    "Equity - Foreign": 0.0,
}


async def get_allocation_targets(db: AsyncSession) -> dict[str, float]:
    rows = (await db.execute(select(AllocationTarget))).scalars().all()
    if not rows:
        return dict(DEFAULT_TARGETS)
    return {r.category: float(r.target_pct) for r in rows}


async def save_allocation_targets(db: AsyncSession, targets: dict[str, float]):
    for category, pct in targets.items():
        existing = (await db.execute(
            select(AllocationTarget).where(AllocationTarget.category == category)
        )).scalar_one_or_none()
        if existing:
            existing.target_pct = pct
        else:
            db.add(AllocationTarget(category=category, target_pct=pct))
    await db.execute(
        delete(AllocationTarget).where(
            AllocationTarget.category.notin_(list(targets.keys()))
        )
    )
    await db.commit()


DEFAULT_ASSET_CLASS_TARGETS: dict[str, float] = {
    "Equity": 65.0,
    "Debt": 30.0,
    "Precious Metals": 5.0,
}


async def get_asset_class_targets(db: AsyncSession) -> dict[str, float]:
    rows = (await db.execute(select(AssetClassTarget))).scalars().all()
    if not rows:
        return dict(DEFAULT_ASSET_CLASS_TARGETS)
    return {r.asset_class: float(r.target_pct) for r in rows}


async def save_asset_class_targets(db: AsyncSession, targets: dict[str, float]):
    for asset_class, pct in targets.items():
        existing = (await db.execute(
            select(AssetClassTarget).where(AssetClassTarget.asset_class == asset_class)
        )).scalar_one_or_none()
        if existing:
            existing.target_pct = pct
        else:
            db.add(AssetClassTarget(asset_class=asset_class, target_pct=pct))
    await db.execute(
        delete(AssetClassTarget).where(
            AssetClassTarget.asset_class.notin_(list(targets.keys()))
        )
    )
    await db.commit()


_AC_EQUITY = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Foreign"}
_AC_DEBT = {"Debt", "Equity - Arbitrage"}
_AC_PRECIOUS_METALS = {"Gold", "Silver"}


async def get_asset_class_comparison(db: AsyncSession) -> dict:
    from app.services.manual_assets import get_manual_assets_summary

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()
    category_totals = await _build_category_totals_full(db, all_holdings, use_cost=False)
    manual = await get_manual_assets_summary(db)

    savings_cash = manual.get("total_cash", 0)
    emergency_fund = manual.get("emergency_total", 0)

    # MF internal cash = total "Cash" category minus savings-account-only cash
    mf_cash = max(0.0, category_totals.get("Cash", 0) - savings_cash)

    equity = sum(category_totals.get(c, 0) for c in _AC_EQUITY)
    # PPF is already in category_totals["Debt"] via _build_category_totals_full; include it in investable debt
    debt = sum(category_totals.get(c, 0) for c in _AC_DEBT) + mf_cash - emergency_fund
    debt = max(0.0, debt)
    precious_metals = sum(category_totals.get(c, 0) for c in _AC_PRECIOUS_METALS)

    investable_total = equity + debt + precious_metals
    grand_total = investable_total + savings_cash + emergency_fund

    targets = await get_asset_class_targets(db)

    foreign_target_row = (await db.execute(
        select(AllocationTarget).where(AllocationTarget.category == "Equity - Foreign")
    )).scalar_one_or_none()
    foreign_equity_target = float(foreign_target_row.target_pct) if foreign_target_row else 20.0

    rows = []
    for asset_class, current_value in [
        ("Equity", equity),
        ("Debt", debt),
        ("Precious Metals", precious_metals),
    ]:
        target_pct = targets.get(asset_class, DEFAULT_ASSET_CLASS_TARGETS.get(asset_class, 0.0))
        current_pct = (current_value / investable_total * 100) if investable_total > 0 else 0.0
        current_diff = current_pct - target_pct
        ideal_value = investable_total * target_pct / 100 if investable_total > 0 else 0.0
        shortfall = current_value - ideal_value
        rows.append({
            "asset_class": asset_class,
            "target_pct": target_pct,
            "current_pct": round(current_pct, 2),
            "current_value": round(current_value, 2),
            "current_diff": round(current_diff, 2),
            "ideal_value": round(ideal_value, 2),
            "shortfall": round(shortfall, 2),
        })

    return {
        "rows": rows,
        "foreign_equity_target": foreign_equity_target,
        "investable_total": round(investable_total, 2),
        "excluded": {
            "emergency_fund": round(emergency_fund, 2),
            "cash": round(savings_cash, 2),
            "total_excluded": round(savings_cash + emergency_fund, 2),
        },
        "grand_total": round(grand_total, 2),
    }


DOMESTIC_EQUITY_CATS = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity"}
FOREIGN_CAT = "Equity - Foreign"
EQUITY_CATS = DOMESTIC_EQUITY_CATS | {FOREIGN_CAT}


def _foreign_anchor_ratio(foreign_target: float, large_target: float) -> float:
    """Ratio of foreign ideal value to large cap value in anchored mode.
    Derived from: foreign_frac / (large_frac * domestic_frac)
    e.g. with foreign=20%, large=50%: 0.20 / (0.50 * 0.80) = 0.50
    """
    foreign_frac = foreign_target / 100
    large_frac = large_target / 100
    domestic_frac = 1.0 - foreign_frac
    if large_frac == 0 or domestic_frac == 0:
        return 0.5
    return foreign_frac / (large_frac * domestic_frac)


async def get_allocation_comparison(db: AsyncSession, mode: str = "anchored") -> dict:
    targets = await get_allocation_targets(db)

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND", "STOCK")))
    )
    all_holdings = result.all()

    current_totals = await _build_category_totals_full(db, all_holdings, use_cost=False)
    invested_totals = await _build_category_totals_full(db, all_holdings, use_cost=True)

    current_equity = sum(v for c, v in current_totals.items() if c in EQUITY_CATS)
    invested_equity = sum(v for c, v in invested_totals.items() if c in EQUITY_CATS)

    foreign_cur = current_totals.get(FOREIGN_CAT, 0)
    foreign_inv = invested_totals.get(FOREIGN_CAT, 0)
    domestic_cur = current_equity - foreign_cur
    domestic_inv = invested_equity - foreign_inv

    foreign_target = targets.get(FOREIGN_CAT, 0)
    domestic_target = 100.0 - foreign_target

    large_target = targets.get("Large Cap", 50)
    cur_large = current_totals.get("Large Cap", 0)
    inv_large = invested_totals.get("Large Cap", 0)

    # ── Domestic market-cap rows ──────────────────────────────────────────────
    domestic_categories = sorted(c for c in targets if c in DOMESTIC_EQUITY_CATS)
    rows = []
    for cat in domestic_categories:
        target_pct = targets[cat]
        cur_val = current_totals.get(cat, 0)
        inv_val = invested_totals.get(cat, 0)

        if mode == "anchored":
            # Percentages relative to domestic equity; ideal anchored on large cap
            cur_pct = (cur_val / domestic_cur * 100) if domestic_cur > 0 else 0
            inv_pct = (inv_val / domestic_inv * 100) if domestic_inv > 0 else 0
            if cat == "Large Cap":
                cur_ideal_val = cur_large
                inv_ideal_val = inv_large
            else:
                cur_ideal_val = cur_large * (target_pct / large_target) if large_target > 0 else 0
                inv_ideal_val = inv_large * (target_pct / large_target) if large_target > 0 else 0
        else:  # free_float
            # Percentages relative to total equity; ideal = total_equity × target_of_total
            domestic_share = 1.0 - foreign_target / 100
            target_of_total = target_pct * domestic_share
            cur_pct = (cur_val / current_equity * 100) if current_equity > 0 else 0
            inv_pct = (inv_val / invested_equity * 100) if invested_equity > 0 else 0
            cur_ideal_val = current_equity * target_of_total / 100
            inv_ideal_val = invested_equity * target_of_total / 100
            target_pct = round(target_of_total, 2)  # expose as % of total equity in this mode

        rows.append({
            "category": cat,
            "target_pct": target_pct,
            "current_pct": round(cur_pct, 2),
            "current_value": round(cur_val, 2),
            "current_diff": round(cur_pct - target_pct, 2),
            "invested_pct": round(inv_pct, 2),
            "invested_value": round(inv_val, 2),
            "invested_diff": round(inv_pct - target_pct, 2),
            "current_ideal_value": round(cur_ideal_val, 2),
            "current_value_diff": round(cur_val - cur_ideal_val, 2),
            "invested_ideal_value": round(inv_ideal_val, 2),
            "invested_value_diff": round(inv_val - inv_ideal_val, 2),
        })

    # ── Foreign row (merged into rows) ───────────────────────────────────────
    foreign_cur_pct = (foreign_cur / current_equity * 100) if current_equity > 0 else 0
    foreign_inv_pct = (foreign_inv / invested_equity * 100) if invested_equity > 0 else 0

    if mode == "anchored":
        anchor_ratio = _foreign_anchor_ratio(foreign_target, large_target)
        cur_foreign_ideal = cur_large * anchor_ratio
        inv_foreign_ideal = inv_large * anchor_ratio
        # target_pct is the equivalent % of total equity for display
        foreign_display_target = round(cur_foreign_ideal / current_equity * 100, 2) if current_equity > 0 else 0
    else:
        cur_foreign_ideal = current_equity * foreign_target / 100
        inv_foreign_ideal = invested_equity * foreign_target / 100
        foreign_display_target = foreign_target

    rows.append({
        "category": "Equity - Foreign",
        "target_pct": foreign_display_target,
        "anchor_note": f"{anchor_ratio * 100:.1f}% of LC" if mode == "anchored" else None,
        "current_pct": round(foreign_cur_pct, 2),
        "current_value": round(foreign_cur, 2),
        "current_diff": round(foreign_cur_pct - foreign_display_target, 2),
        "invested_pct": round(foreign_inv_pct, 2),
        "invested_value": round(foreign_inv, 2),
        "invested_diff": round(foreign_inv_pct - foreign_display_target, 2),
        "current_ideal_value": round(cur_foreign_ideal, 2),
        "current_value_diff": round(foreign_cur - cur_foreign_ideal, 2),
        "invested_ideal_value": round(inv_foreign_ideal, 2),
        "invested_value_diff": round(foreign_inv - inv_foreign_ideal, 2),
    })

    # ── Domestic / foreign split summaries (kept for backward compat) ─────────
    domestic_cur_pct = (domestic_cur / current_equity * 100) if current_equity > 0 else 0
    domestic_inv_pct = (domestic_inv / invested_equity * 100) if invested_equity > 0 else 0
    domestic_cur_ideal = current_equity * domestic_target / 100
    foreign = {
        "target_pct": foreign_target,
        "current_pct": round(foreign_cur_pct, 2),
        "current_value": round(foreign_cur, 2),
        "current_diff": round(foreign_cur_pct - foreign_target, 2),
        "current_value_diff": round(foreign_cur - cur_foreign_ideal, 2),
        "invested_pct": round(foreign_inv_pct, 2),
        "invested_value": round(foreign_inv, 2),
    }
    domestic = {
        "target_pct": domestic_target,
        "current_pct": round(domestic_cur_pct, 2),
        "current_value": round(domestic_cur, 2),
        "current_diff": round(domestic_cur_pct - domestic_target, 2),
        "current_value_diff": round(domestic_cur - domestic_cur_ideal, 2),
        "invested_pct": round(domestic_inv_pct, 2),
        "invested_value": round(domestic_inv, 2),
    }

    return {
        "rows": rows,
        "foreign": foreign,
        "domestic": domestic,
        "targets": targets,
        "current_equity": round(current_equity, 2),
        "invested_equity": round(invested_equity, 2),
        "domestic_equity": round(domestic_cur, 2),
        "mode": mode,
    }
