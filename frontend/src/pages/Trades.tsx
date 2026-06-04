import { useState } from 'react'
import { Anchor, Badge, Group, Pagination, Stack, Text, TextInput, Title } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import { useTrades } from '../api/trades'
import { DataTable } from '../components/DataTable'
import { MoneyText } from '../components/MoneyText'
import { apiUrl } from '../api/client'
import type { TradeRow } from '../types/trades'
import type { Column } from '../components/DataTable'

const COLUMNS: Column<TradeRow>[] = [
  { key: 'trade_date', label: 'Date', render: (r) => r.trade_date },
  {
    key: 'trade_type',
    label: 'Type',
    render: (r) => (
      <Badge color={r.trade_type === 'BUY' ? 'green' : 'red'} variant="light" size="xs">
        {r.trade_type}
      </Badge>
    ),
  },
  { key: 'symbol', label: 'Symbol', render: (r) => <Text size="xs" fw={500}>{r.symbol ?? '—'}</Text> },
  { key: 'isin', label: 'ISIN', render: (r) => <Text size="xs" c="dimmed">{r.isin ?? '—'}</Text> },
  { key: 'quantity', label: 'Qty', align: 'right', render: (r) => r.quantity },
  {
    key: 'price',
    label: 'Price',
    align: 'right',
    render: (r) => <MoneyText value={r.price} />,
  },
  {
    key: 'amount',
    label: 'Amount',
    align: 'right',
    render: (r) => <MoneyText value={r.amount ?? r.price * r.quantity} />,
  },
  { key: 'exchange', label: 'Exchange', render: (r) => r.exchange ?? '—' },
  { key: 'source', label: 'Source', render: (r) => <Text size="xs" c="dimmed">{r.source}</Text> },
  { key: 'notes', label: 'Notes', render: (r) => <Text size="xs" c="dimmed">{r.notes ?? ''}</Text> },
]

export function Trades() {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [debounced] = useDebouncedValue(q, 300)

  const { data, isLoading } = useTrades(page, debounced)

  function handleSearch(val: string) {
    setQ(val)
    setPage(1)
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
          <Text size="xs" c="dimmed">{data.total} trades</Text>
          <DataTable
            columns={COLUMNS}
            rows={data.rows}
            rowKey={(r) => r.id}
          />
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
