import asyncio
import json as jsonlib
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.database import get_db
from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.kite import KiteSyncLog
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.schemas.portfolio import DirectHoldingsResponse, HoldingRow, HoldingsSection, InstrumentListItem, SummaryCards
from app.services.kite_historical import cancel_sync, fetch_ohlc_for_ticker, sync_index_history, sync_price_history
from app.services import kite_sync
from app.services.manual_ohlc import _parse_date as parse_flexible_date, ingest_csv as ingest_ohlc_csv
from app.services.nav_history import compute_nav_series
from app.services.xirr import compute_holdings_xirr, portfolio_xirr, recompute_and_store_xirr
from app.models.trade import Trade

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])

SORT_FIELDS = {"symbol", "type", "qty", "avg_price", "cost", "ltp", "as_of", "value", "pnl", "pnl_pct", "xirr", "day_chg_pct", "day_chg_abs"}

SECTION_ORDER = [
    ("Equity", {"STOCK", "ETF"}),
    ("Bonds", {"BOND"}),
    ("Mutual Funds", {"MF"}),
]


def _sort_key(row: dict, field: str):
    v = row.get(field)
    if v is None:
        return (1, 0)
    if isinstance(v, str):
        return (0, v.lower())
    return (0, v)


def _isodate(v) -> str | None:
    if v is None:
        return None
    from datetime import datetime as _datetime
    if isinstance(v, _datetime):
        return v.date().isoformat()
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


