from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.market_sentiment import (
    SENTIMENT_INDICES,
    get_market_breadth,
    get_sector_trends,
    get_sentiment_series,
    get_sentiment_summary,
)

router = APIRouter(prefix="/api/v1/market-sentiment", tags=["market-sentiment"])


def _resolve(index: str) -> str:
    symbol = SENTIMENT_INDICES.get(index)
    if symbol is None:
        raise HTTPException(400, f"unknown index: {index}")
    return symbol


@router.get("/summary")
async def summary(index: str = "nifty50", db: AsyncSession = Depends(get_db)):
    data = await get_sentiment_summary(db, _resolve(index))
    return JSONResponse(data)


@router.get("/series")
async def series(days: int = 365, index: str = "nifty50", db: AsyncSession = Depends(get_db)):
    data = await get_sentiment_series(db, days, _resolve(index))
    return JSONResponse(data)


@router.get("/breadth")
async def breadth(db: AsyncSession = Depends(get_db)):
    data = await get_market_breadth(db)
    return JSONResponse(data)


@router.get("/sector-trends")
async def sector_trends(db: AsyncSession = Depends(get_db)):
    data = await get_sector_trends(db)
    return JSONResponse(data)


@router.post("/refresh-indices")
async def refresh_indices(db: AsyncSession = Depends(get_db)):
    """Fetch the latest candle for all index instruments from Kite and update price_history.
    Safe to call at any time — before market open, Kite simply returns no new candle yet."""
    from app.services.kite_historical import sync_index_history
    try:
        result = await sync_index_history(db)
        return JSONResponse({"ok": True, **result})
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
