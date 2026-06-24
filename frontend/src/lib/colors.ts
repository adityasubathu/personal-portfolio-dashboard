export const CATEGORY_COLORS: Record<string, string> = {
  'Large Cap': '#2e7d32',
  'Mid Cap': '#0e93f1',
  'Small Cap': '#ff7c00',
  'Unclassified Equity': '#ff9800',
  'Equity': '#2e7d32',
  'Equity - Foreign': '#3949ab',
  'Equity - Arbitrage': '#7b1fa2',
  'Real Estate Trust': '#00838f',
  'Precious Metals': '#d4af37',
  'Gold': '#fcba03',
  'Silver': '#a8a9ad',
  'Debt': '#d926a7',
  'Cash': '#8cdcae',
  'Other': '#e0291f',
}

export function sectorColor(index: number, total: number, label?: string): string {
  if (label === 'Unknown') return '#616161'
  return `hsl(${Math.round((total - 1 - index) * 360 / Math.max(total, 1))}, 85%, 52%)`
}

export function categoryColor(label: string): string {
  return CATEGORY_COLORS[label] ?? '#616161'
}
