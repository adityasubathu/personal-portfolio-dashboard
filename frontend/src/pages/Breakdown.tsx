import React, { useState } from 'react'
import {
  Box, Button, Group, NumberInput, Paper, Select, SegmentedControl, Stack,
  Table, Tabs, Text,
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
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { DonutChart } from '../components/DonutChart'
import { SsePanel } from '../components/SsePanel'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { MoneyText } from '../components/MoneyText'
import { useSse } from '../hooks/useSse'
import { usePersistentState } from '../hooks/usePersistentState'
import { apiUrl } from '../api/client'
import { categoryColor, sectorColor } from '../lib/colors'
import { inrCompact, shortDate } from '../lib/format'
import type { ClassificationLevel, IngestDonePayload, RebalanceBucket, SyncedFund } from '../types/mfBreakdown'

const LEVEL_OPTIONS: Array<{ value: ClassificationLevel; label: string }> = [
  { value: 'macro_sector', label: 'Macro' },
  { value: 'sector', label: 'Sector' },
  { value: 'industry', label: 'Industry' },
  { value: 'basic_industry', label: 'Basic' },
]

const OTHERS_LABEL = 'Others'
const OTHERS_THRESHOLD_PCT = 1

type SectorRow = { sector: string; total: number }

/** Basic Industry fans out to ~148 values, most of them a rounding error. Anything
 *  under 1% of equity collapses into one grey slice — but only when there are at
 *  least two of them, so a lone small slice never becomes a one-item dropdown.
 *  Unknown is never clubbed: it means something different from "small". */
function splitOthers(sectors: SectorRow[], totalSum: number): { rows: SectorRow[]; others: SectorRow[] } {
  const threshold = totalSum * (OTHERS_THRESHOLD_PCT / 100)
  const small = sectors.filter((s) => s.sector !== 'Unknown' && s.total < threshold)
  if (small.length < 2) return { rows: sectors, others: [] }
  const smallLabels = new Set(small.map((s) => s.sector))
  return { rows: sectors.filter((s) => !smallLabels.has(s.sector)), others: small }
}

function diffColor(diff: number): string | undefined {
  return Math.abs(diff) >= 3 ? 'var(--mantine-color-red-5)' : undefined
}

// ── Rebalance calculator — shared by asset-class and category tables ────────────

function RebalanceControls({
  totalBuy,
  totalSell,
  cash,
  onCashChange,
}: {
  totalBuy: number
  totalSell: number
  cash: number | ''
  onCashChange: (v: number | '') => void
}) {
  return (
    <Stack gap={2} mb="xs">
      <Group gap="sm" align="center">
        <Text size="sm">Extra cash to add:</Text>
        <NumberInput
          size="xs"
          w={140}
          value={cash}
          onChange={(v) => onCashChange(v === '' ? '' : Number(v))}
          placeholder="0"
          min={0}
          prefix="₹"
          thousandSeparator=","
        />
        <Text size="xs" c="dimmed">
          Sell <MoneyText value={totalSell} compact style={{ color: 'var(--mantine-color-red-6)' }} /> from over-target buckets,
          buy <MoneyText value={totalBuy} compact style={{ color: 'var(--mantine-color-green-6)' }} /> into under-target ones — every bucket lands exactly on target.
        </Text>
      </Group>
    </Stack>
  )
}

function RebalanceRows({ buckets }: { buckets: RebalanceBucket[] }) {
  return (
    <>
      {buckets.map((b) => (
        <Table.Tr key={b.category}>
          <Table.Td>
            <Group gap={6}>
              <Box style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(b.category) }} />
              {b.category}
            </Group>
          </Table.Td>
          <Table.Td style={{ textAlign: 'right' }}>{b.target_pct.toFixed(1)}%</Table.Td>
          <Table.Td style={{ textAlign: 'right' }}>{b.current_pct.toFixed(2)}%</Table.Td>
          <Table.Td style={{ textAlign: 'right' }}>
            {Math.abs(b.invest) > 1 ? (
              <Group gap={4} justify="flex-end" wrap="nowrap">
                <Text size="xs" c="dimmed">{b.invest > 0 ? 'Buy' : 'Sell'}</Text>
                <MoneyText
                  value={Math.abs(b.invest)}
                  compact
                  style={{ color: b.invest > 0 ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-red-6)' }}
                />
              </Group>
            ) : '—'}
          </Table.Td>
          <Table.Td style={{ textAlign: 'right' }}>{b.new_pct.toFixed(2)}%</Table.Td>
          <Table.Td style={{ textAlign: 'right', color: 'var(--mantine-color-green-6)' }}>
            {b.remaining_drift >= 0 ? '+' : ''}{b.remaining_drift.toFixed(2)}%
          </Table.Td>
        </Table.Tr>
      ))}
    </>
  )
}

