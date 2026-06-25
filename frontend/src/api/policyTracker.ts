import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { PolicyTrackerResponse, TriggerResult } from '../types/policyTracker'

export const policyKeys = {
  tracker: ['policy-tracker'] as const,
}

export function usePolicyTracker() {
  return useQuery({
    queryKey: policyKeys.tracker,
    queryFn: () => request<PolicyTrackerResponse>('/api/v1/policy-tracker'),
  })
}

export function useSetTriggerStateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, ...body }: { key: string; value_bool?: boolean; value_text?: string; value_num?: number }) =>
      request<TriggerResult>(`/api/v1/policy-tracker/state/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: policyKeys.tracker }),
  })
}
