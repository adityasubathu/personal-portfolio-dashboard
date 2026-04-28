from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.kite import KiteConfig, KiteSyncLog
from app.services import kite_client, kite_sync
from app.templating import templates
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/kite", tags=["kite"])


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.put("/config", response_class=HTMLResponse)
async def save_config(
    request: Request,
    api_key: str = Form(...),
    api_secret: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    from app.config import settings
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()

    if config is None:
        config = KiteConfig(
            id=1,
            api_key=api_key,
            api_secret=api_secret,
            redirect_url=settings.kite_redirect_url,
        )
        db.add(config)
    else:
        config.api_key = api_key
        config.api_secret = api_secret
        config.redirect_url = settings.kite_redirect_url
        # Clear old token when credentials change
        config.access_token = None
        config.access_token_expiry = None

    await db.commit()
    # Return updated status panel
    return await _status_html(request, db)


@router.delete("/config", response_class=HTMLResponse)
async def delete_config(request: Request, db: AsyncSession = Depends(get_db)):
    """Wipe saved Kite credentials + access token. Returns the refreshed status
    panel so the UI re-renders into the unconfigured state."""
    await db.execute(delete(KiteConfig))
    await db.commit()
    return await _status_html(request, db)


@router.get("/config")
async def get_config(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        return {"configured": False}
    return {
        "configured": True,
        "api_key": config.api_key,
        "has_secret": bool(config.api_secret),
        "token_valid": _is_token_valid(config),
        "token_expiry": config.access_token_expiry.isoformat() if config.access_token_expiry else None,
    }


# ---------------------------------------------------------------------------
# Auth flow
# ---------------------------------------------------------------------------

@router.get("/auth/url")
async def auth_url(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(400, "Kite not configured")
    return {"url": kite_client.login_url(config.api_key)}


@router.get("/auth/callback")
async def auth_callback(
    request: Request,
    action: str = "",
    type: str = "",
    status: str = "",
    request_token: str = "",
    db: AsyncSession = Depends(get_db),
):
    if status != "success" or not request_token:
        return RedirectResponse(url="/kite?error=login_failed")

    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        return RedirectResponse(url="/kite?error=not_configured")

    try:
        access_token = await kite_client.exchange_token(
            config.api_key, config.api_secret, request_token
        )
    except Exception as e:
        return RedirectResponse(url=f"/kite?error={str(e)[:80]}")

    config.access_token = access_token
    config.access_token_expiry = kite_sync.next_token_expiry()
    await db.commit()

    return RedirectResponse(url="/kite?login=success")


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------

@router.post("/sync", response_class=HTMLResponse)
async def trigger_sync(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await kite_sync.sync(db)
    except Exception as e:
        result = {"status": "FAILED", "error_message": str(e), "holdings_count": 0, "positions_count": 0}

    return templates.TemplateResponse(
        "partials/sync_status.html",
        {"request": request, "result": result},
    )


@router.get("/status", response_class=HTMLResponse)
async def kite_status(request: Request, db: AsyncSession = Depends(get_db)):
    return await _status_html(request, db)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _status_html(request: Request, db: AsyncSession) -> HTMLResponse:
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()

    last_sync = None
    if config:
        sync_result = await db.execute(
            select(KiteSyncLog).order_by(KiteSyncLog.synced_at.desc()).limit(1)
        )
        last_sync = sync_result.scalar_one_or_none()

    return templates.TemplateResponse(
        "partials/kite_status.html",
        {
            "request": request,
            "config": config,
            "token_valid": _is_token_valid(config) if config else False,
            "last_sync": last_sync,
            "login_url": kite_client.login_url(config.api_key) if config else None,
        },
    )


def _is_token_valid(config: KiteConfig | None) -> bool:
    if not config or not config.access_token:
        return False
    if config.access_token_expiry:
        expiry = config.access_token_expiry
        if expiry.tzinfo is not None:
            expiry = expiry.replace(tzinfo=None)
        return now_ist() < expiry
    return True
