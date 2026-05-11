"""
mfapi.in NAV history sync.

For every MF/ETF instrument in Holdings, pull historical NAVs from api.mfapi.in
(incremental after the first full backfill) and — for MFs — refresh the
Holding's last_price from the most recent row. ETFs keep their Kite-sourced LTP
as last_price; the stored NAV history is used separately to display the
market-vs-NAV premium.

Scheme-code resolution bootstraps off AMFI NAVAll.txt (ISIN → scheme_code), so
the user never has to enter codes manually. Funds not present in AMFI's feed
are reported back as unresolved.
"""
import asyncio
from datetime import date, datetime

import httpx
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.nav_tracked_instrument import NavTrackedInstrument
from app.models.trade import Trade
from app.services.amfi_nav import fetch_navs

MFAPI_BASE = "https://api.mfapi.in/mf"


async def resolve_scheme_codes(db: AsyncSession) -> dict:
    """Populate Instrument.amfi_scheme_code for every MF/ETF instrument the user
    has ever traded or manually tracked whose ISIN matches AMFI.
    Returns {resolved, already_had, unresolved: [names]}."""
    traded_ids = select(Trade.instrument_id).distinct()
    tracked_ids = select(NavTrackedInstrument.instrument_id)
    result = await db.execute(
        select(Instrument)
        .where(or_(Instrument.id.in_(traded_ids), Instrument.id.in_(tracked_ids)))
        .where(Instrument.instrument_type.in_(["MF", "ETF"]))
    )
    mfs = list(result.scalars().all())
    if not mfs:
        return {"resolved": 0, "already_had": 0, "unresolved": []}

    needed = [i for i in mfs if not i.amfi_scheme_code]
    already_had = len(mfs) - len(needed)
    if not needed:
        return {"resolved": 0, "already_had": already_had, "unresolved": []}

    navs_by_isin = await fetch_navs()

    resolved = 0
    unresolved: list[str] = []
    for instr in needed:
        entry = navs_by_isin.get(instr.isin) if instr.isin else None
        if entry and entry.get("scheme_code"):
            instr.amfi_scheme_code = entry["scheme_code"]
            resolved += 1
        else:
            unresolved.append(f"{instr.tradingsymbol or '?'} ({instr.isin or 'no ISIN'})")

    await db.commit()
    return {"resolved": resolved, "already_had": already_had, "unresolved": unresolved}


async def fetch_history(client: httpx.AsyncClient, scheme_code: str, start_date: date | None = None) -> list[dict]:
    """Return list of {nav_date: date, nav: float} from mfapi.in, filtered server-side by startDate when given."""
    params = {}
    if start_date:
        params["startDate"] = start_date.isoformat()
    r = await client.get(f"{MFAPI_BASE}/{scheme_code}", params=params, timeout=30.0)
    r.raise_for_status()
    payload = r.json()
    if payload.get("status") != "SUCCESS":
        return []
    rows = []
    for item in payload.get("data") or []:
        try:
            d = datetime.strptime(item["date"], "%d-%m-%Y").date()
            nav = float(item["nav"])
        except (KeyError, ValueError):
            continue
        rows.append({"nav_date": d, "nav": nav})
    return rows


