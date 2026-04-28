from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

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
    yield


from app.config import settings  # noqa: E402

app = FastAPI(title="Portfolio Manager", lifespan=lifespan)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Routers
from app.routers import pages, trades, portfolio, kite, mf, mf_breakdown, manual_assets, settings  # noqa: E402
app.include_router(pages.router)
app.include_router(trades.router)
app.include_router(portfolio.router)
app.include_router(kite.router)
app.include_router(mf.router)
app.include_router(mf_breakdown.router)
app.include_router(manual_assets.router)
app.include_router(settings.router)
