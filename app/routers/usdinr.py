from fastapi import APIRouter, Depends, Form
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.usdinr import get_usdinr_info, refresh_usdinr_rate, set_usdinr_rate_manual

router = APIRouter(prefix="/api/v1/usdinr", tags=["usdinr"])


@router.get("")
async def get_rate(db: AsyncSession = Depends(get_db)):
    info = await get_usdinr_info(db)
    return JSONResponse(info)


@router.post("/refresh")
async def refresh_rate(db: AsyncSession = Depends(get_db)):
    try:
        info = await refresh_usdinr_rate(db)
        return JSONResponse(info)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@router.post("/manual")
async def set_manual_rate(rate: float = Form(...), db: AsyncSession = Depends(get_db)):
    info = await set_usdinr_rate_manual(db, rate)
    return JSONResponse(info)
