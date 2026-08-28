"""
Composite sentiment functions and API-facing service functions for Nifty 50 / Nifty 500.
All computation is on-request (vectorized pandas over ~1,600 rows is fast enough).
"""
import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.price_history import PriceHistory
from app.services import market_indicators as mi


async def _load_index_df(db: AsyncSession, tradingsymbol: str) -> pd.DataFrame | None:
    result = await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == tradingsymbol,
            Instrument.instrument_type == "INDEX",
        )
    )
    instrument = result.scalar_one_or_none()
    if instrument is None:
        return None

    rows = (await db.execute(
        select(PriceHistory)
        .where(PriceHistory.instrument_id == instrument.id)
        .order_by(PriceHistory.price_date)
    )).scalars().all()

    if not rows:
        return None

    df = pd.DataFrame(
        [{'close': float(r.close)} for r in rows],
        index=pd.to_datetime([r.price_date for r in rows]),
    )
    return df.sort_index()


async def _load_ohlc_df(db: AsyncSession, tradingsymbol: str) -> pd.DataFrame | None:
    result = await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == tradingsymbol,
            Instrument.instrument_type == "INDEX",
        )
    )
    instrument = result.scalar_one_or_none()
    if instrument is None:
        return None

    rows = (await db.execute(
        select(PriceHistory)
        .where(PriceHistory.instrument_id == instrument.id)
        .order_by(PriceHistory.price_date)
    )).scalars().all()

    if not rows:
        return None

    df = pd.DataFrame(
        [{
            'open': float(r.open or r.close),
            'high': float(r.high or r.close),
            'low': float(r.low or r.close),
            'close': float(r.close),
        } for r in rows],
        index=pd.to_datetime([r.price_date for r in rows]),
    )
    return df.sort_index()


def _vix_short(vix: pd.DataFrame) -> dict:
    """Short-term: VIX day-over-day % change and 5-day % change."""
    close = vix['close']
    day_chg = _safe((close.iloc[-1] / close.iloc[-2] - 1) * 100) if len(close) >= 2 else None
    chg_5d = _safe((close.iloc[-1] / close.iloc[-5] - 1) * 100) if len(close) >= 5 else None
    return {"vix_day_chg": day_chg, "vix_5d_chg": chg_5d, "vix_current": _safe(close.iloc[-1])}


def _vix_mid(vix: pd.DataFrame) -> dict:
    """Mid-term: VIX vs its 20-day SMA."""
    close = vix['close']
    sma20 = float(close.rolling(20).mean().iloc[-1])
    current = float(close.iloc[-1])
    vs_pct = _safe((current / sma20 - 1) * 100) if sma20 and not np.isnan(sma20) else None
    above = bool(current > sma20) if not np.isnan(sma20) else None
    return {"vix_current": _safe(current), "vix_sma20": _safe(sma20), "vix_vs_sma20_pct": vs_pct, "vix_above_sma20": above}


def _vix_long(vix: pd.DataFrame) -> dict:
    """Long-term: VIX percentile rank vs full history."""
    close = vix['close']
    current = float(close.iloc[-1])
    pct_rank = round(float((close < current).sum() / len(close) * 100), 1)
    return {"vix_current": _safe(current), "vix_pct_rank": pct_rank}


def _safe(val) -> float | None:
    if val is None:
        return None
    try:
        f = float(val)
        return round(f, 2) if not (np.isnan(f) or np.isinf(f)) else None
    except (TypeError, ValueError):
        return None


def _to_points(s: pd.Series, decimals: int = 2) -> list[dict]:
    out = []
    for dt, val in s.items():
        v = None
        if pd.notna(val) and not np.isinf(float(val) if pd.notna(val) else 0):
            v = round(float(val), decimals)
        out.append({'time': dt.strftime('%Y-%m-%d'), 'value': v})
    return out


# ── Per-horizon trend labels ──────────────────────────────────────────────────

