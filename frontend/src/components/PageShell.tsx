import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageShellProps {
  children: ReactNode
  width?: 'wide' | 'narrow'
  className?: string
}

const widthClass = {
  wide: 'max-w-[1600px]',
  narrow: 'max-w-4xl',
} as const

export function PageShell({ children, width = 'wide', className }: PageShellProps) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-4', widthClass[width], className)}>
      {children}
    </div>
  )
}
