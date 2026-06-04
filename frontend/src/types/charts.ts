export interface ChartInstrument {
  id: number
  symbol: string | null
  isin: string | null
  name: string | null
  type: string
}

export interface Candle {
  time: string
  open: number
  high: number
  low: number
  close: number
}

export interface NavPoint {
  time: string
  value: number
}

export interface TradeMarker {
  time: string
  type: 'BUY' | 'SELL'
  qty: number
  price: number
}

export interface PriceChartData {
  candles: Candle[]
  markers: TradeMarker[]
}

export interface NavChartData {
  nav: NavPoint[]
  prices: NavPoint[]
  instrument_type: string
  markers: TradeMarker[]
}

export interface DbInfo {
  host: string
  port: number
  name: string
}

export interface DeleteResult {
  deleted: number
  message: string
}
