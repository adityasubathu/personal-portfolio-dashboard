import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestForm } from './client'
import type { KiteConfig, KiteStatus, KiteSyncResult } from '../types/kite'

export const kiteKeys = {
  status: ['kite', 'status'] as const,
  config: ['kite', 'config'] as const,
  authUrl: ['kite', 'auth-url'] as const,
}

export function useKiteStatus() {
  return useQuery({
    queryKey: kiteKeys.status,
    queryFn: () => request<KiteStatus>('/api/v1/kite/status'),
  })
}

export function useKiteConfig() {
  return useQuery({
    queryKey: kiteKeys.config,
    queryFn: () => request<KiteConfig>('/api/v1/kite/config'),
  })
}

export function useKiteAuthUrl() {
  return useQuery({
    queryKey: kiteKeys.authUrl,
    queryFn: () => request<{ url: string }>('/api/v1/kite/auth/url'),
    enabled: false,
  })
}

export function useSaveKiteConfigMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { api_key: string; api_secret: string }) => {
      const form = new URLSearchParams(data)
      return requestForm<KiteStatus>('/api/v1/kite/config', form, 'PUT')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kite'] }),
  })
}

export function useDeleteKiteConfigMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<KiteStatus>('/api/v1/kite/config', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kite'] }),
  })
}

export function useKiteSyncMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<KiteSyncResult>('/api/v1/kite/sync', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kite'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    },
  })
}
