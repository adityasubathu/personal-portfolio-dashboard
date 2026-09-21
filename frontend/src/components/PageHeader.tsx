import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-[2.5rem]/[1.15] font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 self-center">{actions}</div>}
    </div>
  )
}
