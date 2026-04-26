from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.kite import KiteSyncLog
from app.models.price_history import PriceHistory
from app.services.kite_historical import fetch_ohlc_for_ticker, sync_price_history
from app.services.manual_ohlc import _parse_date as parse_flexible_date, ingest_csv as ingest_ohlc_csv
from app.services.nav_history import compute_nav_series
from app.services.xirr import compute_holdings_xirr, portfolio_xirr
from app.templating import templates

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])

SORT_FIELDS = {"symbol", "type", "qty", "avg_price", "cost", "ltp", "as_of", "value", "pnl", "pnl_pct", "xirr"}

SECTION_ORDER = [
    ("Equity", {"STOCK", "ETF"}),
    ("Bonds", {"BOND"}),
    ("Mutual Funds", {"MF"}),
]


def _sort_key(row: dict, field: str):
    """Return (is_none, value) — None rows always sort to the end."""
    v = row.get(field)
    if v is None:
        return (1, 0)
    if isinstance(v, str):
        return (0, v.lower())
    return (0, v)


@router.get("/direct", response_class=HTMLResponse)
async def direct_holdings(
    request: Request,
    sort: str = Query("symbol"),
    dir: Literal["asc", "desc"] = Query("asc"),
    sections: Literal["on", "off"] = Query("on"),
    db: AsyncSession = Depends(get_db),
):
    if sort not in SORT_FIELDS:
        sort = "symbol"

    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    raw = result.all()

    today = date.today()
    xirrs = await compute_holdings_xirr(db, as_of=today)

    # Latest NAV per ETF (we stored ETF NAV history separately so we can show
    # the market-price-vs-NAV premium alongside Kite's LTP).
    etf_ids = [instr.id for _, instr in raw if instr.instrument_type == "ETF"]
    etf_nav: dict[int, tuple[float, date]] = {}
    if etf_ids:
        sub = (
            select(
                PriceHistory.instrument_id,
                func.max(PriceHistory.price_date).label("max_date"),
            )
            .where(PriceHistory.instrument_id.in_(etf_ids))
            .group_by(PriceHistory.instrument_id)
            .subquery()
        )
        latest_q = select(PriceHistory).join(
            sub,
            (PriceHistory.instrument_id == sub.c.instrument_id)
            & (PriceHistory.price_date == sub.c.max_date),
        )
        for row in (await db.execute(latest_q)).scalars().all():
            etf_nav[row.instrument_id] = (float(row.close), row.price_date)

    # Materialise each row into a flat dict of sortable/derived values + refs to h and instr
    enriched: list[dict] = []
    for h, instr in raw:
        cost = float(h.total_cost or 0)
        ltp = float(h.last_price) if h.last_price else None
        value = float(h.quantity) * ltp if ltp else cost
        pnl = value - cost
        pnl_pct = (pnl / cost * 100) if cost > 0 else None
        xirr_pct = xirrs[instr.id] * 100 if instr.id in xirrs else None
        nav = None
        nav_as_of = None
        nav_premium = None
        if instr.instrument_type == "ETF" and instr.id in etf_nav:
            nav, nav_as_of = etf_nav[instr.id]
            if ltp is not None and nav > 0:
                nav_premium = (ltp - nav) / nav * 100
        enriched.append({
            "holding": h,
            "instrument": instr,
            "symbol": instr.tradingsymbol or "",
            "type": instr.instrument_type or "",
            "qty": float(h.quantity),
            "avg_price": float(h.average_price) if h.average_price else None,
            "cost": cost,
            "ltp": ltp,
            "as_of": h.last_price_at,
            "value": value,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "xirr": xirr_pct,
            "nav": nav,
            "nav_as_of": nav_as_of,
            "nav_premium": nav_premium,
        })

    total_cost = sum(r["cost"] for r in enriched)
    total_value = sum(r["value"] for r in enriched)

    # Heatmap ranges — global across visible rows, regardless of sections toggle
    def _range(vs):
        vs = [v for v in vs if v is not None]
        neg = [v for v in vs if v < 0]
        pos = [v for v in vs if v > 0]
        return (min(neg) if neg else None, max(pos) if pos else None)

    pnl_min, pnl_max = _range([r["pnl"] for r in enriched])
    pnl_pct_min, pnl_pct_max = _range([r["pnl_pct"] for r in enriched])
    xirr_min, xirr_max = _range([r["xirr"] for r in enriched])

    # Sort with stable tiebreak on symbol
    reverse = dir == "desc"
    enriched.sort(key=lambda r: r["symbol"].lower())
    enriched.sort(key=lambda r: _sort_key(r, sort), reverse=reverse)

    sections_enabled = sections == "on"
    if sections_enabled:
        groups = []
        for label, types in SECTION_ORDER:
            group_rows = [r for r in enriched if r["type"] in types]
            if group_rows:
                groups.append({"label": label, "rows": group_rows})
    else:
        groups = [{"label": None, "rows": enriched}]

    return templates.TemplateResponse(
        "partials/holdings_table.html",
        {
            "request": request,
            "groups": groups,
            "sections_enabled": sections_enabled,
            "current_sort": sort,
            "current_dir": dir,
            "total_cost": total_cost,
            "total_value": total_value,
            "pnl_min": pnl_min, "pnl_max": pnl_max,
            "pnl_pct_min": pnl_pct_min, "pnl_pct_max": pnl_pct_max,
            "xirr_min": xirr_min, "xirr_max": xirr_max,
        },
    )


