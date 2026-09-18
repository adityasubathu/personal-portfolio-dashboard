import { Select, Stack, Text } from '@mantine/core'
import { IconChartCandle } from '@tabler/icons-react'
import { useChartInstruments, usePriceChart } from '../api/charts'
import { LwChart } from '../components/LwChart'
import { usePersistentState } from '../hooks/usePersistentState'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'

export function PriceChart() {
  const { data: instruments } = useChartInstruments()
  const [selectedId, setSelectedId] = usePersistentState<number | null>('price-chart-instrument', null)
  const { data: chartData, isLoading } = usePriceChart(selectedId)

  const options = instruments?.map((i) => ({
    value: String(i.id),
    label: `${i.symbol ?? '?'} (${i.type})`,
  })) ?? []

  return (
    <Stack gap="md">
      <PageHeader title="Price Chart" />
      <Panel>
      <Select
        placeholder="Select instrument…"
        data={options}
        value={selectedId != null ? String(selectedId) : null}
        onChange={(v) => setSelectedId(v != null ? Number(v) : null)}
        searchable
        clearable
        w={320}
        size="sm"
      />

      {selectedId == null && <EmptyState icon={<IconChartCandle size={22} />} title="Select an instrument" description="Choose an instrument to view its price history." />}
      {isLoading && <Text size="sm" c="dimmed">Loading…</Text>}

      {chartData && selectedId != null && (
        <LwChart
          seriesType="candlestick"
          candles={chartData.candles}
          markers={chartData.markers}
          persistKey="price_chart_h"
          defaultHeight={520}
          maskInPrivacy={false}
        />
      )}</Panel>
    </Stack>
  )
}
