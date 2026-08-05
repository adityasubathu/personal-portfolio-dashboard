import { useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Loader,
  NumberInput,
  Popover,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { IconAlertCircle, IconChevronDown, IconChevronRight, IconInfoCircle } from '@tabler/icons-react'
import { useCapitalGains, useCapitalGainsYears } from '../api/capitalGains'
import { usePersistentState } from '../hooks/usePersistentState'
import { usePrivacy } from '../hooks/usePrivacy'
import { MoneyText } from '../components/MoneyText'
import { gainColor, inr } from '../lib/format'

const MASK = '₹•••'
import type { GainBucket, RealizedLot, AttentionItem } from '../types/capitalGains'

const PAGE_PX = 128

const LT_BUCKETS = new Set([
  'equity_ltcg_10', 'equity_ltcg_125',
  'debt_ltcg_20_indexed', 'debt_ltcg_125',
  'bond_ltcg_10', 'bond_ltcg_125',
])

function isLongTerm(taxBucket: string) { return LT_BUCKETS.has(taxBucket) }

function TermBadge({ taxBucket }: { taxBucket: string }) {
  const lt = isLongTerm(taxBucket)
  return (
    <Badge size="xs" color={lt ? 'blue' : 'orange'} variant="light" fz="calc(var(--mantine-font-size-xs) * 1.1)">
      {lt ? 'LT' : 'ST'}
    </Badge>
  )
}

// ── Help popover ──────────────────────────────────────────────────────────────

const HELP_TEXT = `How these numbers are computed:

FIFO (First-In, First-Out) cost basis — each sale consumes the oldest available buy lots.

Same-day buy+sell pairs are treated as intraday (speculative income, not capital gains) and excluded from the table.

Tax rates applied are the statutory special rates as they applied on each sell date:
  • Equity STCG: 15% (before 23 Jul 2024), 20% (on/after)
  • Equity LTCG §112A: 10% (before 23 Jul 2024), 12.5% (on/after)
  • §112A exemption: ₹1,00,000/FY (FY ≤ 2023-24), ₹1,25,000/FY (FY 2024-25+)
  • Debt MF bought ≥ 1 Apr 2023 (§50AA): always slab rate
  • Debt MF bought < 1 Apr 2023, sold before 23 Jul 2024: LTCG 20% + indexation if held >36m
  • Debt MF bought < 1 Apr 2023, sold on/after 23 Jul 2024: LTCG 12.5% if held >24m

Estimated tax = taxable gain × flat rate. It excludes surcharge and 4% health & education cess. Slab-rate gains are shown without an estimate — you pay at your marginal rate.

Not included: buyback proceeds (taxed as dividend Oct 2024 – Mar 2026 and indistinguishable from market sales in the tradebook), carry-forward of losses from prior years.`

function InfoPopover({ text }: { text: string }) {
  const [opened, setOpened] = useState(false)
  return (
    <Popover opened={opened} onChange={setOpened} width={380} position="bottom-start"
      withArrow shadow="md" clickOutsideEvents={['mousedown', 'touchstart']}>
      <Popover.Target>
        <IconInfoCircle
          size={16}
          style={{ cursor: 'pointer', color: 'var(--mantine-color-gray-5)', flexShrink: 0 }}
          onClick={() => setOpened(o => !o)}
        />
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs" style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>{text}</Text>
      </Popover.Dropdown>
    </Popover>
  )
}

// ── Bucket summary cards ──────────────────────────────────────────────────────

function BucketCard({ bucket, slabRate }: { bucket: GainBucket, slabRate: number }) {
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)
  const isLoss = bucket.gross_gain < 0
  const effectiveRate = bucket.rate ?? (slabRate > 0 ? slabRate : null)
  const effectiveTax = bucket.rate != null
    ? bucket.est_tax
    : (slabRate > 0 ? Math.round(bucket.taxable * slabRate) / 100 : null)

  return (
    <Card withBorder padding="sm" radius="md">
      <Text size="calc(var(--mantine-font-size-xs) * 1.1)" mb={4} lineClamp={2}>{bucket.label}</Text>
      <MoneyText value={bucket.gross_gain} colorize size="md" fw={600} />
      {(bucket.setoff_applied > 0 || bucket.exemption_applied > 0) && (
        <Stack gap={2} mt={6}>
          {bucket.setoff_applied > 0 && (
            <Text size="xs" c="dimmed">Set-off: −{fmt(bucket.setoff_applied)}</Text>
          )}
          {bucket.exemption_applied > 0 && (
            <Text size="xs" c="dimmed">Exempt: −{fmt(bucket.exemption_applied)}</Text>
          )}
          <Text size="xs" fw={500}>Taxable: {fmt(bucket.taxable)}</Text>
        </Stack>
      )}
      {!isLoss && effectiveRate != null && effectiveTax != null && (
        <Text size="xs" mt={4} c="dimmed">
          Est. tax @ {effectiveRate}%:{' '}
          <Text component="span" fw={600} c={gainColor(-1)}>{fmt(effectiveTax)}</Text>
        </Text>
      )}
      {!isLoss && bucket.rate == null && effectiveRate == null && (
        <Badge color="gray" variant="light" size="xs" mt={6}>Slab rate</Badge>
      )}
    </Card>
  )
}

