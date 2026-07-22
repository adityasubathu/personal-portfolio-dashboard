import app.models  # noqa: F401 — registers all models in Base.metadata

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import Base, get_db

router = APIRouter(prefix="/api/v1", tags=["demo"])


@router.get("/status")
async def app_status():
    return {"demo_mode": settings.demo_mode}


@router.post("/demo/reset")
async def reset_demo(db: AsyncSession = Depends(get_db)):
    if not settings.demo_mode:
        return {"ok": False, "message": "Not in demo mode"}

    for table in reversed(Base.metadata.sorted_tables):
        if table.name == "app_config":
            continue
        await db.execute(text(f"DELETE FROM {table.name}"))

    # Preserve Kite credentials but clear any other config (e.g. demo_seeded flag)
    await db.execute(text("DELETE FROM app_config WHERE key != 'kite_config'"))
    await db.commit()

    from app.demo_seed import seed_demo_data
    await seed_demo_data(db)

    return {"ok": True, "message": "Demo data reset"}
