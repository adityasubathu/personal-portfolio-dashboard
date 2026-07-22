"""
Kite historical-data sync for STOCK / BOND instruments.

Two phases:
  1. resolve_instrument_tokens — downloads Kite's public instruments CSV
     once per call and fills Instrument.kite_instrument_token by matching
     on (tradingsymbol, exchange).

  2. sync_price_history — for each STOCK/BOND holding, pulls day candles
     from Kite (incremental after first backfill) and writes close prices
     into price_history. Idempotent via INSERT OR IGNORE.

ETFs are intentionally routed through mfapi.in (via mfapi_nav.py) instead of
Kite historical: we reuse the daily AMFI NAV for both the ETF-premium display
on the holdings table and the NAV-chart's daily price. NAV typically tracks
the exchange close within ~1%, which is accurate enough for the chart and
avoids a (instrument_id, price_date) unique-constraint collision with the
NAV rows we already store for the premium.
"""
import asyncio
from datetime import date, timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.kite import KiteConfig
from app.models.price_history import PriceHistory
from app.models.trade import Trade
from app.services import kite_client
from app.services.kite_sync import _assert_token_valid, _get_config

EQUITY_TYPES = ("STOCK", "BOND", "ETF", "INDEX")
KITE_DAY_CANDLE_CAP = 1800  # Kite caps `day` interval at 2000; leave headroom.

INDEX_INSTRUMENTS = [
    {"tradingsymbol": "NIFTY 50",         "exchange": "NSE", "name": "Nifty 50"},
    {"tradingsymbol": "NIFTY NEXT 50",    "exchange": "NSE", "name": "Nifty Next 50"},
    {"tradingsymbol": "NIFTY MIDCAP 150", "exchange": "NSE", "name": "Nifty Midcap 150"},
    {"tradingsymbol": "NIFTY SMLCAP 250", "exchange": "NSE", "name": "Nifty Smallcap 250"},
    {"tradingsymbol": "INDIA VIX",        "exchange": "NSE", "name": "India VIX"},
]
HISTORY_START = date(2015, 1, 1)  # earliest date fetched for all instruments

_cancel_event = asyncio.Event()


def cancel_sync() -> None:
    _cancel_event.set()



async def resolve_instrument_tokens(db: AsyncSession) -> dict:
    """Populate Instrument.kite_instrument_token for every STOCK/BOND instrument
    the user has ever traded (including sold-out positions) whose
    (tradingsymbol, exchange) appears in Kite's instruments dump.
    Returns {resolved, already_had, unresolved: [names]}."""
    traded_ids = select(Trade.instrument_id).distinct()
    result = await db.execute(
        select(Instrument)
        .where(Instrument.id.in_(traded_ids))
        .where(Instrument.instrument_type.in_(EQUITY_TYPES))
    )
    instruments = list(result.scalars().all())
    if not instruments:
        return {"resolved": 0, "already_had": 0, "unresolved": []}

    needed = [i for i in instruments if not i.kite_instrument_token]
    already_had = len(instruments) - len(needed)
    if not needed:
        return {"resolved": 0, "already_had": already_had, "unresolved": []}

    dump = await kite_client.get_instruments_dump()
    # Index by (tradingsymbol, exchange) for O(1) lookup.
    by_key: dict[tuple[str, str], int] = {}
    for row in dump:
        sym = (row.get("tradingsymbol") or "").strip()
        exch = (row.get("exchange") or "").strip()
        tok = row.get("instrument_token")
        if not (sym and exch and tok):
            continue
        try:
            by_key[(sym, exch)] = int(tok)
        except ValueError:
            continue

    resolved = 0
    unresolved: list[str] = []
    for instr in needed:
        sym = (instr.tradingsymbol or "").strip()
        exch = (instr.exchange or "NSE").strip()
        tok = by_key.get((sym, exch)) or by_key.get((sym, "BSE"))
        if tok is None:
            unresolved.append(f"{sym or '?'} ({exch})")
            continue
        instr.kite_instrument_token = tok
        resolved += 1

    await db.commit()
    return {"resolved": resolved, "already_had": already_had, "unresolved": unresolved}


