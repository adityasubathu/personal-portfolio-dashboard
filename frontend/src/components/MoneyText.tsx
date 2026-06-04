import { Text, type TextProps } from '@mantine/core'
import { inr, inrCompact, pct, gainColor } from '../lib/format'

interface MoneyTextProps extends Omit<TextProps, 'children'> {
  value: number | null | undefined
  compact?: boolean
  showSign?: boolean
  colorize?: boolean
}

export function MoneyText({ value, compact, showSign, colorize, style, ...rest }: MoneyTextProps) {
  if (value == null) return <Text component="span" {...rest}>—</Text>

  const formatted = compact ? inrCompact(value) : inr(value)
  const color = colorize ? gainColor(value) : undefined
  const prefix = showSign && value > 0 ? '+' : ''

  return (
    <Text component="span" style={{ color, ...style }} {...rest}>
      {prefix}{formatted}
    </Text>
  )
}

interface PctTextProps extends Omit<TextProps, 'children'> {
  value: number | null | undefined
  colorize?: boolean
  decimals?: number
}

export function PctText({ value, colorize, decimals = 2, style, ...rest }: PctTextProps) {
  if (value == null) return <Text component="span" {...rest}>—</Text>
  const color = colorize ? gainColor(value) : undefined
  return (
    <Text component="span" style={{ color, ...style }} {...rest}>
      {pct(value, decimals)}
    </Text>
  )
}
