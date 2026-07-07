"""
One-time script to fetch real OHLC and NAV data for demo fixtures.
Saves JSON to data/demo/ohlc/<SYMBOL>.json and data/demo/nav/<ISIN>.json.

Stock/index OHLC: Yahoo Finance via yfinance (falls back to synthetic random walk
if Yahoo is unreachable). MF/ETF NAV: mfapi.in (same source the app uses).

Re-run to refresh (e.g. to extend the date range).

Usage:
    source venv/bin/activate
    python scripts/fetch_demo_data.py
"""

import json
import math
import os
import random
import time
from datetime import date, timedelta

import requests

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OHLC_DIR = os.path.join(REPO_ROOT, "data", "demo", "ohlc")
NAV_DIR = os.path.join(REPO_ROOT, "data", "demo", "nav")

os.makedirs(OHLC_DIR, exist_ok=True)
os.makedirs(NAV_DIR, exist_ok=True)

END = date.today()
START = END - timedelta(days=730)

# symbol → (yfinance_ticker, base_price, annual_drift, annual_vol, seed)
STOCK_CONFIG = {
    "RELIANCE":   ("RELIANCE.NS",   2400, 0.12, 0.22, 1),
    "HDFCBANK":   ("HDFCBANK.NS",   1550, 0.08, 0.18, 2),
    "INFY":       ("INFY.NS",       1400, 0.10, 0.20, 3),
    "PERSISTENT": ("PERSISTENT.NS", 4200, 0.28, 0.30, 4),
    "CDSL":       ("CDSL.NS",       1600, 0.20, 0.28, 5),
    "TATAELXSI":  ("TATAELXSI.NS",  6800, 0.15, 0.32, 6),
}

INDEX_CONFIG = {
    "NIFTY50":        ("^NSEI",               19000, 0.14, 0.14, 10),
    "NIFTYNXT50":     ("^NSMIDCP",            44000, 0.16, 0.16, 11),
    "NIFTYMIDCAP150": ("NIFTY_MIDCAP_150.NS", 13500, 0.18, 0.17, 12),
    "NIFTYSMLCAP250": ("NIFTY_SMLCAP_250.NS",  9000, 0.20, 0.20, 13),
    "INDIAVIX":       ("^INDIAVIX",              13, -0.05, 0.40, 14),
}

MF_NAV = {
    "INF789F01YN0": "120716",   # UTI Nifty 50 Index Fund - Direct Growth
    "INF174KA1CK2": "120244",   # Kotak Emerging Equity - Direct Growth
    "INF247L01AP3": "118834",   # Motilal Oswal Nasdaq 100 - Direct Growth
    "INF204KB17I5": "135798",   # Nippon Gold ETF
    "INF109KC1Y56": "148469",   # Nippon Silver ETF
}

# Indian market holidays (approximate, just to skip obvious ones)
_HOLIDAYS = {
    date(2024, 1, 26), date(2024, 3, 25), date(2024, 4, 14), date(2024, 4, 17),
    date(2024, 5, 23), date(2024, 6, 17), date(2024, 8, 15), date(2024, 10, 2),
    date(2024, 10, 24), date(2024, 11, 1), date(2024, 11, 15), date(2024, 12, 25),
    date(2025, 1, 26), date(2025, 2, 26), date(2025, 3, 14), date(2025, 3, 31),
    date(2025, 4, 14), date(2025, 4, 18), date(2025, 5, 1), date(2025, 6, 7),
    date(2025, 8, 15), date(2025, 8, 27), date(2025, 10, 2), date(2025, 10, 21),
    date(2025, 11, 5), date(2025, 12, 25),
}


def _trading_days(start: date, end: date) -> list[date]:
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5 and d not in _HOLIDAYS:
            days.append(d)
        d += timedelta(days=1)
    return days


