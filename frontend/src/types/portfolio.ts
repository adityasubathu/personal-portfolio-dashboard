export interface SummaryCards {
  total_cost: number
  total_value: number
  total_pnl: number
  last_ltp_update: string | null
  xirr: number | null
}

export interface HoldingRow {
  instrument_id: number
  symbol: string
  type: string
  isin: string | null
  name: string | null
  qty: number
  avg_price: number | null
  cost: number
  ltp: number | null
  as_of: string | null
  value: number
  pnl: number
  pnl_pct: number | null
  xirr: number | null
  nav: number | null
  nav_as_of: string | null
  nav_premium: number | null
  prev_close: number | null
  prev_close_date: string | null
  day_chg_pct: number | null
  day_chg_abs: number | null
}

export interface HoldingsSection {
  label: string | null
  rows: HoldingRow[]
  day_chg_abs_min: number | null
  day_chg_abs_max: number | null
}

export interface DirectHoldingsResponse {
  groups: HoldingsSection[]
  sections_enabled: boolean
  current_sort: string
  current_dir: 'asc' | 'desc'
  total_cost: number
  total_value: number
  total_day_chg: number
  total_day_chg_pct: number | null
  compare: string
  pnl_min: number | null
  pnl_max: number | null
  pnl_pct_min: number | null
  pnl_pct_max: number | null
  xirr_min: number | null
  xirr_max: number | null
  day_chg_abs_min: number | null
  day_chg_abs_max: number | null
}

export interface InstrumentListItem {
  id: number
  symbol: string | null
  isin: string | null
  name: string | null
  type: string
  n_prices: number
}

export interface NavPoint {
  date: string
  value: number
  invested: number
}
