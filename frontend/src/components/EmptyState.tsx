import type { ReactNode } from 'react'
import { Section } from './Section'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Section>
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">{icon}</div>
        <p className="text-sm font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        {action}
      </div>
    </Section>
  )
}
