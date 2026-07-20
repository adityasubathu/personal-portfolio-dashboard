import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, requestForm } from './client'
import type {
  AllocationComparison,
  AssetClassComparison,
  BreakdownChartData,
  CategoryCompositionItem,
  ClassifyResult,
  DirectTradeBreakdown,
  SchemeBreakdown,
  SchemeListItem,
  SectorClassifyResult,
  SectorCompositionItem,
  SectorStockBreakdownItem,
  StockHolding,
} from '../types/mfBreakdown'

export const breakdownKeys = {
  chartData: ['mf-breakdown', 'chart-data'] as const,
  stockHoldings: ['mf-breakdown', 'stock-holdings'] as const,
  allocationComparison: ['mf-breakdown', 'allocation-comparison'] as const,
  allocationTargets: ['mf-breakdown', 'allocation-targets'] as const,
  assetClassComparison: ['mf-breakdown', 'asset-class-comparison'] as const,
  categoryComposition: ['mf-breakdown', 'category-composition'] as const,
  sectorComposition: ['mf-breakdown', 'sector-composition'] as const,
  sectorStockBreakdown: ['mf-breakdown', 'sector-stock-breakdown'] as const,
  sectorList: ['mf-breakdown', 'sector-list'] as const,
  directTrades: ['mf-breakdown', 'direct-trades'] as const,
  schemes: ['mf-breakdown', 'schemes'] as const,
  scheme: (isin: string) => ['mf-breakdown', 'scheme', isin] as const,
}

export function useBreakdownChart() {
  return useQuery({
    queryKey: breakdownKeys.chartData,
    queryFn: () => request<BreakdownChartData>('/api/v1/mf-breakdown/chart-data'),
  })
}

export function useStockHoldings() {
  return useQuery({
    queryKey: breakdownKeys.stockHoldings,
    queryFn: () => request<StockHolding[]>('/api/v1/mf-breakdown/stock-holdings'),
  })
}

export function useAllocationComparison(mode: 'anchored' | 'free_float' = 'anchored') {
  return useQuery({
    queryKey: [...breakdownKeys.allocationComparison, mode],
    queryFn: () => request<AllocationComparison>(`/api/v1/mf-breakdown/allocation-comparison?mode=${mode}`),
  })
}

export function useAllocationTargets() {
  return useQuery({
    queryKey: breakdownKeys.allocationTargets,
    queryFn: () => request<Record<string, number>>('/api/v1/mf-breakdown/allocation-targets'),
  })
}

export function useCategoryComposition() {
  return useQuery({
    queryKey: breakdownKeys.categoryComposition,
    queryFn: () => request<CategoryCompositionItem[]>('/api/v1/mf-breakdown/category-composition'),
  })
}

export function useSectorComposition() {
  return useQuery({
    queryKey: breakdownKeys.sectorComposition,
    queryFn: () => request<SectorCompositionItem[]>('/api/v1/mf-breakdown/sector-composition'),
  })
}

export function useSectorStockBreakdown() {
  return useQuery({
    queryKey: breakdownKeys.sectorStockBreakdown,
    queryFn: () => request<SectorStockBreakdownItem[]>('/api/v1/mf-breakdown/sector-stock-breakdown'),
  })
}

export function useDirectTrades() {
  return useQuery({
    queryKey: breakdownKeys.directTrades,
    queryFn: () => request<DirectTradeBreakdown[]>('/api/v1/mf-breakdown/direct-trades'),
  })
}

export function useAvailableSchemes() {
  return useQuery({
    queryKey: breakdownKeys.schemes,
    queryFn: () => request<SchemeListItem[]>('/api/v1/mf-breakdown/schemes'),
  })
}

export function useSchemeBreakdown(schemeIsin: string | null) {
  return useQuery({
    queryKey: breakdownKeys.scheme(schemeIsin ?? ''),
    queryFn: () => request<SchemeBreakdown>(`/api/v1/mf-breakdown/scheme/${schemeIsin}`),
    enabled: schemeIsin != null,
  })
}

export function useAssetClassComparison() {
  return useQuery({
    queryKey: breakdownKeys.assetClassComparison,
    queryFn: () => request<AssetClassComparison>('/api/v1/mf-breakdown/asset-class-comparison'),
  })
}

export function useSaveAssetClassTargetsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (targets: Record<string, number>) => {
      const form = new URLSearchParams()
      Object.entries(targets).forEach(([ac, val]) =>
        form.append(`target_${ac.replace(/ /g, '_')}`, String(val))
      )
      return requestForm<{ ok: boolean }>('/api/v1/mf-breakdown/asset-class-targets', form)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mf-breakdown'] }),
  })
}

export function useSaveAllocationTargetsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (targets: Record<string, number>) => {
      const form = new URLSearchParams()
      Object.entries(targets).forEach(([cat, val]) => form.append(`target_${cat}`, String(val)))
      return requestForm<{ ok: boolean }>('/api/v1/mf-breakdown/allocation-targets', form)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mf-breakdown'] }),
  })
}

export function useSectorList() {
  return useQuery({
    queryKey: breakdownKeys.sectorList,
    queryFn: () => request<string[]>('/api/v1/mf-breakdown/sector-list'),
  })
}

export function useSectorClassifyBatchMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: Array<{ name: string; sector: string }>) =>
      request<SectorClassifyResult>('/api/v1/mf-breakdown/sector-classify-batch', {
        method: 'PATCH',
        body: JSON.stringify(rows),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mf-breakdown'] }),
  })
}

export function useClassifyBatchMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (rows: Array<{ scheme_isin: string; name: string; category: string }>) => {
      const form = new URLSearchParams()
      rows.forEach((r) => {
        form.append('scheme_isin', r.scheme_isin)
        form.append('name', r.name)
        form.append('category', r.category)
      })
      return requestForm<ClassifyResult>('/api/v1/mf-breakdown/classify-batch', form, 'PATCH')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mf-breakdown'] }),
  })
}
