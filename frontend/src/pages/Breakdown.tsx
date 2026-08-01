import React, { useEffect, useState } from 'react'
import {
  Box, Button, Group, NumberInput, Paper, Select, SegmentedControl, Stack,
  Table, Tabs, Text, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useDebouncedValue } from '@mantine/hooks'
import { IconRefresh } from '@tabler/icons-react'
import {
  useBreakdownChart,
  useSectorComposition,
  useSectorStockBreakdown,
  useCategoryComposition,
  useAllocationComparison,
  useAssetClassComparison,
  useRebalancePlan,
  useSaveAllocationTargetsMutation,
  useSaveAssetClassTargetsMutation,
  useClassifyBatchMutation,
  useSectorList,
  useSectorClassifyBatchMutation,
  useSchemeBreakdown,
} from '../api/mfBreakdown'
import { DonutChart } from '../components/DonutChart'
import { SsePanel } from '../components/SsePanel'
import { MoneyText } from '../components/MoneyText'
import { useSse } from '../hooks/useSse'
import { usePersistentState } from '../hooks/usePersistentState'
import { apiUrl } from '../api/client'
import { categoryColor, sectorColor } from '../lib/colors'
import { inrCompact } from '../lib/format'
import type { IngestDonePayload, RebalanceBucket } from '../types/mfBreakdown'

function diffColor(diff: number): string | undefined {
  return Math.abs(diff) >= 3 ? 'var(--mantine-color-red-5)' : undefined
}

// ── Rebalance calculator — shared by asset-class and category tables ────────────

function RebalanceControls({
  cashToZeroDrift,
  cash,
  onCashChange,
  bindingNote,
}: {
  cashToZeroDrift: number
  cash: number | ''
  onCashChange: (v: number | '') => void
  bindingNote?: string | null
}) {
  return (
    <Stack gap={2} mb="xs">
      <Group gap="sm" align="center">
        <Text size="sm">Cash to deploy:</Text>
        <NumberInput
          size="xs"
          w={140}
          value={cash}
          onChange={(v) => onCashChange(v === '' ? '' : Number(v))}
          placeholder={cashToZeroDrift.toFixed(0)}
          min={0}
          prefix="₹"
          thousandSeparator=","
        />
        <Button size="xs" variant="subtle" onClick={() => onCashChange('')}>
          Zero all drifts: <MoneyText value={cashToZeroDrift} compact />
        </Button>
        <Text size="xs" c="dimmed">
          Only adds to under-allocated buckets. Over-allocated buckets need sells or time to correct.
        </Text>
      </Group>
      {bindingNote && <Text size="xs" c="dimmed">{bindingNote}</Text>}
    </Stack>
  )
}

function RebalanceRows({ buckets }: { buckets: RebalanceBucket[] }) {
  return (
    <>
      {buckets.map((b) => {
        const overAllocated = b.invest === 0 && b.remaining_drift < -0.01
        return (
          <Table.Tr key={b.category} style={overAllocated ? { opacity: 0.6 } : undefined}>
            <Table.Td>
              <Group gap={6}>
                <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(b.category) }} />
                {b.category}
                {overAllocated && <Text size="xs" c="dimmed">over-allocated — no action</Text>}
              </Group>
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{b.target_pct.toFixed(1)}%</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{b.current_pct.toFixed(2)}%</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>
              {b.invest > 0
                ? <MoneyText value={b.invest} compact style={{ color: 'var(--mantine-color-green-6)' }} />
                : '—'}
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{b.new_pct.toFixed(2)}%</Table.Td>
            <Table.Td style={{ textAlign: 'right', color: overAllocated ? 'var(--mantine-color-red-5)' : 'var(--mantine-color-green-6)' }}>
              {b.remaining_drift >= 0 ? '+' : ''}{b.remaining_drift.toFixed(2)}%
            </Table.Td>
          </Table.Tr>
        )
      })}
    </>
  )
}

function RebalanceTableHead() {
  return (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>Category</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Invest</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>New %</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Remaining drift</Table.Th>
      </Table.Tr>
    </Table.Thead>
  )
}

