from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.amfi_nav import sync_mf_navs
from app.services.mfapi_nav import (
    fetch_nav_by_isin,
    get_nav_tracked_instruments,
    remove_nav_tracked_instrument,
    sync_nav_history,
)
from app.templating import templates
router = APIRouter(prefix="/api/v1/mf", tags=["mf"])


@router.post("/sync-nav", response_class=HTMLResponse)
async def sync_nav(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_mf_navs(db)
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": result, "error": None, "mode": "amfi"},
        )
    except Exception as e:
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": None, "error": str(e), "mode": "amfi"},
        )


@router.post("/fetch-nav-by-isin", response_class=HTMLResponse)
async def fetch_nav_by_isin_route(request: Request, db: AsyncSession = Depends(get_db)):
    form = await request.form()
    isin = (form.get("isin") or "").strip().upper()
    if not isin:
        return HTMLResponse("<p style='color:red'>ISIN is required.</p>")
    try:
        result = await fetch_nav_by_isin(db, isin)
        if result.get("error"):
            return HTMLResponse(f"<p style='color:red'>{result['error']}</p>")
        return HTMLResponse(
            f"<p>Fetched NAV for <strong>{result['symbol']}</strong>"
            f" ({result['isin']}): <strong>{result['rows_added']}</strong> new row(s)."
            f" Latest: <strong>{result['latest_nav_date'] or '—'}</strong>.</p>"
        )
    except Exception as e:
        return HTMLResponse(f"<p style='color:red'>{e}</p>")


def _render_tracked_list(instruments: list[dict]) -> str:
    if not instruments:
        return "<p style='color:var(--pico-muted-color);'><small>No manually tracked funds.</small></p>"
    rows = []
    for i in instruments:
        iid = i["instrument_id"]
        name = i["name"]
        rows.append(
            f"<tr>"
            f"<td>{name}</td>"
            f"<td><small>{i['isin'] or '—'}</small></td>"
            f"<td><small>{i['instrument_type']}</small></td>"
            f"<td><button class='outline secondary' style='padding:0.2rem 0.5rem;font-size:0.75rem;margin:0;'"
            f" hx-delete='/api/v1/mf/nav-tracked/{iid}'"
            f" hx-target='#nav-tracked-section' hx-swap='innerHTML'"
            f" hx-confirm='Remove {name} and delete its NAV history?'>Remove</button></td>"
            f"</tr>"
        )
    return (
        "<table style='font-size:0.85rem;margin-top:0.5rem;'>"
        "<thead><tr><th>Fund</th><th>ISIN</th><th>Type</th><th></th></tr></thead>"
        "<tbody>" + "".join(rows) + "</tbody></table>"
    )


@router.get("/nav-tracked", response_class=HTMLResponse)
async def list_nav_tracked(db: AsyncSession = Depends(get_db)):
    instruments = await get_nav_tracked_instruments(db)
    return HTMLResponse(_render_tracked_list(instruments))


@router.delete("/nav-tracked/{instrument_id}", response_class=HTMLResponse)
async def delete_nav_tracked(instrument_id: int, db: AsyncSession = Depends(get_db)):
    await remove_nav_tracked_instrument(db, instrument_id)
    instruments = await get_nav_tracked_instruments(db)
    return HTMLResponse(_render_tracked_list(instruments))


@router.post("/sync-nav-history", response_class=HTMLResponse)
async def sync_nav_history_route(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_nav_history(db)
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": result, "error": None, "mode": "history"},
        )
    except Exception as e:
        return templates.TemplateResponse(
            "partials/mf_sync_status.html",
            {"request": request, "result": None, "error": str(e), "mode": "history"},
        )
