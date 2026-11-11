import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './client'
import type { NavTrackedInstrument } from '../types/mf'

export const mfKeys = {
  navTracked: ['mf', 'nav-tracked'] as const,
}

export function useNavTracked() {
  return useQuery({
    queryKey: mfKeys.navTracked,
    queryFn: () => request<NavTrackedInstrument[]>('/api/v1/mf/nav-tracked'),
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
