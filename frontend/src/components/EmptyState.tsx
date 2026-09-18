import type { ReactNode } from 'react'
import { Box, Center, Stack, Text } from '@mantine/core'
import { Panel } from './Panel'
interface EmptyStateProps { icon: ReactNode; title: string; description: string; action?: ReactNode }
export function EmptyState({ icon, title, description, action }: EmptyStateProps) { return <Panel><Center py="xl"><Stack align="center" maw={440} ta="center"><Box p="sm" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 12, background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{icon}</Box><Text fw={600}>{title}</Text><Text c="dimmed" size="sm">{description}</Text>{action}</Stack></Center></Panel> }
