"""Raw OpenFin disclosure history for held active equity funds.

Keeps every book within RETENTION_MONTHS calendar months of each fund's newest
available disclosure, fetching what's missing and pruning the rest.
"""
from datetime import date

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import MfDisclosureBook
from app.services.mf_ingest import _fetch_catalog, _fetch_fund_holdings
from app.time_util import now_ist

RETENTION_MONTHS = 3
ACTIVE_EQUITY_MARKER = "Equity Scheme"


def is_active_equity(amfi_category: str | None) -> bool:
    return ACTIVE_EQUITY_MARKER in (amfi_category or "")


def months_apart(later: date, earlier: date) -> int:
    return (later.year - earlier.year) * 12 + later.month - earlier.month


def dates_to_keep(available: list[str]) -> list[date]:
    """The catalog's available_as_of dates within RETENTION_MONTHS calendar months
    of the newest one, newest first."""
    dates = sorted({date.fromisoformat(d) for d in available}, reverse=True)
    if not dates:
        return []
    return [d for d in dates if months_apart(dates[0], d) < RETENTION_MONTHS]


async def sync_disclosure_books(db: AsyncSession, on_progress=None) -> dict:
    held = (await db.execute(
        select(Instrument)
        .join(Holding, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")), Instrument.isin.is_not(None))
    )).scalars().all()
    names = {i.isin: i.tradingsymbol or i.name or i.isin for i in held}

    async with httpx.AsyncClient(follow_redirects=True, headers={"User-Agent": "portfolio-mac-arm/1.0"}) as client:
        try:
            catalog = await _fetch_catalog(client)
        except httpx.HTTPError as e:
            return {"error": f"OpenFin catalog fetch failed: {e}"}
        catalog_by_isin = {e["isin"]: e for e in catalog.values() if e.get("isin")}

        targets: dict[str, tuple[dict, list[date]]] = {}
        for i in held:
            entry = catalog.get(i.amfi_scheme_code or "") or catalog_by_isin.get(i.isin)
            if entry and is_active_equity(entry.get("category")):
                targets[i.isin] = (entry, dates_to_keep(entry.get("available_as_of") or []))

        stored = set((await db.execute(
            select(MfDisclosureBook.scheme_isin, MfDisclosureBook.as_of)
        )).all())

        fetched = 0
        errors: list[str] = []
        for isin, (entry, keep) in targets.items():
            for as_of in keep:
                if (isin, as_of) in stored:
                    continue
                response = await _fetch_fund_holdings(client, entry["amfi_code"], as_of.isoformat())
                if response is None:
                    errors.append(f"{names[isin]}: no holdings for {as_of}")
                    continue
                served = date.fromisoformat(response["meta"]["as_of"])
                if served != as_of:
                    errors.append(f"{names[isin]}: asked for {as_of}, server served {served} — not stored")
                    continue
                holdings = response.get("holdings", [])
                await db.execute(pg_insert(MfDisclosureBook).values(
                    scheme_isin=isin,
                    amfi_code=entry["amfi_code"],
                    amfi_category=entry.get("category"),
                    as_of=as_of,
                    meta=response["meta"],
                    holdings=holdings,
                    fetched_at=now_ist(),
                ).on_conflict_do_nothing(constraint="uq_mf_disclosure_book_scheme_as_of"))
                fetched += 1
                if on_progress:
                    await on_progress(f"Disclosure history: {names[isin]} {as_of} ({len(holdings)} holdings)")

    pruned = 0
    for isin, (_, keep) in targets.items():
        if keep:
            result = await db.execute(delete(MfDisclosureBook).where(
                MfDisclosureBook.scheme_isin == isin, MfDisclosureBook.as_of < min(keep),
            ))
            pruned += result.rowcount
    result = await db.execute(delete(MfDisclosureBook).where(MfDisclosureBook.scheme_isin.notin_(list(targets))))
    pruned += result.rowcount
    await db.commit()

    if on_progress:
        await on_progress(
            f"Disclosure history: {len(targets)} active equity fund(s), {fetched} book(s) fetched, {pruned} pruned"
        )
    return {"funds": len(targets), "fetched": fetched, "pruned": pruned, "errors": errors[:30]}