@router.get("/direct", response_model=DirectHoldingsResponse)
async def direct_holdings(
    sort: str = Query("symbol"),
    dir: Literal["asc", "desc"] = Query("asc"),
    sections: Literal["on", "off"] = Query("on"),
    compare: Literal["prev_close", "open"] = Query("prev_close"),
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

    instr_ids = [instr.id for _, instr in raw]
    mf_instr_ids = {instr.id for _, instr in raw if instr.instrument_type == "MF"}
    non_mf_ids = [i for i in instr_ids if i not in mf_instr_ids]
    mf_id_list = [i for i in instr_ids if i in mf_instr_ids]
    prev_close_map: dict[int, tuple[float, date]] = {}
    today_open_map: dict[int, float] = {}
    ohlc_ltp_map: dict[int, tuple[float, date]] = {}

    if non_mf_ids:
        sub = select(
            PriceHistory.instrument_id,
            PriceHistory.price_date,
            PriceHistory.open,
            PriceHistory.close,
            func.row_number().over(
                partition_by=PriceHistory.instrument_id,
                order_by=PriceHistory.price_date.desc(),
            ).label("rn"),
        ).where(PriceHistory.instrument_id.in_(non_mf_ids)).subquery()
        all_rows = (await db.execute(select(sub).where(sub.c.rn <= 2))).all()

        by_instr: dict[int, list] = {}
        for r in all_rows:
            by_instr.setdefault(r.instrument_id, []).append(r)

        for iid, entries in by_instr.items():
            entries.sort(key=lambda e: e.price_date, reverse=True)
            ohlc_ltp_map[iid] = (float(entries[0].close), entries[0].price_date)
            if entries[0].open is not None:
                today_open_map[iid] = float(entries[0].open)
            if len(entries) >= 2:
                prev_close_map[iid] = (float(entries[1].close), entries[1].price_date)

    if mf_id_list:
        nav_sub = select(
            NavHistory.instrument_id,
            NavHistory.nav_date,
            NavHistory.nav,
            func.row_number().over(
                partition_by=NavHistory.instrument_id,
                order_by=NavHistory.nav_date.desc(),
            ).label("rn"),
        ).where(NavHistory.instrument_id.in_(mf_id_list)).subquery()
        nav_rows = (await db.execute(select(nav_sub).where(nav_sub.c.rn <= 2))).all()

        by_mf: dict[int, list] = {}
        for r in nav_rows:
            by_mf.setdefault(r.instrument_id, []).append(r)

        for iid, entries in by_mf.items():
            entries.sort(key=lambda e: e.nav_date, reverse=True)
            if len(entries) >= 2:
                prev_close_map[iid] = (float(entries[1].nav), entries[1].nav_date)

    etf_ids = [instr.id for _, instr in raw if instr.instrument_type == "ETF"]
    etf_nav: dict[int, tuple[float, date]] = {}
    if etf_ids:
        sub = (
            select(
                NavHistory.instrument_id,
                func.max(NavHistory.nav_date).label("max_date"),
            )
            .where(NavHistory.instrument_id.in_(etf_ids))
            .group_by(NavHistory.instrument_id)
            .subquery()
        )
        latest_q = select(NavHistory).join(
            sub,
            (NavHistory.instrument_id == sub.c.instrument_id)
            & (NavHistory.nav_date == sub.c.max_date),
        )
        for row in (await db.execute(latest_q)).scalars().all():
            etf_nav[row.instrument_id] = (float(row.nav), row.nav_date)

    enriched: list[dict] = []
    for h, instr in raw:
        cost = float(h.total_cost or 0)
        ohlc_entry = ohlc_ltp_map.get(instr.id)
        if instr.instrument_type != "MF":
            holding_ltp = float(h.last_price) if h.last_price else None
            holding_date = h.last_price_at.date() if h.last_price_at else None
            if ohlc_entry:
                ohlc_close, ohlc_date = ohlc_entry
                if holding_ltp is not None and holding_date is not None and holding_date >= ohlc_date:
                    ltp, ltp_as_of = holding_ltp, h.last_price_at
                else:
                    ltp, ltp_as_of = ohlc_close, ohlc_date
            else:
                ltp, ltp_as_of = holding_ltp, h.last_price_at
        else:
            ltp = float(h.last_price) if h.last_price else None
            ltp_as_of = h.last_price_at
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
        prev_close_entry = prev_close_map.get(instr.id)
        prev_close = prev_close_entry[0] if prev_close_entry else None
        prev_close_date = prev_close_entry[1] if prev_close_entry else None
        today_open = today_open_map.get(instr.id)
        ref_price = today_open if compare == "open" else prev_close
        day_chg_pct = ((ltp - ref_price) / ref_price * 100) if ltp is not None and ref_price else None
        day_chg_abs = ((ltp - ref_price) * float(h.quantity)) if ltp is not None and ref_price else None

        enriched.append({
            "instrument_id": instr.id,
            "symbol": instr.tradingsymbol or "",
            "type": instr.instrument_type or "",
            "isin": instr.isin,
            "name": instr.name,
            "qty": float(h.quantity),
            "avg_price": float(h.average_price) if h.average_price else None,
            "cost": cost,
            "ltp": ltp,
            "as_of": _isodate(ltp_as_of),
            "value": value,
            "pnl": pnl,
            "pnl_pct": pnl_pct,
            "xirr": xirr_pct,
            "nav": nav,
            "nav_as_of": _isodate(nav_as_of),
            "nav_premium": nav_premium,
            "prev_close": prev_close,
            "prev_close_date": _isodate(prev_close_date),
            "day_chg_pct": day_chg_pct,
            "day_chg_abs": day_chg_abs,
        })

    total_cost = sum(r["cost"] for r in enriched)
    total_value = sum(r["value"] for r in enriched)
    total_day_chg = sum(r["day_chg_abs"] for r in enriched if r["day_chg_abs"] is not None)
    prev_total = total_value - total_day_chg
    total_day_chg_pct = (total_day_chg / prev_total * 100) if prev_total else None

    def _range(vs):
        vs = [v for v in vs if v is not None]
        neg = [v for v in vs if v < 0]
        pos = [v for v in vs if v > 0]
        return (min(neg) if neg else None, max(pos) if pos else None)

    pnl_min, pnl_max = _range([r["pnl"] for r in enriched])
    pnl_pct_min, pnl_pct_max = _range([r["pnl_pct"] for r in enriched])
    xirr_min, xirr_max = _range([r["xirr"] for r in enriched])
    day_chg_abs_min, day_chg_abs_max = _range([r["day_chg_abs"] for r in enriched])

    reverse = dir == "desc"
    enriched.sort(key=lambda r: r["symbol"].lower())
    enriched.sort(key=lambda r: _sort_key(r, sort), reverse=reverse)

    sections_enabled = sections == "on"
    if sections_enabled:
        groups = []
        for label, types in SECTION_ORDER:
            group_rows = [r for r in enriched if r["type"] in types]
            if group_rows:
                gmin, gmax = _range([r["day_chg_abs"] for r in group_rows])
                groups.append({"label": label, "rows": group_rows, "day_chg_abs_min": gmin, "day_chg_abs_max": gmax})
    else:
        groups = [{"label": None, "rows": enriched, "day_chg_abs_min": day_chg_abs_min, "day_chg_abs_max": day_chg_abs_max}]

    return DirectHoldingsResponse(
        groups=[HoldingsSection(label=g["label"], rows=[HoldingRow(**r) for r in g["rows"]], day_chg_abs_min=g["day_chg_abs_min"], day_chg_abs_max=g["day_chg_abs_max"]) for g in groups],
        sections_enabled=sections_enabled,
        current_sort=sort,
        current_dir=dir,
        total_cost=total_cost,
        total_value=total_value,
        total_day_chg=total_day_chg,
        total_day_chg_pct=total_day_chg_pct,
        compare=compare,
        pnl_min=pnl_min, pnl_max=pnl_max,
        pnl_pct_min=pnl_pct_min, pnl_pct_max=pnl_pct_max,
        xirr_min=xirr_min, xirr_max=xirr_max,
        day_chg_abs_min=day_chg_abs_min, day_chg_abs_max=day_chg_abs_max,
    )


@router.get("/summary")
async def portfolio_summary(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
    )
    rows = result.all()

    non_mf_ids = [instr.id for _, instr in rows if instr.instrument_type != "MF"]
    ohlc_ltp_map: dict[int, tuple[float, date]] = {}
    if non_mf_ids:
        sub = select(
            PriceHistory.instrument_id,
            PriceHistory.close,
            PriceHistory.price_date,
            func.row_number().over(
                partition_by=PriceHistory.instrument_id,
                order_by=PriceHistory.price_date.desc(),
            ).label("rn"),
        ).where(PriceHistory.instrument_id.in_(non_mf_ids)).subquery()
        for r in (await db.execute(select(sub).where(sub.c.rn == 1))).all():
            ohlc_ltp_map[r.instrument_id] = (float(r.close), r.price_date)

    total_cost = sum(float(h.total_cost or 0) for h, _ in rows)
    total_value = 0.0
    for h, instr in rows:
        cost = float(h.total_cost or 0)
        if instr.instrument_type != "MF" and instr.id in ohlc_ltp_map:
            ohlc_close, ohlc_date = ohlc_ltp_map[instr.id]
            holding_ltp = float(h.last_price) if h.last_price else None
            holding_date = h.last_price_at.date() if h.last_price_at else None
            if holding_ltp is not None and holding_date is not None and holding_date >= ohlc_date:
                ltp = holding_ltp
            else:
                ltp = ohlc_close
        elif h.last_price:
            ltp = float(h.last_price)
        else:
            ltp = None
        total_value += float(h.quantity) * ltp if ltp else cost

    return {
        "total_cost": round(total_cost, 2),
        "total_value": round(total_value, 2),
        "total_pnl": round(total_value - total_cost, 2),
        "holdings_count": len(rows),
    }


@router.get("/summary-cards", response_model=SummaryCards)
async def summary_cards(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    rows = result.all()

    non_mf_ids = [instr.id for _, instr in rows if instr.instrument_type != "MF"]
    ohlc_ltp_map: dict[int, tuple[float, date]] = {}
    if non_mf_ids:
        sub = select(
            PriceHistory.instrument_id,
            PriceHistory.close,
            PriceHistory.price_date,
            func.row_number().over(
                partition_by=PriceHistory.instrument_id,
                order_by=PriceHistory.price_date.desc(),
            ).label("rn"),
        ).where(PriceHistory.instrument_id.in_(non_mf_ids)).subquery()
        for r in (await db.execute(select(sub).where(sub.c.rn == 1))).all():
            ohlc_ltp_map[r.instrument_id] = (float(r.close), r.price_date)

    total_cost = sum(float(h.total_cost or 0) for h, _ in rows)
    total_value = 0.0
    for h, instr in rows:
        cost = float(h.total_cost or 0)
        if instr.instrument_type != "MF" and instr.id in ohlc_ltp_map:
            ohlc_close, ohlc_date = ohlc_ltp_map[instr.id]
            holding_ltp = float(h.last_price) if h.last_price else None
            holding_date = h.last_price_at.date() if h.last_price_at else None
            if holding_ltp is not None and holding_date is not None and holding_date >= ohlc_date:
                ltp = holding_ltp
            else:
                ltp = ohlc_close
        elif h.last_price:
            ltp = float(h.last_price)
        else:
            ltp = None
        total_value += float(h.quantity) * ltp if ltp else cost

    last_sync_row = (
        await db.execute(
            select(KiteSyncLog).order_by(KiteSyncLog.synced_at.desc()).limit(1)
        )
    ).scalar_one_or_none()

    last_ltp_row = (await db.execute(
        select(func.max(Holding.last_price_at))
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type != "MF")
    )).scalar_one_or_none()

    xirr_value = await portfolio_xirr(db, as_of=date.today())

    return SummaryCards(
        total_cost=total_cost,
        total_value=total_value,
        total_pnl=total_value - total_cost,
        last_sync=last_sync_row.synced_at.isoformat() if last_sync_row else None,
        last_ltp_update=last_ltp_row.isoformat() if last_ltp_row else None,
        xirr=xirr_value,
    )


@router.post("/update-ltp")
async def update_ltp(db: AsyncSession = Depends(get_db)):
    try:
        result = await kite_sync.update_ltp(db)
        return JSONResponse(result)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@router.get("/instruments", response_model=list[InstrumentListItem])
async def traded_instruments(db: AsyncSession = Depends(get_db)):
    """Instruments the user has ever traded, with combined price+NAV row counts."""
    traded_ids = select(Trade.instrument_id).distinct()

    price_count_sub = (
        select(PriceHistory.instrument_id, func.count(PriceHistory.id).label("n"))
        .group_by(PriceHistory.instrument_id)
        .subquery()
    )
    nav_count_sub = (
        select(NavHistory.instrument_id, func.count(NavHistory.id).label("n"))
        .group_by(NavHistory.instrument_id)
        .subquery()
    )
    result = await db.execute(
        select(
            Instrument,
            func.coalesce(price_count_sub.c.n, 0).label("n_prices"),
            func.coalesce(nav_count_sub.c.n, 0).label("n_navs"),
        )
        .outerjoin(price_count_sub, price_count_sub.c.instrument_id == Instrument.id)
        .outerjoin(nav_count_sub, nav_count_sub.c.instrument_id == Instrument.id)
        .where(Instrument.id.in_(traded_ids))
        .order_by(
            (func.coalesce(price_count_sub.c.n, 0) + func.coalesce(nav_count_sub.c.n, 0)).asc(),
            Instrument.tradingsymbol,
        )
    )
    return [
        InstrumentListItem(
            id=i.id,
            symbol=i.tradingsymbol,
            isin=i.isin,
            name=i.name,
            type=i.instrument_type,
            n_prices=n_prices + n_navs,
        )
        for i, n_prices, n_navs in result.all()
    ]


_price_sync_lock = asyncio.Lock()


@router.get("/sync-price-history/stream")
async def sync_price_history_stream(db: AsyncSession = Depends(get_db)):
    if _price_sync_lock.locked():
        async def _busy():
            yield {"event": "done", "data": jsonlib.dumps({"ok": False, "error": "A price history sync is already running."})}
        return EventSourceResponse(_busy())

    async def _generate():
        async with _price_sync_lock:
            queue: asyncio.Queue[str] = asyncio.Queue()

            async def _on_progress(msg: str):
                await queue.put(msg)

            async def _run_sync():
                try:
                    result = await sync_price_history(db, on_progress=_on_progress)
                    await _on_progress("Syncing index price history…")
                    try:
                        index_result = await sync_index_history(db, on_progress=_on_progress)
                        await _on_progress(f"Indices: {index_result['instruments_synced']} synced, {index_result['rows_added']} rows")
                    except Exception as idx_err:
                        await _on_progress(f"Index sync skipped: {idx_err}")
                    await _on_progress("Updating LTPs from Kite…")
                    ltp_result = None
                    try:
                        ltp_result = await kite_sync.update_ltp(db)
                        await _on_progress(f"LTP updated: {ltp_result['updated']} instruments")
                    except Exception as ltp_err:
                        await _on_progress(f"LTP update skipped: {ltp_err}")
                        await _on_progress("Recomputing XIRR…")
                        await recompute_and_store_xirr(db)
                    await queue.put(None)
                    await queue.put(jsonlib.dumps({"ok": True, "result": result, "ltp": ltp_result}))
                except Exception as e:
                    await queue.put(None)
                    await queue.put(jsonlib.dumps({"ok": False, "error": str(e)}))

            task = asyncio.create_task(_run_sync())
            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield {"event": "log", "data": msg}

            final = await queue.get()
            yield {"event": "done", "data": final}
            await task

    return EventSourceResponse(_generate())


@router.post("/sync-price-history/cancel")
async def cancel_price_sync():
    cancel_sync()
    return JSONResponse({"ok": True})


@router.get("/nav-history")
async def nav_history_json(db: AsyncSession = Depends(get_db)):
    series = await compute_nav_series(db)
    return JSONResponse(series)


@router.post("/upload-ohlc")
async def upload_ohlc(
    instrument_id: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    content = await file.read()
    result = await ingest_ohlc_csv(db, instrument_id, content)
    return JSONResponse(result)


@router.post("/fetch-ohlc")
async def fetch_ohlc(
    ticker: str = Form(...),
    start_date: str = Form(...),
    end_date: str = Form(""),
    db: AsyncSession = Depends(get_db),
):
    start = parse_flexible_date(start_date)
    if start is None:
        return JSONResponse({"error": f"Unrecognised start date: '{start_date}'"}, status_code=400)
    end = None
    if end_date.strip():
        end = parse_flexible_date(end_date)
        if end is None:
            return JSONResponse({"error": f"Unrecognised end date: '{end_date}'"}, status_code=400)
    try:
        result = await fetch_ohlc_for_ticker(db, ticker=ticker, start_date=start, end_date=end)
    except Exception as e:
        result = {"error": str(e)}
    return JSONResponse(result)


@router.get("/fetch-ohlc/stream")
async def fetch_ohlc_stream(
    ticker: str = Query(...),
    start_date: str = Query(...),
    end_date: str = Query(""),
    skip_token_check: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    start = parse_flexible_date(start_date)
    if start is None:
        async def _err():
            yield {"event": "done", "data": jsonlib.dumps({"ok": False, "error": f"Unrecognised start date: '{start_date}'"})}
        return EventSourceResponse(_err())
    end = None
    if end_date.strip():
        end = parse_flexible_date(end_date)
        if end is None:
            async def _err():
                yield {"event": "done", "data": jsonlib.dumps({"ok": False, "error": f"Unrecognised end date: '{end_date}'"})}
            return EventSourceResponse(_err())

    async def _generate():
        queue: asyncio.Queue[str] = asyncio.Queue()

        async def _on_progress(msg: str):
            await queue.put(msg)

        async def _run():
            try:
                result = await fetch_ohlc_for_ticker(
                    db,
                    ticker=ticker,
                    start_date=start,
                    end_date=end,
                    skip_token_check=skip_token_check,
                    on_progress=_on_progress,
                )
                await _on_progress("Updating LTPs from Kite…")
                ltp_result = None
                try:
                    ltp_result = await kite_sync.update_ltp(db)
                    await _on_progress(f"LTP updated: {ltp_result['updated']} instruments")
                except Exception as ltp_err:
                    await _on_progress(f"LTP update skipped: {ltp_err}")
                    await _on_progress("Recomputing XIRR…")
                    await recompute_and_store_xirr(db)
                await queue.put(None)
                await queue.put(jsonlib.dumps({"ok": True, "result": result, "ltp": ltp_result}))
            except Exception as e:
                await queue.put(None)
                await queue.put(jsonlib.dumps({"ok": False, "error": str(e)}))

        task = asyncio.create_task(_run())
        while True:
            msg = await queue.get()
            if msg is None:
                break
            yield {"event": "log", "data": msg}
        final = await queue.get()
        yield {"event": "done", "data": final}
        await task

    return EventSourceResponse(_generate())
