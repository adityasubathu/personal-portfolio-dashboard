"""
Kite sync service.

Fetches holdings and positions from Kite, then:
  1. Upserts instrument records (fills in last_price, ensures isin/symbol present)
  2. Upserts holding records (sets last_price, unrealised_pnl, kite_synced=True)
     - Only updates price/pnl for holdings we already track via trades.
     - If Kite reports a holding not in our trades (e.g. transferred from another account),
       it is created as a Kite-only holding.
  3. Writes a KiteSyncLog entry.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.kite import KiteConfig, KiteSyncLog
from app.services import kite_client
from app.services.instrument_registry import find_or_create
from app.services.kite_reconcile import compute_discrepancies
from app.services.xirr import recompute_and_store_xirr
from app.time_util import now_ist


async def update_ltp(db: AsyncSession) -> dict:
    """Fetch live LTPs from Kite and update Holding.last_price / last_price_at."""
    config = await _get_config(db)
    _assert_token_valid(config)

    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    rows = result.all()

    # Only non-MF instruments with both exchange and tradingsymbol set
    eligible = [
        (h, instr) for h, instr in rows
        if instr.instrument_type != "MF"
        and instr.exchange
        and instr.tradingsymbol
    ]

    if not eligible:
        return {"updated": 0, "timestamp": now_ist().isoformat(), "errors": []}

    instruments = [f"{instr.exchange}:{instr.tradingsymbol}" for _, instr in eligible]
    key_to_holding = {f"{instr.exchange}:{instr.tradingsymbol}": h for h, instr in eligible}

    errors: list[str] = []
    ltp_map: dict[str, tuple[float, datetime | None]] = {}
    try:
        ltp_map = await kite_client.get_ltp(config.api_key, config.access_token, instruments)
    except Exception as e:
        errors.append(str(e))

    updated = 0
    fallback_ts = now_ist()
    for key, (price, ltt) in ltp_map.items():
        holding = key_to_holding.get(key)
        if holding:
            holding.last_price = price
            holding.last_price_at = ltt if ltt is not None else fallback_ts
            updated += 1

    await db.commit()
    await recompute_and_store_xirr(db)

    try:
        from app.services.usdinr import refresh_usdinr_rate
        await refresh_usdinr_rate(db)
    except Exception:
        pass

    return {"updated": updated, "timestamp": fallback_ts.isoformat(), "errors": errors}


async def sync(db: AsyncSession) -> dict:
    config = await _get_config(db)
    _assert_token_valid(config)

    holdings_data: list[dict] = []
    positions_data: list[dict] = []
    errors: list[str] = []

    try:
        holdings_data = await kite_client.get_holdings(config.api_key, config.access_token)
        positions_data = await kite_client.get_positions(config.api_key, config.access_token)
    except Exception as e:
        errors.append(f"equity: {e}")

    synced_at = now_ist()
    equity_ok = not any(e.startswith("equity:") for e in errors)

    discrepancies: list[dict] = []
    if equity_ok:
        discrepancies = await compute_discrepancies(db, kite_equity=holdings_data)

    if discrepancies:
        status = "MISMATCH"
        summary = _discrepancy_summary(discrepancies)
        log = KiteSyncLog(
            synced_at=synced_at,
            status=status,
            holdings_count=len(holdings_data),
            positions_count=len(positions_data),
            error_message=summary,
            access_token_hint=config.access_token[-6:] if config.access_token else None,
        )
        db.add(log)
        await db.commit()
        return {
            "synced_at": synced_at.isoformat(),
            "status": status,
            "holdings_count": log.holdings_count,
            "positions_count": log.positions_count,
            "error_message": summary,
            "discrepancies": discrepancies,
        }

    if holdings_data or positions_data:
        await _upsert_holdings(db, holdings_data, synced_at)
        await _upsert_positions(db, positions_data, synced_at)

    status = "SUCCESS" if equity_ok else "FAILED"

    log = KiteSyncLog(
        synced_at=synced_at,
        status=status,
        holdings_count=len(holdings_data),
        positions_count=len(positions_data),
        error_message="; ".join(errors) if errors else None,
        access_token_hint=config.access_token[-6:] if config.access_token else None,
    )
    db.add(log)
    await db.commit()
    await recompute_and_store_xirr(db)

    return {
        "synced_at": synced_at.isoformat(),
        "status": log.status,
        "holdings_count": log.holdings_count,
        "positions_count": log.positions_count,
        "error_message": log.error_message,
    }


def _discrepancy_summary(discrepancies: list[dict]) -> str:
    counts: dict[str, int] = {}
    for d in discrepancies:
        counts[d["kind"]] = counts.get(d["kind"], 0) + 1
    parts = []
    if counts.get("new_on_kite"):
        parts.append(f"{counts['new_on_kite']} new on Kite")
    if counts.get("missing_from_kite"):
        parts.append(f"{counts['missing_from_kite']} missing from Kite")
    if counts.get("quantity_mismatch"):
        parts.append(f"{counts['quantity_mismatch']} quantity mismatch(es)")
    return "Out of sync: " + ", ".join(parts)


async def _upsert_holdings(db: AsyncSession, holdings: list[dict], synced_at: datetime) -> None:
    for h in holdings:
        isin = h.get("isin") or None
        symbol = h.get("tradingsymbol", "")
        exchange = h.get("exchange", "NSE")
        last_price = float(h.get("last_price") or 0)
        pnl = float(h.get("pnl") or 0)
        quantity = float(h.get("quantity") or 0)
        avg_price = float(h.get("average_price") or 0)

        instrument = await find_or_create(
            db,
            isin=isin,
            tradingsymbol=symbol,
            exchange=exchange,
            instrument_type=_kite_instrument_type(h),
        )

        # Find or create holding
        result = await db.execute(
            select(Holding).where(Holding.instrument_id == instrument.id)
        )
        holding = result.scalar_one_or_none()

        if holding is None:
            # Kite-only holding (not in our trade CSV) — create it
            holding = Holding(
                instrument_id=instrument.id,
                quantity=quantity,
                average_price=avg_price,
                total_cost=round(quantity * avg_price, 6),
            )
            db.add(holding)

        holding.last_price = last_price
        holding.last_price_at = synced_at
        holding.unrealised_pnl = pnl
        holding.kite_synced = True
        holding.kite_synced_at = synced_at


async def _upsert_positions(db: AsyncSession, positions: list[dict], synced_at: datetime) -> None:
    """Update last_price for open intraday positions (quantity != 0)."""
    for p in positions:
        quantity = float(p.get("quantity") or 0)
        if quantity == 0:
            continue  # flat position, skip

        isin = p.get("isin") or None
        symbol = p.get("tradingsymbol", "")
        exchange = p.get("exchange", "NSE")
        last_price = float(p.get("last_price") or 0)

        instrument = await find_or_create(
            db,
            isin=isin,
            tradingsymbol=symbol,
            exchange=exchange,
            instrument_type="STOCK",
        )

        result = await db.execute(
            select(Holding).where(Holding.instrument_id == instrument.id)
        )
        holding = result.scalar_one_or_none()
        if holding:
            holding.last_price = last_price
            holding.last_price_at = synced_at


def _kite_instrument_type(h: dict) -> str:
    isin = h.get("isin", "") or ""
    if isin.startswith("INF"):
        return "ETF"  # ETF (exchange-traded MF unit)
    symbol = (h.get("tradingsymbol") or "").upper()
    # Sovereign Gold Bonds, GOI bonds — Kite returns symbols like SGBFEB32IV-GB, 734GS2064
    if symbol.startswith("SGB") or symbol.startswith("734") or symbol.endswith("-GB"):
        return "BOND"
    return "STOCK"


async def _get_config(db: AsyncSession) -> KiteConfig:
    result = await db.execute(select(KiteConfig).where(KiteConfig.id == 1))
    config = result.scalar_one_or_none()
    if not config:
        raise ValueError("Kite not configured. Add API key and secret first.")
    return config


def _assert_token_valid(config: KiteConfig) -> None:
    if not config.access_token:
        raise ValueError("No access token. Please log in via Kite.")
    if config.access_token_expiry:
        expiry = config.access_token_expiry
        if expiry.tzinfo is not None:
            expiry = expiry.replace(tzinfo=None)
        if now_ist() >= expiry:
            raise ValueError("Access token expired. Please log in via Kite again.")


def next_token_expiry() -> datetime:
    """Kite tokens expire at 06:00 IST next day. Stored as naive IST."""
    current = now_ist()
    next_6am = current.replace(hour=6, minute=0, second=0, microsecond=0)
    if current.hour >= 6:
        next_6am += timedelta(days=1)
    return next_6am
