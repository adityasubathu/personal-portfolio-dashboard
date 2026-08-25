import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.sse import sse_stream
from app.models.allocation_target import AllocationTarget
from app.models.mf_breakdown import EquityCategoryOverride, MfSchemeBreakdown
from app.services.mf_breakdown import (
    normalize_company_name,
    get_allocation_comparison,
    get_allocation_targets,
    get_asset_class_comparison,
    get_asset_class_targets,
    get_available_schemes,
    get_breakdown_chart_data,
    get_category_composition,
    get_direct_trade_breakdown,
    get_rebalance_plan,
    get_scheme_breakdown,
    get_sector_composition,
    get_sector_list,
    get_sector_stock_breakdown,
    get_stock_holdings_table,
    ingest_from_openfin,
    save_allocation_targets,
    save_asset_class_targets,
    save_sector_overrides,
    sync_amfi_market_cap,
)
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/mf-breakdown", tags=["mf-breakdown"])

_ingest_lock = asyncio.Lock()


@router.get("/ingest/stream")
async def ingest_stream(db: AsyncSession = Depends(get_db)):
    async def _runner(on_progress):
        amfi = await sync_amfi_market_cap(db, on_progress=on_progress)
        if "error" not in amfi:
            ingest = await ingest_from_openfin(db, on_progress=on_progress)
        else:
            ingest = {"error": "Skipped — AMFI classification not loaded"}
        return {"amfi": amfi, "ingest": ingest}

    return sse_stream(_runner, lock=_ingest_lock, busy_msg="An ingest is already running.")


VALID_CATEGORIES = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Foreign"}


@router.patch("/classify-batch")
async def classify_batch(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    isins = form.getlist("scheme_isin")
    names = form.getlist("name")
    categories = form.getlist("category")

    updated = 0
    override_rows: list[dict] = []
    for isin, name, cat in zip(isins, names, categories):
        if cat not in VALID_CATEGORIES:
            continue
        result = await db.execute(
            update(MfSchemeBreakdown)
            .where(MfSchemeBreakdown.scheme_isin == isin, MfSchemeBreakdown.name == name)
            .values(category=cat, updated_at=now_ist())
        )
        updated += result.rowcount
        override_rows.append({
            "name_normalized": normalize_company_name(name),
            "raw_name": name,
            "category": cat,
            "updated_at": now_ist(),
        })

    if override_rows:
        stmt = pg_insert(EquityCategoryOverride).values(override_rows)
        await db.execute(stmt.on_conflict_do_update(
            index_elements=["name_normalized"],
            set_={"raw_name": stmt.excluded.raw_name, "category": stmt.excluded.category, "updated_at": stmt.excluded.updated_at},
        ))
    await db.commit()

    return {"updated": updated}


@router.patch("/sector-classify-batch")
async def sector_classify_batch(request: Request, db: AsyncSession = Depends(get_db)):
    body = await request.json()
    updated = await save_sector_overrides(db, body)
    return {"updated": updated}


@router.get("/sector-list")
async def sector_list(db: AsyncSession = Depends(get_db)):
    sectors = await get_sector_list(db)
    return JSONResponse(sectors)


@router.get("/chart-data")
async def chart_data(db: AsyncSession = Depends(get_db)):
    data = await get_breakdown_chart_data(db)
    return JSONResponse(data)


@router.get("/stock-holdings")
async def stock_holdings(db: AsyncSession = Depends(get_db)):
    data = await get_stock_holdings_table(db)
    return JSONResponse(data)


@router.get("/allocation-comparison")
async def allocation_comparison(mode: str = "anchored", db: AsyncSession = Depends(get_db)):
    data = await get_allocation_comparison(db, mode=mode)
    return JSONResponse(data)


@router.get("/allocation-targets")
async def allocation_targets(mode: str = "anchored", db: AsyncSession = Depends(get_db)):
    targets = await get_allocation_targets(db, mode=mode)
    return JSONResponse(targets)


@router.post("/allocation-targets")
async def update_allocation_targets(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    mode = form.get("mode", "anchored")
    targets: dict[str, float] = {}
    for key, val in form.items():
        if key.startswith("target_"):
            cat = key[7:]
            try:
                targets[cat] = float(val)
            except ValueError:
                continue
    await save_allocation_targets(db, targets, mode=str(mode))
    return {"ok": True}


@router.get("/rebalance-plan")
async def rebalance_plan(
    mode: str = "anchored",
    cash: float | None = None,
    db: AsyncSession = Depends(get_db),
):
    data = await get_rebalance_plan(db, mode=mode, cash_amount=cash)
    return JSONResponse(data)


@router.get("/asset-class-comparison")
async def asset_class_comparison(db: AsyncSession = Depends(get_db)):
    data = await get_asset_class_comparison(db)
    return JSONResponse(data)


@router.get("/asset-class-targets")
async def get_asset_class_targets_endpoint(db: AsyncSession = Depends(get_db)):
    targets = await get_asset_class_targets(db)
    return JSONResponse(targets)


@router.post("/asset-class-targets")
async def update_asset_class_targets(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    targets: dict[str, float] = {}
    foreign_pct: float | None = None
    for key, val in form.items():
        if key.startswith("target_"):
            asset_class = key[7:].replace("_", " ")
            try:
                v = float(val)
            except ValueError:
                continue
            if asset_class == "Equity - Foreign":
                foreign_pct = v
            else:
                targets[asset_class] = v
    await save_asset_class_targets(db, targets)
    if foreign_pct is not None:
        await db.execute(
            pg_insert(AllocationTarget)
            .values(category="Equity - Foreign", target_pct=foreign_pct)
            .on_conflict_do_update(index_elements=["category"], set_={"target_pct": foreign_pct})
        )
        await db.commit()
    return {"ok": True}


@router.get("/category-composition")
async def category_composition(db: AsyncSession = Depends(get_db)):
    data = await get_category_composition(db)
    return JSONResponse(data)


@router.get("/sector-composition")
async def sector_composition(db: AsyncSession = Depends(get_db)):
    data = await get_sector_composition(db, equity_only=True)
    return JSONResponse(data)


@router.get("/sector-stock-breakdown")
async def sector_stock_breakdown(db: AsyncSession = Depends(get_db)):
    data = await get_sector_stock_breakdown(db)
    return JSONResponse(data)


@router.get("/direct-trades")
async def direct_trades(db: AsyncSession = Depends(get_db)):
    data = await get_direct_trade_breakdown(db)
    return JSONResponse(data)


@router.get("/schemes")
async def schemes(db: AsyncSession = Depends(get_db)):
    data = await get_available_schemes(db)
    return JSONResponse(data)


@router.get("/scheme/{scheme_isin}")
async def scheme_detail(scheme_isin: str, db: AsyncSession = Depends(get_db)):
    data = await get_scheme_breakdown(db, scheme_isin)
    return JSONResponse(data)