async def ensure_index_instruments(db: AsyncSession) -> list[Instrument]:
    """Find-or-create Instrument rows for each entry in INDEX_INSTRUMENTS."""
    instruments: list[Instrument] = []
    for entry in INDEX_INSTRUMENTS:
        result = await db.execute(
            select(Instrument).where(
                Instrument.tradingsymbol == entry["tradingsymbol"],
                Instrument.exchange == entry["exchange"],
                Instrument.instrument_type == "INDEX",
            )
        )
        instr = result.scalar_one_or_none()
        if instr is None:
            instr = Instrument(
                tradingsymbol=entry["tradingsymbol"],
                exchange=entry["exchange"],
                name=entry["name"],
                instrument_type="INDEX",
                isin=None,
            )
            db.add(instr)
        instruments.append(instr)
    await db.commit()
    # Refresh to get IDs for any newly inserted rows.
    for instr in instruments:
        await db.refresh(instr)
    return instruments


async def resolve_index_tokens(db: AsyncSession) -> dict:
    """Populate kite_instrument_token for INDEX instruments from the Kite dump.
    Index rows appear in the dump with segment=NSE_INDICES."""
    instruments = await ensure_index_instruments(db)
    needed = [i for i in instruments if not i.kite_instrument_token]
    already_had = len(instruments) - len(needed)
    if not needed:
        return {"resolved": 0, "already_had": already_had, "unresolved": []}

    dump = await kite_client.get_instruments_dump()
    # Index rows use segment=NSE_INDICES; tradingsymbol matches exactly.
    index_tokens: dict[str, int] = {}
    for row in dump:
        seg = (row.get("segment") or "").strip()
        sym = (row.get("tradingsymbol") or "").strip()
        tok = row.get("instrument_token")
        if seg == "INDICES" and sym and tok:
            try:
                index_tokens[sym] = int(tok)
            except ValueError:
                continue

    resolved = 0
    unresolved: list[str] = []
    for instr in needed:
        sym = (instr.tradingsymbol or "").strip()
        tok = index_tokens.get(sym)
        if tok is None:
            unresolved.append(sym)
            continue
        instr.kite_instrument_token = tok
        resolved += 1

    await db.commit()
    return {"resolved": resolved, "already_had": already_had, "unresolved": unresolved}


async def _earliest_trade_date(db: AsyncSession, instrument_id: int) -> date | None:
    return (
        await db.execute(
            select(func.min(Trade.trade_date)).where(Trade.instrument_id == instrument_id)
        )
    ).scalar_one_or_none()


async def _latest_stored_price_date(db: AsyncSession, instrument_id: int) -> date | None:
    return (
        await db.execute(
            select(func.max(PriceHistory.price_date)).where(
                PriceHistory.instrument_id == instrument_id
            )
        )
    ).scalar_one_or_none()


async def _earliest_stored_price_date(db: AsyncSession, instrument_id: int) -> date | None:
    return (
        await db.execute(
            select(func.min(PriceHistory.price_date)).where(
                PriceHistory.instrument_id == instrument_id
            )
        )
    ).scalar_one_or_none()


async def _fetch_range(
    config: KiteConfig,
    token: int,
    start: date,
    end: date,
) -> tuple[list[dict], str | None]:
    """Fetch candles for [start, end] in KITE_DAY_CANDLE_CAP-day windows.
    Returns (candles, error_str | None)."""
    candles: list[dict] = []
    cursor = start
    while cursor <= end:
        window_end = min(cursor + timedelta(days=KITE_DAY_CANDLE_CAP - 1), end)
        try:
            chunk = await kite_client.get_historical_candles(
                config.api_key,
                config.access_token,
                token,
                cursor,
                window_end,
            )
        except (httpx.HTTPError, ValueError) as e:
            return [], f"kite: {e}"
        candles.extend(chunk)
        cursor = window_end + timedelta(days=1)
    return candles, None


