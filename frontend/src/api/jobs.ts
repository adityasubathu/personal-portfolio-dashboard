import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import { isJobActive } from '@/lib/jobs'
import type { JobDetail, JobKind, JobSummary } from '@/types/jobs'

const POLL_MS = 1000

export const jobKeys = {
  all: ['jobs'] as const,
  list: ['jobs', 'list'] as const,
  detail: (id: number) => ['jobs', 'detail', id] as const,
}

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.list,
    queryFn: () => request<JobSummary[]>('/api/v1/jobs'),
    refetchInterval: (query) => (query.state.data?.some(isJobActive) ? POLL_MS : false),
  })
}

export function useJob(id: number | null) {
  return useQuery({
    queryKey: jobKeys.detail(id ?? 0),
    queryFn: () => request<JobDetail>(`/api/v1/jobs/${id}`),
    enabled: id != null,
    retry: false,
    refetchInterval: (query) => (query.state.data && isJobActive(query.state.data) ? POLL_MS : false),
  })
}

export function useStartJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, params = {} }: { kind: JobKind; params?: Record<string, unknown> }) =>
      request<JobSummary>('/api/v1/jobs', { method: 'POST', body: JSON.stringify({ kind, params }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  })
}

export function useMarkJobReadMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => request<JobSummary>(`/api/v1/jobs/${id}/read`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  })
}

export function useCancelJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => request<{ ok: boolean }>(`/api/v1/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  })
}

export function useDeleteJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => request<{ ok: boolean }>(`/api/v1/jobs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  })
}

export function useClearJobsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => request<{ deleted: number }>('/api/v1/jobs', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  })
}