def _short_trend(df: pd.DataFrame, rsi14: pd.Series, macd_df: pd.DataFrame) -> str:
    """Short-term trend from EMA20 + MACD + RSI."""
    close = df['close'].iloc[-1]
    e20 = mi.ema(df, 20).iloc[-1]
    hist = macd_df['histogram'].iloc[-1]
    rsi_val = rsi14.iloc[-1]

    score = sum([
        pd.notna(e20) and close > e20,
        pd.notna(hist) and hist > 0,
        pd.notna(rsi_val) and rsi_val > 50,
    ])
    return {3: "Bullish", 2: "Leaning Bullish", 1: "Leaning Bearish", 0: "Bearish"}[score]


def _mid_trend(df: pd.DataFrame, adx_df: pd.DataFrame) -> str:
    """Mid-term trend from SMA50/100 + DI direction."""
    close = df['close'].iloc[-1]
    s50 = mi.sma(df, 50).iloc[-1]
    s100 = mi.sma(df, 100).iloc[-1]
    plus_di = adx_df['plus_di'].iloc[-1]
    minus_di = adx_df['minus_di'].iloc[-1]

    score = sum([
        pd.notna(s50) and close > s50,
        pd.notna(s100) and close > s100,
        pd.notna(plus_di) and pd.notna(minus_di) and plus_di > minus_di,
    ])
    return {3: "Bullish", 2: "Leaning Bullish", 1: "Mixed", 0: "Bearish"}[score]


def _long_trend(df: pd.DataFrame) -> str:
    """Long-term trend from SMA200 + golden/death cross + 1yr return."""
    close = df['close'].iloc[-1]
    s200 = mi.sma(df, 200).iloc[-1]
    cross = mi.golden_death_cross(df)
    ret_1yr = mi.rolling_return(df, 252).iloc[-1]

    score = sum([
        pd.notna(s200) and close > s200,
        cross['cross_state'] == 'golden',
        pd.notna(ret_1yr) and ret_1yr > 0,
    ])
    return {3: "Strong Uptrend", 2: "Uptrend Bias", 1: "Mixed", 0: "Downtrend"}[score]


# ── Composite helpers ─────────────────────────────────────────────────────────

def _detect_ema_cross(ema9: pd.Series, ema20: pd.Series, lookback: int = 3) -> str | None:
    above = ema9 > ema20
    if len(above) < lookback + 1:
        return None
    recent = above.iloc[-(lookback + 1):]
    if not recent.iloc[0] and recent.iloc[-1]:
        return "bullish"
    if recent.iloc[0] and not recent.iloc[-1]:
        return "bearish"
    return None


def _vol_regime(df: pd.DataFrame) -> str:
    atr_pct = mi.atr(df)['atr_pct'].dropna()
    if atr_pct.empty:
        return "Normal"
    current = float(atr_pct.iloc[-1])
    pct = (atr_pct < current).sum() / len(atr_pct) * 100
    if pct < 33:
        return "Low"
    if pct < 66:
        return "Normal"
    if pct < 90:
        return "High"
    return "Elevated"


def _momentum_divergence(df: pd.DataFrame, rsi14: pd.Series, lookback: int = 20) -> bool:
    if len(df) < lookback + 2:
        return False
    price_tail = df['close'].tail(lookback)
    rsi_tail = rsi14.tail(lookback)
    price_new_high = df['close'].iloc[-1] >= price_tail.max()
    rsi_not_high = rsi14.iloc[-1] < rsi_tail.max()
    price_new_low = df['close'].iloc[-1] <= price_tail.min()
    rsi_not_low = rsi14.iloc[-1] > rsi_tail.min()
    return bool((price_new_high and rsi_not_high) or (price_new_low and rsi_not_low))


# ── Breadth composite helpers ─────────────────────────────────────────────────

def _breadth_regime(returns_5d: dict) -> str:
    def up(v): return v is not None and v > 0
    def dn(v): return v is not None and v < 0
    vals = list(returns_5d.values())
    if all(up(v) for v in vals):
        return "Broad Rally"
    if all(dn(v) for v in vals):
        return "Broad Selloff"
    if up(returns_5d['nifty50']) and dn(returns_5d['mid150']) and dn(returns_5d['small250']):
        return "Narrow Rally"
    if dn(returns_5d['nifty50']) and up(returns_5d['mid150']) and up(returns_5d['small250']):
        return "Narrow Selloff"
    return "Rotation"


