"""
CSV importer — handles three formats:
  1. Kite tradebook export, legacy layout: Title-Case columns ("Trade Date", "Quantity Str")
     with DD/MM/YY dates and ₹-prefixed prices.
  2. Kite tradebook export, current layout: lowercase_underscore columns ("trade_date",
     "quantity") with ISO dates (YYYY-MM-DD). EQ and MF exports share this schema.
  3. Generic portfolio CSV (see /api/v1/trades/template).

Returns a dict with batch_id, row_count, success_count, errors list.
"""
import io
import re
import uuid
from datetime import date, datetime

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_log import CSVImportLog
from app.models.trade import Trade
from app.services.instrument_registry import find_or_create, infer_instrument_type


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def import_csv(db: AsyncSession, content: bytes, filename: str) -> dict:
    batch_id = str(uuid.uuid4())
    errors: list[dict] = []

    try:
        df = _load_dataframe(content)
    except Exception as e:
        return {"batch_id": batch_id, "row_count": 0, "success_count": 0, "errors": [{"row": 0, "message": str(e)}]}

    if _is_kite_legacy_format(df):
        df = _normalize_kite_legacy(df)
    elif _is_kite_current_format(df):
        df = _normalize_kite_current(df)
    else:
        df = _normalize_generic(df)

    row_count = len(df)
    success_count = 0

    for i, row in df.iterrows():
        row_num = i + 2  # 1-indexed, +1 for header
        try:
            await _insert_row(db, row, batch_id)
            success_count += 1
        except Exception as e:
            errors.append({"row": row_num, "message": str(e)})

    import json
    log = CSVImportLog(
        batch_id=batch_id,
        filename=filename,
        row_count=row_count,
        success_count=success_count,
        error_count=len(errors),
        errors_json=json.dumps(errors) if errors else None,
    )
    db.add(log)
    await db.commit()

    return {
        "batch_id": batch_id,
        "row_count": row_count,
        "success_count": success_count,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Format detection & normalisation
# ---------------------------------------------------------------------------

def _load_dataframe(content: bytes) -> pd.DataFrame:
    # Strip BOM, handle Windows line endings
    text = content.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    df = pd.read_csv(io.StringIO(text))
    df.columns = [c.strip() for c in df.columns]
    return df


def _is_kite_legacy_format(df: pd.DataFrame) -> bool:
    # Title-Case columns unique to the old export
    return bool({"Trade Date", "Quantity Str"} & set(df.columns))


def _is_kite_current_format(df: pd.DataFrame) -> bool:
    # Lowercase/underscore layout shared by EQ and MF exports
    return {"trade_date", "trade_type", "symbol", "quantity"}.issubset(set(df.columns))


def _normalize_kite_legacy(df: pd.DataFrame) -> pd.DataFrame:
    """Map Kite tradebook (legacy Title-Case) columns → canonical schema."""
    out = pd.DataFrame()
    out["trade_date"] = df["Trade Date"].apply(_parse_date_dmy)
    out["trade_type"] = df["Trade Type"].str.upper().str.strip()
    out["symbol"] = df["Symbol"].str.strip()
    out["isin"] = df["ISIN"].str.strip().fillna("")
    out["exchange"] = df["Exchange"].str.strip()
    out["segment"] = df["Segment"].str.strip()
    out["series"] = df["Series"].fillna("").str.strip()
    out["quantity"] = df["Quantity Str"].apply(_parse_quantity)
    out["price"] = df["Price"].apply(_parse_price)
    out["brokerage"] = 0.0
    out["notes"] = ""
    return out


def _normalize_kite_current(df: pd.DataFrame) -> pd.DataFrame:
    """Map current Kite tradebook export (EQ or MF) → canonical schema."""
    out = pd.DataFrame()
    out["trade_date"] = df["trade_date"].apply(_parse_date_flexible)
    out["trade_type"] = df["trade_type"].astype(str).str.upper().str.strip()
    out["symbol"] = df["symbol"].astype(str).str.strip()
    out["isin"] = df.get("isin", pd.Series([""] * len(df))).fillna("").astype(str).str.strip()
    out["exchange"] = df.get("exchange", pd.Series(["NSE"] * len(df))).fillna("NSE").astype(str).str.strip()
    # Kite's external-equity (EQX) exports use the literal string "UNKNOWN" for IPO/bond-issue
    # allotments that pre-date an exchange listing. Treat as absent so downstream matching
    # falls back to ISIN / symbol-only lookups instead of creating UNKNOWN-exchange rows.
    out["exchange"] = out["exchange"].replace({"UNKNOWN": ""})
    out["segment"] = df.get("segment", pd.Series(["EQ"] * len(df))).fillna("EQ").astype(str).str.strip()
    out["series"] = df.get("series", pd.Series([""] * len(df))).fillna("").astype(str).str.strip()
    out["quantity"] = df["quantity"].apply(_parse_quantity)
    out["price"] = df["price"].apply(_parse_price)
    out["brokerage"] = 0.0
    out["notes"] = ""
    return out


def _normalize_generic(df: pd.DataFrame) -> pd.DataFrame:
    """Normalise generic CSV — tolerant of column name variants."""
    col = _col_map(df)

    out = pd.DataFrame()
    out["trade_date"] = df[col("date", "trade_date")].apply(_parse_date_flexible)
    out["trade_type"] = df[col("type", "trade_type")].str.upper().str.strip()
    out["symbol"] = df[col("symbol")].str.strip()
    out["isin"] = df.get(col("isin"), pd.Series([""] * len(df))).fillna("").str.strip()
    out["exchange"] = df.get(col("exchange"), pd.Series(["NSE"] * len(df))).fillna("NSE").str.strip()
    out["segment"] = df.get(col("segment"), pd.Series(["EQ"] * len(df))).fillna("EQ").str.strip()
    out["series"] = ""
    out["quantity"] = df[col("quantity", "qty")].apply(_parse_quantity)
    out["price"] = df[col("price", "nav")].apply(_parse_price)
    out["brokerage"] = df.get(col("brokerage"), pd.Series([0.0] * len(df))).fillna(0.0)
    out["notes"] = df.get(col("notes"), pd.Series([""] * len(df))).fillna("")
    return out


def _col_map(df: pd.DataFrame):
    """Return a function that finds the first matching column name (case-insensitive)."""
    lower_map = {c.lower().replace(" ", "_"): c for c in df.columns}

    def find(*names):
        for n in names:
            if n.lower() in lower_map:
                return lower_map[n.lower()]
        raise KeyError(f"None of {names} found in CSV columns: {list(df.columns)}")

    return find


# ---------------------------------------------------------------------------
# DB insertion
# ---------------------------------------------------------------------------

async def _insert_row(db: AsyncSession, row: pd.Series, batch_id: str) -> None:
    isin = row["isin"] or None
    segment = row["segment"]
    series = row.get("series", "")
    exchange = row["exchange"] or None

    instrument_type = infer_instrument_type(segment, series, isin=isin, symbol=row["symbol"])

    instrument = await find_or_create(
        db,
        isin=isin,
        tradingsymbol=row["symbol"],
        exchange=exchange,
        instrument_type=instrument_type,
        name=row["symbol"],
    )

    qty = float(row["quantity"])
    price = float(row["price"])

    trade = Trade(
        instrument_id=instrument.id,
        trade_date=row["trade_date"],
        trade_type=row["trade_type"],
        quantity=qty,
        price=price,
        amount=round(qty * price, 6),
        brokerage=float(row.get("brokerage", 0) or 0),
        exchange=exchange,
        segment=segment,
        notes=str(row.get("notes", "")) or None,
        source="CSV_IMPORT",
        import_batch_id=batch_id,
    )
    db.add(trade)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_date_dmy(val: str) -> date:
    """Parse DD/MM/YY or DD/MM/YYYY."""
    val = str(val).strip()
    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {val!r}")


def _parse_date_flexible(val: str) -> date:
    val = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y"):
        try:
            return datetime.strptime(val, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Cannot parse date: {val!r}")


def _parse_price(val) -> float:
    """Strip ₹, commas, spaces then parse."""
    val = str(val).strip()
    val = re.sub(r"[₹,\s]", "", val)
    return float(val)


def _parse_quantity(val) -> float:
    val = str(val).strip().replace(",", "")
    return float(val)
