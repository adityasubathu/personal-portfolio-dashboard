"""
Composite sentiment functions and API-facing service functions for Nifty 50.
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


async def _load_nifty_df(db: AsyncSession) -> pd.DataFrame | None:
    result = await db.execute(
        select(Instrument).where(
            Instrument.tradingsymbol == "NIFTY 50",
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


# ── API-facing functions ──────────────────────────────────────────────────────

async def get_sentiment_summary(db: AsyncSession) -> dict:
    df = await _load_nifty_df(db)
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
        },
    }


async def get_sentiment_series(db: AsyncSession, days: int) -> dict:
    df = await _load_nifty_df(db)
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
