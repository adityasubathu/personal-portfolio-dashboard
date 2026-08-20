"""
Pure indicator functions over a pandas DataFrame with columns:
  open, high, low, close  (float)
indexed by DatetimeIndex (daily, ascending, no forward-fill).

All functions return Series/DataFrames on the same index.
Warm-up windows produce NaN naturally — callers should tolerate them.
"""
import numpy as np
import pandas as pd


# ── Moving averages ───────────────────────────────────────────────────────────

def ema(df: pd.DataFrame, span: int) -> pd.Series:
    return df['close'].ewm(span=span, adjust=False).mean()


def sma(df: pd.DataFrame, window: int) -> pd.Series:
    return df['close'].rolling(window).mean()


def sma_slope(sma_series: pd.Series, lookback: int = 5) -> pd.Series:
    """Classify SMA slope: 'rising' / 'flat' / 'falling' (threshold ±0.05%/day)."""
    pct_per_day = sma_series.pct_change(lookback) / lookback * 100

    def _classify(x):
        if pd.isna(x):
            return None
        if x > 0.05:
            return "rising"
        if x < -0.05:
            return "falling"
        return "flat"

    return pct_per_day.apply(_classify)


# ── Momentum ──────────────────────────────────────────────────────────────────

def rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """RSI with Wilder's smoothing (EWM alpha=1/period)."""
    delta = df['close'].diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def macd(df: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    fast_ema = df['close'].ewm(span=fast, adjust=False).mean()
    slow_ema = df['close'].ewm(span=slow, adjust=False).mean()
    macd_line = fast_ema - slow_ema
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame({
        'macd_line': macd_line,
        'signal_line': signal_line,
        'histogram': macd_line - signal_line,
    })


def weekly_rsi(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """RSI on weekly (Fri) closes, mapped back onto the daily index by the
    calendar week each day falls in.

    The current (in-progress) week's bucket is labeled with a future Friday,
    so a plain reindex(method='ffill') can't reach that label until the
    Friday actually arrives — every day mid-week would keep showing last
    week's already-completed RSI instead of the live in-progress value.
    Mapping by week membership (not by comparing dates) fixes that.
    """
    weekly = df['close'].resample('W-FRI').last().dropna()
    wrsi = rsi(pd.DataFrame({'close': weekly}), period)
    wrsi_by_week = wrsi.copy()
    wrsi_by_week.index = wrsi_by_week.index.to_period('W-FRI')
    mapped = df.index.to_period('W-FRI').map(wrsi_by_week)
    return pd.Series(mapped, index=df.index, dtype=float)


def streaks(df: pd.DataFrame) -> pd.Series:
    """Consecutive up/down day count at each bar. Positive=up, negative=down."""
    result = pd.Series(0, index=df.index, dtype=int)
    streak = 0
    prev = None
    for idx, row in df.iterrows():
        c = row['close']
        if prev is not None:
            if c > prev:
                streak = streak + 1 if streak > 0 else 1
            elif c < prev:
                streak = streak - 1 if streak < 0 else -1
            else:
                streak = 0
        result[idx] = streak
        prev = c
    return result


# ── Trend / directional ───────────────────────────────────────────────────────

def adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """Standard ADX, DI+, DI-."""
    high = df['high']
    low = df['low']
    prev_high = high.shift(1)
    prev_low = low.shift(1)
    prev_close = df['close'].shift(1)

    plus_dm = (high - prev_high).clip(lower=0).copy()
    minus_dm = (prev_low - low).clip(lower=0).copy()
    both = (plus_dm > 0) & (minus_dm > 0)
    plus_dm[both & (minus_dm >= plus_dm)] = 0.0
    minus_dm[both & (plus_dm > minus_dm)] = 0.0

    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)

    alpha = 1 / period
    tr14 = tr.ewm(alpha=alpha, adjust=False).mean()
    plus_di = 100 * plus_dm.ewm(alpha=alpha, adjust=False).mean() / tr14
    minus_di = 100 * minus_dm.ewm(alpha=alpha, adjust=False).mean() / tr14

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / di_sum
    adx_val = dx.ewm(alpha=alpha, adjust=False).mean()

    return pd.DataFrame({'adx': adx_val, 'plus_di': plus_di, 'minus_di': minus_di})


def golden_death_cross(df: pd.DataFrame) -> dict:
    """SMA50 vs SMA200 cross state and days since last crossover."""
    s50 = sma(df, 50)
    s200 = sma(df, 200)
    valid = s50.notna() & s200.notna()
    if not valid.any():
        return {'cross_state': 'none', 'days_since_cross': None}

    above = (s50 > s200).astype(int)
    cross = above[valid].diff().fillna(0)

    last_pos = None
    last_state = 'none'
    valid_positions = [i for i, v in enumerate(valid) if v]
    cross_vals = cross.values

    for j, i in enumerate(valid_positions):
        cv = cross_vals[j] if j < len(cross_vals) else 0
        if cv == 1:
            last_state = 'golden'
            last_pos = i
        elif cv == -1:
            last_state = 'death'
            last_pos = i

    days_since = (len(df) - 1 - last_pos) if last_pos is not None else None
    return {'cross_state': last_state, 'days_since_cross': days_since}


# ── Volatility ────────────────────────────────────────────────────────────────

def atr(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """ATR (Wilder's smoothing) and ATR% of close."""
    high, low, prev_close = df['high'], df['low'], df['close'].shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr_val = tr.ewm(alpha=1 / period, adjust=False).mean()
    return pd.DataFrame({'atr': atr_val, 'atr_pct': atr_val / df['close'] * 100})


def bollinger(df: pd.DataFrame, period: int = 20, std: int = 2) -> pd.DataFrame:
    mid = df['close'].rolling(period).mean()
    std_dev = df['close'].rolling(period).std()
    upper = mid + std * std_dev
    lower = mid - std * std_dev
    return pd.DataFrame({
        'bb_upper': upper,
        'bb_mid': mid,
        'bb_lower': lower,
        'bb_bw': (upper - lower) / mid,
        'bb_pct_b': (df['close'] - lower) / (upper - lower).replace(0, np.nan),
    })


def rolling_volatility(df: pd.DataFrame, window: int) -> pd.Series:
    """Annualized realized vol (%) from daily log returns."""
    log_ret = np.log(df['close'] / df['close'].shift(1))
    return log_ret.rolling(window).std() * np.sqrt(252) * 100


def volatility_percentile(df: pd.DataFrame, window: int = 60) -> float | None:
    """Current rolling vol as percentile of its full history."""
    vol = rolling_volatility(df, window).dropna()
    if vol.empty:
        return None
    current = float(vol.iloc[-1])
    return round(float((vol < current).sum() / len(vol) * 100), 1)


# ── Drawdown ──────────────────────────────────────────────────────────────────

def drawdown_from_recent_high(df: pd.DataFrame, lookback: int = 60) -> pd.Series:
    return (df['close'] - df['close'].rolling(lookback).max()) / df['close'].rolling(lookback).max() * 100


def max_drawdown_and_underwater(df: pd.DataFrame) -> dict:
    rolling_max = df['close'].cummax()
    drawdown = (df['close'] - rolling_max) / rolling_max * 100
    max_dd = float(drawdown.min()) if not drawdown.empty else None
    current_dd = float(drawdown.iloc[-1]) if not drawdown.empty else None

    at_ath = df['close'] >= rolling_max
    underwater_days = 0
    for v in reversed(at_ath.values):
        if v:
            break
        underwater_days += 1

    return {
        'max_drawdown': round(max_dd, 2) if max_dd is not None else None,
        'current_drawdown': round(current_dd, 2) if current_dd is not None else None,
        'underwater_days': underwater_days,
    }


# ── Gap ───────────────────────────────────────────────────────────────────────

def gap_analysis(df: pd.DataFrame) -> pd.DataFrame:
    prev_close = df['close'].shift(1)
    gap_pct = (df['open'] - prev_close) / prev_close * 100
    gap_up = df['open'] > prev_close
    gap_down = df['open'] < prev_close
    filled = (gap_up & (df['low'] <= prev_close)) | (gap_down & (df['high'] >= prev_close))
    return pd.DataFrame({'gap_pct': gap_pct, 'gap_filled_same_day': filled})


# ── Returns ───────────────────────────────────────────────────────────────────

def rolling_return(df: pd.DataFrame, window: int) -> pd.Series:
    return (df['close'] / df['close'].shift(window) - 1) * 100
