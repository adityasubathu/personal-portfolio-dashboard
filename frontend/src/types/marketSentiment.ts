import type { Candle } from './charts'

export type SentimentIndex = 'nifty50' | 'nifty500'

export interface IndicatorPoint {
  time: string
  value: number | null
}

export interface VixShort {
  vix_current: number | null
  vix_day_chg: number | null
  vix_5d_chg: number | null
}

export interface VixMid {
  vix_current: number | null
  vix_sma20: number | null
  vix_vs_sma20_pct: number | null
  vix_above_sma20: boolean | null
}

export interface VixLong {
  vix_current: number | null
  vix_pct_rank: number | null
}

/** One horizon's trend verdict. Shared by the summary card and the sector table —
 *  both are scored by the same three signals so they can never disagree. */
export interface TrendCell {
  label: string
  signals: Record<string, boolean>
  /** Price is up but the trend has stopped gaining strength ("losing steam"). */
  fading: boolean
}

export interface SentimentHorizonShort {
  trend: TrendCell
  rsi14: number | null
  macd_hist: number | null
  vol_regime: string
  vix: VixShort
}

export interface SentimentHorizonMid {
  trend: TrendCell
  adx: number | null
  weekly_rsi: number | null
  vol_regime: string
  vix: VixMid
}

export interface SentimentHorizonLong {
  trend: TrendCell
  sma200_slope: string | null
  drawdown_from_ath_pct: number | null
  vol_percentile: number | null
  vix: VixLong
}

export interface SentimentFlags {
  divergence: boolean
  cross_state: 'golden' | 'death' | 'none'
  days_since_cross: number | null
  streak: number
  gap_pct: number | null
  rsi14: number | null
  above_200dma: boolean | null
  adx: number | null
  bb_squeeze: boolean
  bb_pct_b: number | null
  ema_cross: 'bullish' | 'bearish' | null
  underwater_days: number
  vix_day_chg: number | null
}

export interface SentimentSummary {
  no_data?: boolean
  as_of?: string
  close?: number
  horizons?: {
    short: SentimentHorizonShort
    mid: SentimentHorizonMid
    long: SentimentHorizonLong
  }
  flags?: SentimentFlags
}

export interface SentimentOverlays {
  ema9: IndicatorPoint[]
  ema20: IndicatorPoint[]
  sma50: IndicatorPoint[]
  sma100: IndicatorPoint[]
  sma200: IndicatorPoint[]
  bb_upper: IndicatorPoint[]
  bb_mid: IndicatorPoint[]
  bb_lower: IndicatorPoint[]
}

export interface SentimentOscillators {
  rsi14: IndicatorPoint[]
  rsi14_weekly: IndicatorPoint[]
  macd_hist: IndicatorPoint[]
  adx: IndicatorPoint[]
  atr_pct: IndicatorPoint[]
  realized_vol_20: IndicatorPoint[]
  realized_vol_60: IndicatorPoint[]
}

export interface SentimentSeries {
  no_data?: boolean
  candles?: Candle[]
  overlays?: SentimentOverlays
  oscillators?: SentimentOscillators
}

interface BreadthReturns {
  nifty50: number | null
  next50: number | null
  mid150: number | null
  small250: number | null
}

export interface BreadthDrawdowns {
  nifty50: number | null
  next50: number | null
  mid150: number | null
  small250: number | null
  stress_flag: boolean
}

export interface SectorTrendPerf {
  cagr_2y: number | null
  cagr_5y: number | null
  cagr_10y: number | null
  vs_n50_2y: number | null
  vs_n50_5y: number | null
  vs_n50_10y: number | null
  vs_n500_2y: number | null
  vs_n500_5y: number | null
  vs_n500_10y: number | null
}

export interface SectorTrendRow {
  symbol: string
  label: string
  is_benchmark: boolean
  trend: { short: TrendCell; mid: TrendCell; long: TrendCell } | null
  perf: SectorTrendPerf
}

export interface SectorTrends {
  no_data?: boolean
  as_of?: string | null
  rows?: SectorTrendRow[]
}

export interface MarketBreadth {
  no_data?: boolean
  as_of?: string
  regime?: {
    label: string
    returns_5d: BreadthReturns
  }
  relative_strength?: {
    order: string
    tone: 'risk_on' | 'risk_off' | 'mixed'
    returns_1m: BreadthReturns
  }
  drawdowns?: BreadthDrawdowns
  ratios?: {
    mid150_nifty50: IndicatorPoint[]
    small250_nifty50: IndicatorPoint[]
  }
}
