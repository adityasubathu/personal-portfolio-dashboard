"""The body of each background job kind. A runner gets its params, a progress
callback and a status setter, opens its own DB session, and returns a
JSON-serialisable result dict."""
import asyncio
from typing import Awaitable, Callable

from app.database import AsyncSessionLocal
from app.services import kite_sync
from app.services.amfi_nav import sync_mf_navs
from app.services.kite_historical import cancel_sync, reset_cancel, sync_index_history, sync_price_history
from app.services.mf_ingest import ingest_from_openfin, sync_amfi_market_cap
from app.services.mfapi_nav import sync_nav_history
from app.services.nse_industry import refresh_held_classifications
from app.services.xirr import recompute_and_store_xirr

OnProgress = Callable[[str], Awaitable[None]]
SetStatus = Callable[[str], Awaitable[None]]
Runner = Callable[[dict, OnProgress, SetStatus], Awaitable[dict]]
Summarizer = Callable[[dict], str]

NAV_SOURCES = ("mfapi", "finapi", "amfi")
NAV_SOURCE_LABELS = {"mfapi": "mfapi.in", "finapi": "FinAPI"}
KITE_LOGIN_TIMEOUT_S = 600
KITE_LOGIN_POLL_S = 2


async def run_mf_nav_history(params: dict, on_progress: OnProgress, set_status: SetStatus) -> dict:
    source = params.get("source", "mfapi")
    if source not in NAV_SOURCES:
        raise ValueError(f"Unknown NAV source: {source}")
    async with AsyncSessionLocal() as db:
        if source == "amfi":
            await on_progress("Fetching latest NAVs from the AMFI daily feed…")
            result = await sync_mf_navs(db)
        else:
            await on_progress(f"Syncing NAV history from {NAV_SOURCE_LABELS[source]}…")
            result = await sync_nav_history(db, source=source, on_progress=on_progress)
        await on_progress("Recomputing XIRR…")
        await recompute_and_store_xirr(db)
    return {"source": source, **result}


def summarize_mf_nav_history(result: dict) -> str:
    latest = result.get("latest_nav_date") or "—"
    if result["source"] == "amfi":
        missing = len(result.get("missing") or [])
        text = f"AMFI: {result.get('updated', 0)} updated · latest {latest}"
        return text + (f" · {missing} missing" if missing else "")
    failed = len(result.get("failed") or [])
    text = f"{result.get('funds_synced', 0)} funds · {result.get('rows_added', 0)} rows · latest {latest}"
    return text + (f" · {failed} failed" if failed else "")


async def _kite_token_ready() -> bool:
    async with AsyncSessionLocal() as db:
        config = await kite_sync.get_config(db)
    return kite_sync.is_token_valid(config)


async def _wait_for_kite_login(on_progress: OnProgress, set_status: SetStatus) -> None:
    if await _kite_token_ready():
        return
    await set_status("waiting_login")
    await on_progress(f"Kite token expired — waiting up to {KITE_LOGIN_TIMEOUT_S // 60} min for login…")
    loop = asyncio.get_running_loop()
    deadline = loop.time() + KITE_LOGIN_TIMEOUT_S
    while loop.time() < deadline:
        await asyncio.sleep(KITE_LOGIN_POLL_S)
        if await _kite_token_ready():
            await set_status("running")
            await on_progress("Kite login detected — starting sync.")
            return
    raise ValueError(f"Kite login not completed within {KITE_LOGIN_TIMEOUT_S // 60} minutes.")


async def run_kite_price_history(params: dict, on_progress: OnProgress, set_status: SetStatus) -> dict:
    await _wait_for_kite_login(on_progress, set_status)
    async with AsyncSessionLocal() as db:
        result = await sync_price_history(db, on_progress=on_progress)
        await on_progress("Syncing index price history…")
        index_result = None
        try:
            index_result = await sync_index_history(db, on_progress=on_progress)
            await on_progress(f"Indices: {index_result['instruments_synced']} synced, {index_result['rows_added']} rows")
        except Exception as idx_err:
            await on_progress(f"Index sync skipped: {idx_err}")
        ltp_result = await kite_sync.refresh_ltp_and_xirr(db, on_progress)
    return {"result": result, "index": index_result, "ltp": ltp_result}


def summarize_kite_price_history(result: dict) -> str:
    r = result["result"]
    failed = len(r.get("failed") or [])
    text = f"{r.get('instruments_synced', 0)} instruments · {r.get('rows_added', 0)} rows · latest {r.get('latest_price_date') or '—'}"
    return text + (f" · {failed} failed" if failed else "")


async def run_kite_index_history(params: dict, on_progress: OnProgress, set_status: SetStatus) -> dict:
    await _wait_for_kite_login(on_progress, set_status)
    reset_cancel()
    async with AsyncSessionLocal() as db:
        return await sync_index_history(db, on_progress=on_progress)


def summarize_kite_index_history(result: dict) -> str:
    if not result.get("rows_added"):
        return "No new candles — data is already current"
    return f"{result.get('instruments_synced', 0)} indices · {result['rows_added']} rows"


async def run_mf_disclosures(params: dict, on_progress: OnProgress, set_status: SetStatus) -> dict:
    async with AsyncSessionLocal() as db:
        amfi = await sync_amfi_market_cap(db, on_progress=on_progress)
        if "error" not in amfi:
            ingest = await ingest_from_openfin(db, on_progress=on_progress)
            nse = await refresh_held_classifications(db, on_progress=on_progress)
        else:
            ingest = {"error": "Skipped — AMFI classification not loaded"}
            nse = {"error": "Skipped — AMFI classification not loaded"}
    return {"amfi": amfi, "ingest": ingest, "nse": nse}


def summarize_mf_disclosures(result: dict) -> str:
    amfi, ingest = result["amfi"], result["ingest"]
    if amfi.get("error"):
        return f"AMFI: {amfi['error']}"
    if ingest.get("error"):
        return f"Ingest: {ingest['error']}"
    errors = len(ingest.get("errors") or [])
    if ingest.get("already_current"):
        text = "All schemes up to date"
    else:
        text = f"{ingest.get('schemes_processed', 0)} scheme(s) updated · {ingest.get('rows_upserted', 0)} rows"
    untagged = len({u["name"] for u in ingest.get("unmatched_equities") or []})
    if untagged:
        text += f" · {untagged} untagged"
    return text + (f" · {errors} error(s)" if errors else "")


RUNNERS: dict[str, tuple[Runner, Summarizer]] = {
    "mf_nav_history": (run_mf_nav_history, summarize_mf_nav_history),
    "kite_price_history": (run_kite_price_history, summarize_kite_price_history),
    "kite_index_history": (run_kite_index_history, summarize_kite_index_history),
    "mf_disclosures": (run_mf_disclosures, summarize_mf_disclosures),
}

GRACEFUL_CANCEL: dict[str, Callable[[], None]] = {"kite_price_history": cancel_sync, "kite_index_history": cancel_sync}
