import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { inr, inrCompact } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'

interface MoneyTextProps {
  value: number | null | undefined
  compact?: boolean
  showSign?: boolean
  colorize?: boolean
  className?: string
  style?: CSSProperties
  // Legacy Mantine typography props, still passed by pages not yet migrated off Panel/Text.
  // Silently discarded here; each page's own migration stage removes them at the call site.
  [legacyProp: string]: unknown
}

export function MoneyText({ value, compact, showSign, colorize, className, style }: MoneyTextProps) {
  const { privacyMode } = usePrivacy()

  if (value == null) {
    return (
      <span data-numeric className={className} style={style}>
        —
      </span>
    )
  }

  if (privacyMode) {
    return (
      <span data-numeric className={className} style={style}>
        ₹•••
      </span>
    )
  }

  const formatted = compact ? inrCompact(value) : inr(value)
  const prefix = showSign && value > 0 ? '+' : ''

  return (
    <span
      data-numeric
      className={cn(colorize && value > 0 && 'text-positive', colorize && value < 0 && 'text-negative', className)}
      style={style}
    >
      {prefix}
      {formatted}
    </span>
  )
}
