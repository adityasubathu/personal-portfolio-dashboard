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
  mode: 'rg' | 'rb' = 'rg',
  intensityRange: [number, number] = [7, 18],
): string | undefined {
  if (value == null || value === 0) return undefined
  const [floor, ceil] = intensityRange
  const span = ceil - floor
  if (value > 0 && max != null && max > 0) {
    const intensity = Math.min(value / max, 1)
    const color = mode === 'rb' ? 'var(--info)' : 'var(--positive)'
    return `color-mix(in oklab, ${color} ${Math.round(floor + intensity * span)}%, var(--card))`
  }
  if (value < 0 && min != null && min < 0) {
    const intensity = Math.min(Math.abs(value) / Math.abs(min), 1)
    return `color-mix(in oklab, var(--negative) ${Math.round(floor + intensity * span)}%, var(--card))`
  }
  return undefined
}

export function heatmapTextColor(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  mode: 'rg' | 'rb' = 'rg',
  intensityRange?: [number, number],
): string | undefined {
  return heatmapBg(value, min, max, mode, intensityRange) ? 'var(--foreground)' : undefined
}

export function gainColor(value: number | null | undefined): string {
  if (value == null || value === 0) return 'inherit'
  return value > 0 ? 'var(--positive)' : 'var(--negative)'
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
