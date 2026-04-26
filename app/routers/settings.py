from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.holding import Holding
from app.models.import_log import CSVImportLog
from app.models.instrument import Instrument
from app.models.manual_asset import ManualAsset
from app.models.mf_breakdown import AmfiMarketCap, MfSchemeBreakdown
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.models.trade import Trade

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.delete("/trades", response_class=HTMLResponse)
async def delete_all_trades(db: AsyncSession = Depends(get_db)):
    t = (await db.execute(select(func.count()).select_from(Trade))).scalar_one()
    await db.execute(delete(Trade))
    await db.execute(delete(Holding))
    await db.execute(delete(CSVImportLog))
    await db.execute(delete(Instrument).where(
        ~Instrument.trades.any(),
        ~Instrument.holding.has(),
    ))
    await db.commit()
    return HTMLResponse(f"<p>Deleted {t} trades, all holdings, and orphan instruments.</p>")


@router.delete("/price-history", response_class=HTMLResponse)
async def delete_price_history(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(PriceHistory))).scalar_one()
    await db.execute(delete(PriceHistory))
    await db.commit()
    return HTMLResponse(f"<p>Deleted {n} Kite OHLC price history rows.</p>")


@router.delete("/nav-history", response_class=HTMLResponse)
async def delete_nav_history(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(NavHistory))).scalar_one()
    await db.execute(delete(NavHistory))
    await db.commit()
    return HTMLResponse(f"<p>Deleted {n} MF/ETF NAV history rows.</p>")


@router.delete("/mf-breakdown", response_class=HTMLResponse)
async def delete_mf_breakdown(db: AsyncSession = Depends(get_db)):
    n1 = (await db.execute(select(func.count()).select_from(MfSchemeBreakdown))).scalar_one()
    n2 = (await db.execute(select(func.count()).select_from(AmfiMarketCap))).scalar_one()
    await db.execute(delete(MfSchemeBreakdown))
    await db.execute(delete(AmfiMarketCap))
    await db.commit()
    return HTMLResponse(f"<p>Deleted {n1} breakdown rows and {n2} AMFI classification rows.</p>")


@router.delete("/manual-assets", response_class=HTMLResponse)
async def delete_manual_assets(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(ManualAsset))).scalar_one()
    await db.execute(delete(ManualAsset))
    await db.commit()
    return HTMLResponse(f"<p>Deleted {n} manual asset(s).</p>")
