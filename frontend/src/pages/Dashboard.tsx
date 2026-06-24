import React, { useEffect, useState } from 'react'
import {
  Badge, Box, Button, Collapse, Divider, Group,
  NumberInput, Paper, SegmentedControl, Select, SimpleGrid,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconChevronUp, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useSummaryCards, useHoldings, useUpdateLtpMutation } from '../api/portfolio'
import {
  useManualAssets,
  useAddFdMutation,
  useUpsertPpfMutation,
  useUpsertNpsMutation,
  useUpsertCashMutation,
  useDeleteAssetMutation,
} from '../api/manualAssets'
import { MoneyText } from '../components/MoneyText'
import { inr, pct, heatmapBg, heatmapTextColor } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'
import type { HoldingRow } from '../types/portfolio'

// ── Summary cards ──────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data } = useSummaryCards()
  if (!data) return null
  const pnlPositive = data.total_pnl >= 0
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">Invested</Text>
        <Text fw={700} size="lg"><MoneyText value={data.total_cost} /></Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">Current value</Text>
        <Text fw={700} size="lg"><MoneyText value={data.total_value} /></Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">Total P&amp;L</Text>
        <Text fw={700} size="lg" c={pnlPositive ? 'green' : 'red'}>
          <MoneyText value={data.total_pnl} showSign />
          {' '}
          <Text span size="xs">({pct((data.total_pnl / data.total_cost) * 100)})</Text>
        </Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">XIRR</Text>
        <Text fw={700} size="lg" c={data.xirr != null && data.xirr >= 0 ? 'green' : 'red'}>
          {data.xirr != null ? pct(data.xirr * 100) : '—'}
        </Text>
        {data.last_sync && (
          <Text size="xs" c="dimmed">Synced {new Date(data.last_sync).toLocaleDateString('en-IN')}</Text>
        )}
      </Paper>
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

// Percentage: pct() always emits 2 dp → decimal slot is '.XX%' = 4ch
function NumPct({ value }: { value: number | null | undefined }) {
  return <DecNum text={pct(value)} decWidth="4ch" />
}

