import { CandlestickChart } from 'lucide-react'
import { useChartInstruments, usePriceChart } from '../api/charts'
import { LwChart } from '../components/LwChart'
import { usePersistentState } from '../hooks/usePersistentState'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

export function PriceChart() {
  const { data: instruments } = useChartInstruments()
  const [selectedId, setSelectedId] = usePersistentState<number | null>('price-chart-instrument', null)
  const { data: chartData, isLoading } = usePriceChart(selectedId)

  const options = instruments?.map((i) => ({
    value: String(i.id),
    label: `${i.symbol ?? '?'} (${i.type})`,
  })) ?? []

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Price Chart"
        actions={
          <Select
            value={selectedId != null ? String(selectedId) : undefined}
            onValueChange={(v) => setSelectedId(v ? Number(v) : null)}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select instrument…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {selectedId == null && (
        <EmptyState icon={<CandlestickChart className="size-5" />} title="Select an instrument" description="Choose an instrument to view its price history." />
      )}

      {selectedId != null && isLoading && <Skeleton className="h-[520px] w-full" />}

      {chartData && selectedId != null && (
        <Section bodyClassName="p-2">
          <LwChart
            seriesType="candlestick"
            candles={chartData.candles}
            markers={chartData.markers}
            persistKey="price_chart_h"
            defaultHeight={520}
            maskInPrivacy={false}
          />
        </Section>
      )}
    </div>
  )
}