async def _sync_one(
    db: AsyncSession,
    client: httpx.AsyncClient,
    instrument: Instrument,
    holding: Holding | None,
) -> dict:
    """Sync history for a single MF/ETF instrument. `holding` may be None for
    sold-out positions — we still want the NAV history, just skip the
    holding-level price refresh. Returns {rows_added, latest_nav_date, error?}."""
    latest_existing: date | None = (
        await db.execute(
            select(func.max(NavHistory.nav_date)).where(NavHistory.instrument_id == instrument.id)
        )
    ).scalar_one_or_none()

    start = None
    if latest_existing:
        # mfapi.in startDate is inclusive; we already have latest_existing, so ask from the next day.
        from datetime import timedelta
        start = latest_existing + timedelta(days=1)

    try:
        rows = await fetch_history(client, instrument.amfi_scheme_code, start_date=start)
    except httpx.HTTPError as e:
        return {"rows_added": 0, "latest_nav_date": None, "error": f"mfapi: {e}"}

    if not rows:
        latest_row = (
            await db.execute(
                select(NavHistory)
                .where(NavHistory.instrument_id == instrument.id)
                .order_by(NavHistory.nav_date.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if latest_row:
            _apply_to_holding(instrument, holding, latest_row.nav_date, float(latest_row.nav))
            return {"rows_added": 0, "latest_nav_date": latest_row.nav_date.isoformat()}
        return {"rows_added": 0, "latest_nav_date": None}

    stmt = pg_insert(NavHistory).values(
        [{"instrument_id": instrument.id, "nav_date": r["nav_date"], "nav": r["nav"]} for r in rows]
    ).on_conflict_do_nothing(index_elements=["instrument_id", "nav_date"])
    result = await db.execute(stmt)
    rows_added = result.rowcount or 0

    rows_by_date = sorted(rows, key=lambda r: r["nav_date"], reverse=True)
    newest = rows_by_date[0]
    _apply_to_holding(instrument, holding, newest["nav_date"], newest["nav"])

    return {"rows_added": rows_added, "latest_nav_date": newest["nav_date"].isoformat()}


def _apply_to_holding(instrument: Instrument, holding: Holding | None, nav_date: date, nav: float) -> None:
    if holding is None:
        return  # Sold-out — no holding row to refresh; history already stored.
    # For ETFs the authoritative price is the exchange LTP (set by Kite sync); NAV is stored
    # in price_history only so we can show the market-vs-NAV premium. Don't overwrite here.
    if instrument.instrument_type == "ETF":
        return
    holding.last_price = nav
    holding.last_price_at = datetime.combine(nav_date, datetime.min.time())
    cost = float(holding.total_cost or 0)
    holding.unrealised_pnl = round(float(holding.quantity) * nav - cost, 6)


async def fetch_nav_by_isin(db: AsyncSession, isin: str) -> dict:
    """Fetch NAV history for a single MF/ETF by ISIN.
    Creates the instrument from AMFI data if it doesn't exist yet."""
    isin = isin.strip().upper()
    instrument = (await db.execute(
        select(Instrument).where(Instrument.isin == isin)
    )).scalar_one_or_none()

    if not instrument:
        navs_by_isin = await fetch_navs()
        entry = navs_by_isin.get(isin)
        if not entry:
            return {"error": f"ISIN {isin} not found in AMFI feed. Verify the ISIN and try again."}
        instrument = Instrument(
            isin=isin,
            tradingsymbol=isin,
            instrument_type="MF",
            name=entry["scheme_name"],
            amfi_scheme_code=entry["scheme_code"],
        )
        db.add(instrument)
        await db.flush()
        db.add(NavTrackedInstrument(instrument_id=instrument.id))
        await db.commit()
    else:
        if instrument.instrument_type not in ("MF", "ETF"):
            return {"error": f"{instrument.tradingsymbol} is type {instrument.instrument_type}, not MF/ETF."}
        has_trades = (await db.execute(
            select(Trade.id).where(Trade.instrument_id == instrument.id).limit(1)
        )).scalar_one_or_none()
        if not has_trades:
            existing = (await db.execute(
                select(NavTrackedInstrument).where(NavTrackedInstrument.instrument_id == instrument.id)
            )).scalar_one_or_none()
            if not existing:
                db.add(NavTrackedInstrument(instrument_id=instrument.id))
                await db.commit()

    if not instrument.amfi_scheme_code:
        navs_by_isin = await fetch_navs()
        entry = navs_by_isin.get(isin)
        if entry and entry.get("scheme_code"):
            instrument.amfi_scheme_code = entry["scheme_code"]
            await db.commit()
        else:
            return {"error": f"Could not resolve AMFI scheme code for ISIN {isin}."}

    holding = (await db.execute(
        select(Holding).where(Holding.instrument_id == instrument.id)
    )).scalar_one_or_none()

    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": "portfolio-mac-arm/1.0"}) as client:
        outcome = await _sync_one(db, client, instrument, holding)

    await db.commit()

    if outcome.get("error"):
        return {"error": outcome["error"]}

    return {
        "symbol": instrument.name or instrument.tradingsymbol or instrument.amfi_scheme_code,
        "isin": isin,
        "rows_added": outcome["rows_added"],
        "latest_nav_date": outcome["latest_nav_date"],
    }


async def sync_nav_history(db: AsyncSession) -> dict:
    """Main entry point. Covers every MF/ETF the user has ever traded, not just
    current holdings — so the NAV-history chart can value positions that have
    since been sold. Returns a summary for rendering in the UI."""
    resolved = await resolve_scheme_codes(db)

    traded_ids = select(Trade.instrument_id).distinct()
    tracked_ids = select(NavTrackedInstrument.instrument_id)
    instr_rows = (
        await db.execute(
            select(Instrument)
            .where(or_(Instrument.id.in_(traded_ids), Instrument.id.in_(tracked_ids)))
            .where(Instrument.instrument_type.in_(["MF", "ETF"]))
        )
    ).scalars().all()

    # Pair each instrument with its current Holding (if any).
    holdings_by_instr = {
        h.instrument_id: h
        for h in (await db.execute(select(Holding))).scalars().all()
    }
    rows = [(holdings_by_instr.get(i.id), i) for i in instr_rows]

    per_fund: list[dict] = []
    failed: list[str] = []
    total_rows_added = 0
    latest_nav_date: date | None = None

    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": "portfolio-mac-arm/1.0"}) as client:
        # mfapi.in is rate-limited; cap concurrency modestly.
        sem = asyncio.Semaphore(4)

        async def _run(h: Holding | None, i: Instrument) -> None:
            nonlocal total_rows_added, latest_nav_date
            if not i.amfi_scheme_code:
                failed.append(f"{i.tradingsymbol or '?'}: no AMFI scheme_code (ISIN not in AMFI feed)")
                return
            async with sem:
                outcome = await _sync_one(db, client, i, h)
            if outcome.get("error"):
                failed.append(f"{i.tradingsymbol or i.amfi_scheme_code}: {outcome['error']}")
                return
            total_rows_added += outcome["rows_added"]
            per_fund.append({
                "symbol": i.tradingsymbol or i.amfi_scheme_code,
                "rows_added": outcome["rows_added"],
                "latest_nav_date": outcome["latest_nav_date"],
                "held": h is not None,
            })
            if outcome["latest_nav_date"]:
                d = date.fromisoformat(outcome["latest_nav_date"])
                if latest_nav_date is None or d > latest_nav_date:
                    latest_nav_date = d

        await asyncio.gather(*[_run(h, i) for h, i in rows])

    await db.commit()

    return {
        "funds_synced": len(per_fund),
        "rows_added": total_rows_added,
        "latest_nav_date": latest_nav_date.isoformat() if latest_nav_date else None,
        "resolved_scheme_codes": resolved["resolved"],
        "unresolved": resolved["unresolved"],
        "failed": failed,
        "per_fund": per_fund,
    }


async def get_nav_tracked_instruments(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(NavTrackedInstrument, Instrument)
        .join(Instrument, NavTrackedInstrument.instrument_id == Instrument.id)
        .order_by(Instrument.name)
    )).all()
    return [
        {
            "instrument_id": i.id,
            "isin": i.isin,
            "name": i.name or i.tradingsymbol or i.isin,
            "instrument_type": i.instrument_type,
        }
        for _, i in rows
    ]


async def remove_nav_tracked_instrument(db: AsyncSession, instrument_id: int) -> None:
    has_trades = (await db.execute(
        select(Trade.id).where(Trade.instrument_id == instrument_id).limit(1)
    )).scalar_one_or_none()

    await db.execute(
        delete(NavTrackedInstrument).where(NavTrackedInstrument.instrument_id == instrument_id)
    )
    if not has_trades:
        await db.execute(delete(NavHistory).where(NavHistory.instrument_id == instrument_id))
        await db.execute(delete(Instrument).where(Instrument.id == instrument_id))

    await db.commit()
