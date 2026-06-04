import asyncio
import json as jsonlib

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
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
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/mf-breakdown", tags=["mf-breakdown"])

_ingest_lock = asyncio.Lock()


@router.get("/ingest/stream")
async def ingest_stream(db: AsyncSession = Depends(get_db)):
    if _ingest_lock.locked():
        async def _busy():
            yield {"event": "done", "data": jsonlib.dumps({"ok": False, "error": "An ingest is already running."})}
        return EventSourceResponse(_busy())

    async def _generate():
        async with _ingest_lock:
            queue: asyncio.Queue[str] = asyncio.Queue()

            async def _on_progress(msg: str):
                await queue.put(msg)

            async def _run():
                try:
                    amfi = await sync_amfi_market_cap(db, on_progress=_on_progress)
                    if "error" not in amfi:
                        ingest = await ingest_scheme_csvs(db, on_progress=_on_progress)
                    else:
                        ingest = {"error": "Skipped — AMFI classification not loaded"}
                    await queue.put(None)
                    await queue.put(jsonlib.dumps({"ok": True, "amfi": amfi, "ingest": ingest}))
                except Exception as e:
                    await queue.put(None)
                    await queue.put(jsonlib.dumps({"ok": False, "error": str(e)}))

            task = asyncio.create_task(_run())
            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield {"event": "log", "data": msg}

            final = await queue.get()
            yield {"event": "done", "data": final}
            await task

    return EventSourceResponse(_generate())


VALID_CATEGORIES = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity"}


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


@router.post("/allocation-targets")
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
