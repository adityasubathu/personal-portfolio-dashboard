import { Fragment, useState } from 'react'
import { Landmark, Check, ChevronsUpDown } from 'lucide-react'
import { useAvailableSchemes, useSchemeBreakdown } from '../api/mfBreakdown'
import { DonutChart } from '../components/DonutChart'
import { MoneyText } from '../components/MoneyText'
import { usePersistentState } from '../hooks/usePersistentState'
import { shortDate, shortDateTime } from '../lib/format'
import type { SchemeHolding, SchemeListItem } from '../types/mfBreakdown'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { CHIP_CLASS, type ChipColor } from '@/lib/colors'
import { Badge } from '@/components/ui/badge'

const schemeLabel = (s: SchemeListItem) => `${s.name} (${s.scheme_isin})`

// Equity holdings show the asset class with a market-cap chip rather than the
// combined category, using the Breakdown page's cap colours.
const CAP_CHIP: Record<string, { label: string; color: ChipColor }> = {
  'Large Cap': { label: 'Large', color: 'green' },
  'Mid Cap': { label: 'Mid', color: 'blue' },
  'Small Cap': { label: 'Small', color: 'orange' },
  'Unclassified Equity': { label: 'Unclassified', color: 'gray' },
}

// NSE's four-level taxonomy, most general first; missing levels drop out. Only
// equity holdings are classified — cash, commodity and REIT rows stay blank.
const industryPath = (h: SchemeHolding) =>
  h.type === 'Equity'
    ? [h.macro_sector, h.sector, h.industry, h.basic_industry].filter(Boolean).join(' → ')
    : ''

// The holdings table is read asset class by asset class. Anything outside these
// four falls into a trailing "Other" group so no holding is silently dropped.
const HOLDING_GROUPS: { label: string; categories: string[] }[] = [
  { label: 'Equity', categories: ['Large Cap', 'Mid Cap', 'Small Cap', 'Unclassified Equity', 'Equity - Foreign', 'Equity - Arbitrage', 'Real Estate Trust'] },
  { label: 'Debt', categories: ['Debt'] },
  { label: 'Precious Metals', categories: ['Gold', 'Silver'] },
  { label: 'Cash', categories: ['Cash'] },
]

function groupHoldings(holdings: SchemeHolding[]) {
  const grouped = HOLDING_GROUPS.map((g) => ({
    label: g.label,
    rows: holdings.filter((h) => g.categories.includes(h.category)),
  }))
  const claimed = new Set(HOLDING_GROUPS.flatMap((g) => g.categories))
  const rest = holdings.filter((h) => !claimed.has(h.category))
  if (rest.length > 0) grouped.push({ label: 'Other', rows: rest })
  return grouped
    .filter((g) => g.rows.length > 0)
    .map((g) => ({
      ...g,
      pct: g.rows.reduce((a, h) => a + h.pct, 0),
      value: g.rows.reduce((a, h) => a + h.value, 0),
    }))
}

function CategoryCell({ category }: { category: string }) {
  const cap = CAP_CHIP[category]
  if (!cap) return <>{category}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      Equity
      <Badge variant="outline" className={CHIP_CLASS[cap.color]}>{cap.label}</Badge>
    </span>
  )
}

