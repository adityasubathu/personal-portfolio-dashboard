export interface GainBucket {
  key: string
  label: string
  gross_gain: number
  setoff_applied: number
  exemption_applied: number
  taxable: number
  rate: number | null
  est_tax: number | null
}

export interface RealizedLot {
  symbol: string
  name: string | null
  asset_category: string
  buy_date: string
  sell_date: string
  qty: number
  buy_value: number
  sell_value: number
  expenses: number
  gain: number
  holding_days: number
  tax_bucket: string
  flags: string[]
}

export interface AttentionItem {
  symbol: string
  name: string | null
  asset_category: string
  sell_date: string
  qty: number
  sell_value: number
  flags: string[]
  reason: string
}

export interface IntradayInfo {
  trades: number
  pnl: number
}

export interface CGTotals {
  gross_gain: number
  est_tax: number
}

export interface CapitalGainsResponse {
  fy: string
  buckets: GainBucket[]
  lots: RealizedLot[]
  intraday: IntradayInfo
  attention: AttentionItem[]
  totals: CGTotals
}

export interface AvailableFYsResponse {
  fys: string[]
}