function AssetClassTargetsSection({
  rebalanceView,
  onToggleRebalanceView,
}: {
  rebalanceView: boolean
  onToggleRebalanceView: (v: boolean) => void
}) {
  const { data: ac, refetch } = useAssetClassComparison()
  const saveMut = useSaveAssetClassTargetsMutation()
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [cashInput, setCashInput] = useState<number | ''>('')
  const [debouncedCash] = useDebouncedValue(cashInput, 500)
  const { data: plan } = useRebalancePlan('anchored', debouncedCash === '' ? undefined : debouncedCash)

  if (!ac) return null

  async function handleSave() {
    try {
      const updated = Object.fromEntries(
        ac!.rows.map((r) => [r.asset_class, targets[r.asset_class] ?? r.target_pct])
      )
      updated['Equity - Foreign'] = targets['Equity - Foreign'] ?? ac!.foreign_equity_target
      await saveMut.mutateAsync(updated)
      notifications.show({ color: 'green', message: 'Asset class targets saved.' })
      refetch()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  const { emergency_fund, cash } = ac.excluded

  return (
    <Box>
      <Group justify="space-between" align="center" mb="xs">
        <Text fw={600}>
          Asset class targets{' '}
          <Text component="span" size="xs" c="dimmed" fw={400}>
            (% of invested portfolio · <MoneyText value={ac.investable_total} compact />)
          </Text>
        </Text>
        <SegmentedControl
          size="xs"
          value={rebalanceView ? 'rebalance' : 'shortfall'}
          onChange={(v) => onToggleRebalanceView(v === 'rebalance')}
          data={[
            { label: 'Shortfall / Surplus', value: 'shortfall' },
            { label: 'Rebalance', value: 'rebalance' },
          ]}
        />
      </Group>
      {rebalanceView && plan && (
        <RebalanceControls
          cashToZeroDrift={plan.asset_class_cash_to_zero_drift}
          cash={cashInput}
          onCashChange={setCashInput}
          bindingNote={plan.asset_class_binding_note}
        />
      )}
      <Table fz="sm" withColumnBorders={false}>
        {rebalanceView ? <RebalanceTableHead /> : (
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Asset class</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Diff</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Shortfall / Surplus</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>New target</Table.Th>
          </Table.Tr>
        </Table.Thead>
        )}
        <Table.Tbody>
          {rebalanceView && plan ? (
            <RebalanceRows buckets={plan.asset_class} />
          ) : ac.rows.map((r) => (
            <Table.Tr key={r.asset_class}>
              <Table.Td>
                <Group gap={6}>
                  <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(r.asset_class) }} />
                  {r.asset_class}
                </Group>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>{r.target_pct.toFixed(1)}%</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>{r.current_pct.toFixed(2)}%</Table.Td>
              <Table.Td style={{ textAlign: 'right', color: diffColor(r.current_diff) }}>
                {r.current_diff >= 0 ? '+' : ''}{r.current_diff.toFixed(2)}%
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <MoneyText value={r.shortfall} compact showSign style={{ color: diffColor(r.current_diff) }} />
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.current_value} compact /></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <NumberInput
                  size="xs"
                  w={80}
                  value={targets[r.asset_class] ?? r.target_pct}
                  onChange={(v) => setTargets((p) => ({ ...p, [r.asset_class]: Number(v) }))}
                  min={0}
                  max={100}
                  step={1}
                />
              </Table.Td>
            </Table.Tr>
          ))}
          {!rebalanceView && (
          <Table.Tr style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
            <Table.Td>
              <Group gap={6}>
                <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor('Equity - Foreign') }} />
                Equity - Foreign
                <Text size="xs" c="dimmed">(% of total equity)</Text>
              </Group>
            </Table.Td>
            <Table.Td colSpan={5} />
            <Table.Td style={{ textAlign: 'right' }}>
              <NumberInput
                size="xs"
                w={80}
                value={targets['Equity - Foreign'] ?? ac.foreign_equity_target}
                onChange={(v) => setTargets((p) => ({ ...p, 'Equity - Foreign': Number(v) }))}
                min={0}
                max={100}
                step={1}
              />
            </Table.Td>
          </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {!rebalanceView && (
      <Group gap="lg" mt="xs" align="center">
        <Button size="xs" loading={saveMut.isPending} onClick={handleSave}>
          Save targets
        </Button>
        <Text size="xs" c="dimmed">
          Excludes:{' '}
          {emergency_fund > 0 && <>Emergency fund {inrCompact(emergency_fund)}, </>}
          {cash > 0 && <>Savings {inrCompact(cash)}</>}
        </Text>
      </Group>
      )}
    </Box>
  )
}

