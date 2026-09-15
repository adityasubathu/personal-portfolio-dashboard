export interface NavTrackedInstrument {
  instrument_id: number
  name: string | null
  isin: string | null
  instrument_type: string
}

export interface MfSyncResult {
  mode: string
  error: string | null
  [key: string]: unknown
}
