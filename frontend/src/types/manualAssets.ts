export interface FdAsset {
  id: number
  label: string | null
  principal: number
  interest_rate: number
  start_date: string | null
  maturity_date: string | null
  current_value: number
  maturity_value: number
  is_emergency_fund: boolean
}

export interface SimpleAsset {
  id: number
  label: string | null
  current_value: number
}

export interface ForeignEquityAsset {
  id: number
  label: string
  value_usd: number
  invested_usd: number
  value_inr: number
}

export interface ManualAssetsSummary {
  fds: FdAsset[]
  ppf: SimpleAsset | null
  nps: SimpleAsset | null
  cash: SimpleAsset | null
  foreign_equities: ForeignEquityAsset[]
  total_fd: number
  emergency_total: number
  total_ppf: number
  total_nps: number
  total_cash: number
  total_foreign_equity_usd: number
  total_foreign_equity_inr: number
  usdinr_rate: number
  total_manual: number
}

export interface UsdinrInfo {
  rate: number
  source: string | null
  fetched_at: string | null
}
