import type { ClassificationLevel } from '@/types/mfBreakdown'

export const LEVEL_OPTIONS: Array<{ value: ClassificationLevel; label: string }> = [
  { value: 'macro_sector', label: 'Macro' },
  { value: 'sector', label: 'Sector' },
  { value: 'industry', label: 'Industry' },
  { value: 'basic_industry', label: 'Basic' },
]
