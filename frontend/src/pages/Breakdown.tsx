import { useState } from 'react'
import {
  Box, Button, Group, NumberInput, Paper, ScrollArea, Stack,
  Table, Tabs, Text, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import {
  useBreakdownChart,
  useSectorComposition,
  useCategoryComposition,
  useAllocationComparison,
  useSaveAllocationTargetsMutation,
  useClassifyBatchMutation,
  useDirectTrades,
} from '../api/mfBreakdown'
import { DonutChart } from '../components/DonutChart'
import { SsePanel } from '../components/SsePanel'
import { MoneyText } from '../components/MoneyText'
import { useSse } from '../hooks/useSse'
import { apiUrl } from '../api/client'
import { categoryColor, sectorColor } from '../lib/colors'
import type { IngestDonePayload } from '../types/mfBreakdown'

function OverviewTab() {
  const { data: chart } = useBreakdownChart()
  const { data: comparison, refetch: refetchComp } = useAllocationComparison()
  const saveMut = useSaveAllocationTargetsMutation()
  const [targets, setTargets] = useState<Record<string, number>>({})

  async function handleSaveTargets() {
    try {
      await saveMut.mutateAsync(targets)
      notifications.show({ color: 'green', message: 'Targets saved.' })
      refetchComp()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  if (!chart) return <Text size="sm" c="dimmed">Loading…</Text>

  return (
    <Stack gap="lg">
      {chart.labels.length > 0 && (
        <DonutChart labels={chart.labels} values={chart.values} total={chart.total} />
      )}

      {comparison && (
        <Box>
          <Text fw={600} mb="xs">Allocation vs Targets</Text>
          <Table fz="xs" withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Diff</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>New target</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {comparison.rows.map((r) => (
                <Table.Tr key={r.category}>
                  <Table.Td>
                    <Group gap={6}>
                      <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(r.category) }} />
                      {r.category}
                    </Group>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{r.target_pct.toFixed(1)}%</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{r.current_pct.toFixed(2)}%</Table.Td>
                  <Table.Td style={{ textAlign: 'right', color: r.current_diff > 0 ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)' }}>
                    {r.current_diff > 0 ? '+' : ''}{r.current_diff.toFixed(2)}%
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.current_value} compact /></Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <NumberInput
                      size="xs"
                      w={80}
                      value={targets[r.category] ?? r.target_pct}
                      onChange={(v) => setTargets((p) => ({ ...p, [r.category]: Number(v) }))}
                      min={0}
                      max={100}
                      step={1}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Button size="xs" mt="xs" loading={saveMut.isPending} onClick={handleSaveTargets}>
            Save targets
          </Button>
        </Box>
      )}
    </Stack>
  )
}

function SectorTab() {
  const { data: sectors } = useSectorComposition()
  if (!sectors) return <Text size="sm" c="dimmed">Loading…</Text>

  const labels = sectors.map((s) => s.sector)
  const values = sectors.map((s) => s.value)

  return (
    <Stack gap="lg">
      {labels.length > 0 && (
        <DonutChart labels={labels} values={values} colorMode="sector" />
      )}

      <Box>
        <Table fz="xs" withColumnBorders={false} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sector</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>%</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sectors.map((s, i) => (
              <Table.Tr key={s.sector}>
                <Table.Td>
                  <Group gap={6}>
                    <Box style={{ width: 8, height: 8, borderRadius: 2, background: sectorColor(i, sectors.length, s.sector) }} />
                    {s.sector}
                  </Group>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{s.pct.toFixed(2)}%</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><MoneyText value={s.value} compact /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>
    </Stack>
  )
}

function CompositionTab() {
  const { data: cats } = useCategoryComposition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!cats) return <Text size="sm" c="dimmed">Loading…</Text>

  function toggle(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  return (
    <Table fz="xs" withColumnBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Category / Scheme</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>% of category</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {cats.map((cat) => (
          <>
            <Table.Tr
              key={cat.category}
              style={{ cursor: 'pointer', background: 'var(--mantine-color-dark-6)' }}
              onClick={() => toggle(cat.category)}
            >
              <Table.Td fw={600}>
                {expanded.has(cat.category) ? '▾' : '▸'}{' '}
                <Box component="span" style={{ color: categoryColor(cat.category) }}>{cat.category}</Box>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><MoneyText value={cat.total_value} compact /></Table.Td>
              <Table.Td />
            </Table.Tr>
            {expanded.has(cat.category) && cat.schemes.map((s) => (
              <Table.Tr key={s.scheme_isin}>
                <Table.Td pl="xl"><Text size="xs" c="dimmed">{s.name}</Text></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}><MoneyText value={s.value} compact /></Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{s.pct_of_category.toFixed(2)}%</Table.Td>
              </Table.Tr>
            ))}
          </>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function DirectTradesTab() {
  const { data } = useDirectTrades()
  if (!data) return <Text size="sm" c="dimmed">Loading…</Text>
  return (
    <Table fz="xs" withColumnBorders={false} highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Symbol</Table.Th>
          <Table.Th>Type</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Total Buy</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Total Sell</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Net</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {data.map((r) => (
          <Table.Tr key={r.symbol}>
            <Table.Td>{r.symbol}</Table.Td>
            <Table.Td>{r.type}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.total_buy} compact /></Table.Td>
            <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.total_sell} compact /></Table.Td>
            <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.net} compact colorize /></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function IngestResultRenderer(result: IngestDonePayload) {
  const { amfi, ingest } = result
  return (
    <Stack gap={4}>
      {amfi?.error ? (
        <Text size="xs" c="red">AMFI: {amfi.error}</Text>
      ) : amfi ? (
        <Text size="xs">AMFI: {amfi.rows_loaded} stocks loaded ({amfi.large}L / {amfi.mid}M / {amfi.small}S) from {amfi.file}</Text>
      ) : null}
      {ingest?.error ? (
        <Text size="xs" c="red">Ingest: {ingest.error}</Text>
      ) : ingest ? (
        <Text size="xs">Ingest: {ingest.schemes_processed} scheme(s), {ingest.rows_upserted} row(s)</Text>
      ) : null}
      {ingest?.unmatched_equities?.length ? (
        <Text size="xs" c="orange">{ingest.unmatched_equities.length} unmatched equities — use classify panel to fix</Text>
      ) : null}
    </Stack>
  )
}

export function Breakdown() {
  const ingestSse = useSse<IngestDonePayload>(apiUrl('/api/v1/mf-breakdown/ingest/stream'))

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Portfolio Breakdown</Title>
        <Button
          size="xs"
          leftSection={<IconRefresh size={12} />}
          onClick={ingestSse.start}
          loading={ingestSse.status === 'running'}
          disabled={ingestSse.status === 'running'}
        >
          Ingest portfolios
        </Button>
      </Group>

      <SsePanel
        sse={ingestSse}
        heading="Ingesting portfolios…"
        resultRenderer={(r) => IngestResultRenderer(r as IngestDonePayload)}
      />

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="sector">Sector</Tabs.Tab>
          <Tabs.Tab value="composition">Composition</Tabs.Tab>
          <Tabs.Tab value="direct">Direct Trades</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="sector" pt="md"><SectorTab /></Tabs.Panel>
        <Tabs.Panel value="composition" pt="md"><CompositionTab /></Tabs.Panel>
        <Tabs.Panel value="direct" pt="md"><DirectTradesTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
