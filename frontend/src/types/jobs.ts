export type JobKind = 'mf_nav_history' | 'kite_price_history' | 'mf_disclosures'
export type JobStatus = 'running' | 'waiting_login' | 'done' | 'failed'
export type NavSource = 'mfapi' | 'finapi' | 'amfi'

export interface JobSummary {
  id: number
  kind: JobKind
  status: JobStatus
  params: Record<string, unknown>
  summary: string | null
  last_log: string | null
  error: string | null
  started_at: string
  finished_at: string | null
  read_at: string | null
}

export interface JobDetail extends JobSummary {
  logs: string[]
  result: unknown
}

export interface MfNavHistoryResult {
  source: NavSource
  funds_synced?: number
  rows_added?: number
  latest_nav_date?: string | null
  failed?: string[]
  updated?: number
  missing?: unknown[]
}

export interface KitePriceHistoryResult {
  result: {
    instruments_synced: number
    rows_added: number
    latest_price_date: string | null
    failed: string[]
    no_data: string[]
  }
  index: { instruments_synced: number; rows_added: number } | null
  ltp: { updated: number } | null
}