function TargetsTableHead({ firstColumn }: { firstColumn: string }) {
  return (
    <Table.Thead>
      <Table.Tr>
        <Table.Th>{firstColumn}</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Target %</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Current %</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Diff</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Shortfall / Surplus</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
        <Table.Th style={{ textAlign: 'right' }}>New target</Table.Th>
      </Table.Tr>
    </Table.Thead>
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
          totalBuy={plan.asset_class_total_buy}
          totalSell={plan.asset_class_total_sell}
          cash={cashInput}
          onCashChange={setCashInput}
        />
      )}
      <Text size="xs" c="dimmed" hiddenFrom="sm">Scroll horizontally to view all columns</Text>
      <Box style={{ overflowX: 'auto' }}>
      <Table fz="sm" withColumnBorders={false} style={{ minWidth: 760 }}>
        {rebalanceView ? <RebalanceTableHead /> : (
        <TargetsTableHead firstColumn="Asset class" />
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
      </Box>
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
        <Group align="stretch" wrap="wrap" gap="md" grow>
          <Panel title="Asset Allocation" style={{ flex: 1, minWidth: 280 }}>
            <DonutChart labels={hlLabels} values={hlValues} total={chart.total} />
          </Panel>
          <Panel title="Category Breakdown" style={{ flex: 1, minWidth: 280 }}>
            <DonutChart labels={catLabels} values={catValues} total={chart.total} />
          </Panel>
        </Group>
      )}

      {isAnchored && (
        <Panel><AssetClassTargetsSection rebalanceView={rebalanceView} onToggleRebalanceView={setRebalanceView} /></Panel>
      )}

      {comparison && (
        <Panel>
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
              totalBuy={plan.total_buy}
              totalSell={plan.total_sell}
              cash={cashInput}
              onCashChange={setCashInput}
            />
          )}
          {rebalanceView && plan?.conflict_note && (
            <Text size="xs" c="dimmed" mb="xs">{plan.conflict_note}</Text>
          )}

          <Text size="xs" c="dimmed" hiddenFrom="sm">Scroll horizontally to view all columns</Text>
          <Box style={{ overflowX: 'auto' }}>
          <Table fz="sm" withColumnBorders={false} style={{ minWidth: 760 }}>
            {rebalanceView ? <RebalanceTableHead /> : (
            <TargetsTableHead firstColumn="Category" />
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
          </Box>
          {!rebalanceView && (
            <Button size="xs" mt="xs" loading={saveMut.isPending} onClick={handleSaveTargets}>
              Save targets
            </Button>
          )}
        </Panel>
      )}
    </Stack>
  )
}

/** Shared shell for the two "pick a value for each unclassified name" panels.
 *  onSave returns how many holdings the server updated. */
