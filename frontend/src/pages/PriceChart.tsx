import { useState } from 'react'
import { Select, Stack, Text, Title } from '@mantine/core'
import { useChartInstruments, usePriceChart } from '../api/charts'
import { LwChart } from '../components/LwChart'

export function PriceChart() {
  const { data: instruments } = useChartInstruments()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { data: chartData, isLoading } = usePriceChart(selectedId)

  const options = instruments?.map((i) => ({
    value: String(i.id),
    label: `${i.symbol ?? '?'} (${i.type})`,
  })) ?? []

  return (
    <Stack gap="md">
      <Title order={3}>Price Chart</Title>

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

      {isLoading && <Text size="sm" c="dimmed">Loading…</Text>}

      {chartData && selectedId != null && (
        <LwChart
          seriesType="candlestick"
          candles={chartData.candles}
          markers={chartData.markers}
          persistKey={`price_chart_h_${selectedId}`}
          defaultHeight={520}
        />
      )}
    </Stack>
  )
}