def _synthetic_ohlc(symbol: str, base: float, annual_drift: float, annual_vol: float, seed: int) -> list[dict]:
    rng = random.Random(seed)
    days = _trading_days(START, END)
    dt_daily = 1 / 252
    close = base
    rows = []
    for d in days:
        # Geometric Brownian Motion step
        z = rng.gauss(0, 1)
        ret = (annual_drift - 0.5 * annual_vol ** 2) * dt_daily + annual_vol * math.sqrt(dt_daily) * z
        prev_close = close
        close = max(prev_close * math.exp(ret), 1.0)
        # Intraday range
        gap = prev_close * rng.uniform(-0.005, 0.005)
        open_ = round(prev_close + gap, 2)
        wick_range = abs(close - open_) * rng.uniform(0.3, 1.2)
        high = round(max(open_, close) + wick_range * rng.uniform(0.2, 0.8), 2)
        low = round(min(open_, close) - wick_range * rng.uniform(0.2, 0.8), 2)
        low = max(low, 1.0)
        rows.append({"date": d.strftime("%Y-%m-%d"), "open": open_, "high": high, "low": low, "close": round(close, 2)})
    return rows


def fetch_ohlc_yahoo(symbol: str, ticker: str, base: float, drift: float, vol: float, seed: int):
    print(f"  {symbol}: trying Yahoo Finance ({ticker})...")
    try:
        import yfinance as yf
        df = yf.download(ticker, start=str(START), end=str(END), interval="1d", auto_adjust=True, progress=False)
        if df.empty:
            raise ValueError("empty response")
        rows = []
        for dt, row in df.iterrows():
            def get(col):
                try:
                    v = row[col]
                    return round(float(v.item() if hasattr(v, "item") else v), 4)
                except Exception:
                    return None
            o, h, l, c = get("Open"), get("High"), get("Low"), get("Close")
            if c is None:
                continue
            rows.append({"date": dt.strftime("%Y-%m-%d"), "open": o, "high": h, "low": l, "close": c})
        path = os.path.join(OHLC_DIR, f"{symbol}.json")
        with open(path, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"    Saved {len(rows)} rows from Yahoo → {path}")
        return
    except Exception as e:
        print(f"    Yahoo failed ({e}), generating synthetic OHLC...")

    rows = _synthetic_ohlc(symbol, base, drift, vol, seed)
    path = os.path.join(OHLC_DIR, f"{symbol}.json")
    with open(path, "w") as f:
        json.dump(rows, f, indent=2)
    print(f"    Saved {len(rows)} synthetic rows → {path}")


def fetch_nav(isin: str, amfi_code: str):
    print(f"  Fetching NAV {isin} (mfapi code {amfi_code})...")
    try:
        url = f"https://api.mfapi.in/mf/{amfi_code}"
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        rows = []
        cutoff = START
        for entry in data.get("data", []):
            try:
                parts = entry["date"].split("-")
                d = date(int(parts[2]), int(parts[1]), int(parts[0]))
                if d < cutoff:
                    continue
                rows.append({"date": d.strftime("%Y-%m-%d"), "nav": round(float(entry["nav"]), 4)})
            except Exception:
                continue
        rows.sort(key=lambda x: x["date"])
        path = os.path.join(NAV_DIR, f"{isin}.json")
        with open(path, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"    Saved {len(rows)} rows → {path}")
        time.sleep(0.5)
    except Exception as e:
        print(f"    ERROR: {e}")


if __name__ == "__main__":
    print("Fetching stock OHLC...")
    for sym, (tick, base, drift, vol, seed) in STOCK_CONFIG.items():
        fetch_ohlc_yahoo(sym, tick, base, drift, vol, seed)

    print("\nFetching index OHLC...")
    for sym, (tick, base, drift, vol, seed) in INDEX_CONFIG.items():
        fetch_ohlc_yahoo(sym, tick, base, drift, vol, seed)

    print("\nFetching MF/ETF NAVs from mfapi.in...")
    for isin, code in MF_NAV.items():
        fetch_nav(isin, code)

    print("\nDone.")
