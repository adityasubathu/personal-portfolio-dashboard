"""NSE industry classification — the only module that knows NSE's HTTP surface.

NSE publishes a four-level taxonomy: Macro-Economic Sector -> Sector -> Industry
-> Basic Industry. This module fetches it per stock and hands the rest of the app
plain strings, keyed by ISIN.

Two NSE surfaces are used:
  * the equity master CSV, as an in-memory ISIN -> symbol index
  * the per-symbol quote API, for the classification itself

The quote API is addressed by symbol because that is the only key it accepts, but
the ISIN in every response is verified against the one we looked the symbol up by,
so ISIN stays the identity end to end.

Both are website endpoints rather than contracted APIs. Keep every URL, header and
response-shape assumption in this file so a future NSE change is one module to fix.
"""
import asyncio
import csv
import io

import httpx

EQUITY_MASTER_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
QUOTE_API_URL = "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"

# NSE serves the quote API to anything with a browser User-Agent — no cookies, no
# session warm-up, no Referer. With no User-Agent the request hangs until timeout.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

ALLOWED_SERIES = {"EQ", "BE", "BZ"}
NSE_REQUEST_DELAY_SECONDS = 0.4
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (0, 2, 5)

CLASSIFICATION_LEVELS = ("macro_sector", "sector", "industry", "basic_industry")

STATUS_CLASSIFIED = "CLASSIFIED"
STATUS_UNCLASSIFIED = "UNCLASSIFIED"
STATUS_API_ERROR = "API_ERROR"
STATUS_ISIN_MISMATCH = "ISIN_MISMATCH"


def _read_csv(payload: bytes) -> list[dict]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = payload.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    reader.fieldnames = [f.strip() for f in reader.fieldnames]
    return [{k: (v or "").strip() for k, v in row.items() if k} for row in reader]


def parse_equity_master(payload: bytes) -> dict[str, dict]:
    """Returns {isin: {symbol, company_name, series}} for tradable equities.

    NSE's header row carries leading spaces (" SERIES", " ISIN NUMBER"), hence the
    fieldname strip in _read_csv. The ISIN prefix check also drops NSE's DUM*
    placeholder rows, which stand in for securities under corporate action.
    """
    index: dict[str, dict] = {}
    for row in _read_csv(payload):
        series = row.get("SERIES", "")
        isin = row.get("ISIN NUMBER", "")
        symbol = row.get("SYMBOL", "")
        if series not in ALLOWED_SERIES or not symbol or not isin.startswith("IN"):
            continue
        index.setdefault(
            isin,
            {"symbol": symbol, "company_name": row.get("NAME OF COMPANY", ""), "series": series},
        )
    return index


def extract_classification(payload: dict) -> dict:
    """Pulls the four levels plus identity out of a getSymbolData response.

    NSE nests these under equityResponse[0]. Note secInfo.industryInfo is a plain
    string holding the Industry level, not an object.
    """
    entry = (payload.get("equityResponse") or [{}])[0] or {}
    sec = entry.get("secInfo") or {}
    meta = entry.get("metaData") or {}
    return {
        "macro_sector": (sec.get("macro") or "").strip() or None,
        "sector": (sec.get("sector") or "").strip() or None,
        "industry": (sec.get("industryInfo") or "").strip() or None,
        "basic_industry": (sec.get("basicIndustry") or "").strip() or None,
        "isin": (meta.get("isinCode") or "").strip() or None,
        "company_name": (meta.get("companyName") or "").strip() or None,
    }


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=30,
        follow_redirects=True,
        headers={"User-Agent": BROWSER_UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"},
    )


async def fetch_equity_master(client: httpx.AsyncClient) -> dict[str, dict]:
    response = await client.get(EQUITY_MASTER_URL)
    response.raise_for_status()
    return parse_equity_master(response.content)


