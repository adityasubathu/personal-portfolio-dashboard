from fastapi import APIRouter, Depends
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
from app.schemas.settings import DbInfo, DeleteResult

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("/db-info", response_model=DbInfo)
async def db_info():
    from urllib.parse import urlparse
    from app.config import settings
    parsed = urlparse(settings.database_url.replace("+asyncpg", ""))
    return DbInfo(
        host=parsed.hostname or "localhost",
        port=parsed.port or 5432,
        name=(parsed.path or "/portfolio").lstrip("/"),
    )


@router.delete("/trades", response_model=DeleteResult)
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
    return DeleteResult(deleted=t, message=f"Deleted {t} trades, all holdings, and orphan instruments.")


@router.delete("/price-history", response_model=DeleteResult)
async def delete_price_history(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(PriceHistory))).scalar_one()
    await db.execute(delete(PriceHistory))
    await db.commit()
    return DeleteResult(deleted=n, message=f"Deleted {n} Kite OHLC price history rows.")


@router.delete("/nav-history", response_model=DeleteResult)
async def delete_nav_history(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(NavHistory))).scalar_one()
    await db.execute(delete(NavHistory))
    await db.commit()
    return DeleteResult(deleted=n, message=f"Deleted {n} MF/ETF NAV history rows.")


@router.delete("/mf-breakdown", response_model=DeleteResult)
async def delete_mf_breakdown(db: AsyncSession = Depends(get_db)):
    n1 = (await db.execute(select(func.count()).select_from(MfSchemeBreakdown))).scalar_one()
    n2 = (await db.execute(select(func.count()).select_from(AmfiMarketCap))).scalar_one()
    await db.execute(delete(MfSchemeBreakdown))
    await db.execute(delete(AmfiMarketCap))
    await db.commit()
    return DeleteResult(deleted=n1 + n2, message=f"Deleted {n1} breakdown rows and {n2} AMFI classification rows.")


@router.delete("/manual-assets", response_model=DeleteResult)
async def delete_manual_assets(db: AsyncSession = Depends(get_db)):
    n = (await db.execute(select(func.count()).select_from(ManualAsset))).scalar_one()
    await db.execute(delete(ManualAsset))
    await db.commit()
    return DeleteResult(deleted=n, message=f"Deleted {n} manual asset(s).")
