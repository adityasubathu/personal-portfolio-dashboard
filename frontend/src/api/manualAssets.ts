import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestForm } from './client'
import type { ManualAssetsSummary, UsdinrInfo } from '../types/manualAssets'

export const manualAssetKeys = {
  all: ['manual-assets'] as const,
}

export function useManualAssets() {
  return useQuery({
    queryKey: manualAssetKeys.all,
    queryFn: () => request<ManualAssetsSummary>('/api/v1/manual-assets'),
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: manualAssetKeys.all })
  qc.invalidateQueries({ queryKey: ['portfolio'] })
}

export function useAddFdMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      label: string
      principal: number
      interest_rate: number
      start_date: string
      maturity_date: string
      is_emergency_fund?: boolean
    }) => {
      const form = new URLSearchParams({
        label: data.label,
        principal: String(data.principal),
        interest_rate: String(data.interest_rate),
        start_date: data.start_date,
        maturity_date: data.maturity_date,
        is_emergency_fund: String(data.is_emergency_fund ?? false),
      })
      return requestForm<ManualAssetsSummary>('/api/v1/manual-assets/fd', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertPpfMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { label?: string; current_value: number }) => {
      const form = new URLSearchParams({
        label: data.label ?? 'PPF',
        current_value: String(data.current_value),
      })
      return requestForm<ManualAssetsSummary>('/api/v1/manual-assets/ppf', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertNpsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { label?: string; current_value: number }) => {
      const form = new URLSearchParams({
        label: data.label ?? 'NPS',
        current_value: String(data.current_value),
      })
      return requestForm<ManualAssetsSummary>('/api/v1/manual-assets/nps', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpsertCashMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { label?: string; current_value: number }) => {
      const form = new URLSearchParams({
        label: data.label ?? 'Savings / Current',
        current_value: String(data.current_value),
      })
      return requestForm<ManualAssetsSummary>('/api/v1/manual-assets/cash', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useAddForeignEquityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { label: string; current_value: number }) => {
      const form = new URLSearchParams({
        label: data.label,
        current_value: String(data.current_value),
      })
      return requestForm<ManualAssetsSummary>('/api/v1/manual-assets/foreign-equity', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (assetId: number) =>
      request<ManualAssetsSummary>(`/api/v1/manual-assets/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useRefreshUsdinrMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<UsdinrInfo>('/api/v1/usdinr/refresh', { method: 'POST' }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useSetManualUsdinrMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rate: number) => {
      const form = new URLSearchParams({ rate: String(rate) })
      return requestForm<UsdinrInfo>('/api/v1/usdinr/manual', form)
    },
    onSuccess: () => invalidateAll(qc),
  })
}
