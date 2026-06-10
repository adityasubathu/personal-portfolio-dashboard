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
): string | undefined {
  if (value == null || value === 0) return undefined
  if (value > 0 && max != null && max > 0) {
    const intensity = Math.min(value / max, 1)
    const color = mode === 'rb' ? '59, 130, 246' : '34, 197, 94'
    return `rgba(${color}, ${0.20 + intensity * 0.45})`
  }
  if (value < 0 && min != null && min < 0) {
    const intensity = Math.min(Math.abs(value) / Math.abs(min), 1)
    return `rgba(239, 68, 68, ${0.20 + intensity * 0.45})`
  }
  return undefined
}

// Returns '#000000' or '#ffffff' for readable text on a heatmapBg cell (blended against white).
export function heatmapTextColor(
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
  mode: 'rg' | 'rb' = 'rg',
): string | undefined {
  const bg = heatmapBg(value, min, max, mode)
  if (!bg) return undefined
  const m = bg.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
  if (!m) return undefined
  const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]]
  const er = r * a + 255 * (1 - a)
  const eg = g * a + 255 * (1 - a)
  const eb = b * a + 255 * (1 - a)
  const brightness = 0.299 * er + 0.587 * eg + 0.114 * eb
  return brightness > 160 ? '#000000' : '#ffffff'
}

export function gainColor(value: number | null | undefined): string {
  if (value == null || value === 0) return 'inherit'
  return value > 0 ? 'var(--mantine-color-green-8)' : 'var(--mantine-color-red-8)'
}

export function gainColorRb(value: number | null | undefined): string {
  if (value == null || value === 0) return 'inherit'
  return value > 0 ? 'var(--mantine-color-blue-8)' : 'var(--mantine-color-red-8)'
}
