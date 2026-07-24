from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.capital_gains import get_available_fys, get_capital_gains

router = APIRouter(prefix="/api/v1/capital-gains", tags=["capital-gains"])


@router.get("/years")
async def available_years(db: AsyncSession = Depends(get_db)):
    fys = await get_available_fys(db)
    return JSONResponse({"fys": fys})


@router.get("/{fy}")
async def capital_gains(fy: str, db: AsyncSession = Depends(get_db)):
    data = await get_capital_gains(db, fy)
    return JSONResponse(data)
