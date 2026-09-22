import React, { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Trash2, Info, ArrowUp, ArrowDown } from 'lucide-react'
import { useSummaryCards, useHoldings, useUpdateLtpMutation } from '../api/portfolio'
import {
  useManualAssets,
  useAddFdMutation,
  useUpsertPpfMutation,
  useUpsertNpsMutation,
  useUpsertCashMutation,
  useUpsertUsdCashMutation,
  useAddForeignEquityMutation,
  useUpdateForeignEquityMutation,
  useDeleteAssetMutation,
  useRefreshUsdinrMutation,
  useSetManualUsdinrMutation,
} from '../api/manualAssets'
import { MoneyText } from '../components/MoneyText'
import { inr, pct } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'
import type { HoldingRow } from '../types/portfolio'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { ContentHeader } from '@/components/ContentHeader'
import { Section } from '@/components/Section'
import { MetricCard } from '../components/MetricCard'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { usePersistentState } from '../hooks/usePersistentState'
import { Button as ShadButton } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table as ShadTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { CHIP_CLASS } from '@/lib/colors'
import { notify } from '@/lib/notify'

// ── Summary cards ──────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data } = useSummaryCards()
  if (!data) return <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="" value="" loading />)}</div>
  const pnlPositive = data.total_pnl >= 0
  return (
    <div className="grid grid-cols-4 gap-3">
      <MetricCard label="Invested" value={<MoneyText value={data.total_cost} />} />
      <MetricCard label="Current value" value={<MoneyText value={data.total_value} />} />
      <MetricCard
        tone={pnlPositive ? 'positive' : 'negative'}
        label="Total P&L"
        value={
          <>
            <MoneyText value={data.total_pnl} showSign />
            {' '}
            <span className="text-xs">({pct((data.total_pnl / data.total_cost) * 100)})</span>
          </>
        }
      />
      <MetricCard tone={data.xirr != null && data.xirr >= 0 ? 'positive' : 'negative'} label="XIRR" value={data.xirr != null ? pct(data.xirr * 100) : '—'} />
    </div>
  )
}

// ── Decimal-aligned numeric cells ──────────────────────────────────────────────

const MONO: React.CSSProperties = {
  fontFamily: "'Roboto Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  fontSize: 'calc(1em)',
  whiteSpace: 'nowrap',
}

// Splits at the decimal point: integer part takes natural width (right edge
// of the cell aligns it), decimal part occupies a fixed-width slot so the
// dot lands at the same X position in every row.
// inline-flex keeps the container only as wide as its content — no cell expansion.
function DecNum({ text, decWidth }: { text: string; decWidth: string }) {
  const dotIdx = text.lastIndexOf('.')
  const hasDecimal = dotIdx !== -1 && /^\d/.test(text[dotIdx + 1] ?? '')
  return (
    <span style={{ ...MONO, display: 'inline-flex' }}>
      <span>{hasDecimal ? text.slice(0, dotIdx) : text}</span>
      <span style={{ width: decWidth, textAlign: 'left' }}>{hasDecimal ? text.slice(dotIdx) : ''}</span>
    </span>
  )
}

// Currency: INR always emits exactly 2 dp → decimal slot is '.XX' = 3ch
function NumMoney({ value, showSign }: { value: number | null | undefined; showSign?: boolean }) {
  const { privacyMode } = usePrivacy()
  if (privacyMode) return <DecNum text="₹•••" decWidth="3ch" />
  if (value == null) return <DecNum text="—" decWidth="3ch" />
  let text = inr(value)
  if (showSign && value > 0) text = '+' + text
  return <DecNum text={text} decWidth="3ch" />
}

// Per-unit market prices — not masked in privacy mode; harmless without quantity
function NumPrice({ value }: { value: number | null | undefined }) {
  if (value == null) return <DecNum text="—" decWidth="3ch" />
  return <DecNum text={inr(value)} decWidth="3ch" />
}

// Percentage: pct() always emits 2 dp → decimal slot is '.XX%' = 4ch
function NumPct({ value }: { value: number | null | undefined }) {
  return <DecNum text={pct(value)} decWidth="4ch" />
}

