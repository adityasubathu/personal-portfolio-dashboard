"""
Thin async Kite Connect client using httpx.
Handles auth token exchange and data fetching only.
No business logic here.
"""
import asyncio
import csv
import hashlib
import io
from datetime import date, datetime

import httpx

MAX_RETRIES = 5
BACKOFF_BASE = 2.0  # seconds; doubles each retry

KITE_BASE = "https://api.kite.trade"
KITE_LOGIN = "https://kite.zerodha.com/connect/login?v=3&api_key={api_key}"


def login_url(api_key: str) -> str:
    return KITE_LOGIN.format(api_key=api_key)


async def exchange_token(api_key: str, api_secret: str, request_token: str) -> str:
    """Exchange request_token for access_token. Returns access_token string."""
    checksum = hashlib.sha256(
        (api_key + request_token + api_secret).encode("utf-8")
    ).hexdigest()

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{KITE_BASE}/session/token",
            data={
                "api_key": api_key,
                "request_token": request_token,
                "checksum": checksum,
            },
            headers={"X-Kite-Version": "3"},
        )
        resp.raise_for_status()
        data = resp.json()

    if data.get("status") != "success":
        raise ValueError(f"Kite token exchange failed: {data.get('message', data)}")

    return data["data"]["access_token"]


def _auth_headers(api_key: str, access_token: str) -> dict:
    return {
        "X-Kite-Version": "3",
        "Authorization": f"token {api_key}:{access_token}",
    }


async def get_holdings(api_key: str, access_token: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{KITE_BASE}/portfolio/holdings",
            headers=_auth_headers(api_key, access_token),
        )
        resp.raise_for_status()
        data = resp.json()

    if data.get("status") != "success":
        raise ValueError(f"Kite holdings fetch failed: {data.get('message', data)}")

    return data["data"]


async def get_positions(api_key: str, access_token: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{KITE_BASE}/portfolio/positions",
            headers=_auth_headers(api_key, access_token),
        )
        resp.raise_for_status()
        data = resp.json()

    if data.get("status") != "success":
        raise ValueError(f"Kite positions fetch failed: {data.get('message', data)}")

    # Kite returns {"net": [...], "day": [...]} — we want net positions
    return data["data"].get("net", [])


async def get_instruments_dump() -> list[dict]:
    """Fetch Kite's full instruments CSV. ~100k rows, no auth required.
    Columns: instrument_token, exchange_token, tradingsymbol, name, last_price,
    expiry, strike, tick_size, lot_size, instrument_type, segment, exchange."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(f"{KITE_BASE}/instruments")
        resp.raise_for_status()
        text = resp.text

    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


async def get_historical_candles(
    api_key: str,
    access_token: str,
    instrument_token: int,
    from_date: date,
    to_date: date,
    interval: str = "day",
) -> list[dict]:
    """Fetch OHLC candles for a given instrument_token. Requires historical
    data permission on the Kite Connect app. Kite caps `day` at ~2000 candles
    per request; callers should window longer spans.
    Retries with exponential backoff on 429 rate-limit responses."""
    params = {
        "from": from_date.isoformat(),
        "to": to_date.isoformat(),
    }
    url = f"{KITE_BASE}/instruments/historical/{instrument_token}/{interval}"
    headers = _auth_headers(api_key, access_token)

    resp = None
    for attempt in range(MAX_RETRIES):
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers=headers, params=params)
        if resp.status_code != 429:
            break
        wait = BACKOFF_BASE * (2 ** attempt)
        await asyncio.sleep(wait)

    resp.raise_for_status()
    data = resp.json()

    if data.get("status") != "success":
        raise ValueError(f"Kite historical fetch failed: {data.get('message', data)}")

    out: list[dict] = []
    for candle in data["data"].get("candles", []):
        # [ts, open, high, low, close, volume, (oi)]
        ts_str = candle[0]
        try:
            ts = datetime.fromisoformat(ts_str)
        except ValueError:
            continue
        out.append({
            "date": ts.date(),
            "open": float(candle[1]),
            "high": float(candle[2]),
            "low": float(candle[3]),
            "close": float(candle[4]),
            "volume": int(candle[5]) if len(candle) > 5 else 0,
        })
    return out
