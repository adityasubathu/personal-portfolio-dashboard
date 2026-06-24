import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestForm } from './client'
import type {
  DirectHoldingsResponse,
  InstrumentListItem,
  NavPoint,
  SummaryCards,
} from '../types/portfolio'

export const portfolioKeys = {
  summaryCards: ['portfolio', 'summary-cards'] as const,
  holdings: (sort: string, dir: string, sections: string, compare: string) =>
    ['portfolio', 'holdings', sort, dir, sections, compare] as const,
  navHistory: ['portfolio', 'nav-history'] as const,
  instruments: ['portfolio', 'instruments'] as const,
}

export function useSummaryCards() {
  return useQuery({
    queryKey: portfolioKeys.summaryCards,
    queryFn: () => request<SummaryCards>('/api/v1/portfolio/summary-cards'),
  })
}

export function useHoldings(params: {
  sort?: string
  dir?: 'asc' | 'desc'
  sections?: 'on' | 'off'
  compare?: 'prev_close' | 'open'
}) {
  const { sort = 'symbol', dir = 'asc', sections = 'on', compare = 'prev_close' } = params
  return useQuery({
    queryKey: portfolioKeys.holdings(sort, dir, sections, compare),
    queryFn: () =>
      request<DirectHoldingsResponse>(
        `/api/v1/portfolio/direct?sort=${sort}&dir=${dir}&sections=${sections}&compare=${compare}`,
      ),
  })
}

export function useNavHistory() {
  return useQuery({
    queryKey: portfolioKeys.navHistory,
    queryFn: () => request<NavPoint[]>('/api/v1/portfolio/nav-history'),
  })
}

export function useTradedInstruments() {
  return useQuery({
    queryKey: portfolioKeys.instruments,
    queryFn: () => request<InstrumentListItem[]>('/api/v1/portfolio/instruments'),
  })
}

export function useUpdateLtpMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request<{ updated: number; timestamp: string; errors: string[] }>(
      '/api/v1/portfolio/update-ltp',
      { method: 'POST' },
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export async function uploadOhlc(instrumentId: number, file: File) {
  const form = new FormData()
  form.append('instrument_id', String(instrumentId))
  form.append('file', file)
  return requestForm<Record<string, unknown>>('/api/v1/portfolio/upload-ohlc', form)
}