function ClassifySelectPanel({
  title,
  columnLabel,
  columnWidth,
  placeholder,
  options,
  searchable = false,
  names,
  saving,
  onSave,
  onDone,
}: {
  title: (count: number) => string
  columnLabel: string
  columnWidth: number
  placeholder: string
  options: string[]
  searchable?: boolean
  names: string[]
  saving: boolean
  onSave: (selections: Record<string, string>) => Promise<number>
  onDone: () => void
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})

  async function handleSave() {
    const picked = Object.fromEntries(names.filter((n) => selections[n]).map((n) => [n, selections[n]]))
    if (!Object.keys(picked).length) return
    try {
      const updated = await onSave(picked)
      notifications.show({ color: 'green', message: `Classified ${updated} holding${updated === 1 ? '' : 's'}.` })
      onDone()
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  const doneCount = names.filter((n) => selections[n]).length

  return (
    <Paper withBorder p="sm">
      <Text fw={600} size="sm" mb="xs">{title(names.length)}</Text>
      <Table fz="sm" withColumnBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Stock name</Table.Th>
            <Table.Th style={{ width: columnWidth }}>{columnLabel}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {names.map((n) => (
            <Table.Tr key={n}>
              <Table.Td>{n}</Table.Td>
              <Table.Td>
                <Select
                  size="xs"
                  placeholder={placeholder}
                  data={options}
                  searchable={searchable}
                  value={selections[n] ?? null}
                  onChange={(v) => setSelections((prev) => ({ ...prev, [n]: v ?? '' }))}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group mt="xs" gap="xs">
        <Button size="xs" loading={saving} disabled={!doneCount} onClick={handleSave}>
          Save{doneCount < names.length ? ` (${doneCount} of ${names.length})` : ' all'}
        </Button>
        <Button size="xs" variant="subtle" color="gray" onClick={onDone}>
          Dismiss
        </Button>
      </Group>
    </Paper>
  )
}

function SectorClassifyPanel({
  level,
  unknownHoldings,
  onDone,
}: {
  level: ClassificationLevel
  unknownHoldings: Array<{ name: string; value: number; pct: number }>
  onDone: () => void
}) {
  const { data: valueList } = useSectorList(level)
  const classifyMut = useSectorClassifyBatchMutation()
  const levelLabel = LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? 'Sector'

  return (
    <ClassifySelectPanel
      key={level}
      title={(n) => `Classify unknown-${levelLabel.toLowerCase()} stocks (${n})`}
      columnLabel={levelLabel}
      columnWidth={260}
      placeholder={`Select ${levelLabel.toLowerCase()}…`}
      options={valueList ?? []}
      searchable
      names={unknownHoldings.map((h) => h.name)}
      saving={classifyMut.isPending}
      onSave={async (selections) => {
        const rows = Object.entries(selections).map(([name, value]) => ({ name, level, value }))
        return (await classifyMut.mutateAsync(rows)).updated
      }}
      onDone={onDone}
    />
  )
}

function SectorTab({
  dismissedLevels,
  onDismiss,
}: {
  dismissedLevels: ClassificationLevel[]
  onDismiss: (level: ClassificationLevel) => void
}) {
  const [level, setLevel] = usePersistentState<ClassificationLevel>('sectorLevel', 'sector')
  const { data: sectors } = useSectorComposition(level)
  const { data: stockBreakdown } = useSectorStockBreakdown(level)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function changeLevel(next: string) {
    setLevel(next as ClassificationLevel)
    setExpanded(new Set())
  }

  if (!sectors) return <Text size="sm" c="dimmed">Loading…</Text>

  const unknownHoldings = stockBreakdown?.find((s) => s.sector === 'Unknown')?.holdings ?? []

  const totalSum = sectors.reduce((acc, s) => acc + s.total, 0)
  const grandTotal = stockBreakdown ? stockBreakdown.reduce((acc, s) => acc + s.total, 0) : 0

  const { rows: mainRows, others: othersRows } =
    level === 'basic_industry' ? splitOthers(sectors, totalSum) : { rows: sectors as SectorRow[], others: [] as SectorRow[] }
  const othersTotal = othersRows.reduce((acc, s) => acc + s.total, 0)
  // One array drives the donut, its legend and the table, so the swatches always agree.
  const chartRows: SectorRow[] = othersRows.length
    ? [...mainRows, { sector: OTHERS_LABEL, total: othersTotal }]
    : mainRows

  const labels = chartRows.map((s) => s.sector)
  const values = chartRows.map((s) => s.total)

  const pctOfEquity = (value: number) => (totalSum > 0 ? (value / totalSum * 100).toFixed(2) : '0.00')

  const stocksBySector = stockBreakdown
    ? Object.fromEntries(stockBreakdown.map((s) => [s.sector, s.holdings]))
    : {}

  function toggle(sector: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sector)) next.delete(sector)
      else next.add(sector)
      return next
    })
  }

  return (
    <Stack gap="lg">
      <SegmentedControl
        value={level}
        onChange={changeLevel}
        data={LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        style={{ alignSelf: 'flex-start' }}
      />

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
            {chartRows.map((s, i) => (
              <React.Fragment key={s.sector}>
                <Table.Tr
                  style={{ cursor: 'pointer', background: 'var(--mantine-color-gray-1)' }}
                  onClick={() => toggle(s.sector)}
                >
                  <Table.Td fw={600}>
                    {expanded.has(s.sector) ? '▾' : '▸'}{' '}
                    <Box component="span" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Box component="span" style={{ width: 8, height: 8, borderRadius: 2, background: sectorColor(i, chartRows.length, s.sector), display: 'inline-block' }} />
                      {s.sector}
                      {s.sector === OTHERS_LABEL && <Text component="span" c="dimmed" size="xs">({othersRows.length})</Text>}
                    </Box>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{pctOfEquity(s.total)}%</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><MoneyText value={s.total} compact /></Table.Td>
                </Table.Tr>

                {expanded.has(s.sector) && s.sector === OTHERS_LABEL && othersRows.map((o) => {
                  const key = `others:${o.sector}`
                  return (
                    <React.Fragment key={key}>
                      <Table.Tr style={{ cursor: 'pointer' }} onClick={() => toggle(key)}>
                        <Table.Td pl="lg" fw={500}>
                          {expanded.has(key) ? '▾' : '▸'} {o.sector}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>{pctOfEquity(o.total)}%</Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={o.total} compact /></Table.Td>
                      </Table.Tr>
                      {expanded.has(key) && (stocksBySector[o.sector] ?? []).map((h, j) => (
                        <Table.Tr key={`${key}-${j}`}>
                          <Table.Td pl={48}>{h.name}</Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Text c="dimmed">{h.pct.toFixed(2)}% in {o.sector} · {grandTotal > 0 ? (h.value / grandTotal * 100).toFixed(2) : '0.00'}% of equity</Text>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}><MoneyText value={h.value} compact /></Table.Td>
                        </Table.Tr>
                      ))}
                    </React.Fragment>
                  )
                })}

                {expanded.has(s.sector) && s.sector !== OTHERS_LABEL && (stocksBySector[s.sector] ?? []).map((h, j) => (
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

      {!dismissedLevels.includes(level) && unknownHoldings.length > 0 && (
        <SectorClassifyPanel level={level} unknownHoldings={unknownHoldings} onDone={() => onDismiss(level)} />
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedFunds, setExpandedFunds] = useState<Set<string>>(new Set())

  if (!cats) return <Text size="sm" c="dimmed">Loading…</Text>

  function toggle(cat: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function toggleFund(key: string) {
    setExpandedFunds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
              style={{ cursor: 'pointer', background: 'var(--surface-muted)' }}
              onClick={() => toggle(cat.category)}
            >
              <Table.Td fw={600}>
                {!collapsed.has(cat.category) ? '▾' : '▸'}{' '}
                <Box component="span" style={{ color: categoryColor(cat.category) }}>{cat.category}</Box>
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><MoneyText value={cat.total} compact /></Table.Td>
              <Table.Td />
            </Table.Tr>
            {!collapsed.has(cat.category) && cat.sources.map((s, i) => {
              const fundKey = `${cat.category}||${s.isin ?? i}`
              const canExpand = !!s.isin
              const isFundExpanded = expandedFunds.has(fundKey)
              return (
                <React.Fragment key={fundKey}>
                  <Table.Tr
                    style={{
                      cursor: canExpand ? 'pointer' : undefined,
                      background: isFundExpanded ? 'var(--surface-sunken)' : undefined,
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


const SYNCED_FUND_COLUMNS: Column<SyncedFund>[] = [
  { key: 'name', label: 'Fund', sortable: true, render: (f) => <Text size="xs">{f.name}</Text> },
  {
    key: 'as_of',
    label: 'Portfolio as of',
    sortable: true,
    render: (f) => <Text size="xs">{f.as_of ? shortDate(f.as_of) : '—'}</Text>,
  },
  {
    key: 'rows',
    label: 'Holdings',
    sortable: true,
    align: 'right',
    render: (f) => <Text size="xs">{f.rows}</Text>,
  },
]

function staleFunds(funds: SyncedFund[], serverLatest: string): SyncedFund[] {
  return funds.filter((f) => !f.as_of || f.as_of < serverLatest)
}


function IngestResultRenderer(result: IngestDonePayload) {
  const { amfi, ingest, nse } = result
  return (
    <Stack gap={4}>
      {amfi?.error ? (
        <Text size="xs" c="red">AMFI: {amfi.error}</Text>
      ) : amfi ? (
        <Text size="xs">AMFI: {amfi.rows_loaded} stocks loaded ({amfi.large}L / {amfi.mid}M / {amfi.small}S) from {amfi.file}</Text>
      ) : null}
      {ingest?.error ? (
        <Text size="xs" c="red">Ingest: {ingest.error}</Text>
      ) : ingest?.already_current ? (
        <Text size="xs">All schemes are up to date{ingest.as_of ? ` (as of ${ingest.as_of})` : ''}</Text>
      ) : ingest ? (
        <Text size="xs">
          Ingest: {ingest.schemes_processed} scheme(s) updated, {ingest.rows_upserted} row(s)
          {typeof ingest.schemes_skipped === 'number' && ingest.schemes_skipped > 0 ? ` · ${ingest.schemes_skipped} already current` : ''}
        </Text>
      ) : null}
      {ingest?.funds?.length ? (
        <Stack gap={2} mt={6}>
          <Text size="xs" fw={600}>Portfolio date per fund</Text>
          <DataTable
            columns={SYNCED_FUND_COLUMNS}
            rows={ingest.funds}
            defaultSort="as_of"
            defaultDir="desc"
            rowKey={(f) => f.isin}
          />
          {ingest.server_latest_filing && staleFunds(ingest.funds, ingest.server_latest_filing).length ? (
            <Text size="xs" c="orange">
              {staleFunds(ingest.funds, ingest.server_latest_filing).length} fund(s) behind the
              server's newest filing ({shortDate(ingest.server_latest_filing)}) — they haven't disclosed for it yet
            </Text>
          ) : null}
        </Stack>
      ) : null}
      {ingest?.unmatched_equities?.length ? (
        <Text size="xs" c="orange">{ingest.unmatched_equities.length} unmatched equities — use classify panel to fix</Text>
      ) : null}
      {ingest?.missing_funds?.length ? (
        <Stack gap={2} mt={4}>
          <Text size="xs" c="red" fw={600}>Not found in OpenFin for {ingest.missing_funds.length} held fund{ingest.missing_funds.length === 1 ? '' : 's'}:</Text>
          {ingest.missing_funds.map((f) => (
            <Text key={f.isin} size="xs" c="red">• {f.isin} — {f.name}</Text>
          ))}
        </Stack>
      ) : null}
      {nse?.error ? (
        <Text size="xs" c="red">NSE: {nse.error}</Text>
      ) : nse ? (
        <Stack gap={2} mt={6}>
          <Text size="xs">
            NSE: {nse.classified} classified, {nse.skipped_cached} already known
            {typeof nse.unclassified === 'number' && nse.unclassified > 0 ? `, ${nse.unclassified} unclassified` : ''}
            {typeof nse.errors === 'number' && nse.errors > 0 ? `, ${nse.errors} errors` : ''}
            {typeof nse.mismatched === 'number' && nse.mismatched > 0 ? `, ${nse.mismatched} ISIN mismatches` : ''}
          </Text>
          {nse.unresolved_isins?.length ? (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--mantine-color-dimmed)' }}>
                {nse.unresolved_isins.length} held ISIN{nse.unresolved_isins.length === 1 ? '' : 's'} not on the NSE main board
              </summary>
              <Stack gap={2} mt={4}>
                {nse.unresolved_isins.map((u) => (
                  <Text key={u.isin} size="xs" c="dimmed">• {u.name} ({u.isin})</Text>
                ))}
              </Stack>
            </details>
          ) : null}
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
  const classifyMut = useClassifyBatchMutation()

  // Deduplicate by name for display; one override covers all schemes
  const unique = equities.filter((e, i, arr) => arr.findIndex((x) => x.name === e.name) === i)

  return (
    <ClassifySelectPanel
      title={(n) => `Classify unmatched equities (${n})`}
      columnLabel="Market cap"
      columnWidth={160}
      placeholder="Select…"
      options={CAP_CATEGORIES}
      names={unique.map((e) => e.name)}
      saving={classifyMut.isPending}
      onSave={async (selections) => {
        const rows = unique
          .filter((e) => selections[e.name])
          .map((e) => ({ scheme_isin: e.scheme_isin, name: e.name, category: selections[e.name] }))
        return (await classifyMut.mutateAsync(rows)).updated
      }}
      onDone={onDone}
    />
  )
}

export function Breakdown() {
  const ingestSse = useSse<IngestDonePayload>(apiUrl('/api/v1/mf-breakdown/ingest/stream'))
  const [dismissedResult, setDismissedResult] = useState<IngestDonePayload | null>(null)
  const [dismissedLevels, setDismissedLevels] = usePersistentState<ClassificationLevel[]>('sectorClassifyDismissedLevels', [])
  const unmatchedEquities = dismissedResult === ingestSse.result ? [] : (ingestSse.result?.ingest?.unmatched_equities ?? [])

  return (
    <Stack gap="lg">
      <PageHeader title="Portfolio Breakdown" actions={
        <Button
          size="xs"
          leftSection={<IconRefresh size={12} />}
          onClick={ingestSse.start}
          loading={ingestSse.status === 'running'}
          disabled={ingestSse.status === 'running'}
        >
          Refresh disclosures
        </Button>
      } />

      <SsePanel
        sse={ingestSse}
        heading="Ingesting portfolios…"
        resultRenderer={(r) => IngestResultRenderer(r as IngestDonePayload)}
      />

      {unmatchedEquities.length > 0 && (
        <ClassifyPanel
          equities={unmatchedEquities}
          onDone={() => setDismissedResult(ingestSse.result)}
        />
      )}

      <Panel p="md"><Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="sector">Sector</Tabs.Tab>
          <Tabs.Tab value="composition">Composition</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md"><OverviewTab /></Tabs.Panel>
        <Tabs.Panel value="sector" pt="md">
          <SectorTab
            dismissedLevels={dismissedLevels}
            onDismiss={(lvl) => setDismissedLevels(dismissedLevels.includes(lvl) ? dismissedLevels : [...dismissedLevels, lvl])}
          />
        </Tabs.Panel>
        <Tabs.Panel value="composition" pt="md"><CompositionTab /></Tabs.Panel>
      </Tabs></Panel>
    </Stack>
  )
}