function OverviewTab() {
  const { data: chart } = useBreakdownChart()
  const { data: ac } = useAssetClassComparison()
  const [mode, setMode] = usePersistentState<'anchored' | 'free_float'>('allocationMode', 'anchored')
  const { data: comparison, refetch: refetchComp } = useAllocationComparison(mode)
  const saveMut = useSaveAllocationTargetsMutation()
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [rebalanceView, setRebalanceView] = usePersistentState('rebalanceView', false)
  const [cashInput, setCashInput] = useState<number | ''>('')
  const [debouncedCash] = useDebouncedValue(cashInput, 500)
  const { data: plan } = useRebalancePlan(mode, debouncedCash === '' ? undefined : debouncedCash)

  const isAnchored = mode === 'anchored'

  async function handleSaveTargets() {
    if (!comparison) return
    try {
      let allTargets: Record<string, number>
      if (isAnchored) {
        const domesticRows = comparison.rows.filter((r) => r.category !== 'Equity - Foreign')
        allTargets = Object.fromEntries([
          ...domesticRows.map((r) => [r.category, targets[r.category] ?? r.target_pct] as [string, number]),
          ['Equity - Foreign', targets['Equity - Foreign'] ?? comparison.foreign.target_pct],
        ])
      } else {
        allTargets = Object.fromEntries(
          comparison.rows.map((r) => [r.category, targets[r.category] ?? r.target_pct])
        )
      }
      await saveMut.mutateAsync({ targets: allTargets, mode })
      notifications.show({ color: 'green', message: 'Targets saved.' })
      refetchComp()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  if (!chart) return <Text size="sm" c="dimmed">Loading…</Text>

  // High-level allocation donut — order: Equity, Debt, Precious Metals, Emergency Fund, Cash, Real Estate Trust, Others
  const emergencyFund = ac?.excluded.emergency_fund ?? 0
  const valueMap = Object.fromEntries(chart.labels.map((l, i) => [l, chart.values[i]]))
  const hlGroups: Array<[string, string[]]> = [
    ['Equity',          ['Large Cap', 'Mid Cap', 'Small Cap', 'Unclassified Equity', 'Equity - Foreign']],
    ['Debt',            ['Debt', 'Equity - Arbitrage']],
    ['Precious Metals', ['Gold', 'Silver']],
    ['Emergency Fund',  []],
    ['Cash',            ['Cash']],
    ['Real Estate Trust', ['Real Estate Trust']],
  ]
  const coveredCats = new Set(hlGroups.flatMap(([, cats]) => cats))
  const hlEntries: [string, number][] = hlGroups
    .map(([group, cats]) => {
      let v = cats.reduce((s, c) => s + (valueMap[c] ?? 0), 0)
      if (group === 'Debt') v = Math.max(0, v - emergencyFund)
      if (group === 'Emergency Fund') v = emergencyFund
      return [group, v] as [string, number]
    })
    .filter(([, v]) => v > 0)
  const otherSum = chart.labels.reduce((s, l, i) => coveredCats.has(l) ? s : s + chart.values[i], 0)
  if (otherSum > 0) hlEntries.push(['Other', otherSum])
  const hlLabels = hlEntries.map(([l]) => l)
  const hlValues = hlEntries.map(([, v]) => v)

  // Category breakdown donut — order: Large, Mid, Small, Foreign, Debt, Equity Arbitrage, Gold, Silver, Emergency Fund, Cash, Real Estate Trust, Others
  const CAT_ORDER = ['Large Cap', 'Mid Cap', 'Small Cap', 'Unclassified Equity', 'Equity - Foreign', 'Debt', 'Equity - Arbitrage', 'Gold', 'Silver', 'Emergency Fund', 'Cash', 'Real Estate Trust']
  const rawCatMap = Object.fromEntries(chart.labels.map((l, i) => [l, chart.values[i]]))
  rawCatMap['Emergency Fund'] = emergencyFund
  rawCatMap['Debt'] = Math.max(0, (rawCatMap['Debt'] ?? 0) - emergencyFund)
  const coveredCatOrder = new Set(CAT_ORDER)
  const catEntries: [string, number][] = [
    ...CAT_ORDER.map((l) => [l, rawCatMap[l] ?? 0] as [string, number]).filter(([, v]) => v > 0),
    ...chart.labels
      .filter((l) => !coveredCatOrder.has(l))
      .map((l) => [l, rawCatMap[l] ?? 0] as [string, number])
      .filter(([, v]) => v > 0),
  ]
  const catLabels = catEntries.map(([l]) => l)
  const catValues = catEntries.map(([, v]) => v)

  const modeToggle = (
    <SegmentedControl
      size="xs"
      value={mode}
      onChange={(v) => { setMode(v as 'anchored' | 'free_float'); setTargets({}) }}
      data={[
        { label: 'Large Cap Anchored', value: 'anchored' },
        { label: 'Free Float', value: 'free_float' },
      ]}
    />
  )

  return (
    <Stack gap="lg">
      {chart.labels.length > 0 && (
        <Group align="flex-start" wrap="wrap" gap="xl" justify="center">
          <Stack gap={4}>
            <Text fw={600} size="sm">Asset Allocation</Text>
            <DonutChart labels={hlLabels} values={hlValues} total={chart.total} />
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">Category Breakdown</Text>
            <DonutChart labels={catLabels} values={catValues} total={chart.total} />
          </Stack>
        </Group>
      )}

      {isAnchored && (
        <AssetClassTargetsSection rebalanceView={rebalanceView} onToggleRebalanceView={setRebalanceView} />
      )}

      {comparison && (
        <Box>
          <Group justify="space-between" align="center" mb="xs">
            <Text fw={600}>
              {isAnchored ? (
                <>Equity allocation targets <Text component="span" size="xs" fw={400}>(% of domestic equity)</Text></>
              ) : (
                <>Allocation targets <Text component="span" size="xs" fw={400}>(% of pool · <MoneyText value={comparison.pool ?? comparison.current_equity} compact />, excludes emergency fund & cash)</Text></>
              )}
            </Text>
            <Group gap="sm">
              <SegmentedControl
                size="xs"
                value={rebalanceView ? 'rebalance' : 'shortfall'}
                onChange={(v) => setRebalanceView(v === 'rebalance')}
                data={[
                  { label: 'Shortfall / Surplus', value: 'shortfall' },
                  { label: 'Rebalance', value: 'rebalance' },
                ]}
              />
              {modeToggle}
            </Group>
          </Group>

          {rebalanceView && plan && (
            <RebalanceControls
              cashToZeroDrift={plan.cash_to_zero_drift}
              cash={cashInput}
              onCashChange={setCashInput}
              bindingNote={plan.binding_note}
            />
          )}
          {rebalanceView && plan?.conflict_note && (
            <Text size="xs" c="dimmed" mb="xs">{plan.conflict_note}</Text>
          )}

          <Table fz="sm" withColumnBorders={false}>
            {rebalanceView ? <RebalanceTableHead /> : (
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Diff</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Shortfall / Surplus</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>New target</Table.Th>
              </Table.Tr>
            </Table.Thead>
            )}
            <Table.Tbody>
              {rebalanceView && plan ? (
                <RebalanceRows buckets={plan.buckets} />
              ) : comparison.rows.map((r) => {
                const isForeign = r.category === 'Equity - Foreign'
                const isAnchor = isAnchored && r.category === 'Large Cap'
                const showShortfall = !isAnchor
                const showTargetInput = !(isAnchored && isForeign)
                const inputVal = targets[r.category] ?? (isAnchored && isForeign ? comparison.foreign.target_pct : r.target_pct)
                return (
                  <Table.Tr key={r.category}>
                    <Table.Td>
                      <Group gap={6}>
                        <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(r.category) }} />
                        {r.category}
                      </Group>
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {r.anchor_note
                        ? <Text size="xs">{r.anchor_note}</Text>
                        : `${r.target_pct.toFixed(1)}%`}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>{r.current_pct.toFixed(2)}%</Table.Td>
                    <Table.Td style={{ textAlign: 'right', color: isAnchor ? undefined : diffColor(r.current_diff) }}>
                      {isAnchor ? '—' : `${r.current_diff > 0 ? '+' : ''}${r.current_diff.toFixed(2)}%`}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {showShortfall && (
                        <MoneyText value={r.current_value_diff} compact showSign style={{ color: diffColor(r.current_diff) }} />
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.current_value} compact /></Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {showTargetInput ? (
                        <NumberInput
                          size="xs"
                          w={80}
                          value={inputVal}
                          onChange={(v) => setTargets((p) => ({ ...p, [r.category]: Number(v) }))}
                          min={0}
                          max={100}
                          step={0.1}
                        />
                      ) : (
                        <Text size="xs">50% of LC</Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
          {!rebalanceView && (
            <Button size="xs" mt="xs" loading={saveMut.isPending} onClick={handleSaveTargets}>
              Save targets
            </Button>
          )}
        </Box>
      )}
    </Stack>
  )
}

function SectorClassifyPanel({
  unknownHoldings,
  onDone,
}: {
  unknownHoldings: Array<{ name: string; value: number; pct: number }>
  onDone: () => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const { data: sectorList } = useSectorList()
  const classifyMut = useSectorClassifyBatchMutation()

  async function handleSave() {
    const rows = unknownHoldings
      .filter((h) => selections[h.name])
      .map((h) => ({ name: h.name, sector: selections[h.name] }))
    if (!rows.length) return
    try {
      const res = await classifyMut.mutateAsync(rows)
      notifications.show({ color: 'green', message: `Classified ${res.updated} holding${res.updated === 1 ? '' : 's'}.` })
      onDone()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  const pendingCount = unknownHoldings.filter((h) => !selections[h.name]).length

  return (
    <Paper withBorder p="sm">
      <Text fw={600} size="sm" mb="xs">
        Classify unknown-sector stocks ({unknownHoldings.length})
      </Text>
      <Table fz="sm" withColumnBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Stock name</Table.Th>
            <Table.Th style={{ width: 220 }}>Sector</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {unknownHoldings.map((h) => (
            <Table.Tr key={h.name}>
              <Table.Td>{h.name}</Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  placeholder="Select sector…"
                  data={sectorList ?? []}
                  searchable
                  value={selections[h.name] ?? null}
                  onChange={(v) => setSelections((prev) => ({ ...prev, [h.name]: v ?? '' }))}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt="xs" gap="xs">
        <Button
          size="xs"
          loading={classifyMut.isPending}
          disabled={!Object.values(selections).filter(Boolean).length}
          onClick={handleSave}
        >
          Save{pendingCount > 0 ? ` (${unknownHoldings.length - pendingCount} of ${unknownHoldings.length})` : ' all'}
        </Button>
        <Button size="xs" variant="subtle" color="gray" onClick={onDone}>
          Dismiss
        </Button>
      </Group>
    </Paper>
  )
}

function SectorTab({ dismissed, onDismiss }: { dismissed: boolean; onDismiss: () => void }) {
  const { data: sectors } = useSectorComposition()
  const { data: stockBreakdown } = useSectorStockBreakdown()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (!sectors) return <Text size="sm" c="dimmed">Loading…</Text>

  const unknownHoldings = stockBreakdown?.find((s) => s.sector === 'Unknown')?.holdings ?? []

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

      {!dismissed && unknownHoldings.length > 0 && (
        <SectorClassifyPanel unknownHoldings={unknownHoldings} onDone={onDismiss} />
      )}
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
      {ingest?.missing_funds?.length ? (
        <Stack gap={2} mt={4}>
          <Text size="xs" c="red" fw={600}>Missing CSVs for {ingest.missing_funds.length} held fund{ingest.missing_funds.length === 1 ? '' : 's'}:</Text>
          {ingest.missing_funds.map((f) => (
            <Text key={f.isin} size="xs" c="red">• {f.isin} — {f.name}</Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

const CAP_CATEGORIES = ['Large Cap', 'Mid Cap', 'Small Cap', 'Equity - Foreign']

interface UnmatchedEquity { name: string; scheme_isin: string }

function ClassifyPanel({
  equities,
  onDone,
}: {
  equities: UnmatchedEquity[]
  onDone: () => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const classifyMut = useClassifyBatchMutation()

  // Deduplicate by name for display; one override covers all schemes
  const unique = equities.filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i)

  async function handleSave() {
    const rows = unique
      .filter((e) => selections[e.name])
      .map((e) => ({ scheme_isin: e.scheme_isin, name: e.name, category: selections[e.name] }))
    if (!rows.length) return
    try {
      const res = await classifyMut.mutateAsync(rows)
      notifications.show({ color: 'green', message: `Classified ${res.updated} holding${res.updated === 1 ? '' : 's'}.` })
      onDone()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  const pendingCount = unique.filter((e) => !selections[e.name]).length

  return (
    <Paper withBorder p="sm">
      <Text fw={600} size="sm" mb="xs">
        Classify unmatched equities ({unique.length})
      </Text>
      <Table fz="sm" withColumnBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Stock name</Table.Th>
            <Table.Th style={{ width: 160 }}>Market cap</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {unique.map((e) => (
            <Table.Tr key={e.name}>
              <Table.Td>{e.name}</Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  placeholder="Select…"
                  data={CAP_CATEGORIES}
                  value={selections[e.name] ?? null}
                  onChange={(v) => setSelections((prev) => ({ ...prev, [e.name]: v ?? '' }))}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt="xs" gap="xs">
        <Button
          size="xs"
          loading={classifyMut.isPending}
          disabled={!Object.values(selections).filter(Boolean).length}
          onClick={handleSave}
        >
          Save{pendingCount > 0 ? ` (${unique.length - pendingCount} of ${unique.length})` : ' all'}
        </Button>
        <Button size="xs" variant="subtle" color="gray" onClick={onDone}>
          Dismiss
        </Button>
      </Group>
    </Paper>
  )
}

export function Breakdown() {
  const ingestSse = useSse<IngestDonePayload>(apiUrl('/api/v1/mf-breakdown/ingest/stream'))
  const [unmatchedEquities, setUnmatchedEquities] = useState<UnmatchedEquity[]>([])
  const [sectorClassifyDismissed, setSectorClassifyDismissed] = usePersistentState('sectorClassifyDismissed', false)

  useEffect(() => {
    const equities = ingestSse.result?.ingest?.unmatched_equities
    if (equities?.length) {
      setUnmatchedEquities(equities)
    }
    // Reset sector classify dismiss whenever a new ingest completes
    if (ingestSse.result) {
      setSectorClassifyDismissed(false)
    }
  }, [ingestSse.result])

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

      {unmatchedEquities.length > 0 && (
        <ClassifyPanel
          equities={unmatchedEquities}
          onDone={() => setUnmatchedEquities([])}
        />
      )}

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="sector">Sector</Tabs.Tab>
          <Tabs.Tab value="composition">Composition</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="sector" pt="md"><SectorTab dismissed={sectorClassifyDismissed} onDismiss={() => setSectorClassifyDismissed(true)} /></Tabs.Panel>
        <Tabs.Panel value="composition" pt="md"><CompositionTab /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
