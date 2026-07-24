import { useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Card,
  Divider,
  Group,
  Loader,
  Popover,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { IconAlertCircle, IconInfoCircle } from '@tabler/icons-react'
import { useCapitalGains, useCapitalGainsYears } from '../api/capitalGains'
import { usePersistentState } from '../hooks/usePersistentState'
import { MoneyText } from '../components/MoneyText'
import { gainColor, inr } from '../lib/format'
import type { GainBucket, RealizedLot, AttentionItem } from '../types/capitalGains'

const PAGE_PX = 128

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

function BucketCard({ bucket }: { bucket: GainBucket }) {
  const isLoss = bucket.gross_gain < 0
  return (
    <Card withBorder padding="sm" radius="md">
      <Text size="xs" c="dimmed" mb={4} lineClamp={2}>{bucket.label}</Text>
      <MoneyText value={bucket.gross_gain} colorize size="md" fw={600} />
      {(bucket.setoff_applied > 0 || bucket.exemption_applied > 0) && (
        <Stack gap={2} mt={6}>
          {bucket.setoff_applied > 0 && (
            <Text size="xs" c="dimmed">Set-off: −{inr(bucket.setoff_applied)}</Text>
          )}
          {bucket.exemption_applied > 0 && (
            <Text size="xs" c="dimmed">Exempt: −{inr(bucket.exemption_applied)}</Text>
          )}
          <Text size="xs" fw={500}>Taxable: {inr(bucket.taxable)}</Text>
        </Stack>
      )}
      {!isLoss && bucket.rate != null && bucket.est_tax != null && (
        <Text size="xs" mt={4} c="dimmed">
          Est. tax @ {bucket.rate}%: <Text component="span" fw={600} c={gainColor(-1)}>{inr(bucket.est_tax)}</Text>
        </Text>
      )}
      {!isLoss && bucket.rate == null && (
        <Badge color="gray" variant="light" size="xs" mt={6}>Slab rate</Badge>
      )}
    </Card>
  )
}

// ── Lots table ────────────────────────────────────────────────────────────────

const BUCKET_ORDER = [
  'equity_stcg_15', 'equity_stcg_20',
  'equity_ltcg_10', 'equity_ltcg_125',
  'debt_slab', 'debt_ltcg_20_indexed', 'debt_ltcg_125',
  'bond_stcg_slab', 'bond_ltcg_10', 'bond_ltcg_125',
  'unknown_mf_slab',
]

function LotsTable({ lots, bucketLabels }: { lots: RealizedLot[], bucketLabels: Record<string, string> }) {
  if (lots.length === 0) return <Text c="dimmed" size="sm">No realized lots for this FY.</Text>

  // Group by bucket in display order
  const byBucket = lots.reduce<Record<string, RealizedLot[]>>((acc, lot) => {
    if (!acc[lot.tax_bucket]) acc[lot.tax_bucket] = []
    acc[lot.tax_bucket].push(lot)
    return acc
  }, {})

  const orderedBuckets = [
    ...BUCKET_ORDER.filter(k => byBucket[k]),
    ...Object.keys(byBucket).filter(k => !BUCKET_ORDER.includes(k)),
  ]

  return (
    <ScrollArea>
      <Table withTableBorder withColumnBorders fz="sm" style={{ minWidth: 820 }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>Buy date</Table.Th>
            <Table.Th>Sell date</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Days held</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Buy value</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Sell value</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Gain / Loss</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orderedBuckets.map(bucketKey => {
            const bucketLots = byBucket[bucketKey]
            const bucketGain = bucketLots.reduce((s, l) => s + l.gain, 0)
            return [
              <Table.Tr key={`header-${bucketKey}`}>
                <Table.Td colSpan={8} style={{ background: 'var(--mantine-color-gray-1)', fontWeight: 600 }}>
                  {bucketLabels[bucketKey] ?? bucketKey}
                  <Text component="span" fw={400} size="xs" c="dimmed" ml={8}>
                    {bucketLots.length} lot{bucketLots.length !== 1 ? 's' : ''} · net{' '}
                    <Text component="span" style={{ color: gainColor(bucketGain) }}>
                      {inr(bucketGain)}
                    </Text>
                  </Text>
                </Table.Td>
              </Table.Tr>,
              ...bucketLots.map((lot, i) => (
                <Table.Tr key={`${bucketKey}-${i}`}>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" fw={500}>{lot.symbol}</Text>
                      {lot.flags.includes('grandfathered') && (
                        <Badge size="xs" color="blue" variant="light">GF</Badge>
                      )}
                      {lot.flags.includes('grandfathering_fmv_unavailable') && (
                        <Badge size="xs" color="orange" variant="light">GF?</Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>{lot.buy_date}</Table.Td>
                  <Table.Td>{lot.sell_date}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{lot.holding_days}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{lot.qty.toLocaleString('en-IN')}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{inr(lot.buy_value)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{inr(lot.sell_value)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right', color: gainColor(lot.gain), fontWeight: 500 }}>
                    {inr(lot.gain)}
                  </Table.Td>
                </Table.Tr>
              )),
            ]
          })}
        </Table.Tbody>
      </Table>
    </ScrollArea>
  )
}

// ── Attention section ─────────────────────────────────────────────────────────

function AttentionSection({ items }: { items: AttentionItem[] }) {
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
            <Text size="sm" c="dimmed">sold {item.sell_date} · qty {item.qty} · proceeds {inr(item.sell_value)}</Text>
          </Group>
          <Text size="xs" mt={4}>{item.reason}</Text>
        </Alert>
      ))}
    </Stack>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CapitalGains() {
  const { data: yearsData, isLoading: yearsLoading } = useCapitalGainsYears()
  const fys = yearsData?.fys ?? []

  const [selectedFy, setSelectedFy] = usePersistentState<string>('cg-selected-fy', '')
  const activeFy = selectedFy && fys.includes(selectedFy) ? selectedFy : (fys[fys.length - 1] ?? '')

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

  const bucketLabels = Object.fromEntries(
    (data?.buckets ?? []).map(b => [b.key, b.label])
  )

  return (
    <Box px={PAGE_PX}>
      <Group mb="md" gap="sm" align="center">
        <Title order={3}>Capital Gains</Title>
        <InfoPopover text={HELP_TEXT} />
      </Group>

      <Group mb="lg" align="center">
        <Text size="sm" fw={500}>Fiscal year</Text>
        <SegmentedControl
          value={activeFy}
          onChange={v => setSelectedFy(v)}
          data={fys.map(fy => ({ value: fy, label: `FY ${fy}` }))}
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
          {/* Summary cards */}
          {data.buckets.length > 0 ? (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="sm">
              {data.buckets.map(bucket => (
                <BucketCard key={bucket.key} bucket={bucket} />
              ))}
            </SimpleGrid>
          ) : (
            <Text c="dimmed" size="sm">No realized gains or losses for this FY.</Text>
          )}

          {/* FY totals */}
          {data.buckets.length > 0 && (
            <Card withBorder padding="sm" radius="md" style={{ maxWidth: 360 }}>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Total gross gain</Text>
                  <MoneyText value={data.totals.gross_gain} colorize size="sm" fw={600} />
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Est. tax (flat-rate buckets only)</Text>
                  <MoneyText value={data.totals.est_tax} size="sm" fw={600} c="red.8" />
                </Group>
                <Text size="xs" c="dimmed">Surcharge + 4% cess not included. Slab-rate gains excluded from estimate.</Text>
              </Stack>
            </Card>
          )}

          <Divider />

          {/* Lots table */}
          <Stack gap="xs">
            <Text fw={600} size="sm">Realized lots</Text>
            <LotsTable lots={data.lots} bucketLabels={bucketLabels} />
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
                  {inr(data.intraday.pnl)}
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
