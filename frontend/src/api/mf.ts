import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { FetchNavResult, MfSyncResult, NavTrackedInstrument } from '../types/mf'

export const mfKeys = {
  navTracked: ['mf', 'nav-tracked'] as const,
}

export function useNavTracked() {
  return useQuery({
    queryKey: mfKeys.navTracked,
    queryFn: () => request<NavTrackedInstrument[]>('/api/v1/mf/nav-tracked'),
  })
}

export function useSyncNavMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<MfSyncResult>('/api/v1/mf/sync-nav', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio'] }),
  })
}

export function useSyncNavHistoryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (source: 'mfapi' | 'finapi' = 'mfapi') =>
      request<MfSyncResult>(`/api/v1/mf/sync-nav-history?source=${source}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio'] })
      qc.invalidateQueries({ queryKey: ['charts'] })
    },
  })
}

export function useFetchNavByIsinMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (isin: string) =>
      request<FetchNavResult>(`/api/v1/mf/fetch-nav-by-isin?isin=${encodeURIComponent(isin)}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mfKeys.navTracked })
      qc.invalidateQueries({ queryKey: ['charts'] })
    },
  })
}

export function useRemoveNavTrackedMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (instrumentId: number) =>
      request<NavTrackedInstrument[]>(`/api/v1/mf/nav-tracked/${instrumentId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: mfKeys.navTracked }),
  })
}