async def fetch_classification(client: httpx.AsyncClient, symbol: str) -> tuple[dict | None, str | None]:
    """Returns (classification, error). Exactly one is non-None.

    A 404 means NSE does not know the symbol — final, not retried. Everything else
    gets bounded retries with backoff; NSE throttling shows up as 401/403/429.
    """
    last_error = "unknown error"
    for attempt in range(MAX_ATTEMPTS):
        if BACKOFF_SECONDS[attempt]:
            await asyncio.sleep(BACKOFF_SECONDS[attempt])
        try:
            response = await client.get(
                QUOTE_API_URL,
                params={
                    "functionName": "getSymbolData",
                    "marketType": "N",
                    "series": "EQ",
                    "symbol": symbol,
                },
            )
        except httpx.HTTPError as exc:
            last_error = repr(exc)
            continue
        if response.status_code == 404:
            return None, "symbol not found on NSE"
        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}"
            continue
        try:
            return extract_classification(response.json()), None
        except ValueError as exc:
            last_error = f"malformed response: {exc}"
    return None, last_error


from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, MfSchemeBreakdown, NseIndustryClassification
from app.time_util import now_ist

# Categories whose rows are a real Indian listed company. Equity - Foreign is
# excluded because NSE has no classification for US stocks; Real Estate Trust is
# excluded because the ingest already gives it a synthetic value at every level.
_CLASSIFIABLE_CATEGORIES = {
    "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Arbitrage",
}

# Rows in these states are worth another attempt next run; CLASSIFIED never is,
# because a company's industry does not change.
_RETRY_STATUSES = {STATUS_UNCLASSIFIED, STATUS_API_ERROR, STATUS_ISIN_MISMATCH}


def decide_status(isin: str, result: dict | None, error: str | None) -> tuple[str, str | None]:
    """Decides a classification row's status from one fetch_classification result.

    A response's ISIN is verified against the one we looked the symbol up by,
    which is what keeps ISIN authoritative even though the request is addressed
    by symbol — this is the guard, so it is kept separate from the DB loop so it
    can be tested without a session. NSE occasionally omits metaData.isinCode
    entirely; that is not treated as a mismatch, just classified on level data.
    """
    if error:
        return STATUS_API_ERROR, error
    if result["isin"] and result["isin"] != isin:
        return STATUS_ISIN_MISMATCH, f"expected {isin}, NSE returned {result['isin']}"
    if any(result[level] for level in CLASSIFICATION_LEVELS):
        return STATUS_CLASSIFIED, None
    return STATUS_UNCLASSIFIED, "NSE returned no industry data"


async def _held_isins(db: AsyncSession) -> dict[str, str]:
    """Returns {isin: display_name} for every Indian equity we hold, directly or
    inside a fund. ISIN is the only identifier used — a holding without one cannot
    be classified."""
    held: dict[str, str] = {}

    rows = await db.execute(
        select(MfSchemeBreakdown.isin, MfSchemeBreakdown.name)
        .where(
            MfSchemeBreakdown.category.in_(_CLASSIFIABLE_CATEGORIES),
            MfSchemeBreakdown.isin.is_not(None),
        )
        .distinct()
    )
    for isin, name in rows.all():
        if isin.startswith("IN"):
            held.setdefault(isin, name)

    rows = await db.execute(
        select(Instrument.isin, Instrument.name, Instrument.tradingsymbol)
        .join(Holding, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type == "STOCK", Instrument.isin.is_not(None))
        .distinct()
    )
    for isin, name, tradingsymbol in rows.all():
        if isin.startswith("IN"):
            held.setdefault(isin, name or tradingsymbol or isin)

    return held


