import { useEffect, useRef } from 'react'
import { ActionIcon, Alert, Box, Button, Group, Loader, Paper, Text } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import type { SseState } from '../hooks/useSse'

interface SsePanelProps<T> {
  sse: SseState<T>
  heading?: string
  onClose?: () => void
  resultRenderer?: (result: T) => React.ReactNode
}

export function SsePanel<T>({ sse, heading, onClose, resultRenderer }: SsePanelProps<T>) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [sse.logs])

  if (sse.status === 'idle') return null

  const isDone = sse.status === 'done' || sse.status === 'error'

  return (
    <Paper withBorder p="sm" mt="sm">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          {!isDone && <Loader size="xs" />}
          <Text fw={600} size="sm">
            {heading ?? (isDone ? 'Done' : 'Running…')}
          </Text>
        </Group>
        {isDone && (
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => { sse.reset(); onClose?.() }}
          >
            <IconX size={14} />
          </ActionIcon>
        )}
      </Group>

      {sse.logs.length > 0 && (
        <Box
          component="pre"
          ref={logRef}
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            fontSize: '0.78rem',
            lineHeight: 1.5,
            background: 'var(--mantine-color-dark-8)',
            color: 'var(--mantine-color-gray-3)',
            padding: '0.5rem',
            borderRadius: 4,
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {sse.logs.join('\n')}
        </Box>
      )}

      {sse.status === 'error' && (
        <Alert color="red" mt="xs" title="Error">
          {sse.error}
        </Alert>
      )}

      {sse.status === 'done' && sse.result != null && resultRenderer && (
        <Box mt="xs">{resultRenderer(sse.result)}</Box>
      )}
    </Paper>
  )
}
