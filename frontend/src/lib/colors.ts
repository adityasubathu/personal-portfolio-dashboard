export const CATEGORY_COLORS: Record<string, string> = {
  'Large Cap': '#2e7d32',
  'Mid Cap': '#0e93f1',
  'Small Cap': '#ff7c00',
  'Unclassified Equity': '#ff9800',
  'Equity': '#2e7d32',
  'Equity - Foreign': '#3949ab',
  'Equity - Arbitrage': '#7b1fa2',
  'Real Estate Trust': '#00838f',
  'Precious Metals': '#fcba03',
  'Gold': '#fcba03',
  'Silver': '#a8a9ad',
  'Debt': '#d926a7',
  'Emergency Fund': '#DEA9D5',
  'Cash': '#8cdcae',
  'Other': '#e0291f',
}

export function sectorColor(index: number, total: number, label?: string): string {
  if (label === 'Others') return '#9e9e9e'
  if (label === 'Unknown') return '#616161'
  if (label === 'Non-Equity') return '#bdbdbd'
  return `hsl(${Math.round((total - 1 - index) * 360 / Math.max(total, 1))}, 85%, 52%)`
}

export function categoryColor(label: string): string {
  return CATEGORY_COLORS[label] ?? '#616161'
}

export type ChipColor = 'green' | 'teal' | 'blue' | 'violet' | 'yellow' | 'orange' | 'red' | 'gray'

// Badge/chip colours, carried over from the Mantine build's light-variant badges.
export const CHIP_CLASS: Record<ChipColor, string> = {
  green: 'bg-chip-green text-chip-green-fg',
  teal: 'bg-chip-teal text-chip-teal-fg',
  blue: 'bg-chip-blue text-chip-blue-fg',
  violet: 'bg-chip-violet text-chip-violet-fg',
  yellow: 'bg-chip-yellow text-chip-yellow-fg',
  orange: 'bg-chip-orange text-chip-orange-fg',
  red: 'bg-chip-red text-chip-red-fg',
  gray: 'bg-chip-gray text-chip-gray-fg',
}

export function chipClass(color: string): string {
  return CHIP_CLASS[color as ChipColor] ?? CHIP_CLASS.gray
}
