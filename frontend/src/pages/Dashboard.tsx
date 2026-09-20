import React, { useState } from 'react'
import { RefreshCw, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
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
import { inr, pct, heatmapBg, heatmapTextColor } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type { HoldingRow } from '../types/portfolio'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { MetricCard } from '../components/MetricCard'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { usePersistentState } from '../hooks/usePersistentState'
import { Button as ShadButton } from '@/components/ui/button'
import { Select as ShadSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table as ShadTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { CHIP_CLASS } from '@/lib/colors'
import { notify } from '@/lib/notify'

// ── Summary cards ──────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data } = useSummaryCards()
  if (!data) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="" value="" loading />)}</div>
  const pnlPositive = data.total_pnl >= 0
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-0.5"><p className="text-xs text-muted-foreground">{label}</p><p className="text-sm" data-numeric>{children}</p></div>
}

// ── Holdings table ──────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'symbol', label: 'Symbol' },
  { value: 'value', label: 'Value' },
  { value: 'pnl', label: 'P&L ₹' },
  { value: 'pnl_pct', label: 'P&L %' },
  { value: 'xirr', label: 'XIRR' },
  { value: 'day_chg_abs', label: 'Day ₹' },
  { value: 'day_chg_pct', label: 'Day %' },
  { value: 'cost', label: 'Cost' },
]

