import type { ReactNode } from 'react'
import { Group, Paper, Stack, Text, type PaperProps } from '@mantine/core'

interface PanelProps extends Omit<PaperProps, 'title'> { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode }

export function Panel({ title, description, action, children, p, style, ...props }: PanelProps) {
  return <Paper {...props} p={p ?? 'md'} style={{ background: 'var(--surface-panel)', border: '1px solid var(--border-subtle)', borderRadius: 14, ...style }}><Stack gap="md">{(title || description || action) && <Group justify="space-between" align="flex-start" wrap="wrap"><Stack gap={2}>{title && <Text fw={600} size="sm">{title}</Text>}{description && <Text c="dimmed" size="xs">{description}</Text>}</Stack>{action}</Group>}{children}</Stack></Paper>
}
