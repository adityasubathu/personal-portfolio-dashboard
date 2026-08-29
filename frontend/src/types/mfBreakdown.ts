export interface BreakdownChartData {
  labels: string[]
  values: number[]
  total: number
}

export interface AssetClassRow {
  asset_class: string
  target_pct: number
  current_pct: number
  current_value: number
  current_diff: number
  ideal_value: number
  shortfall: number
}

export interface AssetClassComparison {
  rows: AssetClassRow[]
  foreign_equity_target: number
  investable_total: number
  excluded: { emergency_fund: number; cash: number; total_excluded: number }
  grand_total: number
}

export interface AllocationRow {
  category: string
  target_pct: number
  anchor_note: string | null
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

export interface AllocationSplitSummary {
  target_pct: number
  current_pct: number
  current_value: number
  current_diff: number
  current_value_diff: number
  invested_pct: number
  invested_value: number
}

export interface AllocationComparison {
  rows: AllocationRow[]
  foreign: AllocationSplitSummary
  domestic: AllocationSplitSummary
  targets: Record<string, number>
  current_equity: number
  invested_equity: number
  domestic_equity: number
  pool?: number
  mode: 'anchored' | 'free_float'
}

export interface RebalanceBucket {
  category: string
  current_value: number
  target_pct: number
  current_pct: number
  invest: number
  new_value: number
  new_pct: number
  remaining_drift: number
}

export interface RebalancePlan {
  mode: 'anchored' | 'free_float'
  pool: number
  cash_amount: number
  new_pool: number
  total_buy: number
  total_sell: number
  buckets: RebalanceBucket[]
  asset_class: RebalanceBucket[]
  asset_class_total_buy: number
  asset_class_total_sell: number
  conflict_note: string | null
}

export interface SchemeHolding {
  name: string
  type: string
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
  total: number
  sources: Array<{ name: string; source_type: string; fund_pct: number; contribution: number; share_pct: number }>
}

export interface SectorStockHolding {
  name: string
  value: number
  pct: number
}

export interface SectorStockBreakdownItem {
  sector: string
  total: number
  holdings: SectorStockHolding[]
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
  total: number
  sources: Array<{
    name: string
    isin?: string
    source_type: string
    fund_pct: number
    contribution: number
    share_pct: number
  }>
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

export interface SectorClassifyResult {
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
    schemes_skipped?: number
    already_current?: boolean
    as_of?: string
    unmatched_equities?: Array<{ name: string; scheme_isin: string }>
    missing_funds?: Array<{ isin: string; name: string }>
    errors?: string[]
    error?: string
  }
  error?: string
}
