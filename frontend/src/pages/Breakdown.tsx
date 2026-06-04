import React, { useEffect, useState } from 'react'
import {
  Box, Button, Group, NumberInput, Paper, ScrollArea, Stack,
  Table, Tabs, Text, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh } from '@tabler/icons-react'
import {
  useBreakdownChart,
  useSectorComposition,
  useSectorStockBreakdown,
  useCategoryComposition,
  useAllocationComparison,
  useSaveAllocationTargetsMutation,
  useClassifyBatchMutation,
  useSchemeBreakdown,
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
          <Table fz="sm" withColumnBorders={false}>
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
  const { data: stockBreakdown } = useSectorStockBreakdown()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!sectors) return <Text size="sm" c="dimmed">Loading…</Text>

  const totalSum = sectors.reduce((acc, s) => acc + s.total, 0)
  const grandTotal = stockBreakdown ? stockBreakdown.reduce((acc, s) => acc + s.total, 0) : 0
  const labels = sectors.map((s) => s.sector)
  const values = sectors.map((s) => s.total)

  const stocksBySector = stockBreakdown
    ? Object.fromEntries(stockBreakdown.map((s) => [s.sector, s.holdings]))
    : {}

  function toggle(sector: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(sector) ? next.delete(sector) : next.add(sector)
      return next
    })
  }

  return (
    <Stack gap="lg">
      {labels.length > 0 && (
        <DonutChart labels={labels} values={values} colorMode="sector" />
      )}

      <Box>
        <Table fz="sm" withColumnBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Sector</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>% of equity</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sectors.map((s, i) => (
              <React.Fragment key={s.sector}>
                <Table.Tr
                  style={{ cursor: 'pointer', background: 'var(--mantine-color-gray-1)' }}
                  onClick={() => toggle(s.sector)}
                >
                  <Table.Td fw={600}>
                    {expanded.has(s.sector) ? '▾' : '▸'}{' '}
                    <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Box component="span" style={{ width: 8, height: 8, borderRadius: 2, background: sectorColor(i, sectors.length, s.sector), display: 'inline-block' }} />
                      {s.sector}
                    </Box>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{totalSum > 0 ? (s.total / totalSum * 100).toFixed(2) : '0.00'}%</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><MoneyText value={s.total} compact /></Table.Td>
                </Table.Tr>
                {expanded.has(s.sector) && (stocksBySector[s.sector] ?? []).map((h, j) => (
                  <Table.Tr key={`${s.sector}-${j}`}>
                    <Table.Td pl="xl">{h.name}</Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text c="dimmed">{h.pct.toFixed(2)}% in sector · {grandTotal > 0 ? (h.value / grandTotal * 100).toFixed(2) : '0.00'}% of equity</Text>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><MoneyText value={h.value} compact /></Table.Td>
                  </Table.Tr>
                ))}
              </React.Fragment>
            ))}
          </Table.Tbody>
        </Table>
      </Box>
    </Stack>
  )
}

function FundStockRows({ schemeIsin, filterCategory }: { schemeIsin: string; filterCategory: string }) {
  const { data, isLoading } = useSchemeBreakdown(schemeIsin)
  if (isLoading) return (
    <Table.Tr>
      <Table.Td colSpan={3} style={{ paddingLeft: '4rem' }}>
        <Text c="dimmed">Loading stocks…</Text>
      </Table.Td>
    </Table.Tr>
  )
  if (!data?.holdings.length) return null
  const sorted = [...data.holdings]
    .filter((h) => h.category === filterCategory)
    .sort((a, b) => b.value - a.value)
  if (!sorted.length) return null
  return (
    <>
      {sorted.map((h, i) => (
        <Table.Tr key={i} style={{ background: 'var(--mantine-color-blue-0)' }}>
          <Table.Td style={{ paddingLeft: '4rem' }}>{h.name}</Table.Td>
          <Table.Td style={{ textAlign: 'right' }}><MoneyText value={h.value} compact /></Table.Td>
          <Table.Td style={{ textAlign: 'right' }}>{h.pct.toFixed(2)}%</Table.Td>
        </Table.Tr>
      ))}
    </>
  )
}

function CompositionTab() {
  const { data: cats } = useCategoryComposition()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedFunds, setExpandedFunds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (cats) setExpanded(new Set(cats.map((c) => c.category)))
  }, [cats])

  if (!cats) return <Text size="sm" c="dimmed">Loading…</Text>

  function toggle(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  function toggleFund(key: string) {
    setExpandedFunds((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  return (
    <Table fz="sm" withColumnBorders={false}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Category / Scheme / Stock</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
          <Table.Th style={{ textAlign: 'right' }}>% of category</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {cats.map((cat) => (
          <React.Fragment key={cat.category}>
            <Table.Tr
              style={{ cursor: 'pointer', background: 'var(--mantine-color-gray-1)' }}
              onClick={() => toggle(cat.category)}
            >
              <Table.Td fw={600}>
                {expanded.has(cat.category) ? '▾' : '▸'}{' '}
                <Box component="span" style={{ color: categoryColor(cat.category) }}>{cat.category}</Box>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><MoneyText value={cat.total} compact /></Table.Td>
              <Table.Td />
            </Table.Tr>
            {expanded.has(cat.category) && cat.sources.map((s, i) => {
              const fundKey = `${cat.category}||${s.isin ?? i}`
              const canExpand = !!s.isin
              const isFundExpanded = expandedFunds.has(fundKey)
              return (
                <React.Fragment key={fundKey}>
                  <Table.Tr
                    style={{
                      cursor: canExpand ? 'pointer' : undefined,
                      background: isFundExpanded ? 'var(--mantine-color-gray-2)' : undefined,
                      fontWeight: isFundExpanded ? 600 : undefined,
                    }}
                    onClick={canExpand ? () => toggleFund(fundKey) : undefined}
                  >
                    <Table.Td pl="xl">
                      {canExpand ? (isFundExpanded ? '▾ ' : '▸ ') : ''}
                      {s.name}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><MoneyText value={s.contribution} compact /></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{s.share_pct.toFixed(1)}%</Table.Td>
                  </Table.Tr>
                  {canExpand && isFundExpanded && <FundStockRows schemeIsin={s.isin!} filterCategory={cat.category} />}
                </React.Fragment>
              )
            })}
          </React.Fragment>
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
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="sector" pt="md"><SectorTab /></Tabs.Panel>
        <Tabs.Panel value="composition" pt="md"><CompositionTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