@router.get("/summary")
async def portfolio_summary(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
    )
    rows = result.all()

    total_cost = sum(float(h.total_cost or 0) for h, _ in rows)
    total_value = sum(
        float(h.quantity) * float(h.last_price) if h.last_price else float(h.total_cost or 0)
        for h, _ in rows
    )

    return {
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
        "total_pnl": round(total_value - total_cost, 2),
        "holdings_count": len(rows),
    }


@router.get("/summary-cards", response_class=HTMLResponse)
async def summary_cards(request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    rows = result.all()

    total_cost = sum(float(h.total_cost or 0) for h, _ in rows)
    total_value = sum(
        float(h.quantity) * float(h.last_price) if h.last_price else float(h.total_cost or 0)
        for h, _ in rows
    )

    last_sync_row = (
        await db.execute(
            select(KiteSyncLog).order_by(KiteSyncLog.synced_at.desc()).limit(1)
        )
    ).scalar_one_or_none()

    xirr_value = await portfolio_xirr(db, as_of=date.today())

    return templates.TemplateResponse(
        "partials/summary_cards.html",
        {
            "request": request,
            "total_cost": total_cost,
            "total_value": total_value,
            "total_pnl": total_value - total_cost,
            "last_sync": last_sync_row.synced_at if last_sync_row else None,
            "xirr": xirr_value,
        },
    )


@router.post("/sync-price-history", response_class=HTMLResponse)
async def sync_price_history_route(request: Request, db: AsyncSession = Depends(get_db)):
    try:
        result = await sync_price_history(db)
        return templates.TemplateResponse(
            "partials/price_history_sync_status.html",
            {"request": request, "result": result, "error": None},
        )
    except Exception as e:
        return templates.TemplateResponse(
            "partials/price_history_sync_status.html",
            {"request": request, "result": None, "error": str(e)},
        )


@router.get("/nav-history")
async def nav_history_json(db: AsyncSession = Depends(get_db)):
    series = await compute_nav_series(db)
    return JSONResponse(series)


@router.post("/upload-ohlc", response_class=HTMLResponse)
async def upload_ohlc(
    request: Request,
    instrument_id: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    result = await ingest_ohlc_csv(db, instrument_id, content)
    return templates.TemplateResponse(
        "partials/manual_ohlc_status.html",
        {"request": request, "result": result},
    )


@router.post("/fetch-ohlc", response_class=HTMLResponse)
async def fetch_ohlc(
    request: Request,
    ticker: str = Form(...),
    start_date: str = Form(...),
    end_date: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    # Parse dates with the same permissive format set used for CSV uploads —
    # supports YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY, etc.
    start = parse_flexible_date(start_date)
    if start is None:
        return templates.TemplateResponse(
            "partials/kite_ohlc_fetch_status.html",
            {"request": request, "result": {"error": f"Unrecognised start date: '{start_date}'"}},
        )
    end = None
    if end_date.strip():
        end = parse_flexible_date(end_date)
        if end is None:
            return templates.TemplateResponse(
                "partials/kite_ohlc_fetch_status.html",
                {"request": request, "result": {"error": f"Unrecognised end date: '{end_date}'"}},
            )
    try:
        result = await fetch_ohlc_for_ticker(
            db, ticker=ticker, start_date=start, end_date=end
        )
    except Exception as e:
        result = {"error": str(e)}
    return templates.TemplateResponse(
        "partials/kite_ohlc_fetch_status.html",
        {"request": request, "result": result},
    )
