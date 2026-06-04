export interface NavTrackedInstrument {
  instrument_id: number
  name: string | null
  isin: string | null
  instrument_type: string
}

export interface FetchNavResult {
  error: string | null
  symbol: string | null
  isin: string | null
  rows_added: number | null
  latest_nav_date: string | null
}

export interface MfSyncResult {
  mode: string
  error: string | null
  [key: string]: unknown
}
