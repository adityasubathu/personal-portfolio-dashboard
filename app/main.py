from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.database import engine
from app.models import *  # noqa: F401, F403 — ensures all models are registered before create_all


async def _run_migration(conn, stmt: str):
    """Run a single DDL statement inside a savepoint so a failure doesn't
    abort the surrounding Postgres transaction."""
    from sqlalchemy import text
    await conn.execute(text("SAVEPOINT sp"))
    try:
        await conn.execute(text(stmt))
        await conn.execute(text("RELEASE SAVEPOINT sp"))
    except Exception:
        await conn.execute(text("ROLLBACK TO SAVEPOINT sp"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.database import Base
    async with engine.begin() as conn:
        for stmt in (
            "ALTER TABLE IF EXISTS mf_nav_history RENAME TO price_history",
            "ALTER TABLE IF EXISTS price_history RENAME COLUMN nav_date TO price_date",
            "ALTER TABLE IF EXISTS price_history RENAME COLUMN nav TO close",
            "DROP INDEX IF EXISTS ix_mf_nav_history_instr_date",
            "ALTER TABLE IF EXISTS kite_sync_log ADD COLUMN IF NOT EXISTS mf_holdings_count INTEGER",
            "ALTER TABLE IF EXISTS instruments ADD COLUMN IF NOT EXISTS amfi_scheme_code VARCHAR(20)",
            "ALTER TABLE IF EXISTS instruments ADD COLUMN IF NOT EXISTS kite_instrument_token INTEGER",
        ):
            await _run_migration(conn, stmt)

        await conn.run_sync(Base.metadata.create_all)

        for stmt in (
            "CREATE INDEX IF NOT EXISTS ix_instruments_amfi_scheme_code ON instruments(amfi_scheme_code)",
            "CREATE INDEX IF NOT EXISTS ix_price_history_instr_date ON price_history(instrument_id, price_date)",
            "CREATE INDEX IF NOT EXISTS ix_instruments_kite_token ON instruments(kite_instrument_token)",
        ):
            await _run_migration(conn, stmt)

        await _run_migration(
            conn,
            "ALTER TABLE kite_config ADD CONSTRAINT ck_kite_config_singleton CHECK (id = 1)",
        )

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
