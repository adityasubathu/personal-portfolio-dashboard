from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.models.trade import Trade

router = APIRouter(prefix="/api/v1/charts")


@router.get("/instruments")
async def chart_instruments(db: AsyncSession = Depends(get_db)):
    """Instruments that have OHLC price history (for the price chart dropdown)."""
    result = await db.execute(
        select(Instrument)
        .join(PriceHistory, PriceHistory.instrument_id == Instrument.id)
        .where(Instrument.instrument_type != "MF")
        .distinct()
        .order_by(Instrument.tradingsymbol)
    )
    return [
        {"id": i.id, "symbol": i.tradingsymbol, "isin": i.isin, "name": i.name, "type": i.instrument_type}
        for i in result.scalars().all()
    ]


@router.get("/nav-instruments")
async def nav_chart_instruments(db: AsyncSession = Depends(get_db)):
    """Instruments that have NAV history (for the fund NAV chart dropdown)."""
    result = await db.execute(
        select(Instrument)
        .join(NavHistory, NavHistory.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(["MF", "ETF"]))
        .distinct()
        .order_by(Instrument.instrument_type, Instrument.name)
    )
    return [
        {"id": i.id, "symbol": i.tradingsymbol, "isin": i.isin, "name": i.name, "type": i.instrument_type}
        for i in result.scalars().all()
    ]


@router.get("/price/{instrument_id}")
async def price_chart_data(instrument_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(PriceHistory)
            .where(PriceHistory.instrument_id == instrument_id)
            .order_by(PriceHistory.price_date)
        )
    ).scalars().all()

    candles = [
        {
            "time": r.price_date.isoformat(),
            "open": float(r.open or r.close),
            "high": float(r.high or r.close),
            "low": float(r.low or r.close),
            "close": float(r.close),
        }
        for r in rows
    ]
    return {"candles": candles, "markers": await _trade_markers(db, instrument_id)}


@router.get("/nav/{instrument_id}")
async def nav_chart_data(instrument_id: int, db: AsyncSession = Depends(get_db)):
    instrument = (
        await db.execute(select(Instrument).where(Instrument.id == instrument_id))
    ).scalar_one_or_none()

    nav_rows = (
        await db.execute(
            select(NavHistory)
            .where(NavHistory.instrument_id == instrument_id)
            .order_by(NavHistory.nav_date)
        )
    ).scalars().all()
    nav = [{"time": r.nav_date.isoformat(), "value": float(r.nav)} for r in nav_rows]

    prices = []
    if instrument and instrument.instrument_type == "ETF":
        price_rows = (
            await db.execute(
                select(PriceHistory)
                .where(PriceHistory.instrument_id == instrument_id)
                .order_by(PriceHistory.price_date)
            )
        ).scalars().all()
        prices = [{"time": r.price_date.isoformat(), "value": float(r.close)} for r in price_rows]

    return {
        "nav": nav,
        "prices": prices,
        "instrument_type": instrument.instrument_type if instrument else "MF",
        "markers": await _trade_markers(db, instrument_id),
    }


async def _trade_markers(db: AsyncSession, instrument_id: int) -> list[dict]:
    trades = (
        await db.execute(
            select(Trade)
            .where(Trade.instrument_id == instrument_id)
            .order_by(Trade.trade_date)
        )
    ).scalars().all()

    grouped: dict[tuple, list] = defaultdict(list)
    for t in trades:
        grouped[(t.trade_date.isoformat(), t.trade_type)].append(t)

    markers = []
    for (d, ttype), group in sorted(grouped.items()):
        total_qty = sum(float(t.quantity) for t in group)
        avg_price = sum(float(t.price) * float(t.quantity) for t in group) / total_qty
        markers.append({
            "time": d,
            "type": ttype,
            "qty": round(total_qty, 4),
            "price": round(avg_price, 2),
        })
    return markers
