import React, { useState } from 'react'
import {
  Accordion, Badge, Box, Button, Collapse, Divider, Group,
  NumberInput, Paper, SegmentedControl, Select, SimpleGrid, Skeleton,
  Stack, Table, Text, TextInput, Tooltip,
} from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconChevronUp, IconRefresh, IconTrash } from '@tabler/icons-react'
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
import type { HoldingRow } from '../types/portfolio'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { MetricCard } from '../components/MetricCard'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { usePersistentState } from '../hooks/usePersistentState'

// ── Summary cards ──────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data } = useSummaryCards()
  if (!data) return <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">{Array.from({ length: 4 }, (_, index) => <MetricCard key={index} label="" value="" loading />)}</SimpleGrid>
  const pnlPositive = data.total_pnl >= 0
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      <MetricCard label="Invested" value={<MoneyText value={data.total_cost} />} />
      <MetricCard label="Current value" value={<MoneyText value={data.total_value} />} />
      <MetricCard tone={pnlPositive ? 'positive' : 'negative'} label="Total P&L" value={<Text fw={700} c={pnlPositive ? 'var(--positive)' : 'var(--negative)'}>
          <MoneyText value={data.total_pnl} showSign />
          {' '}
          <Text span size="xs">({pct((data.total_pnl / data.total_cost) * 100)})</Text>
        </Text>} />
      <MetricCard tone={data.xirr != null && data.xirr >= 0 ? 'positive' : 'negative'} label="XIRR" value={data.xirr != null ? pct(data.xirr * 100) : '—'} />
    </SimpleGrid>
  )
}

// ── LTP update bar ─────────────────────────────────────────────────────────────

