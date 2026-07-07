from datetime import date

from fastapi import APIRouter, Depends, Form
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.manual_asset import ManualAsset
from app.schemas.manual_assets import ManualAssetsSummary
from app.services.manual_assets import get_manual_assets_summary

router = APIRouter(prefix="/api/v1/manual-assets", tags=["manual-assets"])


@router.post("/fd", response_model=ManualAssetsSummary)
async def add_fd(
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
    return await _summary(db)


@router.post("/ppf", response_model=ManualAssetsSummary)
async def add_ppf(
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
    return await _summary(db)


@router.post("/nps", response_model=ManualAssetsSummary)
async def add_nps(
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
    return await _summary(db)


@router.post("/cash", response_model=ManualAssetsSummary)
async def add_cash(
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
    return await _summary(db)


@router.post("/foreign-equity", response_model=ManualAssetsSummary)
async def add_foreign_equity(
    label: str = Form(...),
    current_value: float = Form(...),
    db: AsyncSession = Depends(get_db),
):
    db.add(ManualAsset(asset_type="FOREIGN_EQ", label=label, current_value=current_value))
    await db.commit()
    return await _summary(db)


@router.delete("/{asset_id}", response_model=ManualAssetsSummary)
async def delete_asset(asset_id: int, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ManualAsset).where(ManualAsset.id == asset_id))
    await db.commit()
    return await _summary(db)


@router.get("", response_model=ManualAssetsSummary)
async def list_assets(db: AsyncSession = Depends(get_db)):
    return await _summary(db)


async def _summary(db: AsyncSession) -> ManualAssetsSummary:
    data = await get_manual_assets_summary(db)
    # Coerce date objects to strings for Pydantic
    for fd in data.get("fds", []):
        if fd.get("start_date") and not isinstance(fd["start_date"], str):
            fd["start_date"] = fd["start_date"].isoformat()
        if fd.get("maturity_date") and not isinstance(fd["maturity_date"], str):
            fd["maturity_date"] = fd["maturity_date"].isoformat()
    return ManualAssetsSummary(**data)
