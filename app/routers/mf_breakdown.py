from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.mf_breakdown import EquityCategoryOverride, MfSchemeBreakdown
from app.services.mf_breakdown import (
    normalize_company_name,
    get_allocation_comparison,
    get_allocation_targets,
    get_available_schemes,
    get_breakdown_chart_data,
    get_category_composition,
    get_direct_trade_breakdown,
    get_scheme_breakdown,
    get_sector_composition,
    get_sector_stock_breakdown,
    get_stock_holdings_table,
    ingest_scheme_csvs,
    save_allocation_targets,
    sync_amfi_market_cap,
)
from app.templating import templates
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/mf-breakdown", tags=["mf-breakdown"])


@router.post("/ingest", response_class=HTMLResponse)
async def ingest(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        amfi_result = await sync_amfi_market_cap(db)
    except Exception as e:
        amfi_result = {"error": str(e)}

    if "error" not in amfi_result:
        try:
            ingest_result = await ingest_scheme_csvs(db)
        except Exception as e:
            ingest_result = {"error": str(e)}
    else:
        ingest_result = {"error": "Skipped — AMFI classification not loaded"}

    return templates.TemplateResponse(
        "partials/mf_breakdown_ingest_status.html",
        {"request": request, "amfi": amfi_result, "ingest": ingest_result},
    )


VALID_CATEGORIES = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity"}


@router.patch("/classify-batch", response_class=HTMLResponse)
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

    return HTMLResponse(f"<small style='color:green'>Updated {updated} holding(s).</small>")


@router.get("/chart-data")
async def chart_data(db: AsyncSession = Depends(get_db)):
    data = await get_breakdown_chart_data(db)
    return JSONResponse(data)


@router.get("/stock-holdings")
async def stock_holdings(db: AsyncSession = Depends(get_db)):
    data = await get_stock_holdings_table(db)
    return JSONResponse(data)


@router.get("/allocation-comparison")
async def allocation_comparison(db: AsyncSession = Depends(get_db)):
    data = await get_allocation_comparison(db)
    return JSONResponse(data)


@router.get("/allocation-targets")
async def allocation_targets(db: AsyncSession = Depends(get_db)):
    targets = await get_allocation_targets(db)
    return JSONResponse(targets)


@router.post("/allocation-targets", response_class=HTMLResponse)
async def update_allocation_targets(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    targets: dict[str, float] = {}
    for key, val in form.items():
        if key.startswith("target_"):
            cat = key[7:]
            try:
                targets[cat] = float(val)
            except ValueError:
                continue
    await save_allocation_targets(db, targets)
    return HTMLResponse("<small style='color:green'>Targets saved.</small>")


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
