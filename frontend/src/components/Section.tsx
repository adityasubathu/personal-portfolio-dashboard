import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Section({ title, description, action, children, className, bodyClassName }: SectionProps) {
  const hasHeader = title || description || action
  return (
    <section className={cn('rounded-xl border bg-card text-card-foreground', className)}>
      {hasHeader && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
