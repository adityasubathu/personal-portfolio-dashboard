import React, { useState } from 'react'
import { Check, ChevronDown, ChevronsUpDown, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { Section } from '@/components/Section'
import { Button as ShadButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent as ShadSelectContent, SelectItem as ShadSelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'
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
import { MoneyText } from '../components/MoneyText'
import { useSse } from '../hooks/useSse'
import { usePersistentState } from '../hooks/usePersistentState'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
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
  return Math.abs(diff) >= 3 ? 'text-negative' : undefined
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
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Label className="text-sm font-normal">Extra cash to add:</Label>
      <Input
        type="number"
        min={0}
        value={cash}
        onChange={(e) => onCashChange(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder="0"
        className="h-8 w-36"
      />
      <p className="text-xs text-muted-foreground">
        Sell <MoneyText value={totalSell} compact className="text-negative" /> from over-target buckets,
        buy <MoneyText value={totalBuy} compact className="text-positive" /> into under-target ones — every bucket lands exactly on target.
      </p>
    </div>
  )
}

function RebalanceRows({ buckets }: { buckets: RebalanceBucket[] }) {
  return (
    <>
      {buckets.map((b) => (
        <tr key={b.category} className="hover:bg-muted/50">
          <td className="px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: categoryColor(b.category) }} />
              {b.category}
            </div>
          </td>
          <td data-numeric className="px-2 py-1.5 text-right">{b.target_pct.toFixed(1)}%</td>
          <td data-numeric className="px-2 py-1.5 text-right">{b.current_pct.toFixed(2)}%</td>
          <td data-numeric className="px-2 py-1.5 text-right">
            {Math.abs(b.invest) > 1 ? (
              <span className="inline-flex items-center gap-1">
                <span className="text-xs text-muted-foreground">{b.invest > 0 ? 'Buy' : 'Sell'}</span>
                <MoneyText value={Math.abs(b.invest)} compact className={b.invest > 0 ? 'text-positive' : 'text-negative'} />
              </span>
            ) : '—'}
          </td>
          <td data-numeric className="px-2 py-1.5 text-right">{b.new_pct.toFixed(2)}%</td>
          <td data-numeric className="px-2 py-1.5 text-right text-positive">
            {b.remaining_drift >= 0 ? '+' : ''}{b.remaining_drift.toFixed(2)}%
          </td>
        </tr>
      ))}
    </>
  )
}

function TargetsTableHead({ firstColumn }: { firstColumn: string }) {
  return (
    <thead>
      <tr>
        <th className="h-8 px-2 text-left font-medium text-muted-foreground">{firstColumn}</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Target %</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Current %</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Diff</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Shortfall / Surplus</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Value</th>
      </tr>
    </thead>
  )
}

/** Shared body for the "Edit targets" popup: one labelled input per row, defaulting
 *  to the row's current target and falling back to any in-progress edit. */
function EditTargetsFields({
  rows,
  targets,
  onChange,
}: {
  rows: Array<{ key: string; label: string; defaultValue: number; step?: number }>
  targets: Record<string, number>
  onChange: (key: string, value: number) => void
}) {
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto py-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-4">
          <Label className="text-sm font-normal">{row.label}</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={row.step ?? 1}
            value={targets[row.key] ?? row.defaultValue}
            onChange={(e) => onChange(row.key, Number(e.target.value))}
            className="h-8 w-24"
          />
        </div>
      ))}
    </div>
  )
}