function LtpUpdateBar() {
  const { data } = useSummaryCards()
  const mut = useUpdateLtpMutation()

  function handleClick() {
    mut.mutate(undefined, {
      onSuccess: (r) => {
        notifications.show({ color: 'green', message: `LTP updated: ${r.updated} instruments` })
      },
      onError: (e) => {
        notifications.show({ color: 'red', message: String(e) })
      },
    })
  }

  return (
    <Group justify="flex-end" gap="sm">
      {data?.last_ltp_update && (
        <Text size="xs" c="dimmed">
          LTP as of {new Date(data.last_ltp_update).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
      <Button
        size="xs"
        variant="light"
        leftSection={<IconRefresh size={12} />}
        loading={mut.isPending}
        onClick={handleClick}
      >
        Update LTP
      </Button>
    </Group>
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
  return <Stack gap={1}><Text size="xs" c="dimmed">{label}</Text><Text size="sm" data-numeric>{children}</Text></Stack>
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
  const mobile = useMediaQuery('(max-width: 48em)')
  const [sort, setSort] = usePersistentState('dashboard.sort', 'symbol')
  const [dir, setDir] = usePersistentState<'asc' | 'desc'>('dashboard.dir', 'asc')
  const [sections, setSections] = usePersistentState<'on' | 'off'>('dashboard.sections', 'on')
  const [compare, setCompare] = usePersistentState<'prev_close' | 'open'>('dashboard.compare', 'prev_close')

  const { data, isLoading } = useHoldings({ sort, dir, sections, compare })

  if (isLoading) return <Stack gap="xs">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} height={44} />)}</Stack>
  if (!data) return null

  const { groups, pnl_pct_min, pnl_pct_max, day_chg_pct_min, day_chg_pct_max } = data

  function row(r: HoldingRow) {
    const dayPctBg = heatmapBg(r.day_chg_pct, day_chg_pct_min, day_chg_pct_max, 'rb')
    const pnlPctBg = heatmapBg(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rb')
    return (
      <Table.Tr key={r.instrument_id}>
        <Table.Td fw={500} style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--surface-panel)', maxWidth: 230 }}><Tooltip label={r.symbol}><Text truncate="end">{r.symbol}</Text></Tooltip></Table.Td>
        <Table.Td style={{ color: 'var(--mantine-color-dimmed)' }}>{r.type}</Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumQty value={r.qty} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumPrice value={r.avg_price} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumMoney value={r.cost} /></Table.Td>
        <Table.Td style={{ textAlign: 'right', background: dayPctBg, color: heatmapTextColor(r.day_chg_pct, day_chg_pct_min, day_chg_pct_max, 'rb') }}>
          <NumPct value={r.day_chg_pct} />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', color: (r.day_chg_abs ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
          <NumMoney value={r.day_chg_abs} showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', fontSize: '13px' }}>
          <NumPrice value={r.prev_close} />
          {r.prev_close_date && <Text size="xs" c="dimmed">{r.prev_close_date}</Text>}
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', fontSize: '13px' }}>
          <NumPrice value={r.ltp} />
          {r.as_of && <Text size="xs" c="dimmed">{r.as_of}</Text>}
        </Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumMoney value={r.value} /></Table.Td>
        <Table.Td style={{ textAlign: 'right', color: r.pnl >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
          <NumMoney value={r.pnl} showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: pnlPctBg, color: heatmapTextColor(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rb') }}>
          <NumPct value={r.pnl_pct} />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', color: (r.xirr ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
          <NumPct value={r.xirr} />
        </Table.Td>
      </Table.Tr>
    )
  }

  const totalDayChgColor = data.total_day_chg >= 0 ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)'

  function toggleSort(next: string) {
    if (sort === next) setDir(dir === 'asc' ? 'desc' : 'asc')
    else { setSort(next); setDir('asc') }
  }
  const sortable = new Set(SORT_OPTIONS.map((option) => option.value))
  const header = (label: string, key?: string) => key && sortable.has(key) ? <Table.Th aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ textAlign: 'right' }}><Button variant="subtle" size="compact-xs" onClick={() => toggleSort(key)} rightSection={sort === key ? (dir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />) : undefined}>{label}</Button></Table.Th> : <Table.Th style={{ textAlign: label === 'Symbol' || label === 'Type' ? undefined : 'right' }}>{label}</Table.Th>

  if (mobile) return <Stack gap="sm">
    <Group grow align="end"><Select data={SORT_OPTIONS} value={sort} onChange={(value) => value && setSort(value)} label="Sort holdings" size="xs" /><Button variant="default" size="xs" onClick={() => setDir(dir === 'asc' ? 'desc' : 'asc')}>{dir === 'asc' ? 'Ascending' : 'Descending'}</Button></Group>
    <Group grow><SegmentedControl data={[{ value: 'on', label: 'Sections' }, { value: 'off', label: 'Flat' }]} value={sections} onChange={(value) => setSections(value as 'on' | 'off')} size="xs" /><SegmentedControl data={[{ value: 'prev_close', label: 'Prev close' }, { value: 'open', label: 'Open' }]} value={compare} onChange={(value) => setCompare(value as 'prev_close' | 'open')} size="xs" /></Group>
    {groups.map((group) => <Stack key={group.label ?? '__ungrouped'} gap="xs">{group.label && <Text size="xs" fw={700} tt="uppercase" c="dimmed">{group.label}</Text>}{group.rows.map((r) => <Accordion key={r.instrument_id} variant="contained"><Accordion.Item value={String(r.instrument_id)}><Accordion.Control><Group justify="space-between" wrap="nowrap" gap="xs"><Box miw={0}><Text fw={600} truncate="end">{r.symbol}</Text><Text size="xs" c="dimmed">{r.type}</Text></Box><Stack gap={0} align="flex-end"><NumMoney value={r.value} /><Text size="xs" c={(r.pnl_pct ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)'}>Gain <NumPct value={r.pnl_pct} /> · Day <NumPct value={r.day_chg_pct} /></Text></Stack></Group></Accordion.Control><Accordion.Panel><SimpleGrid cols={2} spacing="xs"><Detail label="Qty"><NumQty value={r.qty} /></Detail><Detail label="Avg"><NumPrice value={r.avg_price} /></Detail><Detail label="Cost"><NumMoney value={r.cost} /></Detail><Detail label="Day ₹"><NumMoney value={r.day_chg_abs} showSign /></Detail><Detail label={`Compare (${r.prev_close_date ?? '—'})`}><NumPrice value={r.prev_close} /></Detail><Detail label={`LTP (${r.as_of ?? '—'})`}><NumPrice value={r.ltp} /></Detail><Detail label="Gain ₹"><NumMoney value={r.pnl} showSign /></Detail><Detail label="XIRR"><NumPct value={r.xirr} /></Detail></SimpleGrid></Accordion.Panel></Accordion.Item></Accordion>)}</Stack>)}
    <Panel><SimpleGrid cols={2} spacing="xs"><Detail label="Total cost"><NumMoney value={data.total_cost} /></Detail><Detail label="Day %"><NumPct value={data.total_day_chg_pct} /></Detail><Detail label="Day ₹"><NumMoney value={data.total_day_chg} showSign /></Detail><Detail label="Current value"><NumMoney value={data.total_value} /></Detail><Detail label="Total gain"><NumMoney value={data.total_value - data.total_cost} showSign /></Detail></SimpleGrid></Panel>
  </Stack>

  return (
    <Stack gap="xs">
      <Group gap="sm" wrap="wrap">
        <SegmentedControl data={[{ value: 'on', label: 'Sections' }, { value: 'off', label: 'Flat' }]} value={sections} onChange={(v) => setSections(v as 'on' | 'off')} size="xs" style={{ alignSelf: 'flex-end' }} />
        <SegmentedControl data={[{ value: 'prev_close', label: 'vs Prev Close' }, { value: 'open', label: 'vs Open' }]} value={compare} onChange={(v) => setCompare(v as 'prev_close' | 'open')} size="xs" style={{ alignSelf: 'flex-end' }} />
      </Group>

      <Box style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 320 }}>
        <Table fz="sm" withRowBorders style={{ minWidth: 1380 }} styles={{ th: { position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface-panel)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em' } }}>
          <Table.Thead>
            <Table.Tr>
              {header('Symbol', 'symbol')}
              <Table.Th>Type</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Avg</Table.Th>
              {header('Cost', 'cost')}{header('Day %', 'day_chg_pct')}{header('Day ₹', 'day_chg_abs')}
              <Table.Th style={{ textAlign: 'right' }}>Prev Close</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>LTP</Table.Th>
              {header('Value', 'value')}{header('Gain ₹', 'pnl')}{header('Gain %', 'pnl_pct')}{header('XIRR', 'xirr')}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => (
              <React.Fragment key={g.label ?? '__ungrouped'}>
                {g.label && sections === 'on' && (
                  <Table.Tr>
                    <Table.Td colSpan={13} style={{ background: 'var(--surface-muted)', fontWeight: 600, fontSize: '0.75rem', padding: '6px 8px' }}>
                      {g.label}
                    </Table.Td>
                  </Table.Tr>
                )}
                {g.rows.map((r) => row(r))}
              </React.Fragment>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr style={{ fontWeight: 600, background: 'var(--surface-panel)' }}>
              <Table.Td colSpan={4}>Total</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><NumMoney value={data.total_cost} /></Table.Td>
              <Table.Td style={{ textAlign: 'right', color: totalDayChgColor }}>
                <NumPct value={data.total_day_chg_pct} />
              </Table.Td>
              <Table.Td style={{ textAlign: 'right', color: totalDayChgColor }}>
                <NumMoney value={data.total_day_chg} showSign />
              </Table.Td>
              <Table.Td colSpan={2} />
              <Table.Td style={{ textAlign: 'right' }}><NumMoney value={data.total_value} /></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <NumMoney value={data.total_value - data.total_cost} showSign />
              </Table.Td>
              <Table.Td colSpan={2} />
            </Table.Tr>
          </Table.Tfoot>
        </Table>
      </Box>
    </Stack>
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
      notifications.show({ color: 'green', message: 'FD added.' })
    } catch (e) { notifications.show({ color: 'red', message: String(e) }) }
  }

  async function handleAddForeignEquity() {
    if (!fxLabel || !fxValue) return
    try {
      await addForeignMut.mutateAsync({ label: fxLabel, current_value: Number(fxValue), invested_value: Number(fxInvested) || 0 })
      setFxLabel(''); setFxValue(''); setFxInvested('')
      notifications.show({ color: 'green', message: 'Foreign equity added.' })
    } catch (e) { notifications.show({ color: 'red', message: String(e) }) }
  }

  async function handleSaveForeignEquity(id: number) {
    const e = fxEdits[id]
    if (!e) return
    try {
      await updateForeignMut.mutateAsync({ id, label: e.label, current_value: Number(e.current), invested_value: Number(e.invested) || 0 })
      setFxEdits((prev) => { const n = { ...prev }; delete n[id]; return n })
      notifications.show({ color: 'green', message: 'Updated.' })
    } catch (err) { notifications.show({ color: 'red', message: String(err) }) }
  }

  function initFxEdit(fe: { id: number; label: string; value_usd: number; invested_usd: number }) {
    setFxEdits((prev) => ({ ...prev, [fe.id]: { label: fe.label, current: String(fe.value_usd), invested: String(fe.invested_usd) } }))
  }

  async function handleRefreshUsdinr() {
    try {
      const r = await refreshUsdinrMut.mutateAsync()
      notifications.show({ color: 'green', message: `USDINR rate updated: ₹${r.rate.toFixed(4)} (${r.source})` })
    } catch (e) { notifications.show({ color: 'red', message: `USDINR refresh failed: ${String(e)}` }) }
  }

  async function handleSetManualRate() {
    if (!manualRate) return
    try {
      await setManualUsdinrMut.mutateAsync(Number(manualRate))
      setManualRate('')
      notifications.show({ color: 'green', message: 'USDINR rate set manually.' })
    } catch (e) { notifications.show({ color: 'red', message: String(e) }) }
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

  const hasForeignEquity = data.foreign_equities.length > 0 || data.total_foreign_equity_usd > 0

  return (
    <Panel title="Manual Assets" action={<Text size="xs" c="dimmed"><MoneyText value={data.total_manual} /> total</Text>}>
      <Group justify="space-between" mb="xs">
        <Button size="xs" variant="subtle" rightSection={open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />} onClick={toggleEditor}>
          {open ? 'Hide' : 'Edit'}
        </Button>
      </Group>

      {/* Summary cards */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
        {data.total_fd > 0 && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">FDs</Text>
            <Text fw={600} size="sm"><MoneyText value={data.total_fd} /></Text>
          </Paper>
        )}
        {data.ppf && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">PPF</Text>
            <Text fw={600} size="sm"><MoneyText value={data.total_ppf} /></Text>
          </Paper>
        )}
        {data.nps && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">NPS</Text>
            <Text fw={600} size="sm"><MoneyText value={data.total_nps} /></Text>
          </Paper>
        )}
        {data.cash && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">Cash</Text>
            <Text fw={600} size="sm"><MoneyText value={data.cash.current_value} /></Text>
          </Paper>
        )}
        {data.usd_cash && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">INDMoney</Text>
            <Text fw={600} size="sm"><MoneyText value={data.usd_cash.current_value} /></Text>
            <Text size="xs" c="dimmed">${data.usd_cash_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
          </Paper>
        )}
        {hasForeignEquity && (
          <Paper withBorder p="xs" style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">Foreign Equity</Text>
            <Text fw={600} size="sm"><MoneyText value={data.total_foreign_equity_inr} /></Text>
            <Text size="xs" c="dimmed">{privacyMode ? '$•••' : `$${data.total_foreign_equity_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</Text>
          </Paper>
        )}
      </SimpleGrid>

      {/* FD list */}
      {data.fds.length > 0 && (
        <Box mt="md">
          <Table fz="sm" withColumnBorders={false}>
            <Table.Thead><Table.Tr><Table.Th>Label</Table.Th><Table.Th>Principal</Table.Th><Table.Th>Rate</Table.Th><Table.Th>Maturity</Table.Th><Table.Th>Current</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.fds.map((fd) => (
                <Table.Tr key={fd.id}>
                  <Table.Td>{fd.label}{fd.is_emergency_fund && <Badge size="sm" color="orange" ml={4}>EF</Badge>}</Table.Td>
                  <Table.Td><MoneyText value={fd.principal} /></Table.Td>
                  <Table.Td>{fd.interest_rate}%</Table.Td>
                  <Table.Td>{fd.maturity_date}</Table.Td>
                  <Table.Td><MoneyText value={fd.current_value} /></Table.Td>
                  <Table.Td><ConfirmActionButton size="sm" variant="subtle" color="red" leftSection={<IconTrash size={12} />} confirmTitle="Delete fixed deposit?" confirmDescription={`Delete ${fd.label}?`} onConfirm={() => deleteMut.mutateAsync(fd.id)}>Delete</ConfirmActionButton></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      {/* Foreign equity list */}
      {data.foreign_equities.length > 0 && (
        <Box mt="md">
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={600}>Foreign Equity</Text>
            <Text size="xs" c="dimmed">USD/INR: {data.usdinr_rate.toFixed(4)}</Text>
          </Group>
          <Table fz="sm" withColumnBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Label</Table.Th>
                <Table.Th>Invested ($)</Table.Th>
                <Table.Th>Current ($)</Table.Th>
                <Table.Th>Change ($)</Table.Th>
                <Table.Th>Change (%)</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.foreign_equities.map((fe) => {
                const editing = fxEdits[fe.id]
                const chg = fe.invested_usd > 0 ? fe.value_usd - fe.invested_usd : null
                const chgPct = fe.invested_usd > 0 ? ((fe.value_usd - fe.invested_usd) / fe.invested_usd) * 100 : null
                const fmt = (n: number) => privacyMode ? '$•••' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                const chgColor = chg == null ? undefined : chg >= 0 ? 'var(--positive)' : 'var(--negative)'
                if (editing) {
                  return (
                    <Table.Tr key={fe.id}>
                      <Table.Td><TextInput size="xs" value={editing.label} onChange={(e) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], label: e.currentTarget.value } }))} w={100} /></Table.Td>
                      <Table.Td><NumberInput size="xs" value={editing.invested} onChange={(v) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], invested: String(v) } }))} w={110} min={0} step={0.01} decimalScale={2} /></Table.Td>
                      <Table.Td><NumberInput size="xs" value={editing.current} onChange={(v) => setFxEdits((p) => ({ ...p, [fe.id]: { ...p[fe.id], current: String(v) } }))} w={110} min={0} step={0.01} decimalScale={2} /></Table.Td>
                      <Table.Td colSpan={2} />
                      <Table.Td>
                        <Group gap={4} wrap="nowrap">
                          <Button size="xs" loading={updateForeignMut.isPending} onClick={() => handleSaveForeignEquity(fe.id)}>Save</Button>
                          <Button size="xs" variant="subtle" onClick={() => setFxEdits((p) => { const n = { ...p }; delete n[fe.id]; return n })}>Cancel</Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                }
                return (
                  <Table.Tr key={fe.id}>
                    <Table.Td>{fe.label}</Table.Td>
                    <Table.Td>{fe.invested_usd > 0 ? fmt(fe.invested_usd) : '—'}</Table.Td>
                    <Table.Td>{fmt(fe.value_usd)}</Table.Td>
                    <Table.Td c={chgColor}>{chg != null ? (chg >= 0 ? '+' : '') + fmt(chg) : '—'}</Table.Td>
                    <Table.Td c={chgColor}>{chgPct != null ? (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%' : '—'}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        {open && <Button size="xs" variant="subtle" onClick={() => initFxEdit(fe)}>Edit</Button>}
                        <ConfirmActionButton size="xs" variant="subtle" color="red" leftSection={<IconTrash size={12} />} confirmTitle="Delete foreign equity?" confirmDescription={`Delete ${fe.label}?`} onConfirm={() => deleteMut.mutateAsync(fe.id)}>Delete</ConfirmActionButton>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Box>
      )}

      <Collapse expanded={open}>
        <Stack gap="lg" mt="md">
          {/* Add FD */}
          <Box>
            <Text size="sm" fw={600} mb="xs">Add FD</Text>
            <Group align="flex-end" wrap="wrap">
              <TextInput label="Label" value={fdLabel} onChange={(e) => setFdLabel(e.currentTarget.value)} size="sm" w={140} />
              <NumberInput label="Principal" value={fdPrincipal} onChange={setFdPrincipal} size="sm" w={130} />
              <NumberInput label="Rate %" value={fdRate} onChange={setFdRate} size="sm" w={100} step={0.1} />
              <TextInput label="Start" type="date" value={fdStart} onChange={(e) => setFdStart(e.currentTarget.value)} size="sm" w={150} />
              <TextInput label="Maturity" type="date" value={fdMaturity} onChange={(e) => setFdMaturity(e.currentTarget.value)} size="sm" w={150} />
              <Button size="sm" loading={addFdMut.isPending} onClick={handleAddFd}>Add</Button>
            </Group>
          </Box>

          {/* PPF / NPS / Cash */}
          <Group align="flex-end" wrap="wrap">
            <Box>
              <Text size="sm" fw={600} mb="xs">PPF</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={ppfValue} onChange={setPpfValue} size="sm" w={150} />
                <Button size="sm" loading={ppfMut.isPending} onClick={() => ppfMut.mutate({ current_value: Number(ppfValue) })}>Save</Button>
                {data.ppf && <ConfirmActionButton size="sm" variant="subtle" color="red" confirmTitle="Delete PPF?" confirmDescription="Delete this PPF asset?" onConfirm={() => deleteMut.mutateAsync(data.ppf!.id)}>Delete</ConfirmActionButton>}
              </Group>
            </Box>
            <Box>
              <Text size="sm" fw={600} mb="xs">NPS</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={npsValue} onChange={setNpsValue} size="sm" w={150} />
                <Button size="sm" loading={npsMut.isPending} onClick={() => npsMut.mutate({ current_value: Number(npsValue) })}>Save</Button>
                {data.nps && <ConfirmActionButton size="sm" variant="subtle" color="red" confirmTitle="Delete NPS?" confirmDescription="Delete this NPS asset?" onConfirm={() => deleteMut.mutateAsync(data.nps!.id)}>Delete</ConfirmActionButton>}
              </Group>
            </Box>
            <Box>
              <Text size="sm" fw={600} mb="xs">Cash / Savings</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={cashValue} onChange={setCashValue} size="sm" w={150} />
                <Button size="sm" loading={cashMut.isPending} onClick={() => cashMut.mutate({ current_value: Number(cashValue) })}>Save</Button>
                {data.cash && <ConfirmActionButton size="sm" variant="subtle" color="red" confirmTitle="Delete cash?" confirmDescription="Delete this cash asset?" onConfirm={() => deleteMut.mutateAsync(data.cash!.id)}>Delete</ConfirmActionButton>}
              </Group>
            </Box>
            <Box>
              <Text size="sm" fw={600} mb="xs">INDMoney Wallet (USD)</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Balance ($)" value={usdCashValue} onChange={setUsdCashValue} size="sm" w={150} min={0} step={0.01} decimalScale={2} />
                <Button size="sm" loading={usdCashMut.isPending} onClick={() => usdCashMut.mutate({ current_value: Number(usdCashValue) })}>Save</Button>
                {data.usd_cash && <ConfirmActionButton size="sm" variant="subtle" color="red" confirmTitle="Delete USD cash?" confirmDescription="Delete this USD cash asset?" onConfirm={() => deleteMut.mutateAsync(data.usd_cash!.id)}>Delete</ConfirmActionButton>}
              </Group>
            </Box>
          </Group>

          {/* Foreign equity */}
          <Box>
            <Text size="sm" fw={600} mb="xs">Add Foreign Equity (USD)</Text>
            <Group align="flex-end" wrap="wrap">
              <TextInput label="Label" placeholder="AAPL, VTI, …" value={fxLabel} onChange={(e) => setFxLabel(e.currentTarget.value)} size="sm" w={140} />
              <NumberInput label="Invested ($)" value={fxInvested} onChange={setFxInvested} size="sm" w={130} min={0} step={0.01} decimalScale={2} />
              <NumberInput label="Current ($)" value={fxValue} onChange={setFxValue} size="sm" w={130} min={0} step={0.01} decimalScale={2} />
              <Button size="sm" loading={addForeignMut.isPending} onClick={handleAddForeignEquity}>Add</Button>
            </Group>
          </Box>

          {/* USDINR rate */}
          <Box>
            <Text size="sm" fw={600} mb="xs">USD/INR Rate</Text>
            <Group align="flex-end" wrap="wrap" gap="md">
              <Box>
                <Text size="xs" c="dimmed" mb={4}>Current: {data.usdinr_rate.toFixed(4)}</Text>
                <Button
                  size="sm"
                  variant="light"
                  leftSection={<IconRefresh size={14} />}
                  loading={refreshUsdinrMut.isPending}
                  onClick={handleRefreshUsdinr}
                >
                  Refresh from Kite
                </Button>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" mb={4}>Override manually</Text>
                <Group align="flex-end" gap="xs">
                  <NumberInput placeholder="e.g. 85.50" value={manualRate} onChange={setManualRate} size="sm" w={130} min={0} step={0.01} decimalScale={4} />
                  <Button size="sm" variant="subtle" loading={setManualUsdinrMut.isPending} onClick={handleSetManualRate}>Set</Button>
                </Group>
              </Box>
            </Group>
          </Box>
        </Stack>
      </Collapse>
    </Panel>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function Dashboard() {
  return (
    <Stack gap="lg">
      <PageHeader title="Dashboard" actions={<LtpUpdateBar />} />
      <SummaryCards />
      <Panel title="Holdings"><HoldingsTable /></Panel>
      <Divider />
      <ManualAssets />
    </Stack>
  )
}
