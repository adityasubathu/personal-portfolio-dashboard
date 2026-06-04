export interface KiteLastSync {
  synced_at: string
  status: string
  holdings_count: number | null
  positions_count: number | null
  error_message: string | null
}

export interface KiteStatus {
  configured: boolean
  api_key: string | null
  token_valid: boolean
  token_expiry: string | null
  last_sync: KiteLastSync | null
  login_url: string | null
}

export interface KiteConfig {
  configured: boolean
  api_key?: string
  has_secret?: boolean
  token_valid?: boolean
  token_expiry?: string | null
}

export interface KiteSyncResult {
  synced_at: string
  status: string
  holdings_count: number
  positions_count: number
  error_message: string | null
}
