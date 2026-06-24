from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.mf import FetchNavResult, NavTrackedInstrument
from app.services.amfi_nav import sync_mf_navs
from app.services.mfapi_nav import (
    fetch_nav_by_isin,
    get_nav_tracked_instruments,
    remove_nav_tracked_instrument,
    sync_nav_history,
)
from app.services.xirr import recompute_and_store_xirr

router = APIRouter(prefix="/api/v1/mf", tags=["mf"])


@router.post("/sync-nav")
async def sync_nav(db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_mf_navs(db)
        await recompute_and_store_xirr(db)
        return JSONResponse({"mode": "amfi", "error": None, **result})
    except Exception as e:
        return JSONResponse({"mode": "amfi", "error": str(e)}, status_code=500)


@router.post("/fetch-nav-by-isin", response_model=FetchNavResult)
async def fetch_nav_by_isin_route(isin: str, db: AsyncSession = Depends(get_db)):
    isin = isin.strip().upper()
    if not isin:
        return FetchNavResult(error="ISIN is required.")
    try:
        result = await fetch_nav_by_isin(db, isin)
        return FetchNavResult(**result)
    except Exception as e:
        return FetchNavResult(error=str(e))


@router.get("/nav-tracked", response_model=list[NavTrackedInstrument])
async def list_nav_tracked(db: AsyncSession = Depends(get_db)):
    return await get_nav_tracked_instruments(db)


@router.delete("/nav-tracked/{instrument_id}", response_model=list[NavTrackedInstrument])
async def delete_nav_tracked(instrument_id: int, db: AsyncSession = Depends(get_db)):
    await remove_nav_tracked_instrument(db, instrument_id)
    return await get_nav_tracked_instruments(db)


@router.post("/sync-nav-history")
async def sync_nav_history_route(db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_nav_history(db)
        await recompute_and_store_xirr(db)
        return JSONResponse({"mode": "history", "error": None, **result})
    except Exception as e:
        return JSONResponse({"mode": "history", "error": str(e)}, status_code=500)
