from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db

router = APIRouter(prefix="/api/v1", tags=["demo"])


@router.get("/status")
async def app_status():
    return {"demo_mode": settings.demo_mode}


@router.post("/demo/reset")
async def reset_demo(db: AsyncSession = Depends(get_db)):
    if not settings.demo_mode:
        return {"ok": False, "message": "Not in demo mode"}

    tables = [
        "policy_trigger_events", "policy_trigger_state",
        "nav_tracked_instruments", "csv_import_log",
        "manual_assets", "asset_class_targets", "allocation_targets",
        "mf_scheme_breakdown", "amfi_market_cap", "equity_category_override",
        "nav_history", "price_history",
        "holdings", "trades", "instruments",
    ]
    for table in tables:
        await db.execute(text(f"DELETE FROM {table}"))

    # Remove demo_seeded flag but preserve any Kite config
    await db.execute(text("DELETE FROM app_config WHERE key != 'kite_config'"))
    await db.commit()

    from app.demo_seed import seed_demo_data
    await seed_demo_data(db)

    return {"ok": True, "message": "Demo data reset"}