// ── Symbol-grouped expandable table ──────────────────────────────────────────

interface SymbolGroup {
  symbol: string
  name: string | null
  stcg: number
  ltcg: number
  total: number
  lots: RealizedLot[]
}

const EXPAND_COL = 6  // number of columns in the detail table

function SymbolDetailRows({ lots, fyStart }: { lots: RealizedLot[], fyStart: string }) {
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)
  // Partition: lots whose buy happened before this FY (carried in) vs acquired this FY
  const carried = lots.filter(l => l.buy_date < fyStart)
  const acquired = lots.filter(l => l.buy_date >= fyStart)

  const carriedQty = carried.reduce((s, l) => s + l.qty, 0)
  const carriedCost = carried.reduce((s, l) => s + l.buy_value, 0)
  const avgCost = carriedQty > 0 ? carriedCost / carriedQty : 0

  const cellStyle: React.CSSProperties = {
    background: 'var(--mantine-color-gray-0)',
    fontSize: 'var(--mantine-font-size-sm)',
  }

  const rows: React.ReactNode[] = []

  // Opening position header
  if (carried.length > 0) {
    rows.push(
      <Table.Tr key="opening-header">
        <Table.Td colSpan={EXPAND_COL} style={{ ...cellStyle, paddingLeft: 32, paddingTop: 10, paddingBottom: 4 }}>
          <Text size="sm" fw={600} c="dimmed">
            Opening position (bought before {fyStart}):
            {' '}{carriedQty.toLocaleString('en-IN')} units @ avg {inr(avgCost)} = {fmt(carriedCost)}
          </Text>
        </Table.Td>
      </Table.Tr>
    )
  }

  if (acquired.length > 0 && carried.length > 0) {
    rows.push(
      <Table.Tr key="acquired-header">
        <Table.Td colSpan={EXPAND_COL} style={{ ...cellStyle, paddingLeft: 32, paddingTop: 10, paddingBottom: 4 }}>
          <Text size="sm" fw={600} c="dimmed">Acquired this FY:</Text>
        </Table.Td>
      </Table.Tr>
    )
  }

  // Individual lot rows
  const allLots = [...carried, ...acquired].sort((a, b) => a.sell_date.localeCompare(b.sell_date))
  for (const lot of allLots) {
    rows.push(
      <Table.Tr key={`${lot.buy_date}-${lot.sell_date}-${lot.qty}`}>
        <Table.Td style={{ ...cellStyle, paddingLeft: 40 }}>
          <Group gap={4} wrap="nowrap">
            <TermBadge taxBucket={lot.tax_bucket} />
            {lot.flags.includes('grandfathered') && (
              <Badge size="xs" color="blue" variant="dot">GF</Badge>
            )}
            {lot.flags.includes('grandfathering_fmv_unavailable') && (
              <Badge size="xs" color="orange" variant="dot">GF?</Badge>
            )}
          </Group>
        </Table.Td>
        <Table.Td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
          <Text size="sm" c="dimmed" component="span">{lot.buy_date} → </Text>
          <Text size="sm" component="span">{lot.sell_date}</Text>
          <Text size="sm" c="dimmed" component="span"> · {lot.holding_days}d</Text>
        </Table.Td>
        <Table.Td style={{ ...cellStyle, textAlign: 'right' }}>
          {lot.qty.toLocaleString('en-IN')}
        </Table.Td>
        <Table.Td style={{ ...cellStyle, textAlign: 'right' }}>{fmt(lot.buy_value)}</Table.Td>
        <Table.Td style={{ ...cellStyle, textAlign: 'right' }}>{fmt(lot.sell_value)}</Table.Td>
        <Table.Td style={{ ...cellStyle, textAlign: 'right', color: gainColor(lot.gain), fontWeight: 500 }}>
          {fmt(lot.gain)}
        </Table.Td>
      </Table.Tr>
    )
  }

  return <>{rows}</>
}

