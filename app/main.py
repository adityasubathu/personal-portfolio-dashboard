from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models import *  # noqa: F401, F403 — ensures all models are registered


@asynccontextmanager
async def lifespan(app: FastAPI):
    from alembic import command
    from alembic.config import Config

    from app.config import settings as app_settings

    alembic_cfg = Config("alembic.ini")
    alembic_cfg.set_main_option(
        "sqlalchemy.url",
        app_settings.database_url.replace("+asyncpg", ""),
    )
    command.upgrade(alembic_cfg, "head")

    if app_settings.demo_mode:
        from sqlalchemy import text
        from app.database import AsyncSessionLocal
        from app.demo_seed import seed_demo_data
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT value_json FROM app_config WHERE key = 'demo_seeded'"))
            row = result.scalar_one_or_none()
            if row is None:
                print("[demo] demo_seeded flag not set — running seed...")
                await seed_demo_data(db)
            else:
                print("[demo] Already seeded — skipping.")

    yield


from app.config import settings  # noqa: E402

app = FastAPI(title="Portfolio Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import trades, portfolio, kite, mf, mf_breakdown, manual_assets, settings as settings_router, charts, policy_tracker, usdinr, demo, market_sentiment  # noqa: E402
app.include_router(trades.router)
app.include_router(portfolio.router)
app.include_router(kite.router)
app.include_router(mf.router)
app.include_router(mf_breakdown.router)
app.include_router(manual_assets.router)
app.include_router(settings_router.router)
app.include_router(charts.router)
app.include_router(policy_tracker.router)
app.include_router(usdinr.router)
app.include_router(demo.router)
app.include_router(market_sentiment.router)
