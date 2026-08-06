import { useState } from 'react'
import { Anchor, Badge, Group, Pagination, Stack, Table, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconChevronDown, IconChevronRight, IconSearch } from '@tabler/icons-react'
import { useTrades } from '../api/trades'
import { MoneyText } from '../components/MoneyText'
import { apiUrl } from '../api/client'
import type { TradeOrderRow, TradeRow } from '../types/trades'

function TradeTypeBadge({ type }: { type: string }) {
  return (
    <Badge color={type === 'BUY' ? 'green' : 'red'} variant="light" size="xs">
      {type}
    </Badge>
  )
}

function OrderDetailRow({ trade }: { trade: TradeRow }) {
  return (
    <Table.Tr style={{ background: 'var(--mantine-color-gray-0)' }}>
      <Table.Td />
      <Table.Td>{trade.trade_date}</Table.Td>
      <Table.Td><TradeTypeBadge type={trade.trade_type} /></Table.Td>
      <Table.Td><Text size="xs">{trade.symbol ?? '—'}</Text></Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{trade.isin ?? '—'}</Text></Table.Td>
      <Table.Td style={{ textAlign: 'right' }}>{trade.quantity}</Table.Td>
      <Table.Td style={{ textAlign: 'right' }}><MoneyText value={trade.price} /></Table.Td>
      <Table.Td style={{ textAlign: 'right' }}><MoneyText value={trade.amount ?? trade.price * trade.quantity} /></Table.Td>
      <Table.Td>{trade.exchange ?? '—'}</Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{trade.source}</Text></Table.Td>
      <Table.Td><Text size="xs" c="dimmed">{trade.notes ?? ''}</Text></Table.Td>
    </Table.Tr>
  )
}

function OrderRow({ order, expanded, onToggle }: { order: TradeOrderRow; expanded: boolean; onToggle: () => void }) {
  const hasMultiple = order.trades.length > 1

  return (
    <>
      <Table.Tr
        onClick={hasMultiple ? onToggle : undefined}
        style={{ cursor: hasMultiple ? 'pointer' : undefined }}
      >
        <Table.Td>
          {hasMultiple && (
            <UnstyledButton onClick={onToggle} style={{ display: 'flex' }}>
              {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
            </UnstyledButton>
          )}
        </Table.Td>
        <Table.Td>{order.trade_date}</Table.Td>
        <Table.Td><TradeTypeBadge type={order.trade_type} /></Table.Td>
        <Table.Td><Text size="xs" fw={500}>{order.symbol ?? '—'}</Text></Table.Td>
        <Table.Td><Text size="xs" c="dimmed">{order.isin ?? '—'}</Text></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}>{order.quantity}</Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={order.price} /></Table.Td>
        <Table.Td style={{ textAlign: 'right' }}><MoneyText value={order.amount} /></Table.Td>
        <Table.Td>{order.exchange ?? '—'}</Table.Td>
        <Table.Td><Text size="xs" c="dimmed">{order.source}</Text></Table.Td>
        <Table.Td>
          {hasMultiple && <Text size="xs" c="dimmed">{order.trades.length} trades</Text>}
        </Table.Td>
      </Table.Tr>
      {hasMultiple && expanded && order.trades.map((t) => <OrderDetailRow key={t.id} trade={t} />)}
    </>
  )
}

export function Trades() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [debounced] = useDebouncedValue(q, 300)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const { data, isLoading } = useTrades(page, debounced)

  function handleSearch(val: string) {
    setQ(val)
    setPage(1)
  }

  function toggleExpanded(orderId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Trades</Title>
        <Anchor href={apiUrl('/api/v1/trades/template')} size="xs" download>
          Download CSV template
        </Anchor>
      </Group>

      <TextInput
        placeholder="Search symbol or ISIN…"
        leftSection={<IconSearch size={14} />}
        value={q}
        onChange={(e) => handleSearch(e.currentTarget.value)}
        w={280}
      />

      {isLoading && <Text size="sm" c="dimmed">Loading…</Text>}

      {data && (
        <>
          <Text size="xs" c="dimmed">{data.total} orders</Text>
          <Table fz="xs" withColumnBorders={false} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                <Table.Th><Text size="xs" fw={600}>Date</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>Type</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>Symbol</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>ISIN</Text></Table.Th>
                <Table.Th style={{ textAlign: 'right' }}><Text size="xs" fw={600}>Qty</Text></Table.Th>
                <Table.Th style={{ textAlign: 'right' }}><Text size="xs" fw={600}>Price</Text></Table.Th>
                <Table.Th style={{ textAlign: 'right' }}><Text size="xs" fw={600}>Amount</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>Exchange</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>Source</Text></Table.Th>
                <Table.Th><Text size="xs" fw={600}>Notes</Text></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.map((order) => (
                <OrderRow
                  key={order.order_id}
                  order={order}
                  expanded={expandedIds.has(order.order_id)}
                  onToggle={() => toggleExpanded(order.order_id)}
                />
              ))}
            </Table.Tbody>
          </Table>
          {data.total_pages > 1 && (
            <Pagination
              total={data.total_pages}
              value={page}
              onChange={setPage}
              size="sm"
            />
          )}
        </>
      )}
    </Stack>
  )
}
