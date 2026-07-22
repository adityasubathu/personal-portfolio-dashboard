import { useQuery } from '@tanstack/react-query'
import { request } from './client'
import type { SentimentSummary, SentimentSeries, MarketBreadth } from '../types/marketSentiment'

export const sentimentKeys = {
  summary: ['market-sentiment', 'summary'] as const,
  series: (days: number) => ['market-sentiment', 'series', days] as const,
  breadth: ['market-sentiment', 'breadth'] as const,
}

export function useSentimentSummary() {
  return useQuery({
    queryKey: sentimentKeys.summary,
    queryFn: () => request<SentimentSummary>('/api/v1/market-sentiment/summary'),
    staleTime: 60 * 60 * 1000,
  })
}

export function useSentimentSeries(days: number) {
  return useQuery({
    queryKey: sentimentKeys.series(days),
    queryFn: () => request<SentimentSeries>(`/api/v1/market-sentiment/series?days=${days}`),
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
