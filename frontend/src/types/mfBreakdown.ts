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
  macro_sector: string | null
  sector: string | null
  industry: string | null
  basic_industry: string | null
  pct: number
  value: number
}

export interface SchemeBreakdown {
  holdings: SchemeHolding[]
  category_summary: Array<{ category: string; pct: number; value: number }>
  sector_summary: Array<{ sector: string; pct: number; value: number }>
  as_of: string | null
  fetched_at: string | null
  last_checked_at: string | null
  server_latest_filing: string | null
  server_latest_portfolio_count: number | null
}

export interface SchemeListItem {
  scheme_isin: string
  name: string
}

export type ClassificationLevel = 'macro_sector' | 'sector' | 'industry' | 'basic_industry'

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

export interface ClassifyResult {
  updated: number
}

export interface SectorClassifyRow {
  name: string
  level: ClassificationLevel
  value: string
}

export interface SectorClassifyResult {
  updated: number
  rows_updated: number
}

export interface SyncedFund {
  isin: string
  name: string
  as_of: string | null
  rows: number
}

export interface IngestDonePayload {
  ok: boolean
  amfi?: {
    rows_loaded?: number
    large?: number
    mid?: number
    small?: number
    sectors_from_nse?: number
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
    funds?: SyncedFund[]
    errors?: string[]
    error?: string
    checked_at?: string
    server_latest_filing?: string | null
    server_latest_portfolio_count?: number | null
  }
  nse?: {
    held_isins?: number
    resolved?: number
    queried?: number
    classified?: number
    unclassified?: number
    errors?: number
    mismatched?: number
    skipped_cached?: number
    amfi_enriched?: number
    breakdown_backfilled?: number
    unresolved_isins?: Array<{ isin: string; name: string }>
    error?: string
  }
  error?: string
}
