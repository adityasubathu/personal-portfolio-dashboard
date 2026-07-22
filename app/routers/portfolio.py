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
from app.sse import sse_stream
from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.kite import KiteSyncLog
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.schemas.portfolio import DirectHoldingsResponse, InstrumentListItem, SummaryCards
from app.services.holdings_engine import get_direct_holdings
from app.services.kite_historical import cancel_sync, fetch_ohlc_for_ticker, sync_index_history, sync_price_history
from app.services import kite_sync
from app.services.manual_ohlc import _parse_date as parse_flexible_date, ingest_csv as ingest_ohlc_csv
from app.services.nav_history import compute_nav_series
from app.services.xirr import portfolio_xirr, recompute_and_store_xirr
from app.models.trade import Trade

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])


@router.get("/direct", response_model=DirectHoldingsResponse)
async def direct_holdings(
    sort: str = Query("symbol"),
    dir: Literal["asc", "desc"] = Query("asc"),
    sections: Literal["on", "off"] = Query("on"),
    compare: Literal["prev_close", "open"] = Query("prev_close"),
    db: AsyncSession = Depends(get_db),
):
    return await get_direct_holdings(db, sort=sort, direction=dir, sections=sections, compare=compare)


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
    async def _runner(on_progress):
        result = await sync_price_history(db, on_progress=on_progress)
        await on_progress("Syncing index price history…")
        try:
            index_result = await sync_index_history(db, on_progress=on_progress)
            await on_progress(f"Indices: {index_result['instruments_synced']} synced, {index_result['rows_added']} rows")
        except Exception as idx_err:
            await on_progress(f"Index sync skipped: {idx_err}")
        await on_progress("Updating LTPs from Kite…")
        ltp_result = None
        try:
            ltp_result = await kite_sync.update_ltp(db)
            await on_progress(f"LTP updated: {ltp_result['updated']} instruments")
        except Exception as ltp_err:
            await on_progress(f"LTP update skipped: {ltp_err}")
        await on_progress("Recomputing XIRR…")
        await recompute_and_store_xirr(db)
        return {"result": result, "ltp": ltp_result}

    return sse_stream(_runner, lock=_price_sync_lock, busy_msg="A price history sync is already running.")


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

    async def _runner(on_progress):
        result = await fetch_ohlc_for_ticker(
            db,
            ticker=ticker,
            start_date=start,
            end_date=end,
            skip_token_check=skip_token_check,
            on_progress=on_progress,
        )
        await on_progress("Updating LTPs from Kite…")
        ltp_result = None
        try:
            ltp_result = await kite_sync.update_ltp(db)
            await on_progress(f"LTP updated: {ltp_result['updated']} instruments")
        except Exception as ltp_err:
            await on_progress(f"LTP update skipped: {ltp_err}")
        await on_progress("Recomputing XIRR…")
        await recompute_and_store_xirr(db)
        return {"result": result, "ltp": ltp_result}

    return sse_stream(_runner)