function SymbolTable({ lots, fy }: { lots: RealizedLot[], fy: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)

  if (lots.length === 0) return <Text c="dimmed" size="sm">No realized lots for this FY.</Text>

  const fyStart = `${fy.slice(0, 4)}-04-01`

  // Group lots by symbol
  const bySymbol = new Map<string, SymbolGroup>()
  for (const lot of lots) {
    const existing = bySymbol.get(lot.symbol)
    const stcgDelta = isLongTerm(lot.tax_bucket) ? 0 : lot.gain
    const ltcgDelta = isLongTerm(lot.tax_bucket) ? lot.gain : 0
    if (existing) {
      existing.stcg += stcgDelta
      existing.ltcg += ltcgDelta
      existing.total += lot.gain
      existing.lots.push(lot)
    } else {
      bySymbol.set(lot.symbol, {
        symbol: lot.symbol,
        name: lot.name,
        stcg: stcgDelta,
        ltcg: ltcgDelta,
        total: lot.gain,
        lots: [lot],
      })
    }
  }

  const groups = Array.from(bySymbol.values()).sort((a, b) => b.total - a.total)

  function toggle(symbol: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const headerStyle: React.CSSProperties = { textAlign: 'right', fontWeight: 600 }

  return (
    <ScrollArea>
      <Table withTableBorder withColumnBorders fz="sm" style={{ minWidth: 700 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ width: 28 }} />
            <Table.Th>Symbol</Table.Th>
            <Table.Th style={headerStyle}>STCG</Table.Th>
            <Table.Th style={headerStyle}>LTCG</Table.Th>
            <Table.Th style={headerStyle}>Total P&amp;L</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map(sg => {
            const isOpen = expanded.has(sg.symbol)
            return [
              <Table.Tr
                key={sg.symbol}
                style={{ cursor: 'pointer' }}
                onClick={() => toggle(sg.symbol)}
              >
                <Table.Td style={{ textAlign: 'center', paddingRight: 0 }}>
                  <UnstyledButton style={{ display: 'flex', alignItems: 'center' }}>
                    {isOpen
                      ? <IconChevronDown size={14} color="var(--mantine-color-gray-5)" />
                      : <IconChevronRight size={14} color="var(--mantine-color-gray-5)" />}
                  </UnstyledButton>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" fw={600}>{sg.symbol}</Text>
                  {sg.name && sg.name !== sg.symbol && (
                    <Text size="xs" c="dimmed" lineClamp={1}>{sg.name}</Text>
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right', color: sg.stcg !== 0 ? gainColor(sg.stcg) : undefined, fontWeight: sg.stcg !== 0 ? 500 : undefined }}>
                  {sg.stcg !== 0 ? fmt(sg.stcg) : <Text c="dimmed" size="xs">—</Text>}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right', color: sg.ltcg !== 0 ? gainColor(sg.ltcg) : undefined, fontWeight: sg.ltcg !== 0 ? 500 : undefined }}>
                  {sg.ltcg !== 0 ? fmt(sg.ltcg) : <Text c="dimmed" size="xs">—</Text>}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right', color: gainColor(sg.total), fontWeight: 600 }}>
                  {fmt(sg.total)}
                </Table.Td>
              </Table.Tr>,
              isOpen && (
                <Table.Tr key={`${sg.symbol}-detail`}>
                  <Table.Td colSpan={1} style={{ background: 'var(--mantine-color-gray-0)', padding: 0 }} />
                  <Table.Td colSpan={4} style={{ padding: 0 }}>
                    <Table withColumnBorders fz="sm" style={{ width: '100%' }}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th style={{ paddingLeft: 32 }}>Term</Table.Th>
                          <Table.Th>Dates · Days held</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Cost basis</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Proceeds</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Gain / Loss</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        <SymbolDetailRows lots={sg.lots} fyStart={fyStart} />
                      </Table.Tbody>
                    </Table>
                  </Table.Td>
                </Table.Tr>
              ),
            ]
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  )
}

// ── Attention section ─────────────────────────────────────────────────────────

function AttentionSection({ items }: { items: AttentionItem[] }) {
  const { privacyMode } = usePrivacy()
  if (items.length === 0) return null
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <IconAlertCircle size={16} color="var(--mantine-color-orange-6)" />
        <Text fw={600} size="sm">Needs attention ({items.length})</Text>
      </Group>
      {items.map((item, i) => (
        <Alert key={i} color="orange" variant="light" py="xs">
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500}>{item.symbol}</Text>
            <Text size="sm" c="dimmed">sold {item.sell_date} · qty {item.qty} · proceeds {privacyMode ? MASK : inr(item.sell_value)}</Text>
          </Group>
          <Text size="xs" mt={4}>{item.reason}</Text>
        </Alert>
      ))}
    </Stack>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CapitalGains() {
  const { privacyMode } = usePrivacy()
  const { data: yearsData, isLoading: yearsLoading } = useCapitalGainsYears()
  const fys = yearsData?.fys ?? []

  const [selectedFy, setSelectedFy] = usePersistentState<string>('cg-selected-fy', '')
  const activeFy = selectedFy && fys.includes(selectedFy) ? selectedFy : (fys[fys.length - 1] ?? '')

  const [slabRate, setSlabRate] = usePersistentState<number>('cg-slab-rate', 30)

  const { data, isLoading } = useCapitalGains(activeFy)

  if (yearsLoading) {
    return (
      <Box px={PAGE_PX} py="xl">
        <Loader size="sm" />
      </Box>
    )
  }

  if (fys.length === 0) {
    return (
      <Box px={PAGE_PX} py="xl">
        <Alert color="gray" variant="light">No sell trades found. Import your tradebook to see capital gains.</Alert>
      </Box>
    )
  }

  // Compute STCG / LTCG totals from lots
  const totalStcg = (data?.lots ?? []).reduce((s, l) => s + (isLongTerm(l.tax_bucket) ? 0 : l.gain), 0)
  const totalLtcg = (data?.lots ?? []).reduce((s, l) => s + (isLongTerm(l.tax_bucket) ? l.gain : 0), 0)

  // Slab-rate estimated tax (computed on frontend using user's slab rate)
  const slabTax = slabRate > 0
    ? (data?.buckets ?? [])
        .filter(b => b.rate == null && b.taxable > 0)
        .reduce((s, b) => s + Math.round(b.taxable * slabRate) / 100, 0)
    : 0
  const totalEstTax = (data?.totals.est_tax ?? 0) + slabTax

  return (
    <Box px={PAGE_PX}>
      <Group mb="md" gap="sm" align="center">
        <Title order={3}>Capital Gains</Title>
        <InfoPopover text={HELP_TEXT} />
      </Group>

      <Group mb="lg" align="flex-end" justify="space-between" wrap="wrap">
        <Group align="center" gap="sm">
          <Text size="sm" fw={500}>Fiscal year</Text>
          <SegmentedControl
            value={activeFy}
            onChange={v => setSelectedFy(v)}
            data={fys.map(fy => ({ value: fy, label: `FY ${fy}` }))}
            size="sm"
          />
        </Group>
        <NumberInput
          label="Your slab rate"
          description="Applied to slab-rate gains"
          value={slabRate}
          onChange={v => setSlabRate(Number(v) || 0)}
          min={0}
          max={42}
          step={5}
          suffix="%"
          w={160}
          size="sm"
        />
      </Group>

      {activeFy === '2024-25' && (
        <Alert color="blue" variant="light" mb="md" icon={<IconAlertCircle size={14} />}>
          Tax rates changed on 23 Jul 2024. Lots sold before that date use the old rates (STCG 15%, LTCG 10%);
          lots sold on/after use the new rates (STCG 20%, LTCG 12.5%). Both appear as separate buckets below.
        </Alert>
      )}

      {isLoading && <Loader size="sm" />}

      {data && (
        <Stack gap="xl">
          {/* Per-rate-bucket cards */}
          {data.buckets.length > 0 ? (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="sm">
              {data.buckets.map(bucket => (
                <BucketCard key={bucket.key} bucket={bucket} slabRate={slabRate} />
              ))}
            </SimpleGrid>
          ) : (
            <Text c="dimmed" size="sm">No realized gains or losses for this FY.</Text>
          )}

          {/* FY totals — STCG / LTCG / est. tax */}
          {data.buckets.length > 0 && (
            <Card withBorder padding="sm" radius="md" style={{ maxWidth: 420 }}>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge size="xs" color="orange" variant="light">ST</Badge>
                    <Text size="sm" c="dimmed">Short-term gains</Text>
                  </Group>
                  <MoneyText value={totalStcg} colorize size="sm" fw={600} />
                </Group>
                <Group justify="space-between">
                  <Group gap="xs">
                    <Badge size="xs" color="blue" variant="light">LT</Badge>
                    <Text size="sm" c="dimmed">Long-term gains</Text>
                  </Group>
                  <MoneyText value={totalLtcg} colorize size="sm" fw={600} />
                </Group>
                <Divider my={4} />
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Total gross gain</Text>
                  <MoneyText value={data.totals.gross_gain} colorize size="sm" fw={600} />
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Est. tax{slabRate > 0 ? '' : ' (flat-rate buckets only)'}
                  </Text>
                  <MoneyText value={totalEstTax} size="sm" fw={600} c="red.8" />
                </Group>
                <Text size="xs" c="dimmed">
                  Surcharge + 4% cess not included.
                  {slabRate === 0 && ' Set your slab rate above to include slab-rate gains.'}
                </Text>
              </Stack>
            </Card>
          )}

          <Divider />

          {/* Symbol-grouped expandable table */}
          <Stack gap="xs">
            <Text fw={600} size="sm">Realized P&amp;L by symbol</Text>
            <Text size="xs" c="dimmed">Click a row to see the opening position and individual lots.</Text>
            <SymbolTable lots={data.lots} fy={activeFy} />
          </Stack>

          {/* Attention */}
          <AttentionSection items={data.attention} />

          {/* Intraday footnote */}
          {data.intraday.trades > 0 && (
            <Alert color="gray" variant="light" icon={<IconInfoCircle size={14} />}>
              <Text size="sm">
                {data.intraday.trades} intraday trade{data.intraday.trades !== 1 ? 's' : ''} detected
                (same-day buy+sell) · approx. P&L{' '}
                <Text component="span" fw={500} style={{ color: gainColor(data.intraday.pnl) }}>
                  {privacyMode ? MASK : inr(data.intraday.pnl)}
                </Text>{' '}
                — treated as speculative business income, not capital gains.
              </Text>
            </Alert>
          )}
        </Stack>
      )}
    </Box>
  )
}
