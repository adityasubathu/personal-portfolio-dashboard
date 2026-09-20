import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionProps {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  centerTitle?: boolean
}

export function Section({ title, description, action, children, className, bodyClassName, centerTitle }: SectionProps) {
  const hasHeader = title || description || action
  return (
    <section className={cn('rounded-xl border bg-card text-card-foreground', className)}>
      {hasHeader && (
        <header
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3',
            centerTitle && 'relative justify-center',
          )}
        >
          <div className={cn('min-w-0', centerTitle && 'text-center')}>
            {title && <h2 className={cn('text-sm font-medium', centerTitle && 'text-base font-semibold')}>{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {action && (
            <div
              className={cn(
                'flex flex-wrap items-center gap-2',
                centerTitle && 'absolute top-1/2 right-4 -translate-y-1/2',
              )}
            >
              {action}
            </div>
          )}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  )
}
