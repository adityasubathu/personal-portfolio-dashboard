from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.amfi_nav import sync_mf_navs
from app.services.mfapi_nav import sync_nav_history
from app.templating import templates
router = APIRouter(prefix="/api/v1/mf", tags=["mf"])


@router.post("/sync-nav", response_class=HTMLResponse)
async def sync_nav(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_mf_navs(db)
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": result, "error": None, "mode": "amfi"},
        )
    except Exception as e:
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": None, "error": str(e), "mode": "amfi"},
        )


@router.post("/sync-nav-history", response_class=HTMLResponse)
async def sync_nav_history_route(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_nav_history(db)
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": result, "error": None, "mode": "history"},
        )
    except Exception as e:
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": None, "error": str(e), "mode": "history"},
        )