// Quantity: no digit grouping; MF units up to 3 dp → decimal slot is '.XXX' = 4ch
function NumQty({ value }: { value: number }) {
  const { privacyMode } = usePrivacy()
  if (privacyMode) return <DecNum text="•••" decWidth="4ch" />
  const text = Number.isInteger(value) ? String(value) : value.toFixed(3)
  return <DecNum text={text} decWidth="4ch" />
}

// Cost and Value carry the most weight on this table: 15% above the 12px base.
const NUM_LG = 'font-semibold'

// Direction lives in the arrow, so the number itself is printed unsigned.
// Fixed width so the pill's edges land at the same x in every row, regardless
// of how many digits the percentage has — otherwise the column looks ragged.
const GAIN_CHIP_WIDTH = 'w-[4.5rem]'
function GainChip({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className={cn('inline-block shrink-0', GAIN_CHIP_WIDTH)} />
  const up = value >= 0
  const Arrow = up ? ArrowUp : ArrowDown
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-0.5 rounded-full px-1.5 py-px text-[11px] font-medium whitespace-nowrap',
        GAIN_CHIP_WIDTH,
        up ? CHIP_CLASS.green : CHIP_CLASS.red,
      )}
    >
      <Arrow className="size-2.5 shrink-0" />
      {pct(Math.abs(value), 2, false)}
    </span>
  )
}

function PriceDetailRow({ label, sub, children }: { label: string; sub?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">
        {label}
        {sub && <span className="ml-1 text-[11px]">{sub}</span>}
      </dt>
      <dd data-numeric>{children}</dd>
    </div>
  )
}

function PriceInfo({ row, compare }: { row: HoldingRow; compare: 'prev_close' | 'open' }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ShadButton variant="ghost" size="icon-xs" aria-label={`Prices for ${row.symbol}`}>
          <Info className="text-muted-foreground" />
        </ShadButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-3">
        <p className="mb-2 truncate text-xs font-semibold">{row.symbol}</p>
        <dl className="space-y-1 text-xs">
          <PriceDetailRow label="Avg price"><NumPrice value={row.avg_price} /></PriceDetailRow>
          <PriceDetailRow label={compare === 'open' ? 'Open' : 'Prev close'} sub={row.prev_close_date}>
            <NumPrice value={row.prev_close} />
          </PriceDetailRow>
          <PriceDetailRow label="LTP" sub={row.as_of}><NumPrice value={row.ltp} /></PriceDetailRow>
        </dl>
      </PopoverContent>
    </Popover>
  )
}

// ── Holdings table ──────────────────────────────────────────────────────────────

const SORTABLE = new Set(['symbol', 'value', 'pnl', 'xirr', 'day_chg_abs', 'cost'])

