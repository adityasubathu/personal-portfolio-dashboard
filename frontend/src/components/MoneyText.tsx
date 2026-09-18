import { Text, type TextProps } from '@mantine/core'
import { inr, inrCompact, gainColor } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'

interface MoneyTextProps extends Omit<TextProps, 'children'> {
  value: number | null | undefined
  compact?: boolean
  showSign?: boolean
  colorize?: boolean
}

export function MoneyText({ value, compact, showSign, colorize, style, ...rest }: MoneyTextProps) {
  const { privacyMode } = usePrivacy()

  if (value == null) return <Text component="span" data-numeric {...rest}>—</Text>

  if (privacyMode) {
    return <Text component="span" data-numeric {...rest}>₹•••</Text>
  }

  const formatted = compact ? inrCompact(value) : inr(value)
  const color = colorize ? gainColor(value) : undefined
  const prefix = showSign && value > 0 ? '+' : ''

  return (
    <Text component="span" data-numeric style={{ color, ...style }} {...rest}>
      {prefix}{formatted}
    </Text>
  )
}
