import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { DbInfo, DeleteResult } from '../types/charts'

export const settingsKeys = {
  dbInfo: ['settings', 'db-info'] as const,
}

export function useDbInfo() {
  return useQuery({
    queryKey: settingsKeys.dbInfo,
    queryFn: () => request<DbInfo>('/api/v1/settings/db-info'),
  })
}

function useDeleteMutation(path: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<DeleteResult>(path, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useDeleteTradesMutation() { return useDeleteMutation('/api/v1/settings/trades') }
export function useDeletePriceHistoryMutation() { return useDeleteMutation('/api/v1/settings/price-history') }
export function useDeleteNavHistoryMutation() { return useDeleteMutation('/api/v1/settings/nav-history') }
export function useDeleteMfBreakdownMutation() { return useDeleteMutation('/api/v1/settings/mf-breakdown') }
export function useDeleteManualAssetsMutation() { return useDeleteMutation('/api/v1/settings/manual-assets') }