async def refresh_held_classifications(db: AsyncSession, on_progress=None) -> dict:
    """Classify every held ISIN NSE hasn't told us about yet, then backfill.

    Classification never changes for a company, so a CLASSIFIED row is never
    re-fetched and no row is ever deleted. Only unclassified, errored and
    ISIN-mismatched rows come back round on the next run.
    """
    held = await _held_isins(db)
    if not held:
        return {"held_isins": 0, "resolved": 0, "queried": 0, "classified": 0,
                "unclassified": 0, "errors": 0, "mismatched": 0, "skipped_cached": 0,
                "amfi_enriched": 0, "breakdown_backfilled": 0, "unresolved_isins": []}

    existing = {
        row.isin: row
        for row in (await db.execute(select(NseIndustryClassification))).scalars().all()
    }

    classified = unclassified = errors = mismatched = 0
    unresolved: list[dict] = []

    async with new_client() as client:
        try:
            master = await fetch_equity_master(client)
        except httpx.HTTPError as exc:
            if on_progress:
                await on_progress(f"NSE equity master unavailable ({exc}) — skipping classification")
            return {"held_isins": len(held), "resolved": 0, "queried": 0, "classified": 0,
                    "unclassified": 0, "errors": 0, "mismatched": 0, "skipped_cached": 0,
                    "amfi_enriched": 0, "breakdown_backfilled": 0,
                    "unresolved_isins": [], "error": str(exc)}

        if on_progress:
            await on_progress(f"NSE equity master: {len(master)} securities")

        pending: list[tuple[str, str]] = []          # (isin, symbol)
        skipped = 0
        for isin in sorted(held):
            entry = master.get(isin)
            if not entry:
                unresolved.append({"isin": isin, "name": held[isin]})
                continue
            row = existing.get(isin)
            if row is not None and row.status not in _RETRY_STATUSES:
                skipped += 1
                continue
            pending.append((isin, entry["symbol"]))

        if on_progress:
            await on_progress(
                f"Held ISINs: {len(held)} total, {len(unresolved)} not on NSE, "
                f"{skipped} already classified, {len(pending)} to fetch"
            )

        for done, (isin, symbol) in enumerate(pending, start=1):
            result, error = await fetch_classification(client, symbol)
            row = existing.get(isin)
            if row is None:
                row = NseIndustryClassification(isin=isin, first_seen_at=now_ist())
                db.add(row)
                existing[isin] = row
            row.symbol = symbol
            row.series = (master.get(isin) or {}).get("series")

            status, error_message = decide_status(isin, result, error)
            row.status, row.error_message = status, error_message
            if status == STATUS_API_ERROR:
                errors += 1
            elif status == STATUS_ISIN_MISMATCH:
                mismatched += 1
            elif status == STATUS_CLASSIFIED:
                for level in CLASSIFICATION_LEVELS:
                    setattr(row, level, result[level])
                row.company_name = result["company_name"] or (master.get(isin) or {}).get("company_name")
                classified += 1
            else:
                unclassified += 1
            row.updated_at = now_ist()

            if done % 25 == 0:
                await db.flush()
                if on_progress:
                    await on_progress(f"Classified {done}/{len(pending)} ISINs…")
            await asyncio.sleep(NSE_REQUEST_DELAY_SECONDS)

    await db.flush()
    enriched, backfilled = await apply_classifications(db)
    await db.commit()
    if on_progress:
        await on_progress(
            f"NSE classification: {classified} new, {unclassified} unclassified, "
            f"{errors} errors, {mismatched} ISIN mismatches; enriched {enriched} AMFI rows "
            f"and {backfilled} holding rows"
        )

    return {
        "held_isins": len(held),
        "resolved": len(held) - len(unresolved),
        "queried": len(pending),
        "classified": classified,
        "unclassified": unclassified,
        "errors": errors,
        "mismatched": mismatched,
        "skipped_cached": skipped,
        "amfi_enriched": enriched,
        "breakdown_backfilled": backfilled,
        "unresolved_isins": sorted(unresolved, key=lambda r: r["isin"]),
    }


