import { useState } from 'react'
import {
  Badge, Box, Button, Collapse, Group, Paper, Stack,
  Switch, Text, TextInput, Title,
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
        <Collapse in={expanded}>
          <Box mt="xs" p="xs" style={{ background: 'var(--mantine-color-gray-0)', borderRadius: 4 }}>
            {Object.entries(trigger.detail).map(([k, v]) => (
              <Text key={k} size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </Text>
            ))}
            {trigger.threshold && (
              <>
                <Text size="xs" c="dimmed" mt={4} fw={500}>thresholds:</Text>
                {Object.entries(trigger.threshold).map(([k, v]) => (
                  <Text key={k} size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                    {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </Text>
                ))}
              </>
            )}
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
    <Stack gap="lg">
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
          <Text fw={600} size="sm" mb="xs" c="dimmed">{section.section}</Text>
          {section.triggers.map((trigger) => (
            <TriggerRow key={trigger.key} trigger={trigger} />
          ))}
        </Box>
      ))}
    </Stack>
  )
}
