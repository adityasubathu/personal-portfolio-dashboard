from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.mf import NavTrackedInstrument
from app.services.mfapi_nav import (
    get_nav_tracked_instruments,
    remove_nav_tracked_instrument,
)

router = APIRouter(prefix="/api/v1/mf", tags=["mf"])


@router.get("/nav-tracked", response_model=list[NavTrackedInstrument])
async def list_nav_tracked(db: AsyncSession = Depends(get_db)):
    return await get_nav_tracked_instruments(db)


@router.delete("/nav-tracked/{instrument_id}", response_model=list[NavTrackedInstrument])
async def delete_nav_tracked(instrument_id: int, db: AsyncSession = Depends(get_db)):
    await remove_nav_tracked_instrument(db, instrument_id)
    return await get_nav_tracked_instruments(db)
