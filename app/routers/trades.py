from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.import_log import CSVImportLog
from app.models.instrument import Instrument
from app.models.trade import Trade
from app.schemas.trades import ImportBatch, ImportResponse, TradesListResponse
from app.services.csv_importer import import_csv
from app.services.holdings_engine import recompute_holdings
from app.services.trades import list_trades_grouped
from app.services.xirr import recompute_and_store_xirr
from app.time_util import now_ist

router = APIRouter(prefix="/api/v1/trades", tags=["trades"])

TEMPLATE_CSV = """date,type,symbol,isin,exchange,segment,quantity,price,brokerage,notes
2024-01-15,BUY,RELIANCE,INE002A01018,NSE,EQ,10,2450.00,20.00,Initial buy
2024-03-10,BUY,NIFTYBEES,INF204KB14I2,NSE,EQ,50,230.50,0.00,
2024-06-01,SELL,RELIANCE,INE002A01018,NSE,EQ,5,2800.00,20.00,Partial exit
2024-08-20,BUY,PPFCF,INF879O01019,BSE,MF,100.000,65.23,0.00,MF at NAV
"""


@router.get("/template")
async def download_template():
    return StreamingResponse(
        iter([TEMPLATE_CSV]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=trades_template.csv"},
    )


@router.get("", response_model=TradesListResponse)
async def list_trades(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    q: str = Query("", max_length=50),
    db: AsyncSession = Depends(get_db),
):
    return await list_trades_grouped(db, page, per_page, q)


@router.post("/import", response_model=ImportResponse)
async def import_trades(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    results = []
    for f in files:
        content = await f.read()
        r = await import_csv(db, content, f.filename or "upload.csv")
        r["filename"] = f.filename or "upload.csv"
        results.append(r)

    recompute = await recompute_holdings(db)
    await db.commit()
    await recompute_and_store_xirr(db)

    return ImportResponse(
        results=results,
        holdings_count=recompute["count"],
        violations=recompute["violations"],
    )


@router.post("/split-credit")
async def add_split_credit(
    instrument_id: int = Form(...),
    trade_date: date = Form(...),
    quantity: float = Form(...),
    db: AsyncSession = Depends(get_db),
):
    if quantity <= 0:
        raise HTTPException(400, "quantity must be > 0")

    instrument = (await db.execute(
        select(Instrument).where(Instrument.id == instrument_id)
    )).scalar_one_or_none()
    if not instrument:
        raise HTTPException(404, f"instrument {instrument_id} not found")

    trade = Trade(
        instrument_id=instrument_id,
        trade_date=trade_date,
        trade_type="BUY",
        quantity=quantity,
        price=0,
        amount=0,
        brokerage=0,
        source="SPLIT_CREDIT",
        notes="Stock split / bonus / consolidation credit",
    )
    db.add(trade)
    await db.flush()

    recompute = await recompute_holdings(db)
    await db.commit()
    await recompute_and_store_xirr(db)

    return JSONResponse({"violations": recompute["violations"]})


@router.get("/imports", response_model=list[ImportBatch])
async def list_imports(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CSVImportLog).order_by(CSVImportLog.imported_at.desc()).limit(20)
    )
    logs = result.scalars().all()
    return [
        ImportBatch(
            id=log.id,
            batch_id=log.batch_id,
            filename=log.filename,
            imported_at=log.imported_at.isoformat(),
            row_count=log.row_count,
            success_count=log.success_count,
            error_count=log.error_count,
        )
        for log in logs
    ]


@router.delete("/import/{batch_id}")
async def rollback_import(batch_id: str, db: AsyncSession = Depends(get_db)):
    await db.execute(delete(Trade).where(Trade.import_batch_id == batch_id))
    await db.execute(delete(CSVImportLog).where(CSVImportLog.batch_id == batch_id))
    await recompute_holdings(db)
    await db.commit()
    return JSONResponse({"ok": True, "batch_id": batch_id})
