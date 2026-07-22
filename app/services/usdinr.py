"""
USDINR exchange rate service.

Fetches the live rate from the near-month USDINR futures contract on Kite's CDS
segment, persists it in app_config, and exposes a read function that works without
a live Kite session (returns the last stored value).
"""
import json
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_config import AppConfig
from app.services import kite_client
from app.services.kite_sync import assert_token_valid, get_config
from app.time_util import now_ist

_APP_CONFIG_KEY = "usdinr_rate"
_USDINR_SYMBOL_RE = re.compile(r"^USDINR\d", re.IGNORECASE)
_DEFAULT_RATE = 85.0


async def _resolve_near_month_symbol() -> str | None:
    """Find the nearest non-expired USDINR futures tradingsymbol from Kite's instruments dump."""
    try:
        instruments = await kite_client.get_instruments_dump()
    except Exception:
        return None

    candidates = []
    today = datetime.utcnow().date()
    for row in instruments:
        if row.get("exchange") != "CDS":
            continue
        if row.get("instrument_type") != "FUT":
            continue
        sym = row.get("tradingsymbol", "")
        if not _USDINR_SYMBOL_RE.match(sym):
            continue
        expiry_raw = row.get("expiry", "")
        try:
            expiry = datetime.strptime(expiry_raw, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            continue
        if expiry >= today:
            candidates.append((expiry, sym))

    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


async def refresh_usdinr_rate(db: AsyncSession) -> dict:
    """Fetch live USDINR rate from Kite CDS and persist it. Returns the rate dict.
    Raises on auth or resolution failure; callers treat this as best-effort."""
    config = await get_config(db)
    assert_token_valid(config)

    symbol = await _resolve_near_month_symbol()
    if symbol is None:
        raise ValueError("Could not resolve near-month USDINR futures symbol from Kite instruments dump")

    instrument_key = f"CDS:{symbol}"
    ltp_result = await kite_client.get_ltp(config.api_key, config.access_token, [instrument_key])

    if instrument_key not in ltp_result:
        raise ValueError(f"Kite did not return a quote for {instrument_key}")

    rate, _ = ltp_result[instrument_key]
    fetched_at = now_ist().isoformat()
    payload = {"rate": rate, "source": instrument_key, "fetched_at": fetched_at}

    stmt = pg_insert(AppConfig).values(key=_APP_CONFIG_KEY, value_json=json.dumps(payload))
    await db.execute(stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value_json": stmt.excluded.value_json},
    ))
    await db.commit()

    return payload


async def get_usdinr_rate(db: AsyncSession) -> float:
    """Return the stored USDINR rate. Falls back to default if not yet fetched."""
    row = (await db.execute(
        select(AppConfig).where(AppConfig.key == _APP_CONFIG_KEY)
    )).scalar_one_or_none()

    if row and row.value_json:
        try:
            return float(json.loads(row.value_json)["rate"])
        except (KeyError, ValueError, TypeError):
            pass
    return _DEFAULT_RATE


async def get_usdinr_info(db: AsyncSession) -> dict:
    """Return the full stored rate payload (rate, source, fetched_at). Defaults if missing."""
    row = (await db.execute(
        select(AppConfig).where(AppConfig.key == _APP_CONFIG_KEY)
    )).scalar_one_or_none()

    if row and row.value_json:
        try:
            return json.loads(row.value_json)
        except (ValueError, TypeError):
            pass
    return {"rate": _DEFAULT_RATE, "source": None, "fetched_at": None}


async def set_usdinr_rate_manual(db: AsyncSession, rate: float) -> dict:
    """Persist a manually entered USDINR rate."""
    payload = {"rate": rate, "source": "manual", "fetched_at": now_ist().isoformat()}
    stmt = pg_insert(AppConfig).values(key=_APP_CONFIG_KEY, value_json=json.dumps(payload))
    await db.execute(stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value_json": stmt.excluded.value_json},
    ))
    await db.commit()
    return payload