export function FundBreakdown() {
  const { data: schemes } = useAvailableSchemes()
  const [selectedIsin, setSelectedIsin] = usePersistentState<string | null>('fund-breakdown-isin', null)
  const [open, setOpen] = useState(false)
  const { data: breakdown, isLoading } = useSchemeBreakdown(selectedIsin)

  const selectedScheme = schemes?.find((s) => s.scheme_isin === selectedIsin)

  const catLabels = breakdown?.category_summary.map((s) => s.category) ?? []
  const catValues = breakdown?.category_summary.map((s) => s.value) ?? []
  const sectorLabels = breakdown?.sector_summary.map((s) => s.sector) ?? []
  const sectorValues = breakdown?.sector_summary.map((s) => s.value) ?? []

  return (
    <div className="flex flex-col gap-4 px-12 md:px-48">
      <PageHeader
        title="Fund Detail"
        actions={
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" role="combobox" aria-expanded={open} className="w-96 justify-between font-normal">
                <span className="truncate">
                  {selectedScheme ? schemeLabel(selectedScheme) : 'Search fund by name or ISIN…'}
                </span>
                <ChevronsUpDown className="size-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0">
              <Command>
                <CommandInput placeholder="Search fund by name or ISIN…" />
                <CommandList>
                  <CommandEmpty>No fund found.</CommandEmpty>
                  <CommandGroup>
                    {(schemes ?? []).map((s) => (
                      <CommandItem
                        key={s.scheme_isin}
                        value={schemeLabel(s)}
                        onSelect={() => {
                          setSelectedIsin(s.scheme_isin)
                          setOpen(false)
                        }}
                      >
                        <Check className={cn('size-4', selectedIsin === s.scheme_isin ? 'opacity-100' : 'opacity-0')} />
                        {schemeLabel(s)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        }
      />

      {selectedIsin == null && (
        <EmptyState icon={<Landmark className="size-5" />} title="Select a fund" description="Choose a fund to view its portfolio breakdown." />
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {breakdown && (breakdown.as_of || breakdown.fetched_at || breakdown.last_checked_at) && (
        <div>
          <p className="text-xs text-muted-foreground">
            {[
              breakdown.as_of && `Portfolio as of ${shortDate(breakdown.as_of)}`,
              breakdown.fetched_at && `fetched ${shortDateTime(breakdown.fetched_at)}`,
              breakdown.last_checked_at && `last checked ${shortDateTime(breakdown.last_checked_at)}`,
            ].filter(Boolean).join(' · ')}
          </p>
          {breakdown.server_latest_filing && breakdown.as_of && breakdown.server_latest_filing > breakdown.as_of && (
            <p className="text-xs text-warning">
              Server's newest filing: {shortDate(breakdown.server_latest_filing)}
              {breakdown.server_latest_portfolio_count != null && ` (${breakdown.server_latest_portfolio_count} funds)`}
              {' '}— this fund hasn't filed yet
            </p>
          )}
        </div>
      )}

      {breakdown && (catLabels.length > 0 || sectorLabels.length > 0) && (
        <div className="grid gap-4 xl:grid-cols-2">
          {catLabels.length > 0 && (
            <Section title="Market cap & asset class">
              <DonutChart labels={catLabels} values={catValues} />
            </Section>
          )}
          {sectorLabels.length > 0 && (
            <Section title="Sector">
              <DonutChart labels={sectorLabels} values={sectorValues} colorMode="sector" />
            </Section>
          )}
        </div>
      )}

      {breakdown && breakdown.holdings.length > 0 && (
        <Section title="Holdings" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-[0.81rem]">
              <thead>
                <tr className="sticky top-0 z-10 border-b-2 border-border bg-muted/60 text-[0.9rem] font-bold text-foreground">
                  <th className="h-9 px-2 text-left">Name</th>
                  <th className="h-9 px-2 text-left">Category</th>
                  <th className="h-9 px-2 text-left">
                    Industry{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      (Macro → Sector → Industry → Basic)
                    </span>
                  </th>
                  <th className="h-9 px-2 text-right">%</th>
                  <th className="h-9 px-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {groupHoldings(breakdown.holdings).map((group, gi) => (
                  <Fragment key={group.label}>
                    {gi > 0 && (
                      <tr aria-hidden>
                        <td colSpan={5} className="h-4" />
                      </tr>
                    )}
                    <tr className="bg-row-hover text-[0.9rem] font-bold">
                      <td colSpan={3} className="border-y-2 border-foreground/25 px-2 py-2 uppercase tracking-wide">
                        {group.label}
                      </td>
                      <td data-numeric className="border-y-2 border-foreground/25 px-2 py-2 text-right">
                        {group.pct.toFixed(2)}%
                      </td>
                      <td data-numeric className="border-y-2 border-foreground/25 px-2 py-2 text-right">
                        <MoneyText value={group.value} compact />
                      </td>
                    </tr>
                    {group.rows.map((h, i) => (
                      <tr key={`${group.label}-${i}`} className={cn(i % 2 === 1 && 'bg-row-stripe', 'hover:bg-row-hover')}>
                        <td className="px-2 py-1.5">{h.name}</td>
                        <td className="px-2 py-1.5"><CategoryCell category={h.category} /></td>
                        <td className="px-2 py-1.5 text-muted-foreground">{industryPath(h)}</td>
                        <td data-numeric className="px-2 py-1.5 text-right">{h.pct.toFixed(2)}%</td>
                        <td data-numeric className="px-2 py-1.5 text-right"><MoneyText value={h.value} compact /></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}
