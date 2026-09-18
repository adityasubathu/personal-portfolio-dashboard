import type { ReactNode } from 'react'
import { Skeleton, Stack, Text } from '@mantine/core'
import { Panel } from './Panel'

interface MetricCardProps { label: ReactNode; value: ReactNode; detail?: ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'warning'; loading?: boolean }
const tones = { neutral: 'transparent', positive: 'var(--positive)', negative: 'var(--negative)', warning: 'var(--warning)' }
export function MetricCard({ label, value, detail, tone = 'neutral', loading }: MetricCardProps) {
  return <Panel style={{ borderTop: `3px solid ${tones[tone]}` }}>{loading ? <Stack gap="xs"><Skeleton height={12} width="45%" /><Skeleton height={28} width="70%" /><Skeleton height={12} width="55%" /></Stack> : <Stack gap={3}><Text c="dimmed" size="xs">{label}</Text><Text data-numeric fw={650} style={{ fontSize: 'clamp(1.375rem, 2vw, 1.625rem)', lineHeight: 1.2 }}>{value}</Text>{detail && <Text c="dimmed" size="xs">{detail}</Text>}</Stack>}</Panel>
}
