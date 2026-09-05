import { useState } from 'react'
import { Autocomplete, Box, Stack, Table, Text, Title } from '@mantine/core'
import { useAvailableSchemes, useSchemeBreakdown } from '../api/mfBreakdown'
import { DonutChart } from '../components/DonutChart'
import { MoneyText } from '../components/MoneyText'
import { shortDate, shortDateTime } from '../lib/format'

export function FundBreakdown() {
  const { data: schemes } = useAvailableSchemes()
  const [selectedIsin, setSelectedIsin] = useState<string | null>(null)
  const { data: breakdown, isLoading } = useSchemeBreakdown(selectedIsin)

  const schemeOptions = schemes?.map((s) => ({
    value: s.scheme_isin,
    label: `${s.name} (${s.scheme_isin})`,
  })) ?? []

  function handleSelect(label: string) {
    const match = schemeOptions.find((o) => o.label === label)
    if (match) setSelectedIsin(match.value)
  }

  // Build donut from category_summary
  const labels = breakdown?.category_summary.map((s) => s.category) ?? []
  const values = breakdown?.category_summary.map((s) => s.value) ?? []

  return (
    <Stack gap="lg">
      <Title order={3}>Fund Breakdown</Title>

      <Autocomplete
        placeholder="Search fund by name or ISIN…"
        data={schemeOptions.map((o) => o.label)}
        onOptionSubmit={handleSelect}
        w={400}
        size="sm"
      />

      {isLoading && <Text size="sm" c="dimmed">Loading…</Text>}

      {breakdown && (breakdown.as_of || breakdown.fetched_at || breakdown.last_checked_at) && (
        <Box>
          <Text size="xs" c="dimmed">
            {[
              breakdown.as_of && `Portfolio as of ${shortDate(breakdown.as_of)}`,
              breakdown.fetched_at && `fetched ${shortDateTime(breakdown.fetched_at)}`,
              breakdown.last_checked_at && `last checked ${shortDateTime(breakdown.last_checked_at)}`,
            ].filter(Boolean).join(' · ')}
          </Text>
          {breakdown.server_latest_filing && breakdown.as_of && breakdown.server_latest_filing > breakdown.as_of && (
            <Text size="xs" c="orange">
              Server's newest filing: {shortDate(breakdown.server_latest_filing)}
              {breakdown.server_latest_portfolio_count != null && ` (${breakdown.server_latest_portfolio_count} funds)`}
              {' '}— this fund hasn't filed yet
            </Text>
          )}
        </Box>
      )}

      {breakdown && labels.length > 0 && (
        <DonutChart labels={labels} values={values} />
      )}

      {breakdown && breakdown.holdings.length > 0 && (
        <Box>
          <Text fw={600} mb="xs">Holdings</Text>
          <Table fz="sm" withColumnBorders={false} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>%</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Value</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {breakdown.holdings.map((h, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{h.name}</Table.Td>
                  <Table.Td>{h.category}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{h.pct.toFixed(2)}%</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}><MoneyText value={h.value} compact /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      )}
    </Stack>
  )
}