function RebalanceTableHead() {
  return (
    <thead>
      <tr>
        <th className="h-8 px-2 text-left font-medium text-muted-foreground">Category</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Target %</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Current %</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Invest</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">New %</th>
        <th className="h-8 px-2 text-right font-medium text-muted-foreground">Remaining drift</th>
      </tr>
    </thead>
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
  const [editOpen, setEditOpen] = useState(false)
  const [cashInput, setCashInput] = useState<number | ''>('')
  const debouncedCash = useDebouncedValue(cashInput, 500)
  const { data: plan } = useRebalancePlan('anchored', debouncedCash === '' ? undefined : debouncedCash)

  if (!ac) return null

  async function handleSave() {
    try {
      const updated = Object.fromEntries(
        ac!.rows.map((r) => [r.asset_class, targets[r.asset_class] ?? r.target_pct])
      )
      updated['Equity - Foreign'] = targets['Equity - Foreign'] ?? ac!.foreign_equity_target
      await saveMut.mutateAsync(updated)
      notify.success('Asset class targets saved.')
      refetch()
      setEditOpen(false)
    } catch (e) {
      notify.error(String(e))
    }
  }

  const editRows = [
    ...ac.rows.map((r) => ({ key: r.asset_class, label: r.asset_class, defaultValue: r.target_pct })),
    { key: 'Equity - Foreign', label: 'Equity - Foreign (% of total equity)', defaultValue: ac.foreign_equity_target },
  ]

  const { emergency_fund, cash } = ac.excluded

  return (
    <Section
      title={
        <>
          Asset class targets{' '}
          <span className="text-xs font-normal text-muted-foreground">
            (% of invested portfolio · <MoneyText value={ac.investable_total} compact />)
          </span>
        </>
      }
      action={
        <ToggleGroup type="single" variant="outline" size="sm" value={rebalanceView ? 'rebalance' : 'shortfall'} onValueChange={(v) => v && onToggleRebalanceView(v === 'rebalance')}>
          <ToggleGroupItem value="shortfall">Shortfall / Surplus</ToggleGroupItem>
          <ToggleGroupItem value="rebalance">Rebalance</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {rebalanceView && plan && (
        <RebalanceControls
          totalBuy={plan.asset_class_total_buy}
          totalSell={plan.asset_class_total_sell}
          cash={cashInput}
          onCashChange={setCashInput}
        />
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ minWidth: 760 }}>
          {rebalanceView ? <RebalanceTableHead /> : <TargetsTableHead firstColumn="Asset class" />}
          <tbody>
            {rebalanceView && plan ? (
              <RebalanceRows buckets={plan.asset_class} />
            ) : ac.rows.map((r) => (
              <tr key={r.asset_class} className="hover:bg-muted/50">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: categoryColor(r.asset_class) }} />
                    {r.asset_class}
                  </div>
                </td>
                <td data-numeric className="px-2 py-1.5 text-right">{r.target_pct.toFixed(1)}%</td>
                <td data-numeric className="px-2 py-1.5 text-right">{r.current_pct.toFixed(2)}%</td>
                <td data-numeric className={cn('px-2 py-1.5 text-right', diffColor(r.current_diff))}>
                  {r.current_diff >= 0 ? '+' : ''}{r.current_diff.toFixed(2)}%
                </td>
                <td data-numeric className="px-2 py-1.5 text-right">
                  <MoneyText value={r.shortfall} compact showSign className={diffColor(r.current_diff)} />
                </td>
                <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={r.current_value} compact /></td>
              </tr>
            ))}
            {!rebalanceView && (
              <tr className="border-t">
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: categoryColor('Equity - Foreign') }} />
                    Equity - Foreign
                    <span className="text-xs text-muted-foreground">(% of total equity)</span>
                  </div>
                </td>
                <td colSpan={5} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!rebalanceView && (
        <div className="mt-2 flex items-center gap-4">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <ShadButton size="xs" variant="outline">Edit targets</ShadButton>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit asset class targets</DialogTitle>
              </DialogHeader>
              <EditTargetsFields rows={editRows} targets={targets} onChange={(key, value) => setTargets((p) => ({ ...p, [key]: value }))} />
              <DialogFooter>
                <ShadButton variant="outline" onClick={() => setEditOpen(false)}>Cancel</ShadButton>
                <ShadButton disabled={saveMut.isPending} onClick={handleSave}>Save targets</ShadButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <p className="text-xs text-muted-foreground">
            Excludes:{' '}
            {emergency_fund > 0 && <>Emergency fund {inrCompact(emergency_fund)}, </>}
            {cash > 0 && <>Savings {inrCompact(cash)}</>}
          </p>
        </div>
      )}
    </Section>
  )
}

