from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.market_sentiment import get_market_breadth, get_sentiment_series, get_sentiment_summary

router = APIRouter(prefix="/api/v1/market-sentiment", tags=["market-sentiment"])


@router.get("/summary")
async def summary(db: AsyncSession = Depends(get_db)):
    data = await get_sentiment_summary(db)
    return JSONResponse(data)


@router.get("/series")
async def series(days: int = 365, db: AsyncSession = Depends(get_db)):
    data = await get_sentiment_series(db, days)
    return JSONResponse(data)


@router.get("/breadth")
async def breadth(db: AsyncSession = Depends(get_db)):
    data = await get_market_breadth(db)
    return JSONResponse(data)
