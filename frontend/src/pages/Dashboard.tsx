import { useState } from 'react'
import {
  Badge, Box, Button, Collapse, Divider, Grid, Group,
  NumberInput, Paper, SegmentedControl, Select, SimpleGrid,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconChevronDown, IconChevronUp, IconTrash } from '@tabler/icons-react'
import { useSummaryCards, useHoldings } from '../api/portfolio'
import {
  useManualAssets,
  useAddFdMutation,
  useUpsertPpfMutation,
  useUpsertNpsMutation,
  useUpsertCashMutation,
  useDeleteAssetMutation,
} from '../api/manualAssets'
import { MoneyText, PctText } from '../components/MoneyText'
import { inrCompact, pct, heatmapBg } from '../lib/format'
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
        <Text fw={700} size="lg">{inrCompact(data.total_cost)}</Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">Current value</Text>
        <Text fw={700} size="lg">{inrCompact(data.total_value)}</Text>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="xs" c="dimmed">Total P&amp;L</Text>
        <Text fw={700} size="lg" c={pnlPositive ? 'green' : 'red'}>
          {pnlPositive ? '+' : ''}{inrCompact(data.total_pnl)}
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

  function row(r: HoldingRow, i: number) {
    return (
      <Table.Tr key={r.instrument_id} style={i % 2 === 1 ? { background: 'var(--mantine-color-dark-7)' } : {}}>
        <Table.Td fw={500}>{r.symbol}</Table.Td>
        <Table.Td><Badge size="xs" variant="outline">{r.type}</Badge></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}>{r.qty}</Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.avg_price} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.cost} compact /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}>
          <Text size="xs">{r.ltp != null ? inrCompact(r.ltp) : '—'}</Text>
          {r.as_of && <Text size="xs" c="dimmed">{r.as_of}</Text>}
        </Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={r.value} compact /></Table.Td>
        <Table.Td style={{ textAlign: 'right', background: heatmapBg(r.pnl, pnl_min, pnl_max) }}>
          <MoneyText value={r.pnl} compact colorize showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: heatmapBg(r.pnl_pct, pnl_pct_min, pnl_pct_max) }}>
          <PctText value={r.pnl_pct} colorize />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: heatmapBg(r.xirr, xirr_min, xirr_max) }}>
          <PctText value={r.xirr} colorize />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: heatmapBg(r.day_chg_abs, day_chg_abs_min, day_chg_abs_max) }}>
          <MoneyText value={r.day_chg_abs} compact colorize showSign />
        </Table.Td>
        <Table.Td style={{ textAlign: 'right', background: heatmapBg(r.day_chg_pct, -5, 5) }}>
          <PctText value={r.day_chg_pct} colorize />
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
        <Table fz="xs" withColumnBorders={false} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Symbol</Table.Th>
              <Table.Th>Type</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Avg</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Cost</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>LTP</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>P&amp;L</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>P&amp;L%</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>XIRR</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Day ₹</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Day%</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((g) => (
              <>
                {g.label && sections === 'on' && (
                  <Table.Tr key={`sec-${g.label}`}>
                    <Table.Td colSpan={12} style={{ background: 'var(--mantine-color-dark-6)', fontWeight: 600, fontSize: '0.75rem', padding: '4px 8px' }}>
                      {g.label}
                    </Table.Td>
                  </Table.Tr>
                )}
                {g.rows.map((r, i) => row(r, i))}
              </>
            ))}
          </Table.Tbody>
          <Table.Tfoot>
            <Table.Tr style={{ fontWeight: 600 }}>
              <Table.Td colSpan={4}>Total</Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>{inrCompact(data.total_cost)}</Table.Td>
              <Table.Td />
              <Table.Td style={{ textAlign: 'right' }}>{inrCompact(data.total_value)}</Table.Td>
              <Table.Td style={{ textAlign: 'right' }} colSpan={2}>
                <MoneyText value={data.total_value - data.total_cost} compact colorize showSign />
              </Table.Td>
              <Table.Td />
              <Table.Td style={{ textAlign: 'right', color: totalDayChgColor }}>
                {data.total_day_chg >= 0 ? '+' : ''}{inrCompact(data.total_day_chg)}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right', color: totalDayChgColor }}>
                <PctText value={data.total_day_chg_pct} colorize />
              </Table.Td>
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
  const [fdEmergency, setFdEmergency] = useState(false)
  // Simple asset form state
  const [ppfValue, setPpfValue] = useState<number | string>(data?.ppf?.current_value ?? '')
  const [npsValue, setNpsValue] = useState<number | string>(data?.nps?.current_value ?? '')
  const [cashValue, setCashValue] = useState<number | string>(data?.cash?.current_value ?? '')

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
        <Text fw={600}>Manual Assets <Text span size="xs" c="dimmed">({inrCompact(data.total_manual)} total)</Text></Text>
        <Button size="xs" variant="subtle" rightSection={open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Edit'}
        </Button>
      </Group>

      {/* Summary row */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {data.total_fd > 0 && <Paper withBorder p="xs"><Text size="xs" c="dimmed">FDs</Text><Text fw={600} size="sm">{inrCompact(data.total_fd)}</Text></Paper>}
        {data.ppf && <Paper withBorder p="xs"><Text size="xs" c="dimmed">PPF</Text><Text fw={600} size="sm">{inrCompact(data.total_ppf)}</Text></Paper>}
        {data.nps && <Paper withBorder p="xs"><Text size="xs" c="dimmed">NPS</Text><Text fw={600} size="sm">{inrCompact(data.total_nps)}</Text></Paper>}
        {data.cash && <Paper withBorder p="xs"><Text size="xs" c="dimmed">Cash</Text><Text fw={600} size="sm">{inrCompact(data.total_cash)}</Text></Paper>}
      </SimpleGrid>

      <Collapse in={open}>
        <Stack gap="lg" mt="md">
          {/* FD list */}
          {data.fds.length > 0 && (
            <Box>
              <Text size="xs" fw={600} mb="xs">Fixed Deposits</Text>
              <Table fz="xs" withColumnBorders={false}>
                <Table.Thead><Table.Tr><Table.Th>Label</Table.Th><Table.Th>Principal</Table.Th><Table.Th>Rate</Table.Th><Table.Th>Maturity</Table.Th><Table.Th>Current</Table.Th><Table.Th /></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {data.fds.map((fd) => (
                    <Table.Tr key={fd.id}>
                      <Table.Td>{fd.label}{fd.is_emergency_fund && <Badge size="xs" color="orange" ml={4}>EF</Badge>}</Table.Td>
                      <Table.Td>{inrCompact(fd.principal)}</Table.Td>
                      <Table.Td>{fd.interest_rate}%</Table.Td>
                      <Table.Td>{fd.maturity_date}</Table.Td>
                      <Table.Td>{inrCompact(fd.current_value)}</Table.Td>
                      <Table.Td><Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={10} />} onClick={() => deleteMut.mutate(fd.id)}>Del</Button></Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Box>
          )}

          {/* Add FD */}
          <Box>
            <Text size="xs" fw={600} mb="xs">Add FD</Text>
            <Group align="flex-end" wrap="wrap">
              <TextInput label="Label" value={fdLabel} onChange={(e) => setFdLabel(e.currentTarget.value)} size="xs" w={120} />
              <NumberInput label="Principal" value={fdPrincipal} onChange={setFdPrincipal} size="xs" w={110} />
              <NumberInput label="Rate %" value={fdRate} onChange={setFdRate} size="xs" w={90} step={0.1} />
              <TextInput label="Start" type="date" value={fdStart} onChange={(e) => setFdStart(e.currentTarget.value)} size="xs" w={130} />
              <TextInput label="Maturity" type="date" value={fdMaturity} onChange={(e) => setFdMaturity(e.currentTarget.value)} size="xs" w={130} />
              <Button size="xs" loading={addFdMut.isPending} onClick={handleAddFd}>Add</Button>
            </Group>
          </Box>

          {/* PPF / NPS / Cash */}
          <Group align="flex-end" wrap="wrap">
            <Box>
              <Text size="xs" fw={600} mb="xs">PPF</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={ppfValue} onChange={setPpfValue} size="xs" w={130} />
                <Button size="xs" loading={ppfMut.isPending} onClick={() => ppfMut.mutate({ current_value: Number(ppfValue) })}>Save</Button>
                {data.ppf && <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={10} />} onClick={() => deleteMut.mutate(data.ppf!.id)}>Del</Button>}
              </Group>
            </Box>
            <Box>
              <Text size="xs" fw={600} mb="xs">NPS</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={npsValue} onChange={setNpsValue} size="xs" w={130} />
                <Button size="xs" loading={npsMut.isPending} onClick={() => npsMut.mutate({ current_value: Number(npsValue) })}>Save</Button>
                {data.nps && <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={10} />} onClick={() => deleteMut.mutate(data.nps!.id)}>Del</Button>}
              </Group>
            </Box>
            <Box>
              <Text size="xs" fw={600} mb="xs">Cash / Savings</Text>
              <Group align="flex-end" gap="xs">
                <NumberInput label="Value" value={cashValue} onChange={setCashValue} size="xs" w={130} />
                <Button size="xs" loading={cashMut.isPending} onClick={() => cashMut.mutate({ current_value: Number(cashValue) })}>Save</Button>
                {data.cash && <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={10} />} onClick={() => deleteMut.mutate(data.cash!.id)}>Del</Button>}
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
      <Divider />
      <HoldingsTable />
      <Divider />
      <ManualAssets />
    </Stack>
  )
}
