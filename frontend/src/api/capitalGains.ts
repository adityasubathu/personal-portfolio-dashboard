import { useQuery } from '@tanstack/react-query'
import { request } from './client'
import type { CapitalGainsResponse, AvailableFYsResponse } from '../types/capitalGains'

export const cgKeys = {
  years: ['capital-gains', 'years'] as const,
  fy: (fy: string) => ['capital-gains', 'fy', fy] as const,
}

export function useCapitalGainsYears() {
  return useQuery({
    queryKey: cgKeys.years,
    queryFn: () => request<AvailableFYsResponse>('/api/v1/capital-gains/years'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useCapitalGains(fy: string) {
  return useQuery({
    queryKey: cgKeys.fy(fy),
    queryFn: () => request<CapitalGainsResponse>(`/api/v1/capital-gains/${fy}`),
    staleTime: 10 * 60 * 1000,
    enabled: !!fy,
  })
}
