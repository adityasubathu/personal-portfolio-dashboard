import { useMemo, useState } from 'react'
import { BarChart3, Plus, X } from 'lucide-react'
import { useNavChartInstruments, useNavChart } from '../api/charts'
import { LwChart } from '../components/LwChart'
import { usePersistentState } from '../hooks/usePersistentState'
import type { NavPoint } from '../types/charts'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

function normalizeToPercent(data: NavPoint[]): NavPoint[] {
  if (!data.length) return []
  const base = data[0].value
  if (!base) return data
  return data.map((p) => ({ ...p, value: ((p.value - base) / base) * 100 }))
}

function CompareSelect({
  instruments,
  value,
  onChange,
  exclude,
}: {
  instruments: { value: string; label: string }[]
  value: string | null
  onChange: (v: string | null) => void
  exclude: string | null
}) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-56">
        <SelectValue placeholder="Add comparison…" />
      </SelectTrigger>
      <SelectContent>
        {instruments
          .filter((i) => i.value !== exclude)
          .map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}

export function NavChart() {
  const { data: instruments } = useNavChartInstruments()
  const [selectedId, setSelectedId] = usePersistentState<number | null>('nav-chart-instrument', null)
  const [compareId, setCompareId] = useState<number | null>(null)
  const [compareMode, setCompareMode] = useState(false)

  const { data: mainData, isLoading: mainLoading } = useNavChart(selectedId)
  const { data: compareData } = useNavChart(compareMode ? compareId : null)

  const options = instruments?.map((i) => ({
    value: String(i.id),
    label: `${i.name ?? i.symbol ?? '?'} (${i.type})`,
  })) ?? []

  const selectedInstr = instruments?.find((i) => i.id === selectedId)
  const compareInstr = instruments?.find((i) => i.id === compareId)

  const compareLines = useMemo(() => {
    if (!compareMode || !mainData || !compareData) return undefined
    const mainNorm = normalizeToPercent(mainData.nav)
    const compNorm = normalizeToPercent(compareData.nav)
    const lines = [
      { data: mainNorm, label: selectedInstr?.name ?? 'Main', color: '#3b82f6' },
      { data: compNorm, label: compareInstr?.name ?? 'Compare', color: '#f59e0b' },
    ]
    if (selectedInstr?.type === 'ETF' && mainData.prices.length) {
      lines.push({ data: normalizeToPercent(mainData.prices), label: `${selectedInstr.name} (price)`, color: '#6366f1' })
    }
    return lines
  }, [compareMode, mainData, compareData, selectedInstr, compareInstr])

  const mainLine = useMemo(() => {
    if (compareMode || !mainData) return mainData?.nav
    if (selectedInstr?.type === 'ETF' && mainData.prices.length) return mainData.nav
    return mainData?.nav
  }, [compareMode, mainData, selectedInstr])

  const etfCompareLines = useMemo(() => {
    if (compareMode || !mainData || selectedInstr?.type !== 'ETF' || !mainData.prices.length) return undefined
    return [{ data: mainData.prices, label: `${selectedInstr?.name ?? 'ETF'} (close price)`, color: '#f59e0b' }]
  }, [compareMode, mainData, selectedInstr])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fund NAV Chart"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedId != null ? String(selectedId) : undefined}
              onValueChange={(v) => {
                setSelectedId(v ? Number(v) : null)
                setCompareMode(false)
                setCompareId(null)
              }}
            >
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Select fund…" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedId && !compareMode && (
              <Button size="sm" variant="outline" onClick={() => setCompareMode(true)}>
                <Plus className="size-3.5" />
                Compare
              </Button>
            )}
            {compareMode && (
              <>
                <CompareSelect
                  instruments={options}
                  value={compareId != null ? String(compareId) : null}
                  onChange={(v) => setCompareId(v != null ? Number(v) : null)}
                  exclude={selectedId != null ? String(selectedId) : null}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-negative"
                  onClick={() => {
                    setCompareMode(false)
                    setCompareId(null)
                  }}
                >
                  <X className="size-3.5" />
                  Remove
                </Button>
              </>
            )}
          </div>
        }
      />

      {selectedId == null && (
        <EmptyState icon={<BarChart3 className="size-5" />} title="Select a fund" description="Choose a fund to view and compare NAV history." />
      )}

      {compareMode && <p className="text-xs text-muted-foreground">Compare mode: series normalised to % change from first point.</p>}

      {selectedId != null && mainLoading && <Skeleton className="h-[520px] w-full" />}

      {mainData && selectedId != null && (
        <Section bodyClassName="p-2">
          {compareMode && compareLines ? (
            <LwChart seriesType="line" compareLines={compareLines} persistKey="nav_chart_h" defaultHeight={520} maskInPrivacy={false} />
          ) : (
            <div>
              <LwChart
                seriesType="area"
                line={mainLine}
                label={etfCompareLines ? `${selectedInstr?.name ?? 'NAV'} (NAV)` : undefined}
                markers={mainData.markers}
                compareLines={etfCompareLines}
                persistKey="nav_chart_h"
                defaultHeight={520}
                maskInPrivacy={false}
              />
              {etfCompareLines && (
                <p className="mt-1 text-xs text-muted-foreground">Blue = NAV · Orange = daily close price (Kite OHLC)</p>
              )}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}
