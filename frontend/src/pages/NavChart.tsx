import { useMemo, useState } from 'react'
import { Box, Button, Group, Select, Stack, Text, Title } from '@mantine/core'
import { IconPlus, IconX } from '@tabler/icons-react'
import { useNavChartInstruments, useNavChart } from '../api/charts'
import { LwChart } from '../components/LwChart'
import type { NavPoint } from '../types/charts'

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
    <Select
      placeholder="Add comparison…"
      data={instruments.filter((i) => i.value !== exclude)}
      value={value}
      onChange={onChange}
      searchable
      clearable
      w={260}
      size="xs"
    />
  )
}

export function NavChart() {
  const { data: instruments } = useNavChartInstruments()
  const [selectedId, setSelectedId] = useState<number | null>(null)
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
    <Stack gap="md">
      <Title order={3}>Fund NAV Chart</Title>

      <Group align="flex-end">
        <Select
          placeholder="Select fund…"
          data={options}
          value={selectedId != null ? String(selectedId) : null}
          onChange={(v) => { setSelectedId(v != null ? Number(v) : null); setCompareMode(false); setCompareId(null) }}
          searchable
          clearable
          w={320}
          size="sm"
        />
        {selectedId && !compareMode && (
          <Button size="xs" variant="light" leftSection={<IconPlus size={12} />} onClick={() => setCompareMode(true)}>
            Compare
          </Button>
        )}
        {compareMode && (
          <Group gap="xs">
            <CompareSelect
              instruments={options}
              value={compareId != null ? String(compareId) : null}
              onChange={(v) => setCompareId(v != null ? Number(v) : null)}
              exclude={selectedId != null ? String(selectedId) : null}
            />
            <Button size="xs" variant="subtle" color="red" leftSection={<IconX size={12} />} onClick={() => { setCompareMode(false); setCompareId(null) }}>
              Remove
            </Button>
          </Group>
        )}
      </Group>

      {compareMode && (
        <Text size="xs" c="dimmed">Compare mode: series normalised to % change from first point.</Text>
      )}

      {mainLoading && <Text size="sm" c="dimmed">Loading…</Text>}

      {mainData && selectedId != null && (
        <>
          {compareMode && compareLines ? (
            <LwChart
              seriesType="line"
              compareLines={compareLines}
              persistKey={`nav_chart_h_${selectedId}`}
              defaultHeight={520}
              maskInPrivacy={false}
            />
          ) : (
            <Box>
              <LwChart
                seriesType="area"
                line={mainLine}
                label={etfCompareLines ? `${selectedInstr?.name ?? 'NAV'} (NAV)` : undefined}
                markers={mainData.markers}
                compareLines={etfCompareLines}
                persistKey={`nav_chart_h_${selectedId}`}
                defaultHeight={520}
                maskInPrivacy={false}
              />
              {etfCompareLines && (
                <Text size="xs" c="dimmed" mt={4}>
                  Blue = NAV · Orange = daily close price (Kite OHLC)
                </Text>
              )}
            </Box>
          )}
        </>
      )}
    </Stack>
  )
}
