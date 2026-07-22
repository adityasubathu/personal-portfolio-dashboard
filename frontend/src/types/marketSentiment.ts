import type { Candle } from './charts'

export interface IndicatorPoint {
  time: string
  value: number | null
}

export interface SentimentHorizonShort {
  trend: string
  rsi14: number | null
  macd_hist: number | null
  vol_regime: string
}

export interface SentimentHorizonMid {
  trend: string
  adx: number | null
  weekly_rsi: number | null
  vol_regime: string
}

export interface SentimentHorizonLong {
  trend: string
  sma200_slope: string | null
  drawdown_from_ath_pct: number | null
  vol_percentile: number | null
}

export interface SentimentFlags {
  divergence: boolean
  cross_state: 'golden' | 'death' | 'none'
  days_since_cross: number | null
  streak: number
  gap_pct: number | null
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
