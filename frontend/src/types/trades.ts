export interface TradeRow {
  id: number
  instrument_id: number
  symbol: string | null
  isin: string | null
  trade_date: string
  trade_type: string
  quantity: number
  price: number
  amount: number | null
  brokerage: number
  exchange: string | null
  segment: string | null
  notes: string | null
  source: string
  import_batch_id: string | null
}

export interface TradesListResponse {
  rows: TradeRow[]
  page: number
  per_page: number
  total: number
  total_pages: number
  q: string
}

export interface ImportFileResult {
  filename: string
  batch_id: string
  row_count: number
  success_count: number
  errors: Array<{ row: number; message: string }>
}

export interface ImportResponse {
  results: ImportFileResult[]
  holdings_count: number
  violations: Violation[]
}

export interface Violation {
  symbol?: string
  isin?: string
  kind: string
  detail?: string
}

export interface ImportBatch {
  id: number
  batch_id: string
  filename: string | null
  imported_at: string
  row_count: number | null
  success_count: number | null
  error_count: number | null
}
