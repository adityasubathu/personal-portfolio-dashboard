"""The body of each background job kind. A runner gets its params, a progress
callback and a status setter, opens its own DB session, and returns a
JSON-serialisable result dict."""
from typing import Awaitable, Callable

from app.database import AsyncSessionLocal
from app.services.amfi_nav import sync_mf_navs
from app.services.mfapi_nav import sync_nav_history
from app.services.xirr import recompute_and_store_xirr

OnProgress = Callable[[str], Awaitable[None]]
SetStatus = Callable[[str], Awaitable[None]]
Runner = Callable[[dict, OnProgress, SetStatus], Awaitable[dict]]
Summarizer = Callable[[dict], str]

NAV_SOURCES = ("mfapi", "finapi", "amfi")
NAV_SOURCE_LABELS = {"mfapi": "mfapi.in", "finapi": "FinAPI"}


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
            result = await sync_nav_history(db, source=source)
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


RUNNERS: dict[str, tuple[Runner, Summarizer]] = {
    "mf_nav_history": (run_mf_nav_history, summarize_mf_nav_history),
}

GRACEFUL_CANCEL: dict[str, Callable[[], None]] = {}
