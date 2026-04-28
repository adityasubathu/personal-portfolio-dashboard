"""
AMFI NAV sync.

Pulls https://www.amfiindia.com/spages/NAVAll.txt and updates MF holdings
by matching on ISIN (either the growth or dividend-reinvestment ISIN column).
Also upserts the current AMFI NAV for ETF instruments into NavHistory so that
the portfolio page's premium calculation uses the freshest NAV across both
AMFI and mfapi.in sources.
"""
from datetime import datetime

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.trade import Trade

AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"


async def fetch_navs() -> dict[str, dict]:
    """Fetch NAVAll.txt and return {isin: {"nav": float, "nav_date": date, "scheme_name": str, "scheme_code": str}}."""
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        resp = await client.get(AMFI_URL)
        resp.raise_for_status()
        text = resp.text

    navs: dict[str, dict] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("Scheme Code"):
            continue
        parts = line.split(";")
        if len(parts) < 6:
            continue  # section header / blank

        scheme_code, isin_growth, isin_reinv, scheme_name, nav_str, date_str = parts[:6]

        try:
            nav = float(nav_str)
        except ValueError:
            continue  # NAV column may be "N.A." for suspended schemes
        try:
            nav_date = datetime.strptime(date_str.strip(), "%d-%b-%Y").date()
        except ValueError:
            continue

        entry = {
            "nav": nav,
            "nav_date": nav_date,
            "scheme_name": scheme_name.strip(),
            "scheme_code": scheme_code.strip(),
        }
        for isin in (isin_growth.strip(), isin_reinv.strip()):
            if isin and isin != "-":
                navs[isin] = entry

    return navs


async def sync_mf_navs(db: AsyncSession) -> dict:
    """Update Holding.last_price / last_price_at / unrealised_pnl for every MF holding whose ISIN matches AMFI.
    Also upserts the current AMFI NAV into NavHistory for ETF instruments."""
    navs = await fetch_navs()

    # --- MF holdings ---
    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type == "MF")
    )
    rows = result.all()

    updated = 0
    missing: list[str] = []
    latest_nav_date = None

    for holding, instrument in rows:
        entry = navs.get(instrument.isin) if instrument.isin else None
        if not entry:
            missing.append(f"{instrument.tradingsymbol} ({instrument.isin or 'no ISIN'})")
            continue

        holding.last_price = entry["nav"]
        holding.last_price_at = datetime.combine(entry["nav_date"], datetime.min.time())
        cost = float(holding.total_cost or 0)
        holding.unrealised_pnl = round(float(holding.quantity) * entry["nav"] - cost, 6)
        updated += 1

        if latest_nav_date is None or entry["nav_date"] > latest_nav_date:
            latest_nav_date = entry["nav_date"]

    # --- ETF NavHistory ---
    # Upsert the current AMFI NAV for every ETF the user has ever traded so that
    # the holdings page premium calc picks the freshest date across AMFI + mfapi.in.
    traded_ids = select(Trade.instrument_id).distinct()
    etf_instruments = (
        await db.execute(
            select(Instrument)
            .where(Instrument.id.in_(traded_ids))
            .where(Instrument.instrument_type == "ETF")
        )
    ).scalars().all()

    etf_nav_rows_upserted = 0
    etf_missing: list[str] = []
    for instrument in etf_instruments:
        entry = navs.get(instrument.isin) if instrument.isin else None
        if not entry:
            etf_missing.append(f"{instrument.tradingsymbol} ({instrument.isin or 'no ISIN'})")
            continue
        stmt = pg_insert(NavHistory).values(
            instrument_id=instrument.id,
            nav_date=entry["nav_date"],
            nav=entry["nav"],
        ).on_conflict_do_update(
            index_elements=["instrument_id", "nav_date"],
            set_={"nav": entry["nav"]},
        )
        await db.execute(stmt)
        etf_nav_rows_upserted += 1

    await db.commit()

    return {
        "updated": updated,
        "missing": missing,
        "latest_nav_date": latest_nav_date.isoformat() if latest_nav_date else None,
        "total_isins_in_feed": len(navs),
        "etf_nav_rows_upserted": etf_nav_rows_upserted,
        "etf_missing": etf_missing,
    }