function OverviewTab() {
  const { data: chart } = useBreakdownChart()
  const { data: ac } = useAssetClassComparison()
  const [mode, setMode] = usePersistentState<'anchored' | 'free_float'>('allocationMode', 'anchored')
  const { data: comparison, refetch: refetchComp } = useAllocationComparison(mode)
  const saveMut = useSaveAllocationTargetsMutation()
  const [targets, setTargets] = useState<Record<string, number>>({})
  const [editOpen, setEditOpen] = useState(false)
  const [rebalanceView, setRebalanceView] = usePersistentState('rebalanceView', false)
  const [cashInput, setCashInput] = useState<number | ''>('')
  const debouncedCash = useDebouncedValue(cashInput, 500)
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
      notify.success('Targets saved.')
      refetchComp()
      setEditOpen(false)
    } catch (e) {
      notify.error(String(e))
    }
  }

  if (!chart) return <p className="text-sm text-muted-foreground">Loading…</p>

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
    <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => { if (v) { setMode(v as 'anchored' | 'free_float'); setTargets({}) } }}>
      <ToggleGroupItem value="anchored">Large Cap Anchored</ToggleGroupItem>
      <ToggleGroupItem value="free_float">Free Float</ToggleGroupItem>
    </ToggleGroup>
  )

  return (
    <div className="flex flex-col gap-4">
      {chart.labels.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section title="Asset Allocation">
            <DonutChart labels={hlLabels} values={hlValues} total={chart.total} />
          </Section>
          <Section title="Category Breakdown">
            <DonutChart labels={catLabels} values={catValues} total={chart.total} />
          </Section>
        </div>
      )}

      {isAnchored && (
        <AssetClassTargetsSection rebalanceView={rebalanceView} onToggleRebalanceView={setRebalanceView} />
      )}

      {comparison && (
        <Section
          title={
            isAnchored ? (
              <>Equity allocation targets <span className="text-xs font-normal text-muted-foreground">(% of domestic equity)</span></>
            ) : (
              <>Allocation targets <span className="text-xs font-normal text-muted-foreground">(% of pool · <MoneyText value={comparison.pool ?? comparison.current_equity} compact />, excludes emergency fund & cash)</span></>
            )
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup type="single" variant="outline" size="sm" value={rebalanceView ? 'rebalance' : 'shortfall'} onValueChange={(v) => v && setRebalanceView(v === 'rebalance')}>
                <ToggleGroupItem value="shortfall">Shortfall / Surplus</ToggleGroupItem>
                <ToggleGroupItem value="rebalance">Rebalance</ToggleGroupItem>
              </ToggleGroup>
              {modeToggle}
            </div>
          }
        >
          {rebalanceView && plan && (
            <RebalanceControls
              totalBuy={plan.total_buy}
              totalSell={plan.total_sell}
              cash={cashInput}
              onCashChange={setCashInput}
            />
          )}
          {rebalanceView && plan?.conflict_note && (
            <p className="mb-2 text-xs text-muted-foreground">{plan.conflict_note}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 760 }}>
              {rebalanceView ? <RebalanceTableHead /> : <TargetsTableHead firstColumn="Category" />}
              <tbody>
                {rebalanceView && plan ? (
                  <RebalanceRows buckets={plan.buckets} />
                ) : comparison.rows.map((r) => {
                  const isAnchor = isAnchored && r.category === 'Large Cap'
                  const showShortfall = !isAnchor
                  return (
                    <tr key={r.category} className="hover:bg-muted/50">
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="size-2 rounded-sm" style={{ background: categoryColor(r.category) }} />
                          {r.category}
                        </div>
                      </td>
                      <td data-numeric className="px-2 py-1.5 text-right">
                        {r.anchor_note ? <span className="text-xs">{r.anchor_note}</span> : `${r.target_pct.toFixed(1)}%`}
                      </td>
                      <td data-numeric className="px-2 py-1.5 text-right">{r.current_pct.toFixed(2)}%</td>
                      <td data-numeric className={cn('px-2 py-1.5 text-right', !isAnchor && diffColor(r.current_diff))}>
                        {isAnchor ? '—' : `${r.current_diff > 0 ? '+' : ''}${r.current_diff.toFixed(2)}%`}
                      </td>
                      <td data-numeric className="px-2 py-1.5 text-right">
                        {showShortfall && (
                          <MoneyText value={r.current_value_diff} compact showSign className={diffColor(r.current_diff)} />
                        )}
                      </td>
                      <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={r.current_value} compact /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!rebalanceView && (
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <ShadButton size="xs" variant="outline" className="mt-2">Edit targets</ShadButton>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{isAnchored ? 'Edit equity allocation targets' : 'Edit allocation targets'}</DialogTitle>
                </DialogHeader>
                <EditTargetsFields
                  rows={comparison.rows
                    .filter((r) => !(isAnchored && r.category === 'Equity - Foreign'))
                    .map((r) => ({ key: r.category, label: r.category, defaultValue: r.target_pct, step: 0.1 }))}
                  targets={targets}
                  onChange={(key, value) => setTargets((p) => ({ ...p, [key]: value }))}
                />
                <DialogFooter>
                  <ShadButton variant="outline" onClick={() => setEditOpen(false)}>Cancel</ShadButton>
                  <ShadButton disabled={saveMut.isPending} onClick={handleSaveTargets}>Save targets</ShadButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </Section>
      )}
    </div>
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
  const [open, setOpen] = useState(true)

  async function handleSave() {
    const picked = Object.fromEntries(names.filter((n) => selections[n]).map((n) => [n, selections[n]]))
    if (!Object.keys(picked).length) return
    try {
      const updated = await onSave(picked)
      notify.success(`Classified ${updated} holding${updated === 1 ? '' : 's'}.`)
      onDone()
    } catch (e) {
      notify.error(String(e))
    }
  }

  const doneCount = names.filter((n) => selections[n]).length

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="text-sm font-medium">{title(names.length)}</span>
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="h-8 px-2 text-left font-medium text-muted-foreground">Stock name</th>
                <th className="h-8 px-2 text-left font-medium text-muted-foreground" style={{ width: columnWidth }}>{columnLabel}</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => (
                <tr key={n}>
                  <td className="px-2 py-1.5">{n}</td>
                  <td className="px-2 py-1.5">
                    {searchable ? (
                      <ClassifyCombobox
                        placeholder={placeholder}
                        options={options}
                        value={selections[n] ?? ''}
                        onChange={(v) => setSelections((prev) => ({ ...prev, [n]: v }))}
                      />
                    ) : (
                      <Select value={selections[n] ?? ''} onValueChange={(v) => setSelections((prev) => ({ ...prev, [n]: v }))}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue placeholder={placeholder} />
                        </SelectTrigger>
                        <ShadSelectContent>
                          {options.map((o) => <ShadSelectItem key={o} value={o}>{o}</ShadSelectItem>)}
                        </ShadSelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ShadButton size="xs" disabled={saving || !doneCount} onClick={handleSave}>
            Save{doneCount < names.length ? ` (${doneCount} of ${names.length})` : ' all'}
          </ShadButton>
          <ShadButton size="xs" variant="ghost" onClick={onDone}>
            Dismiss
          </ShadButton>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ClassifyCombobox({
  placeholder,
  options,
  value,
  onChange,
}: {
  placeholder: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ShadButton variant="outline" size="sm" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {value || placeholder}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </ShadButton>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false) }}>
                  <Check className={cn('size-3.5', value === o ? 'opacity-100' : 'opacity-0')} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

  if (!sectors) return <p className="text-sm text-muted-foreground">Loading…</p>

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
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,560px)_1fr]">
        <Section
          title="Sector Allocation"
          action={
            <ToggleGroup type="single" variant="outline" size="sm" value={level} onValueChange={(v) => v && changeLevel(v)}>
              {LEVEL_OPTIONS.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
            </ToggleGroup>
          }
        >
          {labels.length > 0 && <DonutChart labels={labels} values={values} colorMode="sector" />}
        </Section>

        <Section title="Sector" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="sticky top-0 z-10 bg-card">
                  <th className="h-8 px-2 text-left font-medium text-muted-foreground">Sector</th>
                  <th className="h-8 px-2 text-right font-medium text-muted-foreground">% of equity</th>
                  <th className="h-8 px-2 text-right font-medium text-muted-foreground">Value</th>
                </tr>
              </thead>
              <tbody>
                {chartRows.map((s, i) => (
                  <React.Fragment key={s.sector}>
                    <tr className="cursor-pointer bg-muted/40 hover:bg-muted/60" onClick={() => toggle(s.sector)}>
                      <td className="px-2 py-1.5 font-semibold">
                        {expanded.has(s.sector) ? '▾' : '▸'}{' '}
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block size-2 rounded-sm" style={{ background: sectorColor(i, chartRows.length, s.sector) }} />
                          {s.sector}
                          {s.sector === OTHERS_LABEL && <span className="text-xs text-muted-foreground">({othersRows.length})</span>}
                        </span>
                      </td>
                      <td data-numeric className="px-2 py-1.5 text-right">{pctOfEquity(s.total)}%</td>
                      <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={s.total} compact /></td>
                    </tr>

                    {expanded.has(s.sector) && s.sector === OTHERS_LABEL && othersRows.map((o) => {
                      const key = `others:${o.sector}`
                      return (
                        <React.Fragment key={key}>
                          <tr className="cursor-pointer hover:bg-muted/50" onClick={() => toggle(key)}>
                            <td className="py-1.5 pr-2 pl-6 font-medium">
                              {expanded.has(key) ? '▾' : '▸'} {o.sector}
                            </td>
                            <td data-numeric className="px-2 py-1.5 text-right">{pctOfEquity(o.total)}%</td>
                            <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={o.total} compact /></td>
                          </tr>
                          {expanded.has(key) && (stocksBySector[o.sector] ?? []).map((h, j) => (
                            <tr key={`${key}-${j}`} className="hover:bg-muted/50">
                              <td className="py-1.5 pr-2 pl-12">{h.name}</td>
                              <td data-numeric className="px-2 py-1.5 text-right text-muted-foreground">
                                {h.pct.toFixed(2)}% in {o.sector} · {grandTotal > 0 ? (h.value / grandTotal * 100).toFixed(2) : '0.00'}% of equity
                              </td>
                              <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={h.value} compact /></td>
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}

                    {expanded.has(s.sector) && s.sector !== OTHERS_LABEL && (stocksBySector[s.sector] ?? []).map((h, j) => (
                      <tr key={`${s.sector}-${j}`} className="hover:bg-muted/50">
                        <td className="py-1.5 pr-2 pl-8">{h.name}</td>
                        <td data-numeric className="px-2 py-1.5 text-right text-muted-foreground">
                          {h.pct.toFixed(2)}% in sector · {grandTotal > 0 ? (h.value / grandTotal * 100).toFixed(2) : '0.00'}% of equity
                        </td>
                        <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={h.value} compact /></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {!dismissedLevels.includes(level) && unknownHoldings.length > 0 && (
        <SectorClassifyPanel level={level} unknownHoldings={unknownHoldings} onDone={() => onDismiss(level)} />
      )}
    </div>
  )
}

function FundStockRows({ schemeIsin, filterCategory }: { schemeIsin: string; filterCategory: string }) {
  const { data, isLoading } = useSchemeBreakdown(schemeIsin)
  if (isLoading) return (
    <tr>
      <td colSpan={3} className="py-1.5 pr-2 pl-16 text-muted-foreground">Loading stocks…</td>
    </tr>
  )
  if (!data?.holdings.length) return null
  const sorted = [...data.holdings]
    .filter((h) => h.category === filterCategory)
    .sort((a, b) => b.value - a.value)
  if (!sorted.length) return null
  return (
    <>
      {sorted.map((h, i) => (
        <tr key={i} className="bg-info/5">
          <td className="py-1.5 pr-2 pl-16">{h.name}</td>
          <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={h.value} compact /></td>
          <td data-numeric className="px-2 py-1.5 text-right">{h.pct.toFixed(2)}%</td>
        </tr>
      ))}
    </>
  )
}

function CompositionTab() {
  const { data: cats } = useCategoryComposition()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expandedFunds, setExpandedFunds] = useState<Set<string>>(new Set())

  if (!cats) return <p className="text-sm text-muted-foreground">Loading…</p>

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
    <Section bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-card">
              <th className="h-8 px-2 text-left font-medium text-muted-foreground">Category / Scheme / Stock</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Value</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">% of category</th>
            </tr>
          </thead>
          <tbody>
            {cats.map((cat) => (
              <React.Fragment key={cat.category}>
                <tr className="cursor-pointer bg-muted/40 hover:bg-muted/60" onClick={() => toggle(cat.category)}>
                  <td className="px-2 py-1.5 font-semibold">
                    {!collapsed.has(cat.category) ? '▾' : '▸'}{' '}
                    <span style={{ color: categoryColor(cat.category) }}>{cat.category}</span>
                  </td>
                  <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={cat.total} compact /></td>
                  <td />
                </tr>
                {!collapsed.has(cat.category) && cat.sources.map((s, i) => {
                  const fundKey = `${cat.category}||${s.isin ?? i}`
                  const canExpand = !!s.isin
                  const isFundExpanded = expandedFunds.has(fundKey)
                  return (
                    <React.Fragment key={fundKey}>
                      <tr
                        className={cn('hover:bg-muted/50', canExpand && 'cursor-pointer', isFundExpanded && 'bg-muted/30 font-semibold')}
                        onClick={canExpand ? () => toggleFund(fundKey) : undefined}
                      >
                        <td className="py-1.5 pr-2 pl-8">
                          {canExpand ? (isFundExpanded ? '▾ ' : '▸ ') : ''}
                          {s.name}
                        </td>
                        <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={s.contribution} compact /></td>
                        <td data-numeric className="px-2 py-1.5 text-right">{s.share_pct.toFixed(1)}%</td>
                      </tr>
                      {canExpand && isFundExpanded && <FundStockRows schemeIsin={s.isin!} filterCategory={cat.category} />}
                    </React.Fragment>
                  )
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

const SYNCED_FUND_COLUMNS: Column<SyncedFund>[] = [
  { key: 'name', label: 'Fund', sortable: true, render: (f) => <span className="text-xs">{f.name}</span> },
  {
    key: 'as_of',
    label: 'Portfolio as of',
    sortable: true,
    render: (f) => <span className="text-xs">{f.as_of ? shortDate(f.as_of) : '—'}</span>,
  },
  {
    key: 'rows',
    label: 'Holdings',
    sortable: true,
    align: 'right',
    render: (f) => <span className="text-xs">{f.rows}</span>,
  },
]

function staleFunds(funds: SyncedFund[], serverLatest: string): SyncedFund[] {
  return funds.filter((f) => !f.as_of || f.as_of < serverLatest)
}


function IngestResultRenderer(result: IngestDonePayload) {
  const { amfi, ingest, nse } = result
  return (
    <div className="space-y-1">
      {amfi?.error ? (
        <p className="text-xs text-negative">AMFI: {amfi.error}</p>
      ) : amfi ? (
        <p className="text-xs">AMFI: {amfi.rows_loaded} stocks loaded ({amfi.large}L / {amfi.mid}M / {amfi.small}S) from {amfi.file}</p>
      ) : null}
      {ingest?.error ? (
        <p className="text-xs text-negative">Ingest: {ingest.error}</p>
      ) : ingest?.already_current ? (
        <p className="text-xs">All schemes are up to date{ingest.as_of ? ` (as of ${ingest.as_of})` : ''}</p>
      ) : ingest ? (
        <p className="text-xs">
          Ingest: {ingest.schemes_processed} scheme(s) updated, {ingest.rows_upserted} row(s)
          {typeof ingest.schemes_skipped === 'number' && ingest.schemes_skipped > 0 ? ` · ${ingest.schemes_skipped} already current` : ''}
        </p>
      ) : null}
      {ingest?.funds?.length ? (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs font-semibold">Portfolio date per fund</p>
          <DataTable
            columns={SYNCED_FUND_COLUMNS}
            rows={ingest.funds}
            defaultSort="as_of"
            defaultDir="desc"
            rowKey={(f) => f.isin}
          />
          {ingest.server_latest_filing && staleFunds(ingest.funds, ingest.server_latest_filing).length ? (
            <p className="text-xs text-warning">
              {staleFunds(ingest.funds, ingest.server_latest_filing).length} fund(s) behind the
              server's newest filing ({shortDate(ingest.server_latest_filing)}) — they haven't disclosed for it yet
            </p>
          ) : null}
        </div>
      ) : null}
      {ingest?.unmatched_equities?.length ? (
        <p className="text-xs text-warning">{ingest.unmatched_equities.length} unmatched equities — use classify panel to fix</p>
      ) : null}
      {ingest?.missing_funds?.length ? (
        <div className="mt-1 space-y-1">
          <p className="text-xs font-semibold text-negative">Not found in OpenFin for {ingest.missing_funds.length} held fund{ingest.missing_funds.length === 1 ? '' : 's'}:</p>
          {ingest.missing_funds.map((f) => (
            <p key={f.isin} className="text-xs text-negative">• {f.isin} — {f.name}</p>
          ))}
        </div>
      ) : null}
      {nse?.error ? (
        <p className="text-xs text-negative">NSE: {nse.error}</p>
      ) : nse ? (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs">
            NSE: {nse.classified} classified, {nse.skipped_cached} already known
            {typeof nse.unclassified === 'number' && nse.unclassified > 0 ? `, ${nse.unclassified} unclassified` : ''}
            {typeof nse.errors === 'number' && nse.errors > 0 ? `, ${nse.errors} errors` : ''}
            {typeof nse.mismatched === 'number' && nse.mismatched > 0 ? `, ${nse.mismatched} ISIN mismatches` : ''}
          </p>
          {nse.unresolved_isins?.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {nse.unresolved_isins.length} held ISIN{nse.unresolved_isins.length === 1 ? '' : 's'} not on the NSE main board
              </summary>
              <div className="mt-1 space-y-1">
                {nse.unresolved_isins.map((u) => (
                  <p key={u.isin} className="text-xs text-muted-foreground">• {u.name} ({u.isin})</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
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
    <PageShell>
      <PageHeader title="Portfolio Breakdown" actions={
        <ShadButton size="sm" disabled={ingestSse.status === 'running'} onClick={ingestSse.start}>
          <RefreshCw className="size-3.5" />
          Refresh disclosures
        </ShadButton>
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

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sector">Sector</TabsTrigger>
          <TabsTrigger value="composition">Composition</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-4"><OverviewTab /></TabsContent>
        <TabsContent value="sector" className="pt-4">
          <SectorTab
            dismissedLevels={dismissedLevels}
            onDismiss={(lvl) => setDismissedLevels(dismissedLevels.includes(lvl) ? dismissedLevels : [...dismissedLevels, lvl])}
          />
        </TabsContent>
        <TabsContent value="composition" className="pt-4"><CompositionTab /></TabsContent>
      </Tabs>
    </PageShell>
  )
}
