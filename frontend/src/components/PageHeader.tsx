import type { ReactNode } from 'react'
import { Group, Stack, Text, Title } from '@mantine/core'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return <Group justify="space-between" align="flex-start" wrap="wrap" gap="md"><Stack gap={4}><Title order={2} style={{ fontSize: 'clamp(1.5rem, 2vw, 1.75rem)' }}>{title}</Title>{description && <Text c="dimmed" size="sm">{description}</Text>}{meta && <Text c="dimmed" size="xs">{meta}</Text>}</Stack>{actions && <Group wrap="wrap">{actions}</Group>}</Group>
}