// Quantity: no digit grouping; MF units up to 3 dp → decimal slot is '.XXX' = 4ch
function NumQty({ value }: { value: number }) {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(3)
  return <DecNum text={text} decWidth="4ch" />
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
  const [sort, setSort] = useState('symbol')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc')
  const [sections, setSections] = useState<'on' | 'off'>('on')
  const [compare, setCompare] = useState<'prev_close' | 'open'>('prev_close')

  const { data, isLoading } = useHoldings({ sort, dir, sections, compare })

  if (isLoading) return <Text size="sm" c="dimmed">Loading holdings…</Text>
  if (!data) return null

  const { groups, pnl_min, pnl_max, pnl_pct_min, pnl_pct_max, xirr_min, xirr_max, day_chg_abs_min, day_chg_abs_max } = data

  function row(r: HoldingRow) {
    const dayPctBg = heatmapBg(r.day_chg_pct, -5, 5, 'rg')
    const dayAbsBg = heatmapBg(r.day_chg_abs, day_chg_abs_min, day_chg_abs_max, 'rb')
    const pnlBg = heatmapBg(r.pnl, pnl_min, pnl_max, 'rb')
    const pnlPctBg = heatmapBg(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rg')
    const xirrBg = heatmapBg(r.xirr, xirr_min, xirr_max, 'rb')
    return (
      <Table.Tr key={r.instrument_id}>
        <Table.Td fw={500}>{r.symbol}</Table.Td>
        <Table.Td style={{ color: 'var(--mantine-color-dimmed)' }}>{r.type}</Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumQty value={r.qty} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumMoney value={r.avg_price} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumMoney value={r.cost} /></Table.Td>
        <Table.Td style={{ textAlign: 'right', background: dayPctBg, color: heatmapTextColor(r.day_chg_pct, -5, 5, 'rg') }}>
          <NumPct value={r.day_chg_pct} />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: dayAbsBg, color: heatmapTextColor(r.day_chg_abs, day_chg_abs_min, day_chg_abs_max, 'rb') }}>
          <NumMoney value={r.day_chg_abs} showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', fontSize: '13px' }}>
          <NumMoney value={r.prev_close} />
          {r.prev_close_date && <Text size="xs" c="dimmed">{r.prev_close_date}</Text>}
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', fontSize: '13px' }}>
          <NumMoney value={r.ltp} />
          {r.as_of && <Text size="xs" c="dimmed">{r.as_of}</Text>}
        </Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><NumMoney value={r.value} /></Table.Td>
        <Table.Td style={{ textAlign: 'right', background: pnlBg, color: heatmapTextColor(r.pnl, pnl_min, pnl_max, 'rb') }}>
          <NumMoney value={r.pnl} showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: pnlPctBg, color: heatmapTextColor(r.pnl_pct, pnl_pct_min, pnl_pct_max, 'rg') }}>
          <NumPct value={r.pnl_pct} />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: xirrBg, color: heatmapTextColor(r.xirr, xirr_min, xirr_max, 'rb') }}>
          <NumPct value={r.xirr} />
        </Table.Td>
      </Table.Tr>
    )
  }

  const totalDayChgColor = data.total_day_chg >= 0 ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)'

  return (
    <Stack gap="xs">
      <Group gap="sm" wrap="wrap">
        <Select data={SORT_OPTIONS} value={sort} onChange={(v) => v && setSort(v)} size="xs" w={110} label="Sort" />
        <SegmentedControl data={['asc', 'desc']} value={dir} onChange={(v) => setDir(v as 'asc' | 'desc')} size="xs" style={{ alignSelf: 'flex-end' }} />
        <SegmentedControl data={[{ value: 'on', label: 'Sections' }, { value: 'off', label: 'Flat' }]} value={sections} onChange={(v) => setSections(v as 'on' | 'off')} size="xs" style={{ alignSelf: 'flex-end' }} />
        <SegmentedControl data={[{ value: 'prev_close', label: 'vs Prev Close' }, { value: 'open', label: 'vs Open' }]} value={compare} onChange={(v) => setCompare(v as 'prev_close' | 'open')} size="xs" style={{ alignSelf: 'flex-end' }} />
      </Group>

      <Box style={{ overflowX: 'auto' }}>
        <Table fz="sm" withColumnBorders withRowBorders styles={{ th: { background: 'var(--mantine-color-gray-1)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.03em' } }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Avg</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Cost</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Day %</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Day ₹</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Prev Close</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>LTP</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Gain ₹</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Gain %</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>XIRR</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => (
              <React.Fragment key={g.label ?? '__ungrouped'}>
                {g.label && sections === 'on' && (
                  <Table.Tr>
                    <Table.Td colSpan={13} style={{ background: 'var(--mantine-color-gray-2)', fontWeight: 600, fontSize: '0.75rem', padding: '2px 8px', color: 'var(--mantine-color-gray-7)' }}>
                      {g.label}
                    </Table.Td>
                  </Table.Tr>
                )}
                {g.rows.map((r) => row(r))}
              </React.Fragment>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr style={{ fontWeight: 600, background: 'var(--mantine-color-gray-1)' }}>
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
  const { data } = useManualAssets()
  const addFdMut = useAddFdMutation()
  const ppfMut = useUpsertPpfMutation()
  const npsMut = useUpsertNpsMutation()
  const cashMut = useUpsertCashMutation()
  const deleteMut = useDeleteAssetMutation()

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

  useEffect(() => {
    if (data?.ppf?.current_value != null) setPpfValue(data.ppf.current_value)
    if (data?.nps?.current_value != null) setNpsValue(data.nps.current_value)
    if (data?.cash?.current_value != null) setCashValue(data.cash.current_value)
  }, [data])

  async function handleAddFd() {
    if (!fdLabel || !fdPrincipal || !fdRate || !fdStart || !fdMaturity) return
    try {
      await addFdMut.mutateAsync({ label: fdLabel, principal: Number(fdPrincipal), interest_rate: Number(fdRate), start_date: fdStart, maturity_date: fdMaturity, is_emergency_fund: fdEmergency })
      setFdLabel(''); setFdPrincipal(''); setFdRate(''); setFdStart(''); setFdMaturity('')
      notifications.show({ color: 'green', message: 'FD added.' })
    } catch (e) { notifications.show({ color: 'red', message: String(e) }) }
  }

  if (!data) return null

  return (
    <Box>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Manual Assets <Text span size="xs" c="dimmed">(<MoneyText value={data.total_manual} /> total)</Text></Text>
        <Button size="xs" variant="subtle" rightSection={open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Edit'}
        </Button>
      </Group>

      {/* Summary row */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {data.total_fd > 0 && <Paper withBorder p="xs"><Text size="xs" c="dimmed">FDs</Text><Text fw={600} size="sm"><MoneyText value={data.total_fd} /></Text></Paper>}
        {data.ppf && <Paper withBorder p="xs"><Text size="xs" c="dimmed">PPF</Text><Text fw={600} size="sm"><MoneyText value={data.total_ppf} /></Text></Paper>}
        {data.nps && <Paper withBorder p="xs"><Text size="xs" c="dimmed">NPS</Text><Text fw={600} size="sm"><MoneyText value={data.total_nps} /></Text></Paper>}
        {data.cash && <Paper withBorder p="xs"><Text size="xs" c="dimmed">Cash</Text><Text fw={600} size="sm"><MoneyText value={data.total_cash} /></Text></Paper>}
      </SimpleGrid>

      {/* FD list — always visible */}
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
                  <Table.Td><Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => deleteMut.mutate(fd.id)}>Del</Button></Table.Td>
                </Table.Tr>
              ))}
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
                {data.ppf && <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => deleteMut.mutate(data.ppf!.id)}>Del</Button>}
              </Group>
            </Box>
            <Box>
              <Text size="sm" fw={600} mb="xs">NPS</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={npsValue} onChange={setNpsValue} size="sm" w={150} />
                <Button size="sm" loading={npsMut.isPending} onClick={() => npsMut.mutate({ current_value: Number(npsValue) })}>Save</Button>
                {data.nps && <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => deleteMut.mutate(data.nps!.id)}>Del</Button>}
              </Group>
            </Box>
            <Box>
              <Text size="sm" fw={600} mb="xs">Cash / Savings</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={cashValue} onChange={setCashValue} size="sm" w={150} />
                <Button size="sm" loading={cashMut.isPending} onClick={() => cashMut.mutate({ current_value: Number(cashValue) })}>Save</Button>
                {data.cash && <Button size="sm" variant="subtle" color="red" leftSection={<IconTrash size={12} />} onClick={() => deleteMut.mutate(data.cash!.id)}>Del</Button>}
              </Group>
            </Box>
          </Group>
        </Stack>
      </Collapse>
    </Box>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function Dashboard() {
  return (
    <Stack gap="lg">
      <Title order={3}>Dashboard</Title>
      <SummaryCards />
      <LtpUpdateBar />
      <Divider />
      <HoldingsTable />
      <Divider />
      <ManualAssets />
    </Stack>
  )
}
