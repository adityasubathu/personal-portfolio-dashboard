import type { ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Section } from './Section'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  tone?: 'neutral' | 'positive' | 'negative' | 'warning'
  loading?: boolean
}

const toneClass = {
  neutral: '',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
}

export function MetricCard({ label, value, detail, tone = 'neutral', loading }: MetricCardProps) {
  return (
    <Section bodyClassName="p-4">
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p data-numeric className={cn('text-2xl font-semibold leading-tight', toneClass[tone])}>{value}</p>
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </div>
      )}
    </Section>
  )
}