async def _sync_one(
    db: AsyncSession,
    config: KiteConfig,
    instrument: Instrument,
    backfill_start: date | None = None,
) -> dict:
    """Sync history for a single instrument. Returns {rows_added, latest_price_date, error?}.

    `backfill_start`: floor date for initial and backward-gap fills.
    Defaults to HISTORY_START for instruments with no trades, or
    10 days before the earliest trade date (whichever is earlier)."""
    latest_stored = await _latest_stored_price_date(db, instrument.id)
    earliest_stored = await _earliest_stored_price_date(db, instrument.id)
    today = date.today()
    floor = backfill_start if backfill_start is not None else HISTORY_START

    # ── Determine forward fetch start ─────────────────────────────────────────
    if latest_stored:
        forward_start = latest_stored - timedelta(days=4)
    else:
        if backfill_start is not None:
            forward_start = backfill_start
        else:
            earliest_trade = await _earliest_trade_date(db, instrument.id)
            if earliest_trade is None:
                return {"rows_added": 0, "latest_price_date": None}
            forward_start = min(earliest_trade - timedelta(days=10), floor)

    if forward_start > today:
        return {"rows_added": 0, "latest_price_date": latest_stored.isoformat() if latest_stored else None}

    # ── Fetch forward (recent data) ───────────────────────────────────────────
    all_candles, err = await _fetch_range(config, instrument.kite_instrument_token, forward_start, today)
    if err:
        return {"rows_added": 0, "latest_price_date": None, "error": err}

    # ── Fetch backward gap if existing data doesn't reach the floor ───────────
    if earliest_stored is not None and earliest_stored > floor:
        backward_end = earliest_stored - timedelta(days=1)
        if backward_end >= floor:
            back_candles, err = await _fetch_range(
                config, instrument.kite_instrument_token, floor, backward_end
            )
            if err:
                return {"rows_added": 0, "latest_price_date": None, "error": err}
            all_candles.extend(back_candles)

    if not all_candles:
        # Kite returned zero candles across the requested window. Common for
        # G-secs and illiquid bonds — surface that explicitly so the caller can
        # list them separately from outright failures.
        return {
            "rows_added": 0,
            "latest_price_date": latest_stored.isoformat() if latest_stored else None,
            "no_data": latest_stored is None,
        }

    stmt = pg_insert(PriceHistory).values(
        [
            {
                "instrument_id": instrument.id,
                "price_date": c["date"],
                "open": c.get("open"),
                "high": c.get("high"),
                "low": c.get("low"),
                "close": c["close"],
            }
            for c in all_candles
        ]
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["instrument_id", "price_date"],
        set_={
            "open": stmt.excluded.open,
            "high": stmt.excluded.high,
            "low": stmt.excluded.low,
            "close": stmt.excluded.close,
        },
    )
    result = await db.execute(stmt)
    rows_added = result.rowcount or 0

    newest = max(all_candles, key=lambda c: c["date"])
    return {"rows_added": rows_added, "latest_price_date": newest["date"].isoformat()}


async def sync_price_history(db: AsyncSession, on_progress=None) -> dict:
    """Main entry point. Covers every STOCK/BOND the user has ever traded (not
    just current holdings). Resolves any missing tokens, then fetches history
    sequentially (Kite historical = 3 req/s).

    If `on_progress` is provided, it's called with a string message after each
    instrument completes — used for SSE streaming."""
    _cancel_event.clear()
    config = await _get_config(db)
    _assert_token_valid(config)

    if on_progress:
        await on_progress("Resolving instrument tokens…")

    resolved = await resolve_instrument_tokens(db)

    if on_progress and resolved["resolved"]:
        await on_progress(f"Resolved {resolved['resolved']} new token(s)")

    traded_ids = select(Trade.instrument_id).distinct()
    result = await db.execute(
        select(Instrument)
        .where(Instrument.id.in_(traded_ids))
        .where(Instrument.instrument_type.in_(EQUITY_TYPES))
    )
    instruments = list(result.scalars().all())

    if on_progress:
        await on_progress(f"Syncing {len(instruments)} instrument(s)…")

    per_instrument: list[dict] = []
    failed: list[str] = []
    no_data: list[str] = []
    total_rows_added = 0
    latest_price_date: date | None = None

    for idx, instr in enumerate(instruments, 1):
        if _cancel_event.is_set():
            if on_progress:
                await on_progress("⏹ Sync halted by user.")
            break

        sym = instr.tradingsymbol or "?"
        if not instr.kite_instrument_token:
            failed.append(f"{sym}: no Kite token (not found in instruments dump)")
            if on_progress:
                await on_progress(f"[{idx}/{len(instruments)}] {sym} — skipped (no token)")
            continue

        await asyncio.sleep(0.5)
        outcome = await _sync_one(db, config, instr, backfill_start=HISTORY_START)

        if outcome.get("error"):
            failed.append(f"{sym}: {outcome['error']}")
            if on_progress:
                await on_progress(f"[{idx}/{len(instruments)}] {sym} — error: {outcome['error']}")
            continue
        if outcome.get("no_data"):
            no_data.append(f"{sym} ({instr.instrument_type})")
            if on_progress:
                await on_progress(f"[{idx}/{len(instruments)}] {sym} — no data from Kite")
            continue

        total_rows_added += outcome["rows_added"]
        per_instrument.append({
            "symbol": sym,
            "rows_added": outcome["rows_added"],
            "latest_price_date": outcome["latest_price_date"],
        })
        if outcome["latest_price_date"]:
            d = date.fromisoformat(outcome["latest_price_date"])
            if latest_price_date is None or d > latest_price_date:
                latest_price_date = d

        if on_progress:
            msg = f"[{idx}/{len(instruments)}] {sym} — +{outcome['rows_added']} row(s)"
            if outcome["latest_price_date"]:
                msg += f" (latest: {outcome['latest_price_date']})"
            await on_progress(msg)

    await db.commit()

    try:
        from app.services.usdinr import refresh_usdinr_rate
        await refresh_usdinr_rate(db)
    except Exception:
        pass

    return {
        "instruments_synced": len(per_instrument),
        "rows_added": total_rows_added,
        "latest_price_date": latest_price_date.isoformat() if latest_price_date else None,
        "resolved_tokens": resolved["resolved"],
        "unresolved": resolved["unresolved"],
        "failed": failed,
        "no_data": no_data,
        "per_instrument": per_instrument,
    }


