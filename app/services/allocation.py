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


DEFAULT_TARGETS: dict[str, dict[str, float]] = {
    "anchored": {
        "Large Cap": 50.0,
        "Mid Cap": 30.0,
        "Small Cap": 20.0,
        "Equity - Foreign": 0.0,
    },
    "free_float": {
        "Large Cap": 26.0,
        "Mid Cap": 18.2,
        "Small Cap": 7.8,
        "Equity - Foreign": 13.0,
        "Debt": 25.0,
        "Precious Metals": 10.0,
    },
}


async def get_allocation_targets(db: AsyncSession, mode: str = "anchored") -> dict[str, float]:
    rows = (await db.execute(
        select(AllocationTarget).where(AllocationTarget.alloc_mode == mode)
    )).scalars().all()
    if not rows:
        return dict(DEFAULT_TARGETS.get(mode, DEFAULT_TARGETS["anchored"]))
    return {r.category: float(r.target_pct) for r in rows}


async def save_allocation_targets(db: AsyncSession, targets: dict[str, float], mode: str = "anchored"):
    for category, pct in targets.items():
        existing = (await db.execute(
            select(AllocationTarget).where(
                AllocationTarget.category == category,
                AllocationTarget.alloc_mode == mode,
            )
        )).scalar_one_or_none()
        if existing:
            existing.target_pct = pct
        else:
            db.add(AllocationTarget(category=category, alloc_mode=mode, target_pct=pct))
    await db.execute(
        delete(AllocationTarget).where(
            AllocationTarget.alloc_mode == mode,
            AllocationTarget.category.notin_(list(targets.keys())),
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
        select(AllocationTarget).where(
            AllocationTarget.category == "Equity - Foreign",
            AllocationTarget.alloc_mode == "anchored",
        )
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
    from app.services.manual_assets import get_manual_assets_summary

    targets = await get_allocation_targets(db, mode=mode)

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

    if mode == "free_float":
        return await _get_free_float_comparison(
            db, targets, current_totals, invested_totals,
            current_equity, invested_equity,
            foreign_cur, foreign_inv, domestic_cur, domestic_inv,
        )

    # ── Anchored mode ─────────────────────────────────────────────────────────
    domestic_categories = sorted(c for c in targets if c in DOMESTIC_EQUITY_CATS)
    rows = []
    for cat in domestic_categories:
        target_pct = targets[cat]
        cur_val = current_totals.get(cat, 0)
        inv_val = invested_totals.get(cat, 0)
        cur_pct = (cur_val / domestic_cur * 100) if domestic_cur > 0 else 0
        inv_pct = (inv_val / domestic_inv * 100) if domestic_inv > 0 else 0
        if cat == "Large Cap":
            cur_ideal_val = cur_large
            inv_ideal_val = inv_large
        else:
            cur_ideal_val = cur_large * (target_pct / large_target) if large_target > 0 else 0
            inv_ideal_val = inv_large * (target_pct / large_target) if large_target > 0 else 0
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

    anchor_ratio = _foreign_anchor_ratio(foreign_target, large_target)
    cur_foreign_ideal = cur_large * anchor_ratio
    inv_foreign_ideal = inv_large * anchor_ratio
    foreign_cur_pct = (foreign_cur / current_equity * 100) if current_equity > 0 else 0
    foreign_inv_pct = (foreign_inv / invested_equity * 100) if invested_equity > 0 else 0
    foreign_display_target = round(cur_foreign_ideal / current_equity * 100, 2) if current_equity > 0 else 0

    rows.append({
        "category": "Equity - Foreign",
        "target_pct": foreign_display_target,
        "anchor_note": f"{anchor_ratio * 100:.1f}% of LC",
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

    domestic_cur_pct = (domestic_cur / current_equity * 100) if current_equity > 0 else 0
    domestic_inv_pct = (domestic_inv / invested_equity * 100) if invested_equity > 0 else 0
    domestic_cur_ideal = current_equity * domestic_target / 100
    foreign_summary = {
        "target_pct": foreign_target,
        "current_pct": round(foreign_cur_pct, 2),
        "current_value": round(foreign_cur, 2),
        "current_diff": round(foreign_cur_pct - foreign_target, 2),
        "current_value_diff": round(foreign_cur - cur_foreign_ideal, 2),
        "invested_pct": round(foreign_inv_pct, 2),
        "invested_value": round(foreign_inv, 2),
    }
    domestic_summary = {
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
        "foreign": foreign_summary,
        "domestic": domestic_summary,
        "targets": targets,
        "current_equity": round(current_equity, 2),
        "invested_equity": round(invested_equity, 2),
        "domestic_equity": round(domestic_cur, 2),
        "mode": mode,
    }


def _zero_drift_plan(buckets: list[dict], pool: float, cash_amount: float | None) -> dict:
    """Given buckets [{key fields..., "current_value", "target_pct"}] with target_pct
    summing to 100 across the pool, compute the cash injection that brings every
    bucket to its target % (clamped at 0 — cash can only be added, not withdrawn).

    See plans/2026-08-01-rebalance-cash-allocation.md section 1 for the derivation.
    """
    eligible = [b for b in buckets if b["target_pct"] > 0]
    binding_note = None
    if not eligible or pool <= 0:
        c_min = 0.0
    else:
        binding = max(eligible, key=lambda b: b["current_value"] * 100 / b["target_pct"])
        c_min = binding["current_value"] * 100 / binding["target_pct"] - pool
        c_min = max(0.0, c_min)
        if c_min > 0:
            drift = binding.get("current_pct", 0) - binding["target_pct"]
            binding_note = (
                f"Driven by {binding['category']}: only {drift:+.2f}pp over its {binding['target_pct']:.1f}% "
                f"target, but diluting it back down requires growing the whole pool."
            )

    def _invest_at(total_cash: float) -> dict[int, float]:
        new_pool = pool + total_cash
        return {
            id(b): max(0.0, new_pool * b["target_pct"] / 100 - b["current_value"])
            for b in buckets
        }

    full_invest = _invest_at(c_min)

    if cash_amount is None:
        cash_applied = c_min
        invest_map = full_invest
    elif cash_amount <= 0:
        cash_applied = 0.0
        invest_map = {id(b): 0.0 for b in buckets}
    elif cash_amount < c_min and c_min > 0:
        cash_applied = cash_amount
        scale = cash_amount / c_min
        invest_map = {k: v * scale for k, v in full_invest.items()}
    elif cash_amount > c_min:
        cash_applied = cash_amount
        excess = cash_amount - c_min
        invest_map = dict(full_invest)
        for b in buckets:
            invest_map[id(b)] += excess * b["target_pct"] / 100
    else:
        cash_applied = cash_amount
        invest_map = full_invest

    new_pool = pool + cash_applied
    result_buckets = []
    for b in buckets:
        invest = invest_map[id(b)]
        new_value = b["current_value"] + invest
        new_pct = (new_value / new_pool * 100) if new_pool > 0 else 0.0
        result_buckets.append({
            **b,
            "invest": round(invest, 2),
            "new_value": round(new_value, 2),
            "new_pct": round(new_pct, 2),
            "remaining_drift": round(new_pct - b["target_pct"], 2),
        })

    return {
        "cash_to_zero_drift": round(c_min, 2),
        "cash_applied": round(cash_applied, 2),
        "new_pool": round(new_pool, 2),
        "buckets": result_buckets,
        "binding_note": binding_note,
    }


async def get_rebalance_plan(db: AsyncSession, mode: str = "anchored", cash_amount: float | None = None) -> dict:
    comparison = await get_allocation_comparison(db, mode)
    asset_class_comparison = await get_asset_class_comparison(db)

    asset_class_buckets = [
        {
            "category": r["asset_class"],
            "current_value": r["current_value"],
            "target_pct": r["target_pct"],
            "current_pct": r["current_pct"],
        }
        for r in asset_class_comparison["rows"]
    ]
    asset_class_plan = _zero_drift_plan(
        asset_class_buckets, asset_class_comparison["investable_total"], cash_amount
    )

    if mode == "free_float":
        buckets = [
            {
                "category": r["category"],
                "current_value": r["current_value"],
                "target_pct": r["target_pct"],
                "current_pct": r["current_pct"],
            }
            for r in comparison["rows"]
        ]
        category_plan = _zero_drift_plan(buckets, comparison["pool"], cash_amount)
        pool = comparison["pool"]
        conflict_note = _conflict_note(asset_class_plan, category_plan)
        return {
            "mode": mode,
            "pool": round(pool, 2),
            "cash_to_zero_drift": category_plan["cash_to_zero_drift"],
            "cash_applied": category_plan["cash_applied"],
            "new_pool": category_plan["new_pool"],
            "buckets": category_plan["buckets"],
            "asset_class": asset_class_plan["buckets"],
            "asset_class_cash_to_zero_drift": asset_class_plan["cash_to_zero_drift"],
            "asset_class_binding_note": asset_class_plan["binding_note"],
            "conflict_note": conflict_note,
            "binding_note": category_plan["binding_note"],
        }

    # ── Anchored mode: domestic categories share one pool, foreign scales off the
    # (possibly rebalanced) Large Cap anchor. See plan section 3.2. ──────────────
    domestic_rows = [r for r in comparison["rows"] if r["category"] != FOREIGN_CAT]
    foreign_row = next(r for r in comparison["rows"] if r["category"] == FOREIGN_CAT)

    domestic_buckets = [
        {
            "category": r["category"],
            "current_value": r["current_value"],
            "target_pct": r["target_pct"],
            "current_pct": r["current_pct"],
        }
        for r in domestic_rows
    ]
    domestic_pool = comparison["domestic_equity"]
    domestic_full_plan = _zero_drift_plan(domestic_buckets, domestic_pool, None)
    domestic_c_min = domestic_full_plan["cash_to_zero_drift"]

    targets = comparison["targets"]
    large_target = targets.get("Large Cap", 50)
    foreign_target_pct = targets.get(FOREIGN_CAT, 0)
    anchor_ratio = _foreign_anchor_ratio(foreign_target_pct, large_target)

    new_large_full = next(b for b in domestic_full_plan["buckets"] if b["category"] == "Large Cap")["new_value"]
    foreign_cur = foreign_row["current_value"]
    foreign_need = max(0.0, new_large_full * anchor_ratio - foreign_cur)
    total_c_min = domestic_c_min + foreign_need

    if cash_amount is None:
        domestic_cash, foreign_cash = domestic_c_min, foreign_need
    elif cash_amount <= domestic_c_min:
        domestic_cash, foreign_cash = cash_amount, 0.0
    elif cash_amount <= total_c_min:
        domestic_cash = domestic_c_min
        foreign_cash = cash_amount - domestic_c_min
    else:
        leftover = cash_amount - total_c_min
        domestic_target_total = 100.0 - foreign_target_pct
        domestic_cash = domestic_c_min + leftover * (domestic_target_total / 100)
        foreign_cash = foreign_need + leftover * (foreign_target_pct / 100)

    domestic_plan = _zero_drift_plan(domestic_buckets, domestic_pool, domestic_cash)
    new_large = next(b for b in domestic_plan["buckets"] if b["category"] == "Large Cap")["new_value"]
    foreign_new_value = foreign_cur + foreign_cash
    new_total_equity = domestic_plan["new_pool"] + foreign_new_value
    foreign_new_ideal = new_large * anchor_ratio
    foreign_target_display = round(foreign_new_ideal / new_total_equity * 100, 2) if new_total_equity > 0 else 0.0
    foreign_new_pct = round(foreign_new_value / new_total_equity * 100, 2) if new_total_equity > 0 else 0.0

    foreign_bucket = {
        "category": FOREIGN_CAT,
        "current_value": round(foreign_cur, 2),
        "target_pct": foreign_target_display,
        "current_pct": foreign_row["current_pct"],
        "invest": round(foreign_cash, 2),
        "new_value": round(foreign_new_value, 2),
        "new_pct": foreign_new_pct,
        "remaining_drift": round(foreign_new_pct - foreign_target_display, 2),
    }

    category_plan = {
        "cash_to_zero_drift": round(total_c_min, 2),
        "cash_applied": round(domestic_cash + foreign_cash, 2),
        "new_pool": round(new_total_equity, 2),
        "buckets": domestic_plan["buckets"] + [foreign_bucket],
    }
    conflict_note = _conflict_note(asset_class_plan, category_plan)

    if foreign_need > domestic_c_min and foreign_need > 0:
        binding_note = (
            f"Driven by Equity - Foreign catching up to {anchor_ratio * 100:.1f}% of Large Cap "
            f"(₹{foreign_need:,.0f} needed there alone)."
        )
    else:
        binding_note = domestic_full_plan["binding_note"]

    return {
        "mode": mode,
        "pool": round(domestic_pool + foreign_cur, 2),
        "cash_to_zero_drift": category_plan["cash_to_zero_drift"],
        "cash_applied": category_plan["cash_applied"],
        "new_pool": category_plan["new_pool"],
        "buckets": category_plan["buckets"],
        "asset_class": asset_class_plan["buckets"],
        "asset_class_cash_to_zero_drift": asset_class_plan["cash_to_zero_drift"],
        "asset_class_binding_note": asset_class_plan["binding_note"],
        "conflict_note": conflict_note,
        "binding_note": binding_note,
    }


def _conflict_note(asset_class_plan: dict, category_plan: dict) -> str | None:
    non_equity_need = sum(
        b["invest"] for b in asset_class_plan["buckets"]
        if b["category"] != "Equity" and b["invest"] > 0
    )
    if non_equity_need > 0 and category_plan["cash_to_zero_drift"] > 0:
        return (
            f"Asset-class rebalance also calls for ₹{non_equity_need:,.0f} in Debt/Precious Metals — "
            "an equity-only investment won't fix that."
        )
    return None


async def _get_free_float_comparison(
    db,
    targets: dict[str, float],
    current_totals: dict[str, float],
    invested_totals: dict[str, float],
    current_equity: float,
    invested_equity: float,
    foreign_cur: float,
    foreign_inv: float,
    domestic_cur: float,
    domestic_inv: float,
) -> dict:
    from app.services.manual_assets import get_manual_assets_summary

    manual = await get_manual_assets_summary(db)
    savings_cash = manual.get("total_cash", 0)
    emergency_fund = manual.get("emergency_total", 0)

    # Pool = investable total (everything except savings cash, USD cash, emergency fund)
    # USD cash is already excluded from manual_assets total_cash vs total_foreign_equity_inr split,
    # but if stored under a separate key, handle it. USD equity is in Equity - Foreign already.
    mf_cash = max(0.0, current_totals.get("Cash", 0) - savings_cash)
    debt_cur = sum(current_totals.get(c, 0) for c in _AC_DEBT) + mf_cash - emergency_fund
    debt_cur = max(0.0, debt_cur)
    debt_inv = sum(invested_totals.get(c, 0) for c in _AC_DEBT)
    pm_cur = sum(current_totals.get(c, 0) for c in _AC_PRECIOUS_METALS)
    pm_inv = sum(invested_totals.get(c, 0) for c in _AC_PRECIOUS_METALS)

    pool_cur = current_equity + debt_cur + pm_cur
    pool_inv = invested_equity + debt_inv + pm_inv

    # Row order: Large, Mid, Small, Foreign, Debt, Precious Metals
    ff_cats = [
        ("Large Cap",        current_totals.get("Large Cap", 0),        invested_totals.get("Large Cap", 0)),
        ("Mid Cap",          current_totals.get("Mid Cap", 0),          invested_totals.get("Mid Cap", 0)),
        ("Small Cap",        current_totals.get("Small Cap", 0),        invested_totals.get("Small Cap", 0)),
        ("Equity - Foreign", foreign_cur,                                foreign_inv),
        ("Debt",             debt_cur,                                   debt_inv),
        ("Precious Metals",  pm_cur,                                     pm_inv),
    ]

    rows = []
    for cat, cur_val, inv_val in ff_cats:
        target_pct = targets.get(cat, 0.0)
        cur_pct = (cur_val / pool_cur * 100) if pool_cur > 0 else 0
        inv_pct = (inv_val / pool_inv * 100) if pool_inv > 0 else 0
        cur_ideal = pool_cur * target_pct / 100
        inv_ideal = pool_inv * target_pct / 100
        rows.append({
            "category": cat,
            "target_pct": target_pct,
            "anchor_note": None,
            "current_pct": round(cur_pct, 2),
            "current_value": round(cur_val, 2),
            "current_diff": round(cur_pct - target_pct, 2),
            "invested_pct": round(inv_pct, 2),
            "invested_value": round(inv_val, 2),
            "invested_diff": round(inv_pct - target_pct, 2),
            "current_ideal_value": round(cur_ideal, 2),
            "current_value_diff": round(cur_val - cur_ideal, 2),
            "invested_ideal_value": round(inv_ideal, 2),
            "invested_value_diff": round(inv_val - inv_ideal, 2),
        })

    foreign_cur_pct = (foreign_cur / pool_cur * 100) if pool_cur > 0 else 0
    return {
        "rows": rows,
        "foreign": {"target_pct": targets.get("Equity - Foreign", 0), "current_pct": round(foreign_cur_pct, 2),
                    "current_value": round(foreign_cur, 2), "current_diff": 0,
                    "current_value_diff": 0, "invested_pct": 0, "invested_value": round(foreign_inv, 2)},
        "domestic": {"target_pct": 0, "current_pct": 0, "current_value": round(domestic_cur, 2),
                     "current_diff": 0, "current_value_diff": 0, "invested_pct": 0, "invested_value": round(domestic_inv, 2)},
        "targets": targets,
        "current_equity": round(current_equity, 2),
        "invested_equity": round(invested_equity, 2),
        "domestic_equity": round(domestic_cur, 2),
        "pool": round(pool_cur, 2),
        "mode": "free_float",
    }