def _relative_strength_order(returns_1m: dict) -> dict:
    labels = {'nifty50': 'Nifty50', 'next50': 'Next50', 'mid150': 'Mid150', 'small250': 'Small250'}
    sorted_keys = sorted(
        returns_1m.keys(),
        key=lambda k: returns_1m[k] if returns_1m[k] is not None else float('-inf'),
        reverse=True,
    )
    order_str = ' > '.join(labels[k] for k in sorted_keys)
    top2 = set(sorted_keys[:2])
    if top2 == {'small250', 'mid150'}:
        tone = 'risk_on'
    elif top2 == {'nifty50', 'next50'}:
        tone = 'risk_off'
    else:
        tone = 'mixed'
    return {'order': order_str, 'tone': tone}


def _segment_drawdown(dfs: dict) -> dict:
    result = {}
    for key, df in dfs.items():
        dd = mi.drawdown_from_recent_high(df, lookback=252)
        result[key] = _safe(dd.iloc[-1]) if not dd.empty else None
    n50_dd = result.get('nifty50') or 0.0
    s250_dd = result.get('small250') or 0.0
    result['stress_flag'] = bool(
        n50_dd != 0 and abs(s250_dd) > 5.0 and abs(s250_dd) > 2.5 * abs(n50_dd)
    )
    return result


# ── Sector trend scoring (close-only, no OHLC required) ─────────────────────

SECTOR_INDICES: list[tuple[str, str]] = [
    ("NIFTY AUTO",        "Auto"),
    ("NIFTY BANK",        "Bank"),
    ("NIFTY FIN SERVICE", "Fin Services"),
    ("NIFTY FMCG",        "FMCG"),
    ("NIFTY HEALTHCARE",  "Healthcare"),
    ("NIFTY IT",          "IT"),
    ("NIFTY MEDIA",       "Media"),
    ("NIFTY METAL",       "Metal"),
    ("NIFTY PHARMA",      "Pharma"),
    ("NIFTY PVT BANK",    "Pvt Bank"),
    ("NIFTY PSU BANK",    "PSU Bank"),
    ("NIFTY REALTY",      "Realty"),
    ("NIFTY CONSR DURBL", "Consumer Durables"),
    ("NIFTY OIL AND GAS", "Oil & Gas"),
    ("NIFTY MIDCAP 150",  "Midcap 150"),
    ("NIFTY SMLCAP 250",  "Smallcap 250"),
]
BENCHMARKS: list[tuple[str, str]] = [
    ("NIFTY 50",  "Nifty 50"),
    ("NIFTY 500", "Nifty 500"),
]
SENTIMENT_INDICES = {"nifty50": "NIFTY 50", "nifty500": "NIFTY 500"}


def _sector_short(df: pd.DataFrame) -> dict:
    close = float(df['close'].iloc[-1])
    e20 = mi.ema(df, 20).iloc[-1]
    rsi_val = mi.rsi(df).iloc[-1]
    ret_1m = mi.rolling_return(df, 21).iloc[-1]
    sig_ema20 = bool(pd.notna(e20) and close > float(e20))
    sig_rsi50 = bool(pd.notna(rsi_val) and float(rsi_val) > 50)
    sig_ret1m = bool(pd.notna(ret_1m) and float(ret_1m) > 0)
    score = sum([sig_ema20, sig_rsi50, sig_ret1m])
    return {
        "label": {3: "Bullish", 2: "Leaning Bullish", 1: "Leaning Bearish", 0: "Bearish"}[score],
        "signals": {"ema20": sig_ema20, "rsi50": sig_rsi50, "ret_1m": sig_ret1m},
    }


def _sector_mid(df: pd.DataFrame) -> dict:
    close = float(df['close'].iloc[-1])
    s50 = mi.sma(df, 50).iloc[-1]
    s100 = mi.sma(df, 100).iloc[-1]
    ret_3m = mi.rolling_return(df, 63).iloc[-1]
    sig_sma50 = bool(pd.notna(s50) and close > float(s50))
    sig_sma100 = bool(pd.notna(s100) and close > float(s100))
    sig_ret3m = bool(pd.notna(ret_3m) and float(ret_3m) > 0)
    score = sum([sig_sma50, sig_sma100, sig_ret3m])
    return {
        "label": {3: "Bullish", 2: "Leaning Bullish", 1: "Mixed", 0: "Bearish"}[score],
        "signals": {"sma50": sig_sma50, "sma100": sig_sma100, "ret_3m": sig_ret3m},
    }