async def sync_index_history(db: AsyncSession, on_progress=None) -> dict:
    """Sync daily OHLC history for all INDEX instruments (Nifty 50, etc.).
    Separate from sync_price_history which only covers traded instruments."""
    config = await _get_config(db)
    _assert_token_valid(config)

    token_result = await resolve_index_tokens(db)
    if on_progress and token_result["resolved"]:
        await on_progress(f"Index tokens resolved: {token_result['resolved']} new")
    if on_progress and token_result["unresolved"]:
        await on_progress(f"Index tokens unresolved: {', '.join(token_result['unresolved'])}")

    instruments = await ensure_index_instruments(db)

    total_rows = 0
    instruments_synced = 0
    for idx, instr in enumerate(instruments, 1):
        if _cancel_event.is_set():
            if on_progress:
                await on_progress("⏹ Index sync halted by user.")
            break

        sym = instr.tradingsymbol or "?"
        if not instr.kite_instrument_token:
            if on_progress:
                await on_progress(f"[{idx}/{len(instruments)}] {sym} — skipped (no token)")
            continue

        await asyncio.sleep(0.5)
        outcome = await _sync_one(db, config, instr, backfill_start=HISTORY_START)

        if outcome.get("error"):
            if on_progress:
                await on_progress(f"[{idx}/{len(instruments)}] {sym} — error: {outcome['error']}")
            continue

        total_rows += outcome["rows_added"]
        instruments_synced += 1
        if on_progress:
            await on_progress(
                f"[{idx}/{len(instruments)}] {sym} — +{outcome['rows_added']} row(s)"
                + (f" (latest: {outcome['latest_price_date']})" if outcome.get("latest_price_date") else "")
            )

    await db.commit()
    return {"instruments_synced": instruments_synced, "rows_added": total_rows}


async def _resolve_ticker_token(
    instrument: Instrument,
) -> tuple[int | None, str | None]:
    """Return (token, error). If the instrument already has a cached token,
    use it; otherwise fetch Kite's dump and look up by (tradingsymbol, exchange)."""
    if instrument.kite_instrument_token:
        return instrument.kite_instrument_token, None

    dump = await kite_client.get_instruments_dump()
    sym = (instrument.tradingsymbol or "").strip()
    exch_pref = (instrument.exchange or "NSE").strip()
    by_key: dict[tuple[str, str], int] = {}
    for row in dump:
        tok = row.get("instrument_token")
        rsym = (row.get("tradingsymbol") or "").strip()
        rexch = (row.get("exchange") or "").strip()
        if not (tok and rsym and rexch):
            continue
        try:
            by_key[(rsym, rexch)] = int(tok)
        except ValueError:
            continue
    tok = by_key.get((sym, exch_pref)) or by_key.get((sym, "NSE")) or by_key.get((sym, "BSE"))
    if tok is None:
        return None, f"'{sym}' not found in Kite's instruments dump"
    return tok, None


