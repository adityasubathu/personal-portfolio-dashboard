export interface BreakdownChartData {
  labels: string[]
  values: number[]
  total: number
}

export interface AllocationRow {
  category: string
  target_pct: number
  current_pct: number
  current_value: number
  current_diff: number
  invested_pct: number
  invested_value: number
  invested_diff: number
  current_ideal_value: number
  current_value_diff: number
  invested_ideal_value: number
  invested_value_diff: number
}

export interface AllocationComparison {
  rows: AllocationRow[]
  targets: Record<string, number>
  current_equity: number
  invested_equity: number
}

export interface SchemeHolding {
  name: string
  scheme_isin: string
  category: string
  pct: number
  value: number
}

export interface SchemeBreakdown {
  holdings: SchemeHolding[]
  category_summary: Array<{ category: string; pct: number; value: number }>
}

export interface SchemeListItem {
  scheme_isin: string
  name: string
}

export interface SectorCompositionItem {
  sector: string
  value: number
  pct: number
  stocks?: StockHolding[]
}

export interface StockHolding {
  name: string
  isin: string | null
  sector: string
  schemes: string[]
  value: number
  pct_of_equity: number
  category: string
}

export interface CategoryCompositionItem {
  category: string
  schemes: Array<{
    scheme_isin: string
    name: string
    value: number
    pct_of_category: number
  }>
  total_value: number
}

export interface DirectTradeBreakdown {
  symbol: string
  type: string
  total_buy: number
  total_sell: number
  net: number
}

export interface ClassifyResult {
  updated: number
}

export interface IngestDonePayload {
  ok: boolean
  amfi?: {
    rows_loaded?: number
    large?: number
    mid?: number
    small?: number
    file?: string
    file_date?: string
    stale_warning?: string
    error?: string
  }
  ingest?: {
    schemes_processed?: number
    rows_upserted?: number
    skipped_isins?: string[]
    unmatched_equities?: Array<{ name: string; scheme_isin: string }>
    errors?: string[]
    error?: string
  }
  error?: string
}
