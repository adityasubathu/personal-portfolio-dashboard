import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { AppStatus } from '../types/status'

export function useAppStatus() {
  return useQuery({
    queryKey: ['app-status'],
    queryFn: () => request<AppStatus>('/api/v1/status'),
    staleTime: Infinity,
  })
}

export function useResetDemoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<{ ok: boolean; message: string }>('/api/v1/demo/reset', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  })
}
