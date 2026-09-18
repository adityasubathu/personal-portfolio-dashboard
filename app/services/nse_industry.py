"""NSE industry classification — the only module that knows NSE's HTTP surface.

NSE publishes a four-level taxonomy: Macro-Economic Sector -> Sector -> Industry
-> Basic Industry. This module fetches it per stock and hands the rest of the app
plain strings, keyed by ISIN.

Two NSE surfaces are used:
  * the equity master CSV, as an in-memory ISIN -> symbol index
  * the per-symbol quote API, for the classification itself

The quote API is addressed by symbol because that is the only key it accepts, but
the ISIN in every response is verified against the one we looked the symbol up by,
so ISIN stays the identity end to end.

Both are website endpoints rather than contracted APIs. Keep every URL, header and
response-shape assumption in this file so a future NSE change is one module to fix.
"""
import asyncio
import csv
import io

import httpx

EQUITY_MASTER_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
QUOTE_API_URL = "https://www.nseindia.com/api/NextApi/apiClient/GetQuoteApi"

# NSE serves the quote API to anything with a browser User-Agent — no cookies, no
# session warm-up, no Referer. With no User-Agent the request hangs until timeout.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

ALLOWED_SERIES = {"EQ", "BE", "BZ"}
NSE_REQUEST_DELAY_SECONDS = 0.4
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (0, 2, 5)

CLASSIFICATION_LEVELS = ("macro_sector", "sector", "industry", "basic_industry")

STATUS_CLASSIFIED = "CLASSIFIED"
STATUS_UNCLASSIFIED = "UNCLASSIFIED"
STATUS_API_ERROR = "API_ERROR"
STATUS_ISIN_MISMATCH = "ISIN_MISMATCH"


def _read_csv(payload: bytes) -> list[dict]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = payload.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    reader.fieldnames = [f.strip() for f in reader.fieldnames]
    return [{k: (v or "").strip() for k, v in row.items() if k} for row in reader]


def parse_equity_master(payload: bytes) -> dict[str, dict]:
    """Returns {isin: {symbol, company_name, series}} for tradable equities.

    NSE's header row carries leading spaces (" SERIES", " ISIN NUMBER"), hence the
    fieldname strip in _read_csv. The ISIN prefix check also drops NSE's DUM*
    placeholder rows, which stand in for securities under corporate action.
    """
    index: dict[str, dict] = {}
    for row in _read_csv(payload):
        series = row.get("SERIES", "")
        isin = row.get("ISIN NUMBER", "")
        symbol = row.get("SYMBOL", "")
        if series not in ALLOWED_SERIES or not symbol or not isin.startswith("IN"):
            continue
        index.setdefault(
            isin,
            {"symbol": symbol, "company_name": row.get("NAME OF COMPANY", ""), "series": series},
        )
    return index


def extract_classification(payload: dict) -> dict:
    """Pulls the four levels plus identity out of a getSymbolData response.

    NSE nests these under equityResponse[0]. Note secInfo.industryInfo is a plain
    string holding the Industry level, not an object.
    """
    entry = (payload.get("equityResponse") or [{}])[0] or {}
    sec = entry.get("secInfo") or {}
    meta = entry.get("metaData") or {}
    return {
        "macro_sector": (sec.get("macro") or "").strip() or None,
        "sector": (sec.get("sector") or "").strip() or None,
        "industry": (sec.get("industryInfo") or "").strip() or None,
        "basic_industry": (sec.get("basicIndustry") or "").strip() or None,
        "isin": (meta.get("isinCode") or "").strip() or None,
        "company_name": (meta.get("companyName") or "").strip() or None,
    }


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=30,
        follow_redirects=True,
        headers={"User-Agent": BROWSER_UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"},
    )


async def fetch_equity_master(client: httpx.AsyncClient) -> dict[str, dict]:
    response = await client.get(EQUITY_MASTER_URL)
    response.raise_for_status()
    return parse_equity_master(response.content)


async def fetch_classification(client: httpx.AsyncClient, symbol: str) -> tuple[dict | None, str | None]:
    """Returns (classification, error). Exactly one is non-None.

    A 404 means NSE does not know the symbol — final, not retried. Everything else
    gets bounded retries with backoff; NSE throttling shows up as 401/403/429.
    """
    last_error = "unknown error"
    for attempt in range(MAX_ATTEMPTS):
        if BACKOFF_SECONDS[attempt]:
            await asyncio.sleep(BACKOFF_SECONDS[attempt])
        try:
            response = await client.get(
                QUOTE_API_URL,
                params={
                    "functionName": "getSymbolData",
                    "marketType": "N",
                    "series": "EQ",
                    "symbol": symbol,
                },
            )
        except httpx.HTTPError as exc:
            last_error = repr(exc)
            continue
        if response.status_code == 404:
            return None, "symbol not found on NSE"
        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}"
            continue
        try:
            return extract_classification(response.json()), None
        except ValueError as exc:
            last_error = f"malformed response: {exc}"
    return None, last_error