async def fetch_ohlc_for_ticker(
    db: AsyncSession,
    *,
    ticker: str,
    start_date: date,
    end_date: date | None = None,
    skip_token_check: bool = False,
    on_progress=None,
) -> dict:
    """Fetch day candles from Kite for a single ticker between start_date and
    end_date (defaults to today) and write them to price_history. The ticker
    must belong to an Instrument the user has traded. Returns a result dict
    shaped for the kite_ohlc_fetch_status partial."""

    async def _progress(msg: str):
        if on_progress:
            await on_progress(msg)

    ticker_clean = (ticker or "").strip().upper()
    if not ticker_clean:
        return {"error": "Ticker is required"}
    end = end_date or date.today()
    if end < start_date:
        return {"error": f"End date {end} is before start date {start_date}"}

    # Pick the Instrument row: ticker must match, and it must have at least
    # one trade (so we don't build price history for random untracked symbols).
    traded_ids = select(Trade.instrument_id).distinct()
    candidates = list(
        (
            await db.execute(
                select(Instrument)
                .where(Instrument.id.in_(traded_ids))
                .where(func.upper(Instrument.tradingsymbol) == ticker_clean)
            )
        ).scalars().all()
    )
    if not candidates:
        return {
            "error": (
                f"No traded instrument found with ticker '{ticker_clean}'. "
                "Add a trade for this symbol first, or use manual CSV upload."
            )
        }
    # If multiple (e.g. NSE + BSE listings), pick the one with more trades.
    if len(candidates) > 1:
        trade_counts = {
            iid: n for iid, n in (
                await db.execute(
                    select(Trade.instrument_id, func.count())
                    .where(Trade.instrument_id.in_([c.id for c in candidates]))
                    .group_by(Trade.instrument_id)
                )
            ).all()
        }
        candidates.sort(key=lambda i: trade_counts.get(i.id, 0), reverse=True)
    instrument = candidates[0]
    await _progress(f"Instrument: {instrument.tradingsymbol} (id={instrument.id})")

    config = await _get_config(db)
    _assert_token_valid(config)

    # Resolve + cache the instrument_token.
    if instrument.kite_instrument_token and skip_token_check:
        token = instrument.kite_instrument_token
        await _progress(f"Using cached token {token} (dump check skipped)")
    else:
        if skip_token_check:
            await _progress("No cached token — falling back to Kite dump resolution…")
        else:
            await _progress("Resolving instrument token from Kite dump…")
        token, tok_err = await _resolve_ticker_token(instrument)
        if tok_err:
            return {"error": tok_err, "symbol": instrument.tradingsymbol}
        if not instrument.kite_instrument_token:
            instrument.kite_instrument_token = token
            await db.commit()
        await _progress(f"Token resolved: {token}")

    # Windowed fetch.
    all_candles: list[dict] = []
    cursor = start_date
    n_windows = max(1, (end - start_date).days // KITE_DAY_CANDLE_CAP + 1)
    win_idx = 0
    while cursor <= end:
        win_idx += 1
        window_end = min(cursor + timedelta(days=KITE_DAY_CANDLE_CAP - 1), end)
        await _progress(
            f"Fetching window {win_idx}/{n_windows}: {cursor} → {window_end}…"
        )
        try:
            chunk = await kite_client.get_historical_candles(
                config.api_key,
                config.access_token,
                token,
                cursor,
                window_end,
            )
        except (httpx.HTTPError, ValueError) as e:
            return {
                "error": f"Kite fetch failed: {e}",
                "symbol": instrument.tradingsymbol,
                "requested_start": start_date.isoformat(),
                "requested_end": end.isoformat(),
            }
        await _progress(f"  → {len(chunk)} candle(s) received")
        all_candles.extend(chunk)
        cursor = window_end + timedelta(days=1)

    if not all_candles:
        return {
            "symbol": instrument.tradingsymbol,
            "isin": instrument.isin,
            "requested_start": start_date.isoformat(),
            "requested_end": end.isoformat(),
            "rows_added": 0,
            "rows_in_response": 0,
            "actual_start": None,
            "actual_end": None,
            "no_data": True,
        }

    stmt = pg_insert(PriceHistory).values(
        [
            {
                "instrument_id": instrument.id,
                "price_date": c["date"],
                "open": c.get("open"),
                "high": c.get("high"),
                "low": c.get("low"),
                "close": c["close"],
            }
            for c in all_candles
        ]
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["instrument_id", "price_date"],
        set_={
            "open": stmt.excluded.open,
            "high": stmt.excluded.high,
            "low": stmt.excluded.low,
            "close": stmt.excluded.close,
        },
    )
    result = await db.execute(stmt)
    rows_added = result.rowcount or 0
    await db.commit()

    dates = [c["date"] for c in all_candles]
    return {
        "symbol": instrument.tradingsymbol,
        "isin": instrument.isin,
        "requested_start": start_date.isoformat(),
        "requested_end": end.isoformat(),
        "rows_added": rows_added,
        "rows_in_response": len(all_candles),
        "actual_start": min(dates).isoformat(),
        "actual_end": max(dates).isoformat(),
        "no_data": False,
    }
