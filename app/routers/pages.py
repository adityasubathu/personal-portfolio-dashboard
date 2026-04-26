from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.instrument import Instrument
from app.models.price_history import PriceHistory
from app.models.trade import Trade
from app.templating import templates
router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@router.get("/trades", response_class=HTMLResponse)
async def trades(request: Request):
    return templates.TemplateResponse("trades.html", {"request": request})


@router.get("/import", response_class=HTMLResponse)
async def import_page(request: Request):
    return templates.TemplateResponse("import.html", {"request": request})


@router.get("/kite", response_class=HTMLResponse)
async def kite_page(request: Request):
    return templates.TemplateResponse("kite.html", {"request": request})


@router.get("/portfolio/nav-history", response_class=HTMLResponse)
async def nav_history_page(request: Request, db: AsyncSession = Depends(get_db)):
    # Dropdown: every instrument the user has ever traded, with how many
    # price_history rows we already have for it. Instruments with zero rows
    # are the ones that typically need a manual upload.
    traded_ids = select(Trade.instrument_id).distinct()
    result = await db.execute(
        select(
            Instrument,
            func.count(PriceHistory.id).label("n_prices"),
        )
        .outerjoin(PriceHistory, PriceHistory.instrument_id == Instrument.id)
        .where(Instrument.id.in_(traded_ids))
        .group_by(Instrument.id)
        .order_by(func.count(PriceHistory.id).asc(), Instrument.tradingsymbol)
    )
    instruments = [
        {
            "id": i.id,
            "symbol": i.tradingsymbol,
            "isin": i.isin,
            "type": i.instrument_type,
            "n_prices": n,
        }
        for i, n in result.all()
    ]
    return templates.TemplateResponse(
        "nav_history.html",
        {"request": request, "instruments": instruments},
    )


@router.get("/portfolio/mf-breakdown", response_class=HTMLResponse)
async def mf_breakdown_page(request: Request):
    return templates.TemplateResponse("mf_breakdown.html", {"request": request})


@router.get("/settings", response_class=HTMLResponse)
async def settings(request: Request):
    from app.config import settings as app_settings
    from urllib.parse import urlparse
    parsed = urlparse(app_settings.database_url.replace("+asyncpg", ""))
    return templates.TemplateResponse("settings.html", {
        "request": request,
        "db_host": parsed.hostname or "localhost",
        "db_port": parsed.port or 5432,
        "db_name": (parsed.path or "/portfolio").lstrip("/"),
    })