def _sector_long(df: pd.DataFrame) -> dict:
    close = float(df['close'].iloc[-1])
    s200 = mi.sma(df, 200)
    s200_val = s200.iloc[-1]
    slope = mi.sma_slope(s200).iloc[-1]
    ret_1y = mi.rolling_return(df, 252).iloc[-1]
    sig_sma200 = bool(pd.notna(s200_val) and close > float(s200_val))
    sig_slope = slope == "rising"
    sig_ret1y = bool(pd.notna(ret_1y) and float(ret_1y) > 0)
    score = sum([sig_sma200, sig_slope, sig_ret1y])
    return {
        "label": {3: "Strong Uptrend", 2: "Uptrend Bias", 1: "Mixed", 0: "Downtrend"}[score],
        "signals": {"sma200": sig_sma200, "sma200_slope": sig_slope, "ret_1y": sig_ret1y},
    }


def _cagr(df: pd.DataFrame | None, years: int) -> float | None:
    if df is None or len(df) < 2:
        return None
    end = df.index[-1]
    target_start = end - pd.DateOffset(years=years)
    candidates = df[df.index >= target_start]
    if candidates.empty:
        return None
    actual_years = (end - candidates.index[0]).days / 365.25
    if actual_years < years * 0.75:
        return None
    start_price = float(candidates['close'].iloc[0])
    end_price = float(df['close'].iloc[-1])
    if start_price <= 0:
        return None
    return round(((end_price / start_price) ** (1.0 / actual_years) - 1) * 100, 1)


# ── API-facing functions ──────────────────────────────────────────────────────

async def get_sentiment_summary(db: AsyncSession, symbol: str = "NIFTY 50") -> dict:
    df = await _load_ohlc_df(db, symbol)
    if df is None or len(df) < 20:
        return {"no_data": True}

    rsi14 = mi.rsi(df)
    macd_df = mi.macd(df)
    adx_df = mi.adx(df)
    cross = mi.golden_death_cross(df)
    dd = mi.max_drawdown_and_underwater(df)
    vol_pct = mi.volatility_percentile(df)
    streak = int(mi.streaks(df).iloc[-1])
    gap = mi.gap_analysis(df)
    s200 = mi.sma(df, 200)
    s200_slope = mi.sma_slope(s200).iloc[-1]
    wrsi = mi.weekly_rsi(df)
    vol_reg = _vol_regime(df)
    bb = mi.bollinger(df)
    ema9 = mi.ema(df, 9)
    ema20 = mi.ema(df, 20)

    # Bollinger squeeze: bandwidth at 60-day low
    bb_bw = bb['bb_bw'].dropna()
    bb_squeeze = bool(len(bb_bw) >= 60 and bb_bw.iloc[-1] <= bb_bw.iloc[-60:].min())

    vix_df = await _load_index_df(db, "INDIA VIX")
    vix_short = _vix_short(vix_df) if vix_df is not None and len(vix_df) >= 5 else {}
    vix_mid = _vix_mid(vix_df) if vix_df is not None and len(vix_df) >= 20 else {}
    vix_long = _vix_long(vix_df) if vix_df is not None and len(vix_df) >= 2 else {}

    return {
        "as_of": df.index[-1].strftime('%Y-%m-%d'),
        "close": _safe(df['close'].iloc[-1]),
        "horizons": {
            "short": {
                "trend": _short_trend(df, rsi14, macd_df),
                "rsi14": _safe(rsi14.iloc[-1]),
                "macd_hist": _safe(macd_df['histogram'].iloc[-1]),
                "vol_regime": vol_reg,
                "vix": vix_short,
            },
            "mid": {
                "trend": _mid_trend(df, adx_df),
                "adx": _safe(adx_df['adx'].iloc[-1]),
                "weekly_rsi": _safe(wrsi.iloc[-1]),
                "vol_regime": vol_reg,
                "vix": vix_mid,
            },
            "long": {
                "trend": _long_trend(df),
                "sma200_slope": s200_slope,
                "drawdown_from_ath_pct": dd["current_drawdown"],
                "vol_percentile": vol_pct,
                "vix": vix_long,
            },
        },
        "flags": {
            "divergence": _momentum_divergence(df, rsi14),
            "cross_state": cross["cross_state"],
            "days_since_cross": cross["days_since_cross"],
            "streak": streak,
            "gap_pct": _safe(gap['gap_pct'].iloc[-1]),
            "rsi14": _safe(rsi14.iloc[-1]),
            "above_200dma": bool(pd.notna(s200.iloc[-1]) and df['close'].iloc[-1] > s200.iloc[-1]),
            "adx": _safe(adx_df['adx'].iloc[-1]),
            "bb_squeeze": bb_squeeze,
            "bb_pct_b": _safe(bb['bb_pct_b'].iloc[-1]),
            "ema_cross": _detect_ema_cross(ema9, ema20),
            "underwater_days": dd["underwater_days"],
            "vix_day_chg": vix_short.get("vix_day_chg"),
        },
    }