function HoldingsTable() {
  const mobile = useMediaQuery('(max-width: 767px)')
  const [sort, setSort] = usePersistentState('dashboard.sort', 'symbol')
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

  const { groups, pnl_pct_min, pnl_pct_max, day_chg_pct_min, day_chg_pct_max } = data

  function row(r: HoldingRow) {
    const dayPctBg = heatmapBg(r.day_chg_pct, day_chg_pct_min, day_chg_pct_max, 'rb')
    const pnlPctBg = heatmapBg(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rb')
    return (
      <tr key={r.instrument_id} className="hover:bg-muted/50">
        <td className="sticky left-0 z-10 max-w-[230px] bg-card px-2 py-1.5 font-medium">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate">{r.symbol}</span>
            </TooltipTrigger>
            <TooltipContent>{r.symbol}</TooltipContent>
          </Tooltip>
        </td>
        <td className="px-2 py-1.5 text-muted-foreground">{r.type}</td>
        <td data-numeric className="px-2 py-1.5 text-right"><NumQty value={r.qty} /></td>
        <td data-numeric className="px-2 py-1.5 text-right"><NumPrice value={r.avg_price} /></td>
        <td data-numeric className="px-2 py-1.5 text-right"><NumMoney value={r.cost} /></td>
        <td data-numeric className={cn('px-2 py-1.5 text-right')} style={{ background: dayPctBg, color: heatmapTextColor(r.day_chg_pct, day_chg_pct_min, day_chg_pct_max, 'rb') }}>
          <NumPct value={r.day_chg_pct} />
        </td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', (r.day_chg_abs ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
          <NumMoney value={r.day_chg_abs} showSign />
        </td>
        <td data-numeric className="px-2 py-1.5 text-right">
          <NumPrice value={r.prev_close} />
          {r.prev_close_date && <p className="text-xs text-muted-foreground">{r.prev_close_date}</p>}
        </td>
        <td data-numeric className="px-2 py-1.5 text-right">
          <NumPrice value={r.ltp} />
          {r.as_of && <p className="text-xs text-muted-foreground">{r.as_of}</p>}
        </td>
        <td data-numeric className="px-2 py-1.5 text-right"><NumMoney value={r.value} /></td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', r.pnl >= 0 ? 'text-positive' : 'text-negative')}>
          <NumMoney value={r.pnl} showSign />
        </td>
        <td data-numeric className={cn('px-2 py-1.5 text-right')} style={{ background: pnlPctBg, color: heatmapTextColor(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rb') }}>
          <NumPct value={r.pnl_pct} />
        </td>
        <td data-numeric className={cn('px-2 py-1.5 text-right', (r.xirr ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
          <NumPct value={r.xirr} />
        </td>
      </tr>
    )
  }

  function toggleSort(next: string) {
    if (sort === next) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setDir('asc') }
  }
  const sortable = new Set(SORT_OPTIONS.map((option) => option.value))
  const header = (label: string, key?: string) =>
    key && sortable.has(key) ? (
      <th className="h-8 px-2 text-right font-medium text-muted-foreground" aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1">
          {label}
          {sort === key && (dir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
        </button>
      </th>
    ) : (
      <th className={cn('h-8 px-2 font-medium text-muted-foreground', label !== 'Symbol' && label !== 'Type' && 'text-right')}>{label}</th>
    )

  if (mobile) {
    return (
      <Section
        title="Holdings"
        action={<div className="flex flex-wrap items-center gap-2">{asOfText}{refreshButton}</div>}
        bodyClassName="p-4 space-y-3"
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-muted-foreground">Sort holdings</label>
            <ShadSelect value={sort} onValueChange={(v) => setSort(v)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </ShadSelect>
          </div>
          <ShadButton variant="outline" size="sm" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>
            {dir === 'asc' ? 'Ascending' : 'Descending'}
          </ShadButton>
        </div>
        <div className="flex gap-2">
          {sectionsToggle}
          {compareToggle}
        </div>
        {groups.map((group) => (
          <div key={group.label ?? '__ungrouped'} className="space-y-1">
            {group.label && <p className="text-xs font-bold text-muted-foreground uppercase">{group.label}</p>}
            {group.rows.map((r) => (
              <Accordion key={r.instrument_id} type="single" collapsible className="rounded-md border px-3">
                <AccordionItem value={String(r.instrument_id)} className="border-b-0">
                  <AccordionTrigger className="py-2 hover:no-underline">
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.symbol}</p>
                        <p className="text-xs text-muted-foreground">{r.type}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <NumMoney value={r.value} />
                        <p className={cn('text-xs', (r.pnl_pct ?? 0) >= 0 ? 'text-positive' : 'text-negative')}>
                          Gain <NumPct value={r.pnl_pct} /> · Day <NumPct value={r.day_chg_pct} />
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 gap-2">
                      <Detail label="Qty"><NumQty value={r.qty} /></Detail>
                      <Detail label="Avg"><NumPrice value={r.avg_price} /></Detail>
                      <Detail label="Cost"><NumMoney value={r.cost} /></Detail>
                      <Detail label="Day ₹"><NumMoney value={r.day_chg_abs} showSign /></Detail>
                      <Detail label={`Compare (${r.prev_close_date ?? '—'})`}><NumPrice value={r.prev_close} /></Detail>
                      <Detail label={`LTP (${r.as_of ?? '—'})`}><NumPrice value={r.ltp} /></Detail>
                      <Detail label="Gain ₹"><NumMoney value={r.pnl} showSign /></Detail>
                      <Detail label="XIRR"><NumPct value={r.xirr} /></Detail>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            ))}
          </div>
        ))}
        <div className="rounded-xl border bg-card p-4">
          <div className="grid grid-cols-2 gap-2">
            <Detail label="Total cost"><NumMoney value={data.total_cost} /></Detail>
            <Detail label="Day %"><NumPct value={data.total_day_chg_pct} /></Detail>
            <Detail label="Day ₹"><NumMoney value={data.total_day_chg} showSign /></Detail>
            <Detail label="Current value"><NumMoney value={data.total_value} /></Detail>
            <Detail label="Total gain"><NumMoney value={data.total_value - data.total_cost} showSign /></Detail>
          </div>
        </div>
      </Section>
    )
  }

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
        <table className="w-full text-xs" style={{ minWidth: 1380 }}>
          <thead>
            <tr className="sticky top-0 z-20 bg-card">
              {header('Symbol', 'symbol')}
              <th className="h-8 px-2 text-left font-medium text-muted-foreground">Type</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Qty</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Avg</th>
              {header('Cost', 'cost')}{header('Day %', 'day_chg_pct')}{header('Day ₹', 'day_chg_abs')}
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">Prev Close</th>
              <th className="h-8 px-2 text-right font-medium text-muted-foreground">LTP</th>
              {header('Value', 'value')}{header('Gain ₹', 'pnl')}{header('Gain %', 'pnl_pct')}{header('XIRR', 'xirr')}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <React.Fragment key={g.label ?? '__ungrouped'}>
                {g.label && sections === 'on' && (
                  <tr>
                    <td colSpan={13} className="bg-muted px-2 py-1.5 text-xs font-semibold">
                      {g.label}
                    </td>
                  </tr>
                )}
                {g.rows.map((r) => row(r))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className={cn('sticky bottom-0 z-20 bg-card font-semibold', data.total_day_chg >= 0 ? 'text-positive' : 'text-negative')}>
              <td colSpan={4} className="px-2 py-1.5 text-foreground">Total</td>
              <td data-numeric className="px-2 py-1.5 text-right text-foreground"><NumMoney value={data.total_cost} /></td>
              <td data-numeric className="px-2 py-1.5 text-right">
                <NumPct value={data.total_day_chg_pct} />
              </td>
              <td data-numeric className="px-2 py-1.5 text-right">
                <NumMoney value={data.total_day_chg} showSign />
              </td>
              <td colSpan={2} />
              <td data-numeric className="px-2 py-1.5 text-right text-foreground"><NumMoney value={data.total_value} /></td>
              <td data-numeric className="px-2 py-1.5 text-right text-foreground">
                <NumMoney value={data.total_value - data.total_cost} showSign />
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Manual Assets</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground"><MoneyText value={data.total_manual} /> total</span>
          <ShadButton size="xs" variant="ghost" onClick={toggleEditor}>
            {open ? 'Hide' : 'Edit'}
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </ShadButton>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Fixed Deposits" action={data.total_fd > 0 ? <MoneyText value={data.total_fd} className="text-sm font-semibold" /> : undefined}>
          <div className="space-y-3">
            {data.fds.length > 0 && (
              <ShadTable className="text-xs">
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
                        <ConfirmActionButton size="icon-xs" variant="ghost" confirmTitle="Delete fixed deposit?" confirmDescription={`Delete ${fd.label}?`} onConfirm={() => deleteMut.mutateAsync(fd.id)}>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                {data.ppf && <ConfirmActionButton size="sm" variant="ghost" confirmTitle="Delete PPF?" confirmDescription="Delete this PPF asset?" onConfirm={() => deleteMut.mutateAsync(data.ppf!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">NPS value</Label><Input type="number" value={npsValue} onChange={(e) => setNpsValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={npsMut.isPending} onClick={() => npsMut.mutate({ current_value: Number(npsValue) })}>Save</ShadButton>
                {data.nps && <ConfirmActionButton size="sm" variant="ghost" confirmTitle="Delete NPS?" confirmDescription="Delete this NPS asset?" onConfirm={() => deleteMut.mutateAsync(data.nps!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">Cash / Savings value</Label><Input type="number" value={cashValue} onChange={(e) => setCashValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={cashMut.isPending} onClick={() => cashMut.mutate({ current_value: Number(cashValue) })}>Save</ShadButton>
                {data.cash && <ConfirmActionButton size="sm" variant="ghost" confirmTitle="Delete cash?" confirmDescription="Delete this cash asset?" onConfirm={() => deleteMut.mutateAsync(data.cash!.id)}>Delete</ConfirmActionButton>}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36 space-y-1"><Label className="text-xs">INDMoney balance ($)</Label><Input type="number" min={0} step={0.01} value={usdCashValue} onChange={(e) => setUsdCashValue(e.target.value)} className="h-8" /></div>
                <ShadButton size="sm" disabled={usdCashMut.isPending} onClick={() => usdCashMut.mutate({ current_value: Number(usdCashValue) })}>Save</ShadButton>
                {data.usd_cash && <ConfirmActionButton size="sm" variant="ghost" confirmTitle="Delete USD cash?" confirmDescription="Delete this USD cash asset?" onConfirm={() => deleteMut.mutateAsync(data.usd_cash!.id)}>Delete</ConfirmActionButton>}
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
              <ShadTable className="text-xs">
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
                            <ConfirmActionButton size="icon-xs" variant="ghost" confirmTitle="Delete foreign equity?" confirmDescription={`Delete ${fe.label}?`} onConfirm={() => deleteMut.mutateAsync(fe.id)}>
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
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard" />
      <SummaryCards />
      <HoldingsTable />
      <ManualAssets />
    </div>
  )
}