function HoldingsTable() {
  const [storedSort, setSort] = usePersistentState('dashboard.sort', 'symbol')
  const sort = SORTABLE.has(storedSort) ? storedSort : 'pnl'
  const [dir, setDir] = usePersistentState<'asc' | 'desc'>('dashboard.dir', 'asc')
  const [sections, setSections] = usePersistentState<'on' | 'off'>('dashboard.sections', 'on')
  const [compare, setCompare] = usePersistentState<'prev_close' | 'open'>('dashboard.compare', 'prev_close')
  const { data: summary } = useSummaryCards()
  const ltpMut = useUpdateLtpMutation()

  const { data, isLoading } = useHoldings({ sort, dir, sections, compare })

  function handleUpdateLtp() {
    ltpMut.mutate(undefined, {
      onSuccess: (r) => notify.success(`LTP updated: ${r.updated} instruments`),
      onError: (e) => notify.error(String(e)),
    })
  }

  const sectionsToggle = (
    <ToggleGroup type="single" variant="outline" size="sm" value={sections} onValueChange={(v) => v && setSections(v as 'on' | 'off')}>
      <ToggleGroupItem value="on">Sections</ToggleGroupItem>
      <ToggleGroupItem value="off">Flat</ToggleGroupItem>
    </ToggleGroup>
  )
  const compareToggle = (
    <ToggleGroup type="single" variant="outline" size="sm" value={compare} onValueChange={(v) => v && setCompare(v as 'prev_close' | 'open')}>
      <ToggleGroupItem value="prev_close">vs Prev Close</ToggleGroupItem>
      <ToggleGroupItem value="open">vs Open</ToggleGroupItem>
    </ToggleGroup>
  )
  const refreshButton = (
    <ShadButton size="sm" variant="outline" disabled={ltpMut.isPending} onClick={handleUpdateLtp}>
      <RefreshCw className="size-3.5" />
      Update LTP
    </ShadButton>
  )
  const asOfText = summary?.last_ltp_update && (
    <span className="text-xs text-muted-foreground">
      LTP as of {new Date(summary.last_ltp_update).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )

  if (isLoading) {
    return (
      <Section title="Holdings">
        <div className="space-y-1.5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}</div>
      </Section>
    )
  }
  if (!data) return null

  const { groups } = data

  function row(r: HoldingRow, idx: number) {
    const striped = idx % 2 === 1
    return (
      <tr key={r.instrument_id} className={cn('group divide-x divide-border hover:bg-row-hover', striped && 'bg-row-stripe')}>
        <td className={cn('sticky left-0 z-10 px-2 py-1.5 font-medium group-hover:bg-row-hover', striped ? 'bg-row-stripe' : 'bg-card')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate">{r.symbol}</span>
            </TooltipTrigger>
            <TooltipContent>{r.symbol}</TooltipContent>
          </Tooltip>
        </td>
        <td className="px-2 py-1.5 text-right text-muted-foreground">{r.type}</td>
        <td data-numeric className="px-2 py-1.5 text-right"><NumQty value={r.qty} /></td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', NUM_LG)}><NumMoney value={r.cost} /></td>
        <td data-numeric className="px-2 py-1.5 text-right text-foreground">
          <div className="flex items-center justify-end gap-1.5">
            <NumMoney value={r.day_chg_abs} showSign />
            <GainChip value={r.day_chg_pct} />
          </div>
        </td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', NUM_LG)}><NumMoney value={r.value} /></td>
        <td data-numeric className="px-2 py-1.5 text-right text-foreground">
          <div className="flex items-center justify-end gap-1.5">
            <NumMoney value={r.pnl} showSign />
            <GainChip value={r.pnl_pct} />
          </div>
        </td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', (r.xirr ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
          <NumPct value={r.xirr} />
        </td>
        <td className="px-2 py-1.5">
          <div className="flex items-center justify-end gap-1">
            <span data-numeric className="text-muted-foreground">{r.as_of ?? '—'}</span>
            <PriceInfo row={r} compare={compare} />
          </div>
        </td>
      </tr>
    )
  }

  function toggleSort(next: string) {
    if (sort === next) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setDir('asc') }
  }
  const header = (label: string, key?: string) =>
    key && SORTABLE.has(key) ? (
      <th className="h-8 px-2 text-right font-medium text-muted-foreground" aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1">
          {label}
          {sort === key && (dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
        </button>
      </th>
    ) : (
      <th className={cn('h-8 px-2 font-medium text-muted-foreground', label !== 'Symbol' && label !== 'Type' && 'text-right')}>{label}</th>
    )

  return (
    <Section
      title="Holdings"
      bodyClassName="p-0"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {asOfText}
          {sectionsToggle}
          {compareToggle}
          {refreshButton}
        </div>
      }
    >
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)', minHeight: 320 }}>
        <table className="w-full table-fixed text-xs" style={{ minWidth: 1160 }}>
          <colgroup>
            <col style={{ width: 300 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead>
            <tr className="sticky top-0 z-20 divide-x divide-border bg-card">
              {header('Symbol', 'symbol')}
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Type</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Qty</th>
              {header('Cost', 'cost')}{header('Day ₹', 'day_chg_abs')}
              {header('Value', 'value')}{header('Gain ₹', 'pnl')}{header('XIRR', 'xirr')}
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Updated</th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {(() => {
              let rowIndex = 0
              return groups.map((g) => (
                <React.Fragment key={g.label ?? '__ungrouped'}>
                  {g.label && sections === 'on' && (
                    <tr className="bg-row-hover">
                      <td colSpan={9} className="border-y-2 border-foreground/25 px-2 py-1.5 text-xs font-bold tracking-wide uppercase">
                        {g.label}
                      </td>
                    </tr>
                  )}
                  {g.rows.map((r) => row(r, rowIndex++))}
                </React.Fragment>
              ))
            })()}
          </tbody>
          <tfoot>
            <tr className="sticky bottom-0 z-20 divide-x divide-border border-t-2 border-primary/50 bg-primary/10 font-semibold">
              <td colSpan={3} className="px-2 py-1.5 text-foreground">Total</td>
              <td data-numeric className={cn('px-2 py-1.5 text-right text-foreground', NUM_LG)}><NumMoney value={data.total_cost} /></td>
              <td data-numeric className="px-2 py-1.5 text-right text-foreground">
                <div className="flex items-center justify-end gap-1.5">
                  <NumMoney value={data.total_day_chg} showSign />
                  <GainChip value={data.total_day_chg_pct} />
                </div>
              </td>
              <td data-numeric className={cn('px-2 py-1.5 text-right text-foreground', NUM_LG)}><NumMoney value={data.total_value} /></td>
              <td data-numeric className="px-2 py-1.5 text-right text-foreground">
                <div className="flex items-center justify-end gap-1.5">
                  <NumMoney value={data.total_value - data.total_cost} showSign />
                  <GainChip value={data.total_cost > 0 ? ((data.total_value - data.total_cost) / data.total_cost) * 100 : null} />
                </div>
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  )
}

// ── Manual assets ──────────────────────────────────────────────────────────────

function ManualAssets() {
  const { privacyMode } = usePrivacy()
  const { data } = useManualAssets()
  const addFdMut = useAddFdMutation()
  const ppfMut = useUpsertPpfMutation()
  const npsMut = useUpsertNpsMutation()
  const cashMut = useUpsertCashMutation()
  const usdCashMut = useUpsertUsdCashMutation()
  const addForeignMut = useAddForeignEquityMutation()
  const updateForeignMut = useUpdateForeignEquityMutation()
  const deleteMut = useDeleteAssetMutation()
  const refreshUsdinrMut = useRefreshUsdinrMutation()
  const setManualUsdinrMut = useSetManualUsdinrMutation()

  const [open, setOpen] = useState(false)
  // FD form state
  const [fdLabel, setFdLabel] = useState('')
  const [fdPrincipal, setFdPrincipal] = useState<number | string>('')
  const [fdRate, setFdRate] = useState<number | string>('')
  const [fdStart, setFdStart] = useState('')
  const [fdMaturity, setFdMaturity] = useState('')
  const [fdEmergency] = useState(false)
  // Simple asset form state — initialized empty; synced from server when data arrives
  const [ppfValue, setPpfValue] = useState<number | string>('')
  const [npsValue, setNpsValue] = useState<number | string>('')
  const [cashValue, setCashValue] = useState<number | string>('')
  const [usdCashValue, setUsdCashValue] = useState<number | string>('')
  // Foreign equity form state (add new)
  const [fxLabel, setFxLabel] = useState('')
  const [fxValue, setFxValue] = useState<number | string>('')
  const [fxInvested, setFxInvested] = useState<number | string>('')
  // Foreign equity inline edit state: id → {label, current, invested}
  const [fxEdits, setFxEdits] = useState<Record<number, { label: string; current: string; invested: string }>>({})
  // Manual USDINR override
  const [manualRate, setManualRate] = useState<number | string>('')

  async function handleAddFd() {
    if (!fdLabel || !fdPrincipal || !fdRate || !fdStart || !fdMaturity) return
    try {
      await addFdMut.mutateAsync({ label: fdLabel, principal: Number(fdPrincipal), interest_rate: Number(fdRate), start_date: fdStart, maturity_date: fdMaturity, is_emergency_fund: fdEmergency })
      setFdLabel(''); setFdPrincipal(''); setFdRate(''); setFdStart(''); setFdMaturity('')
      notify.success('FD added.')
    } catch (e) { notify.error(String(e)) }
  }

  async function handleAddForeignEquity() {
    if (!fxLabel || !fxValue) return
    try {
      await addForeignMut.mutateAsync({ label: fxLabel, current_value: Number(fxValue), invested_value: Number(fxInvested) || 0 })
      setFxLabel(''); setFxValue(''); setFxInvested('')
      notify.success('Foreign equity added.')
    } catch (e) { notify.error(String(e)) }
  }

  async function handleSaveForeignEquity(id: number) {
    const e = fxEdits[id]
    if (!e) return
    try {
      await updateForeignMut.mutateAsync({ id, label: e.label, current_value: Number(e.current), invested_value: Number(e.invested) || 0 })
      setFxEdits((prev) => { const n = { ...prev }; delete n[id]; return n })
      notify.success('Updated.')
    } catch (err) { notify.error(String(err)) }
  }

  function initFxEdit(fe: { id: number; label: string; value_usd: number; invested_usd: number }) {
    setFxEdits((prev) => ({ ...prev, [fe.id]: { label: fe.label, current: String(fe.value_usd), invested: String(fe.invested_usd) } }))
  }

  async function handleRefreshUsdinr() {
    try {
      const r = await refreshUsdinrMut.mutateAsync()
      notify.success(`USDINR rate updated: ₹${r.rate.toFixed(4)} (${r.source})`)
    } catch (e) { notify.error(`USDINR refresh failed: ${String(e)}`) }
  }

  async function handleSetManualRate() {
    if (!manualRate) return
    try {
      await setManualUsdinrMut.mutateAsync(Number(manualRate))
      setManualRate('')
      notify.success('USDINR rate set manually.')
    } catch (e) { notify.error(String(e)) }
  }

  if (!data) return null
  const manualData = data

  function toggleEditor() {
    if (!open) {
      setPpfValue(manualData.ppf?.current_value ?? '')
      setNpsValue(manualData.nps?.current_value ?? '')
      setCashValue(manualData.cash?.current_value ?? '')
      setUsdCashValue(manualData.usd_cash_value_usd > 0 ? manualData.usd_cash_value_usd : '')
    }
    setOpen((value) => !value)
  }

  return (
    <div className="flex flex-col gap-4">
      <ContentHeader
        title="Manual Assets"
        action={
          <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground"><MoneyText value={data.total_manual} /> total</span>
          <ShadButton size="xs" variant="ghost" onClick={toggleEditor}>
            {open ? 'Hide' : 'Edit'}
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </ShadButton>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Fixed Deposits" action={data.total_fd > 0 ? <MoneyText value={data.total_fd} className="text-sm font-semibold" /> : undefined}>
          <div className="space-y-3">
            {data.fds.length > 0 && (
              <ShadTable className="text-xs [&_th]:h-8 [&_td]:px-2 [&_td]:py-1.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Principal</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Maturity</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.fds.map((fd) => (
                    <TableRow key={fd.id}>
                      <TableCell>
                        {fd.label}
                        {fd.is_emergency_fund && <Badge className={cn('ml-1', CHIP_CLASS.orange)}>EF</Badge>}
                      </TableCell>
                      <TableCell><MoneyText value={fd.principal} /></TableCell>
                      <TableCell>{fd.interest_rate}%</TableCell>
                      <TableCell>{fd.maturity_date}</TableCell>
                      <TableCell><MoneyText value={fd.current_value} /></TableCell>
                      <TableCell>
                        <ConfirmActionButton size="icon-xs" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete fixed deposit?" confirmDescription={`Delete ${fd.label}?`} onConfirm={() => deleteMut.mutateAsync(fd.id)}>
                          <Trash2 className="size-3" />
                        </ConfirmActionButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ShadTable>
            )}
            {open && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Add FD</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-36 space-y-1"><Label className="text-xs">Label</Label><Input value={fdLabel} onChange={(e) => setFdLabel(e.target.value)} className="h-8" /></div>
                  <div className="w-32 space-y-1"><Label className="text-xs">Principal</Label><Input type="number" value={fdPrincipal} onChange={(e) => setFdPrincipal(e.target.value)} className="h-8" /></div>
                  <div className="w-24 space-y-1"><Label className="text-xs">Rate %</Label><Input type="number" step={0.1} value={fdRate} onChange={(e) => setFdRate(e.target.value)} className="h-8" /></div>
                  <div className="w-36 space-y-1"><Label className="text-xs">Start</Label><Input type="date" value={fdStart} onChange={(e) => setFdStart(e.target.value)} className="h-8" /></div>
                  <div className="w-36 space-y-1"><Label className="text-xs">Maturity</Label><Input type="date" value={fdMaturity} onChange={(e) => setFdMaturity(e.target.value)} className="h-8" /></div>
                  <ShadButton size="sm" disabled={addFdMut.isPending} onClick={handleAddFd}>Add</ShadButton>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section title="PPF · NPS · Cash">
          <div className="grid grid-cols-4 gap-3">
            {data.ppf && (
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">PPF</p>
                <MoneyText value={data.total_ppf} className="text-sm font-semibold" />
              </div>
            )}
            {data.nps && (
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">NPS</p>
                <MoneyText value={data.total_nps} className="text-sm font-semibold" />
              </div>
            )}
            {data.cash && (
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">Cash</p>
                <MoneyText value={data.cash.current_value} className="text-sm font-semibold" />
              </div>
            )}
            {data.usd_cash && (
              <div className="rounded-lg border p-2">
                <p className="text-xs text-muted-foreground">INDMoney</p>
                <MoneyText value={data.usd_cash.current_value} className="text-sm font-semibold" />
                <p className="text-xs text-muted-foreground">${data.usd_cash_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            )}
          </div>

          {open && (
            <div className="mt-3 space-y-3 border-t pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">PPF value</Label><Input type="number" value={ppfValue} onChange={(e) => setPpfValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={ppfMut.isPending} onClick={() => ppfMut.mutate({ current_value: Number(ppfValue) })}>Save</ShadButton>
                {data.ppf && <ConfirmActionButton size="sm" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete PPF?" confirmDescription="Delete this PPF asset?" onConfirm={() => deleteMut.mutateAsync(data.ppf!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">NPS value</Label><Input type="number" value={npsValue} onChange={(e) => setNpsValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={npsMut.isPending} onClick={() => npsMut.mutate({ current_value: Number(npsValue) })}>Save</ShadButton>
                {data.nps && <ConfirmActionButton size="sm" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete NPS?" confirmDescription="Delete this NPS asset?" onConfirm={() => deleteMut.mutateAsync(data.nps!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">Cash / Savings value</Label><Input type="number" value={cashValue} onChange={(e) => setCashValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={cashMut.isPending} onClick={() => cashMut.mutate({ current_value: Number(cashValue) })}>Save</ShadButton>
                {data.cash && <ConfirmActionButton size="sm" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete cash?" confirmDescription="Delete this cash asset?" onConfirm={() => deleteMut.mutateAsync(data.cash!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">INDMoney balance ($)</Label><Input type="number" min={0} step={0.01} value={usdCashValue} onChange={(e) => setUsdCashValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={usdCashMut.isPending} onClick={() => usdCashMut.mutate({ current_value: Number(usdCashValue) })}>Save</ShadButton>
                {data.usd_cash && <ConfirmActionButton size="sm" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete USD cash?" confirmDescription="Delete this USD cash asset?" onConfirm={() => deleteMut.mutateAsync(data.usd_cash!.id)}>Delete</ConfirmActionButton>}
              </div>
            </div>
          )}
        </Section>

        <Section
          title="Foreign Equity"
          action={data.total_foreign_equity_inr > 0 ? <MoneyText value={data.total_foreign_equity_inr} className="text-sm font-semibold" /> : undefined}
        >
          <div className="space-y-3">
            {data.foreign_equities.length > 0 && (
              <ShadTable className="text-xs [&_th]:h-8 [&_td]:px-2 [&_td]:py-1.5">
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Invested ($)</TableHead>
                    <TableHead>Current ($)</TableHead>
                    <TableHead>Change ($)</TableHead>
                    <TableHead>Change (%)</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.foreign_equities.map((fe) => {
                    const editing = fxEdits[fe.id]
                    const chg = fe.invested_usd > 0 ? fe.value_usd - fe.invested_usd : null
                    const chgPct = fe.invested_usd > 0 ? ((fe.value_usd - fe.invested_usd) / fe.invested_usd) * 100 : null
                    const fmt = (n: number) => privacyMode ? '$•••' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    const chgClass = chg == null ? undefined : chg >= 0 ? 'text-positive' : 'text-negative'
                    if (editing) {
                      return (
                        <TableRow key={fe.id}>
                          <TableCell><Input className="h-7 w-24" value={editing.label} onChange={(e) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], label: e.target.value } }))} /></TableCell>
                          <TableCell><Input type="number" min={0} step={0.01} className="h-7 w-28" value={editing.invested} onChange={(e) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], invested: e.target.value } }))} /></TableCell>
                          <TableCell><Input type="number" min={0} step={0.01} className="h-7 w-28" value={editing.current} onChange={(e) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], current: e.target.value } }))} /></TableCell>
                          <TableCell colSpan={2} />
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <ShadButton size="xs" disabled={updateForeignMut.isPending} onClick={() => handleSaveForeignEquity(fe.id)}>Save</ShadButton>
                              <ShadButton size="xs" variant="ghost" onClick={() => setFxEdits((p) => { const n = { ...p }; delete n[fe.id]; return n })}>Cancel</ShadButton>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    }
                    return (
                      <TableRow key={fe.id}>
                        <TableCell>{fe.label}</TableCell>
                        <TableCell>{fe.invested_usd > 0 ? fmt(fe.invested_usd) : '—'}</TableCell>
                        <TableCell>{fmt(fe.value_usd)}</TableCell>
                        <TableCell className={chgClass}>{chg != null ? (chg >= 0 ? '+' : '') + fmt(chg) : '—'}</TableCell>
                        <TableCell className={chgClass}>{chgPct != null ? (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%' : '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {open && <ShadButton size="xs" variant="ghost" onClick={() => initFxEdit(fe)}>Edit</ShadButton>}
                            <ConfirmActionButton size="icon-xs" variant="ghost" className="text-destructive hover:text-destructive" confirmTitle="Delete foreign equity?" confirmDescription={`Delete ${fe.label}?`} onConfirm={() => deleteMut.mutateAsync(fe.id)}>
                              <Trash2 className="size-3" />
                            </ConfirmActionButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </ShadTable>
            )}
            {open && (
              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Add Foreign Equity (USD)</p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-36 space-y-1"><Label className="text-xs">Label</Label><Input placeholder="AAPL, VTI, …" value={fxLabel} onChange={(e) => setFxLabel(e.target.value)} className="h-8" /></div>
                  <div className="w-32 space-y-1"><Label className="text-xs">Invested ($)</Label><Input type="number" min={0} step={0.01} value={fxInvested} onChange={(e) => setFxInvested(e.target.value)} className="h-8" /></div>
                  <div className="w-32 space-y-1"><Label className="text-xs">Current ($)</Label><Input type="number" min={0} step={0.01} value={fxValue} onChange={(e) => setFxValue(e.target.value)} className="h-8" /></div>
                  <ShadButton size="sm" disabled={addForeignMut.isPending} onClick={handleAddForeignEquity}>Add</ShadButton>
                </div>
              </div>
            )}
          </div>
        </Section>

        <Section title="USD/INR" action={<span className="text-sm font-semibold">{data.usdinr_rate.toFixed(4)}</span>}>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Refresh from Kite</Label>
              <ShadButton size="sm" variant="outline" disabled={refreshUsdinrMut.isPending} onClick={handleRefreshUsdinr}>
                <RefreshCw className="size-3.5" />
                Refresh from Kite
              </ShadButton>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Override manually</Label>
              <div className="flex items-end gap-2">
                <Input type="number" placeholder="e.g. 85.50" min={0} step={0.01} value={manualRate} onChange={(e) => setManualRate(e.target.value)} className="h-8 w-32" />
                <ShadButton size="sm" variant="ghost" disabled={setManualUsdinrMut.isPending} onClick={handleSetManualRate}>Set</ShadButton>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function Dashboard() {
  return (
    <PageShell>
      <PageHeader title="Dashboard" />
      <SummaryCards />
      <HoldingsTable />
      <ManualAssets />
    </PageShell>
  )
}