async def get_market_breadth(db: AsyncSession) -> dict:
    n50 = await _load_index_df(db, "NIFTY 50")
    nn50 = await _load_index_df(db, "NIFTY NEXT 50")
    mid150 = await _load_index_df(db, "NIFTY MIDCAP 150")
    sml250 = await _load_index_df(db, "NIFTY SMLCAP 250")

    dfs = {'nifty50': n50, 'next50': nn50, 'mid150': mid150, 'small250': sml250}
    if any(df is None or len(df) < 22 for df in dfs.values()):
        return {"no_data": True}

    returns_5d = {k: _safe(mi.rolling_return(df, 5).iloc[-1]) for k, df in dfs.items()}
    returns_1m = {k: _safe(mi.rolling_return(df, 21).iloc[-1]) for k, df in dfs.items()}
    drawdowns = _segment_drawdown(dfs)
    rs = _relative_strength_order(returns_1m)

    # Ratio chart — trailing 252 rows on the intersection of all four series
    combined = pd.DataFrame({
        'nifty50': n50['close'],
        'mid150': mid150['close'],
        'small250': sml250['close'],
    }).dropna().tail(252)

    mid_ratio = combined['mid150'] / combined['nifty50']
    small_ratio = combined['small250'] / combined['nifty50']
    mid_ratio = mid_ratio / mid_ratio.iloc[0] * 100
    small_ratio = small_ratio / small_ratio.iloc[0] * 100

    return {
        "as_of": combined.index[-1].strftime('%Y-%m-%d'),
        "regime": {
            "label": _breadth_regime(returns_5d),
            "returns_5d": returns_5d,
        },
        "relative_strength": {
            "order": rs['order'],
            "tone": rs['tone'],
            "returns_1m": returns_1m,
        },
        "drawdowns": drawdowns,
        "ratios": {
            "mid150_nifty50": _to_points(mid_ratio),
            "small250_nifty50": _to_points(small_ratio),
        },
    }


