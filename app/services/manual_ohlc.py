"""
Manual OHLC CSV ingestion.

For instruments that aren't in Kite's instruments dump (delisted, renamed,
post-split shells) we can't pull history via the Kite historical API. This
service accepts a user-uploaded CSV and writes closes into price_history so
the NAV reconstruction picks them up during the period the user held the
position.

CSV format is permissive: any header with a date-ish name (date, trade_date,
timestamp) and any close-ish name (close, close price, adj close, closing)
works. Date strings are tried against several common formats.
"""
import csv
import io
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.price_history import PriceHistory

DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%Y/%m/%d",
    "%d-%b-%Y",       # NSE bhavcopy style: 21-Mar-2024
    "%d %b %Y",
    "%d-%B-%Y",
)

DATE_HEADER_ALIASES = ("date", "trade_date", "timestamp", "day")
CLOSE_HEADER_ALIASES = ("close", "close price", "closing", "adj close", "adj_close", "adjusted close")


def _parse_date(s: str) -> date | None:
    s = s.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


async def ingest_csv(db: AsyncSession, instrument_id: int, csv_bytes: bytes) -> dict:
    """Parse a date+close CSV and upsert into price_history. Returns
    {symbol, rows_added, rows_submitted, rows_skipped, errors} or {error}."""
    instrument = (
        await db.execute(select(Instrument).where(Instrument.id == instrument_id))
    ).scalar_one_or_none()
    if not instrument:
        return {"error": f"Instrument id {instrument_id} not found"}

    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = csv_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {"error": "CSV appears empty or missing a header row"}

    header_map = {(name or "").lower().strip(): name for name in reader.fieldnames}
    date_col = next((header_map[k] for k in DATE_HEADER_ALIASES if k in header_map), None)
    close_col = next((header_map[k] for k in CLOSE_HEADER_ALIASES if k in header_map), None)
    if not date_col or not close_col:
        return {
            "error": (
                f"CSV must have a date column (one of {DATE_HEADER_ALIASES}) and a close "
                f"column (one of {CLOSE_HEADER_ALIASES}). Found: {list(reader.fieldnames)}"
            )
        }

    values: list[dict] = []
    skipped = 0
    errors: list[str] = []
    for i, row in enumerate(reader, start=2):  # row 1 is header
        d_raw = (row.get(date_col) or "").strip()
        c_raw = (row.get(close_col) or "").strip().replace(",", "")
        if not d_raw or not c_raw:
            skipped += 1
            continue
        d = _parse_date(d_raw)
        if d is None:
            errors.append(f"row {i}: unrecognised date '{d_raw}'")
            continue
        try:
            c = float(c_raw)
        except ValueError:
            errors.append(f"row {i}: invalid close '{c_raw}'")
            continue
        if c <= 0:
            errors.append(f"row {i}: non-positive close {c}")
            continue
        values.append({"instrument_id": instrument_id, "price_date": d, "close": c})

    rows_added = 0
    if values:
        stmt = pg_insert(PriceHistory).values(values).on_conflict_do_nothing(
            index_elements=["instrument_id", "price_date"]
        )
        result = await db.execute(stmt)
        rows_added = result.rowcount or 0
        await db.commit()

    return {
        "symbol": instrument.tradingsymbol,
        "isin": instrument.isin,
        "rows_added": rows_added,
        "rows_submitted": len(values),
        "rows_skipped": skipped,
        "errors": errors[:20],  # cap to keep the UI readable
    }
