import { useState } from 'react'
import {
  Badge, Box, Button, Collapse, Group, Paper, Stack,
  Switch, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { usePolicyTracker, useSetTriggerStateMutation } from '../api/policyTracker'
import type { TriggerResult, TriggerStatus } from '../types/policyTracker'

const STATUS_COLOR: Record<TriggerStatus, string> = {
  ok: 'green',
  watch: 'blue',
  action: 'orange',
  breach: 'red',
  manual: 'yellow',
}

const STATUS_VARIANT: Record<TriggerStatus, 'filled' | 'light'> = {
  ok: 'light',
  watch: 'light',
  action: 'filled',
  breach: 'filled',
  manual: 'light',
}

const ROW_ACCENT: Partial<Record<TriggerStatus, React.CSSProperties>> = {
  action: {
    borderLeft: '3px solid var(--mantine-color-orange-5)',
    background: 'var(--mantine-color-orange-0)',
    paddingLeft: 10,
  },
  breach: {
    borderLeft: '3px solid var(--mantine-color-red-5)',
    background: 'var(--mantine-color-red-0)',
    paddingLeft: 10,
  },
}

function isNestedRecord(v: unknown): v is Record<string, Record<string, unknown>> {
  return typeof v === 'object' && v !== null && Object.values(v).every(
    (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
  )
}

function DetailView({ detail, threshold }: { detail: Record<string, unknown>; threshold: Record<string, unknown> | null }) {
  if (typeof detail.premium_pct === 'number') {
    const premium = detail.premium_pct as number
    const low = threshold?.low as number | undefined
    const high = threshold?.high as number | undefined
    const bg = low !== undefined && high !== undefined
      ? premium < low
        ? 'var(--mantine-color-green-1)'
        : premium <= high
          ? 'var(--mantine-color-yellow-1)'
          : 'var(--mantine-color-red-1)'
      : undefined
    return (
      <Table withTableBorder={false} fz="xs" style={{ width: 'auto' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ textAlign: 'right' }}>Exchange close</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>NAV</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Premium</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>As of</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td style={{ textAlign: 'right' }}>{(detail.exchange_close as number).toFixed(2)}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{(detail.nav as number).toFixed(4)}</Table.Td>
            <Table.Td style={{ textAlign: 'right', background: bg, borderRadius: 3 }}>
              {premium > 0 ? '+' : ''}{premium.toFixed(2)}%
            </Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{detail.nav_date as string}{detail.stale ? ' ⚠' : ''}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
        {low !== undefined && high !== undefined && (
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={4} style={{ color: 'var(--mantine-color-dimmed)', fontStyle: 'italic' }}>
                low ≤{low}% · high {'>'}{high}%
              </Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
    )
  }

  if (Array.isArray(detail.rung_levels)) {
    const peak = detail.peak as number
    const current = detail.current as number
    const drawdown = detail.drawdown_pct as number
    const levels = detail.rung_levels as number[]
    const pcts = detail.rung_pcts as number[]
    const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    return (
      <Table withTableBorder={false} fz="xs" style={{ width: 'auto' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={{ textAlign: 'right' }}>Current</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Peak</Table.Th>
            <Table.Th style={{ textAlign: 'right' }}>Drawdown</Table.Th>
            {pcts.map((p, i) => <Table.Th key={i} style={{ textAlign: 'right' }}>Rung {i + 1} (−{p}%)</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td style={{ textAlign: 'right' }}>{fmt(current)}</Table.Td>
            <Table.Td style={{ textAlign: 'right' }}>{fmt(peak)}</Table.Td>
            <Table.Td style={{ textAlign: 'right', color: drawdown <= -15 ? 'var(--mantine-color-red-6)' : undefined }}>
              {drawdown.toFixed(2)}%
            </Table.Td>
            {levels.map((lvl, i) => (
              <Table.Td key={i} style={{ textAlign: 'right', color: current <= lvl ? 'var(--mantine-color-red-6)' : undefined }}>
                {fmt(lvl)}
              </Table.Td>
            ))}
          </Table.Tr>
        </Table.Tbody>
      </Table>
    )
  }

  if (isNestedRecord(detail)) {
    const rows = Object.entries(detail)
    const cols = Object.keys(rows[0][1])
    const thresholdNum = threshold
      ? (Object.values(threshold).find((v) => typeof v === 'number') as number | undefined)
      : undefined
    return (
      <Table withTableBorder={false} fz="xs" style={{ width: 'auto' }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th></Table.Th>
            {cols.map((c) => <Table.Th key={c} style={{ textAlign: 'right' }}>{c.replace(/_/g, ' ')}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(([name, vals]) => (
            <Table.Tr key={name}>
              <Table.Td fw={500}>{name}</Table.Td>
              {cols.map((c) => {
                const raw = (vals as Record<string, unknown>)[c]
                const n = typeof raw === 'number' ? raw : null
                const isdiff = c === 'diff'
                const breached = isdiff && n !== null && thresholdNum !== undefined && Math.abs(n) > thresholdNum
                return (
                  <Table.Td key={c} style={{ textAlign: 'right', color: breached ? 'var(--mantine-color-red-6)' : undefined }}>
                    {n !== null ? (c.endsWith('_pct') || isdiff ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : String(n)) : String(raw)}
                  </Table.Td>
                )
              })}
            </Table.Tr>
          ))}
        </Table.Tbody>
        {thresholdNum !== undefined && (
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td colSpan={cols.length + 1} style={{ color: 'var(--mantine-color-dimmed)', fontStyle: 'italic' }}>
                threshold ±{thresholdNum.toFixed(1)}%
              </Table.Td>
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
    )
  }

  return (
    <>
      {Object.entries(detail).map(([k, v]) => (
        <Text key={k} size="xs" style={{ fontFamily: 'monospace' }}>
          {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </Text>
      ))}
      {threshold && (
        <>
          <Text size="xs" mt={4} fw={500}>thresholds:</Text>
          {Object.entries(threshold).map(([k, v]) => (
            <Text key={k} size="xs" style={{ fontFamily: 'monospace' }}>
              {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </Text>
          ))}
        </>
      )}
    </>
  )
}

function TriggerRow({ trigger }: { trigger: TriggerResult }) {
  const [expanded, setExpanded] = useState(false)
  const [auditNote, setAuditNote] = useState(
    (trigger.detail?.result as string | undefined) ?? ''
  )
  const mut = useSetTriggerStateMutation()

  async function ack(extra?: { value_text?: string }) {
    try {
      await mut.mutateAsync({ key: trigger.key, value_bool: true, ...extra })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  async function toggle(val: boolean) {
    try {
      await mut.mutateAsync({ key: trigger.key, value_bool: val })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  const hasDetail = Object.keys(trigger.detail).length > 0 || trigger.threshold != null

  return (
    <Box
      py="xs"
      style={{
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        ...ROW_ACCENT[trigger.status],
      }}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={500}>{trigger.label}</Text>
            {trigger.cta && trigger.status !== 'ok' && (
              <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>— {trigger.cta}</Text>
            )}
          </Group>
          <Text size="xs" c="dimmed">{trigger.summary}</Text>

          {trigger.mode === 'manual_ack' && trigger.status !== 'ok' && (
            <Group gap="xs" mt={4} wrap="nowrap">
              {trigger.key.includes('audit') && (
                <TextInput
                  size="xs"
                  placeholder="Result note (e.g. +1.2% vs TRI — pass)"
                  value={auditNote}
                  onChange={(e) => setAuditNote(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
              )}
              <Button
                size="xs"
                variant="light"
                loading={mut.isPending}
                onClick={() => ack(trigger.key.includes('audit') && auditNote ? { value_text: auditNote } : undefined)}
              >
                Mark done
              </Button>
            </Group>
          )}

          {trigger.mode === 'manual_input' && (
            <Switch
              mt={4}
              size="xs"
              checked={trigger.status === 'action'}
              onChange={(e) => toggle(e.currentTarget.checked)}
              label={trigger.key === 'sp500_inflows_open' ? 'Fund open to inflows' : 'Purchase intent active'}
            />
          )}
        </Stack>

        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Badge
            color={STATUS_COLOR[trigger.status]}
            variant={STATUS_VARIANT[trigger.status]}
            size="sm"
          >
            {trigger.status}
          </Badge>
          {hasDetail && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={() => setExpanded((v) => !v)}
              style={{ padding: '2px 6px', minWidth: 0 }}
            >
              {expanded ? '▲' : '▼'}
            </Button>
          )}
        </Group>
      </Group>

      {hasDetail && (
        <Collapse expanded={expanded}>
          <Box mt="xs" p="xs" style={{ background: 'var(--mantine-color-gray-0)', borderRadius: 4 }}>
            <DetailView detail={trigger.detail} threshold={trigger.threshold} />
          </Box>
        </Collapse>
      )}
    </Box>
  )
}

export function PolicyTracker() {
  const { data, isLoading } = usePolicyTracker()

  if (isLoading) return <Text size="sm" c="dimmed">Loading…</Text>
  if (!data) return null

  return (
    <Stack gap="lg" maw={860}>
      <Group justify="space-between" align="center">
        <Title order={3}>Policy Tracker</Title>
        <Paper
          px="md"
          py="xs"
          style={{
            background: data.action_count > 0
              ? 'var(--mantine-color-orange-1)'
              : 'var(--mantine-color-green-1)',
          }}
        >
          <Text size="sm" fw={500} c={data.action_count > 0 ? 'orange.8' : 'green.8'}>
            {data.action_count > 0
              ? `${data.action_count} action${data.action_count > 1 ? 's' : ''} pending`
              : 'All clear'}
          </Text>
          <Text size="xs" c="dimmed">as of {new Date(data.generated_at).toLocaleTimeString('en-IN')}</Text>
        </Paper>
      </Group>

      {data.sections.map((section) => (
        <Box key={section.section}>
          <Text fw={600} size="lg" my="xs" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '4px 0' }}>{section.section}</Text>
          {section.triggers.map((trigger) => (
            <TriggerRow key={trigger.key} trigger={trigger} />
          ))}
        </Box>
      ))}
    </Stack>
  )
}
