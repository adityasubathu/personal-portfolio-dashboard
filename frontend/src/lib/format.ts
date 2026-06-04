export function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value)
}

export function inrCompact(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

export function pct(value: number | null | undefined, decimals = 2, showSign = true): string {
  if (value == null) return '—'
  const sign = showSign && value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function heatmapBg(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): string | undefined {
  if (value == null || value === 0) return undefined
  if (value > 0 && max != null && max > 0) {
    const intensity = Math.min(value / max, 1)
    return `rgba(34, 197, 94, ${0.12 + intensity * 0.3})`
  }
  if (value < 0 && min != null && min < 0) {
    const intensity = Math.min(Math.abs(value) / Math.abs(min), 1)
    return `rgba(239, 68, 68, ${0.12 + intensity * 0.3})`
  }
  return undefined
}

export function gainColor(value: number | null | undefined): string {
  if (value == null || value === 0) return 'inherit'
  return value > 0 ? 'var(--mantine-color-green-5)' : 'var(--mantine-color-red-5)'
}
