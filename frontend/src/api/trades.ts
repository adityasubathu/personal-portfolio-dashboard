import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestForm } from './client'
import type { ImportBatch, ImportResponse, TradesListResponse } from '../types/trades'

export const tradeKeys = {
  list: (page: number, q: string) => ['trades', 'list', page, q] as const,
  imports: ['trades', 'imports'] as const,
}

export function useTrades(page = 1, q = '') {
  return useQuery({
    queryKey: tradeKeys.list(page, q),
    queryFn: () => request<TradesListResponse>(`/api/v1/trades?page=${page}&q=${encodeURIComponent(q)}`),
  })
}

export function useImports() {
  return useQuery({
    queryKey: tradeKeys.imports,
    queryFn: () => request<ImportBatch[]>('/api/v1/trades/imports'),
  })
}

export function useImportMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (files: FileList | File[]) => {
      const form = new FormData()
      Array.from(files).forEach((f) => form.append('files', f))
      return requestForm<ImportResponse>('/api/v1/trades/import', form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useRollbackMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (batchId: string) =>
      request<{ ok: boolean; batch_id: string }>(`/api/v1/trades/import/${batchId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}

export function useSplitCreditMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { instrument_id: number; trade_date: string; quantity: number }) => {
      const form = new URLSearchParams({
        instrument_id: String(data.instrument_id),
        trade_date: data.trade_date,
        quantity: String(data.quantity),
      })
      return requestForm<{ violations: unknown[] }>('/api/v1/trades/split-credit', form)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
