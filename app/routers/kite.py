from fastapi import APIRouter, Depends, Form, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.kite import KiteConfig, KiteSyncLog
from app.schemas.kite import KiteLastSync, KiteStatus, KiteSyncResult
from app.services import kite_client, kite_sync
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/kite", tags=["kite"])


@router.put("/config", response_model=KiteStatus)
async def save_config(
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
        config.access_token = None
        config.access_token_expiry = None

    await db.commit()
    return await _status_json(db)


@router.delete("/config", response_model=KiteStatus)
async def delete_config(db: AsyncSession = Depends(get_db)):
    await db.execute(delete(KiteConfig))
    await db.commit()
    return await _status_json(db)


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


@router.get("/auth/url")
async def auth_url(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(400, "Kite not configured")
    return {"url": kite_client.login_url(config.api_key)}


@router.get("/auth/callback")
async def auth_callback(
    action: str = "",
    type: str = "",
    status: str = "",
    request_token: str = "",
    db: AsyncSession = Depends(get_db),
):
    from app.config import settings
    frontend = settings.frontend_url
    if status != "success" or not request_token:
        return RedirectResponse(url=f"{frontend}/kite?error=login_failed")

    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        return RedirectResponse(url=f"{frontend}/kite?error=not_configured")

    try:
        access_token = await kite_client.exchange_token(
            config.api_key, config.api_secret, request_token
        )
    except Exception as e:
        return RedirectResponse(url=f"{frontend}/kite?error={str(e)[:80]}")

    config.access_token = access_token
    config.access_token_expiry = kite_sync.next_token_expiry()
    await db.commit()

    return RedirectResponse(url=f"{frontend}/kite?login=success")


@router.post("/sync", response_model=KiteSyncResult)
async def trigger_sync(db: AsyncSession = Depends(get_db)):
    try:
        result = await kite_sync.sync(db)
    except Exception as e:
        result = {"synced_at": now_ist().isoformat(), "status": "FAILED", "error_message": str(e), "holdings_count": 0, "positions_count": 0}
    return KiteSyncResult(**result)


@router.get("/status", response_model=KiteStatus)
async def kite_status(db: AsyncSession = Depends(get_db)):
    return await _status_json(db)


async def _status_json(db: AsyncSession) -> KiteStatus:
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()

    last_sync = None
    if config:
        sync_result = await db.execute(
            select(KiteSyncLog).order_by(KiteSyncLog.synced_at.desc()).limit(1)
        )
        log = sync_result.scalar_one_or_none()
        if log:
            last_sync = KiteLastSync(
                synced_at=log.synced_at.isoformat(),
                status=log.status,
                holdings_count=log.holdings_count,
                positions_count=log.positions_count,
                error_message=log.error_message,
            )

    return KiteStatus(
        configured=config is not None,
        api_key=config.api_key if config else None,
        token_valid=_is_token_valid(config) if config else False,
        token_expiry=config.access_token_expiry.isoformat() if config and config.access_token_expiry else None,
        last_sync=last_sync,
        login_url=kite_client.login_url(config.api_key) if config else None,
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
