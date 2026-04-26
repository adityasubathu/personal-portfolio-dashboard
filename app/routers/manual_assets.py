from datetime import date

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.manual_asset import ManualAsset
from app.services.manual_assets import compute_fd_value, get_manual_assets_summary
from app.templating import templates
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/manual-assets", tags=["manual-assets"])


@router.post("/fd", response_class=HTMLResponse)
async def add_fd(
    request: Request,
    label: str = Form(...),
    principal: float = Form(...),
    interest_rate: float = Form(...),
    start_date: date = Form(...),
    maturity_date: date = Form(...),
    is_emergency_fund: bool = Form(False),
    db: AsyncSession = Depends(get_db),
):
    asset = ManualAsset(
        asset_type="FD",
        label=label,
        principal=principal,
        interest_rate=interest_rate,
        start_date=start_date,
        maturity_date=maturity_date,
        is_emergency_fund=is_emergency_fund,
    )
    db.add(asset)
    await db.commit()
    return await _render_assets_partial(request, db)


@router.post("/ppf", response_class=HTMLResponse)
async def add_ppf(
    request: Request,
    label: str = Form("PPF"),
    current_value: float = Form(...),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(ManualAsset).where(ManualAsset.asset_type == "PPF")
    )).scalar_one_or_none()

    if existing:
        existing.current_value = current_value
        existing.label = label
    else:
        db.add(ManualAsset(asset_type="PPF", label=label, current_value=current_value))

    await db.commit()
    return await _render_assets_partial(request, db)


@router.post("/nps", response_class=HTMLResponse)
async def add_nps(
    request: Request,
    label: str = Form("NPS"),
    current_value: float = Form(...),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(ManualAsset).where(ManualAsset.asset_type == "NPS")
    )).scalar_one_or_none()

    if existing:
        existing.current_value = current_value
        existing.label = label
    else:
        db.add(ManualAsset(asset_type="NPS", label=label, current_value=current_value))

    await db.commit()
    return await _render_assets_partial(request, db)


@router.post("/cash", response_class=HTMLResponse)
async def add_cash(
    request: Request,
    label: str = Form("Savings / Current"),
    current_value: float = Form(...),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(
        select(ManualAsset).where(ManualAsset.asset_type == "CASH")
    )).scalar_one_or_none()

    if existing:
        existing.current_value = current_value
        existing.label = label
    else:
        db.add(ManualAsset(asset_type="CASH", label=label, current_value=current_value))

    await db.commit()
    return await _render_assets_partial(request, db)


@router.delete("/{asset_id}", response_class=HTMLResponse)
async def delete_asset(
    request: Request,
    asset_id: int,
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(ManualAsset).where(ManualAsset.id == asset_id))
    await db.commit()
    return await _render_assets_partial(request, db)


@router.get("", response_class=HTMLResponse)
async def list_assets(request: Request, db: AsyncSession = Depends(get_db)):
    return await _render_assets_partial(request, db)


async def _render_assets_partial(request: Request, db: AsyncSession) -> HTMLResponse:
    summary = await get_manual_assets_summary(db)
    return templates.TemplateResponse(
        "partials/manual_assets.html",
        {"request": request, **summary},
    )
