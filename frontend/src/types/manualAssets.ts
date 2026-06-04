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

export interface ManualAssetsSummary {
  fds: FdAsset[]
  ppf: SimpleAsset | null
  nps: SimpleAsset | null
  cash: SimpleAsset | null
  total_fd: number
  emergency_total: number
  total_ppf: number
  total_nps: number
  total_cash: number
  total_manual: number
}
