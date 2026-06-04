import { useQuery } from '@tanstack/react-query'
import { request } from './client'
import type { ChartInstrument, NavChartData, PriceChartData } from '../types/charts'

export const chartKeys = {
  instruments: ['charts', 'instruments'] as const,
  navInstruments: ['charts', 'nav-instruments'] as const,
  price: (id: number) => ['charts', 'price', id] as const,
  nav: (id: number) => ['charts', 'nav', id] as const,
}

export function useChartInstruments() {
  return useQuery({
    queryKey: chartKeys.instruments,
    queryFn: () => request<ChartInstrument[]>('/api/v1/charts/instruments'),
  })
}

export function useNavChartInstruments() {
  return useQuery({
    queryKey: chartKeys.navInstruments,
    queryFn: () => request<ChartInstrument[]>('/api/v1/charts/nav-instruments'),
  })
}

export function usePriceChart(instrumentId: number | null) {
  return useQuery({
    queryKey: chartKeys.price(instrumentId ?? 0),
    queryFn: () => request<PriceChartData>(`/api/v1/charts/price/${instrumentId}`),
    enabled: instrumentId != null,
  })
}

export function useNavChart(instrumentId: number | null) {
  return useQuery({
    queryKey: chartKeys.nav(instrumentId ?? 0),
    queryFn: () => request<NavChartData>(`/api/v1/charts/nav/${instrumentId}`),
    enabled: instrumentId != null,
  })
}