async def get_sentiment_series(db: AsyncSession, days: int, symbol: str = "NIFTY 50") -> dict:
    df = await _load_ohlc_df(db, symbol)
    if df is None or df.empty:
        return {"no_data": True}

    # Compute all indicators on full history for accuracy, then slice
    ema9 = mi.ema(df, 9)
    ema20 = mi.ema(df, 20)
    s50 = mi.sma(df, 50)
    s100 = mi.sma(df, 100)
    s200 = mi.sma(df, 200)
    bb = mi.bollinger(df)
    rsi14 = mi.rsi(df)
    rsi14_weekly = mi.weekly_rsi(df)
    macd_df = mi.macd(df)
    adx_df = mi.adx(df)
    atr_df = mi.atr(df)
    rv20 = mi.rolling_volatility(df, 20)
    rv60 = mi.rolling_volatility(df, 60)

    df_slice = df.tail(days) if days > 0 else df
    idx = df_slice.index

    def _s(series: pd.Series) -> list[dict]:
        return _to_points(series.reindex(idx))

    candles = [
        {
            'time': dt.strftime('%Y-%m-%d'),
            'open': round(row['open'], 2),
            'high': round(row['high'], 2),
            'low': round(row['low'], 2),
            'close': round(row['close'], 2),
        }
        for dt, row in df_slice.iterrows()
    ]

    return {
        "candles": candles,
        "overlays": {
            "ema9": _s(ema9),
            "ema20": _s(ema20),
            "sma50": _s(s50),
            "sma100": _s(s100),
            "sma200": _s(s200),
            "bb_upper": _s(bb['bb_upper']),
            "bb_mid": _s(bb['bb_mid']),
            "bb_lower": _s(bb['bb_lower']),
        },
        "oscillators": {
            "rsi14": _s(rsi14),
            "rsi14_weekly": _s(rsi14_weekly),
            "macd_hist": _s(macd_df['histogram']),
            "adx": _s(adx_df['adx']),
            "atr_pct": _s(atr_df['atr_pct']),
            "realized_vol_20": _s(rv20),
            "realized_vol_60": _s(rv60),
        },
    }


async def get_sector_trends(db: AsyncSession) -> dict:
    benchmark_dfs = {sym: await _load_index_df(db, sym) for sym, _ in BENCHMARKS}
    sector_dfs = {sym: await _load_index_df(db, sym) for sym, _ in SECTOR_INDICES}

    n50_df = benchmark_dfs.get("NIFTY 50")
    n500_df = benchmark_dfs.get("NIFTY 500")
    n50_cagr = {y: _cagr(n50_df, y) for y in (2, 5, 10)}
    n500_cagr = {y: _cagr(n500_df, y) for y in (2, 5, 10)}

    def _vs(index_cagr: float | None, base: float | None) -> float | None:
        if index_cagr is None or base is None:
            return None
        return round(index_cagr - base, 1)

    def _perf(df: pd.DataFrame | None, is_n50: bool = False, is_n500: bool = False) -> dict:
        c = {y: _cagr(df, y) for y in (2, 5, 10)}
        return {
            "cagr_2y": c[2], "cagr_5y": c[5], "cagr_10y": c[10],
            "vs_n50_2y":  None if is_n50  else _vs(c[2], n50_cagr[2]),
            "vs_n50_5y":  None if is_n50  else _vs(c[5], n50_cagr[5]),
            "vs_n50_10y": None if is_n50  else _vs(c[10], n50_cagr[10]),
            "vs_n500_2y":  None if is_n500 else _vs(c[2], n500_cagr[2]),
            "vs_n500_5y":  None if is_n500 else _vs(c[5], n500_cagr[5]),
            "vs_n500_10y": None if is_n500 else _vs(c[10], n500_cagr[10]),
        }

    def _trend(df: pd.DataFrame | None) -> dict | None:
        if df is None or len(df) < 21:
            return None
        return {
            "short": _sector_short(df),
            "mid": _sector_mid(df),
            "long": _sector_long(df),
        }

    rows: list[dict] = []

    for sym, label in BENCHMARKS:
        df = benchmark_dfs.get(sym)
        if df is None or len(df) < 5:
            continue
        rows.append({
            "symbol": sym, "label": label, "is_benchmark": True,
            "trend": _trend(df),
            "perf": _perf(df, is_n50=(sym == "NIFTY 50"), is_n500=(sym == "NIFTY 500")),
        })

    for sym, label in SECTOR_INDICES:
        df = sector_dfs.get(sym)
        if df is None or len(df) < 5:
            continue
        rows.append({
            "symbol": sym, "label": label, "is_benchmark": False,
            "trend": _trend(df),
            "perf": _perf(df),
        })

    if len(rows) < 2:
        return {"no_data": True}

    as_of = max(
        (df.index[-1].strftime('%Y-%m-%d')
         for df in [*benchmark_dfs.values(), *sector_dfs.values()]
         if df is not None and not df.empty),
        default=None,
    )
    return {"as_of": as_of, "rows": rows}