async def load_classification_lookup(db: AsyncSession) -> dict[str, dict]:
    """Returns {isin: {level: value}} for every classified stock.

    Replaces the old sector_master.csv loader. ISIN is the only key.
    """
    rows = (await db.execute(
        select(NseIndustryClassification)
        .where(NseIndustryClassification.status == STATUS_CLASSIFIED)
    )).scalars().all()
    return {
        row.isin: {level: getattr(row, level) for level in CLASSIFICATION_LEVELS}
        for row in rows
    }


async def load_taxonomy_parents(db: AsyncSession) -> dict[str, dict[str, dict[str, str]]]:
    """Returns {level: {value: {ancestor_level: ancestor_value}}}.

    NSE's taxonomy is a strict tree — every industry sits under exactly one sector,
    every basic industry under exactly one industry — so a value determines all of
    its ancestors. Built from the classified rows rather than hardcoded, so it grows
    as the portfolio does.
    """
    rows = (await db.execute(
        select(
            NseIndustryClassification.macro_sector,
            NseIndustryClassification.sector,
            NseIndustryClassification.industry,
            NseIndustryClassification.basic_industry,
        )
        .where(NseIndustryClassification.status == STATUS_CLASSIFIED)
        .distinct()
    )).all()

    parents: dict[str, dict[str, dict[str, str]]] = {level: {} for level in CLASSIFICATION_LEVELS}
    for row in rows:
        values = dict(zip(CLASSIFICATION_LEVELS, row))
        for depth, level in enumerate(CLASSIFICATION_LEVELS):
            value = values[level]
            if not value:
                continue
            ancestors = {anc: values[anc] for anc in CLASSIFICATION_LEVELS[:depth] if values[anc]}
            if ancestors:
                parents[level].setdefault(value, ancestors)
    return parents


def cascade_levels(
    parents: dict[str, dict[str, dict[str, str]]],
    level: str,
    value: str,
) -> dict[str, str | None]:
    """Expands one manually chosen taxonomy value into a full {level: value} dict.

    Ancestors are filled from NSE's hierarchy; levels below the chosen one stay None,
    because a parent never implies a specific child.
    """
    out: dict[str, str | None] = {lvl: None for lvl in CLASSIFICATION_LEVELS}
    out[level] = value
    for ancestor, ancestor_value in parents.get(level, {}).get(value, {}).items():
        out[ancestor] = ancestor_value
    return out


async def apply_classifications(db: AsyncSession) -> tuple[int, int]:
    """Push learned levels onto amfi_market_cap and mf_scheme_breakdown, by ISIN.

    Runs at the end of a refresh so a cold start needs one ingest, not two. Mirrors
    the write-back save_sector_overrides already does for manual sector fixes.
    """
    lookup = await load_classification_lookup(db)
    if not lookup:
        return 0, 0

    enriched = 0
    for row in (await db.execute(select(AmfiMarketCap))).scalars().all():
        levels = lookup.get(row.isin or "")
        if not levels:
            continue
        for level in CLASSIFICATION_LEVELS:
            # A CLASSIFIED row can still be blank at some levels; writing that blank
            # would erase a manual override. Stale overrides are pruned at ingest.
            if levels[level]:
                setattr(row, level, levels[level])
        enriched += 1

    backfilled = 0
    breakdown = (await db.execute(
        select(MfSchemeBreakdown).where(
            MfSchemeBreakdown.category.in_(_CLASSIFIABLE_CATEGORIES),
            MfSchemeBreakdown.isin.is_not(None),
        )
    )).scalars().all()
    for row in breakdown:
        levels = lookup.get(row.isin or "")
        if not levels:
            continue
        for level in CLASSIFICATION_LEVELS:
            # A CLASSIFIED row can still be blank at some levels; writing that blank
            # would erase a manual override. Stale overrides are pruned at ingest.
            if levels[level]:
                setattr(row, level, levels[level])
        backfilled += 1

    await db.flush()
    return enriched, backfilled
