import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ContentHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  centered?: boolean
  className?: string
}

export function ContentHeader({ title, description, action, centered, className }: ContentHeaderProps) {
  return (
    <div
      className={cn(
        'flex min-h-8 items-end justify-between gap-3',
        centered && 'justify-center text-center',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}
