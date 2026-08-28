import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { SentimentSummary, SentimentSeries, MarketBreadth, SectorTrends, SentimentIndex } from '../types/marketSentiment'

export const sentimentKeys = {
  summary: (index: SentimentIndex) => ['market-sentiment', 'summary', index] as const,
  series: (days: number, index: SentimentIndex) => ['market-sentiment', 'series', days, index] as const,
  breadth: ['market-sentiment', 'breadth'] as const,
  sectorTrends: ['market-sentiment', 'sector-trends'] as const,
}

export function useSentimentSummary(index: SentimentIndex) {
  return useQuery({
    queryKey: sentimentKeys.summary(index),
    queryFn: () => request<SentimentSummary>(`/api/v1/market-sentiment/summary?index=${index}`),
    staleTime: 60 * 60 * 1000,
  })
}

export function useSentimentSeries(days: number, index: SentimentIndex) {
  return useQuery({
    queryKey: sentimentKeys.series(days, index),
    queryFn: () => request<SentimentSeries>(`/api/v1/market-sentiment/series?days=${days}&index=${index}`),
    staleTime: 60 * 60 * 1000,
  })
}

export function useMarketBreadth() {
  return useQuery({
    queryKey: sentimentKeys.breadth,
    queryFn: () => request<MarketBreadth>('/api/v1/market-sentiment/breadth'),
    staleTime: 60 * 60 * 1000,
  })
}

export function useSectorTrends() {
  return useQuery({
    queryKey: sentimentKeys.sectorTrends,
    queryFn: () => request<SectorTrends>('/api/v1/market-sentiment/sector-trends'),
    staleTime: 60 * 60 * 1000,
  })
}

export function useRefreshIndicesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<{ ok: boolean; error?: string; instruments_synced?: number; rows_added?: number }>(
      '/api/v1/market-sentiment/refresh-indices',
      { method: 'POST' },
    ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['market-sentiment', 'summary'] })
      qc.invalidateQueries({ queryKey: ['market-sentiment', 'series'] })
      qc.invalidateQueries({ queryKey: sentimentKeys.breadth })
      qc.invalidateQueries({ queryKey: sentimentKeys.sectorTrends })
    },
  })
}
