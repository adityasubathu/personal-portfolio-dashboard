import { Fragment, useState, type ReactNode } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { useCapitalGains, useCapitalGainsYears } from '../api/capitalGains'
import { usePersistentState } from '../hooks/usePersistentState'
import { usePrivacy } from '../hooks/usePrivacy'
import { MoneyText } from '../components/MoneyText'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { ContentHeader } from '@/components/ContentHeader'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { InfoPopover } from '@/components/InfoPopover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { CHIP_CLASS } from '@/lib/colors'
import { gainColor, inr } from '../lib/format'

const MASK = '₹•••'
import type { GainBucket, RealizedLot, AttentionItem } from '../types/capitalGains'

const LT_BUCKETS = new Set([
  'equity_ltcg_10', 'equity_ltcg_125',
  'hybrid_ltcg_20_indexed', 'hybrid_ltcg_125',
])

function isLongTerm(taxBucket: string) { return LT_BUCKETS.has(taxBucket) }

const ASSET_CATEGORY_BADGE: Record<string, { label: string; className: string }> = {
  equity: { label: 'Equity', className: CHIP_CLASS.green },
  debt_mf: { label: 'Debt/Non-Equity', className: CHIP_CLASS.blue },
  bond: { label: 'Debt/Non-Equity', className: CHIP_CLASS.blue },
  unknown_mf: { label: 'Debt/Non-Equity', className: CHIP_CLASS.blue },
  intl_fund: { label: 'Hybrid', className: CHIP_CLASS.orange },
  gold_mf: { label: 'Hybrid', className: CHIP_CLASS.orange },
  intl_etf: { label: 'Hybrid', className: CHIP_CLASS.orange },
  gold_etf: { label: 'Hybrid', className: CHIP_CLASS.orange },
  hybrid_mf: { label: 'Hybrid', className: CHIP_CLASS.orange },
}

function AssetCategoryBadge({ assetCategory }: { assetCategory: string }) {
  const meta = ASSET_CATEGORY_BADGE[assetCategory] ?? { label: assetCategory, className: CHIP_CLASS.gray }
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

function TermBadge({ taxBucket }: { taxBucket: string }) {
  const lt = isLongTerm(taxBucket)
  return (
    <Badge variant="outline" className={lt ? CHIP_CLASS.blue : CHIP_CLASS.orange}>
      {lt ? 'LT' : 'ST'}
    </Badge>
  )
}

const HELP_TEXT = `How these numbers are computed:

FIFO (First-In, First-Out) cost basis — each sale consumes the oldest available buy lots.

Same-day buy+sell pairs are treated as intraday (speculative income, not capital gains) and excluded from the table.

Tax rates applied are the statutory special rates as they applied on each sell date:
  • Equity STCG: 15% (before 23 Jul 2024), 20% (on/after)
  • Equity LTCG §112A: 10% (before 23 Jul 2024), 12.5% (on/after)
  • §112A exemption: ₹1,00,000/FY (FY ≤ 2023-24), ₹1,25,000/FY (FY 2024-25+)
  • Debt MF bought ≥ 1 Apr 2023 (§50AA): always slab rate
  • Debt MF bought < 1 Apr 2023, sold before 23 Jul 2024: LTCG 20% + indexation if held >36m
  • Debt MF bought < 1 Apr 2023, sold on/after 23 Jul 2024: LTCG 12.5% if held >24m

Estimated tax = taxable gain × flat rate. It excludes surcharge and 4% health & education cess. Slab-rate gains are shown without an estimate — you pay at your marginal rate.

Not included: buyback proceeds (taxed as dividend Oct 2024 – Mar 2026 and indistinguishable from market sales in the tradebook), carry-forward of losses from prior years.`

function BucketCard({ bucket, slabRate }: { bucket: GainBucket, slabRate: number }) {
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)
  const isLoss = bucket.gross_gain < 0
  const effectiveRate = bucket.rate ?? (slabRate > 0 ? slabRate : null)
  const effectiveTax = bucket.rate != null
    ? bucket.est_tax
    : (slabRate > 0 ? Math.round(bucket.taxable * slabRate) / 100 : null)

  return (
    <div className="basis-[calc((100%-2.25rem)/4)] rounded-xl border bg-card p-3">
      <p className="mb-1 line-clamp-2 text-xs">{bucket.label}</p>
      <MoneyText value={bucket.gross_gain} colorize className="text-base font-semibold" />
      {(bucket.setoff_applied > 0 || bucket.exemption_applied > 0) && (
        <div className="mt-1.5 space-y-0.5">
          {bucket.setoff_applied > 0 && (
            <p className="text-xs text-muted-foreground">Set-off: −{fmt(bucket.setoff_applied)}</p>
          )}
          {bucket.exemption_applied > 0 && (
            <p className="text-xs text-muted-foreground">Exempt: −{fmt(bucket.exemption_applied)}</p>
          )}
          <p className="text-xs font-medium">Taxable: {fmt(bucket.taxable)}</p>
        </div>
      )}
      {!isLoss && effectiveRate != null && effectiveTax != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Est. tax @ {effectiveRate}%: <span className="font-semibold text-negative">{fmt(effectiveTax)}</span>
        </p>
      )}
      {!isLoss && bucket.rate == null && effectiveRate == null && (
        <Badge variant="outline" className={cn('mt-1.5', CHIP_CLASS.gray)}>Slab rate</Badge>
      )}
    </div>
  )
}

interface SymbolGroup {
  symbol: string
  name: string | null
  assetCategory: string
  stcg: number
  ltcg: number
  total: number
  lots: RealizedLot[]
}

function SymbolDetailRows({ lots, fyStart }: { lots: RealizedLot[], fyStart: string }) {
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)
  const carried = lots.filter(l => l.buy_date < fyStart)
  const acquired = lots.filter(l => l.buy_date >= fyStart)

  const carriedQty = carried.reduce((s, l) => s + l.qty, 0)
  const carriedCost = carried.reduce((s, l) => s + l.buy_value, 0)
  const avgCost = carriedQty > 0 ? carriedCost / carriedQty : 0

  const rows: ReactNode[] = []

  if (carried.length > 0) {
    rows.push(
      <tr key="opening-header" className="bg-muted/40">
        <td colSpan={6} className="px-8 pt-2.5 pb-1">
          <p className="text-sm font-semibold text-muted-foreground">
            Opening position (bought before {fyStart}):
            {' '}{carriedQty.toLocaleString('en-IN')} units @ avg {inr(avgCost)} = {fmt(carriedCost)}
          </p>
        </td>
      </tr>
    )
  }

  if (acquired.length > 0 && carried.length > 0) {
    rows.push(
      <tr key="acquired-header" className="bg-muted/40">
        <td colSpan={6} className="px-8 pt-2.5 pb-1">
          <p className="text-sm font-semibold text-muted-foreground">Acquired this FY:</p>
        </td>
      </tr>
    )
  }

  const allLots = [...carried, ...acquired].sort((a, b) => a.sell_date.localeCompare(b.sell_date))
  for (const lot of allLots) {
    rows.push(
      <tr key={`${lot.buy_date}-${lot.sell_date}-${lot.qty}`} className="bg-muted/40">
        <td className="px-10 py-1.5">
          <div className="flex items-center gap-1">
            <TermBadge taxBucket={lot.tax_bucket} />
            {lot.flags.includes('grandfathered') && (
              <Badge variant="outline" className={CHIP_CLASS.blue}>GF</Badge>
            )}
            {lot.flags.includes('grandfathering_fmv_unavailable') && (
              <Badge variant="outline" className={CHIP_CLASS.orange}>GF?</Badge>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 whitespace-nowrap">
          <span className="text-muted-foreground">{lot.buy_date} → </span>
          <span>{lot.sell_date}</span>
          <span className="text-muted-foreground"> · {lot.holding_days}d</span>
        </td>
        <td data-numeric className="px-2 py-1.5 text-right">{lot.qty.toLocaleString('en-IN')}</td>
        <td data-numeric className="px-2 py-1.5 text-right">{fmt(lot.buy_value)}</td>
        <td data-numeric className="px-2 py-1.5 text-right">{fmt(lot.sell_value)}</td>
        <td data-numeric className={cn('px-2 py-1.5 text-right font-medium', lot.gain > 0 ? 'text-positive' : lot.gain < 0 ? 'text-negative' : undefined)}>
          {fmt(lot.gain)}
        </td>
      </tr>
    )
  }

  return <>{rows}</>
}

function SymbolTable({ lots, fy }: { lots: RealizedLot[], fy: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { privacyMode } = usePrivacy()
  const fmt = (v: number) => privacyMode ? MASK : inr(v)

  if (lots.length === 0) return <p className="p-4 text-sm text-muted-foreground">No realized lots for this FY.</p>

  const fyStart = `${fy.slice(0, 4)}-04-01`

  const bySymbol = new Map<string, SymbolGroup>()
  for (const lot of lots) {
    const existing = bySymbol.get(lot.symbol)
    const stcgDelta = isLongTerm(lot.tax_bucket) ? 0 : lot.gain
    const ltcgDelta = isLongTerm(lot.tax_bucket) ? lot.gain : 0
    if (existing) {
      existing.stcg += stcgDelta
      existing.ltcg += ltcgDelta
      existing.total += lot.gain
      existing.lots.push(lot)
    } else {
      bySymbol.set(lot.symbol, {
        symbol: lot.symbol,
        name: lot.name,
        assetCategory: lot.asset_category,
        stcg: stcgDelta,
        ltcg: ltcgDelta,
        total: lot.gain,
        lots: [lot],
      })
    }
  }

  const groups = Array.from(bySymbol.values()).sort((a, b) => b.total - a.total)

  function toggle(symbol: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ minWidth: 700 }}>
        <thead>
          <tr className="sticky top-0 z-10 bg-card">
            <th className="h-8 w-7 px-2" />
            <th className="h-8 px-2 text-left font-medium text-muted-foreground">Symbol</th>
            <th className="h-8 px-2 text-right font-medium text-muted-foreground">STCG</th>
            <th className="h-8 px-2 text-right font-medium text-muted-foreground">LTCG</th>
            <th className="h-8 px-2 text-right font-medium text-muted-foreground">Total P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(sg => {
            const isOpen = expanded.has(sg.symbol)
            return (
              <Fragment key={sg.symbol}>
                <tr className="cursor-pointer hover:bg-muted/50" onClick={() => toggle(sg.symbol)}>
                  <td className="px-2 py-1.5 text-center">
                    <button type="button" className="inline-flex items-center text-muted-foreground">
                      {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{sg.symbol}</span>
                      <AssetCategoryBadge assetCategory={sg.assetCategory} />
                    </div>
                    {sg.name && sg.name !== sg.symbol && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">{sg.name}</p>
                    )}
                  </td>
                  <td data-numeric className={cn('px-2 py-1.5 text-right', sg.stcg !== 0 && (sg.stcg > 0 ? 'font-medium text-positive' : 'font-medium text-negative'))}>
                    {sg.stcg !== 0 ? fmt(sg.stcg) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td data-numeric className={cn('px-2 py-1.5 text-right', sg.ltcg !== 0 && (sg.ltcg > 0 ? 'font-medium text-positive' : 'font-medium text-negative'))}>
                    {sg.ltcg !== 0 ? fmt(sg.ltcg) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td data-numeric className={cn('px-2 py-1.5 text-right font-semibold', sg.total > 0 ? 'text-positive' : sg.total < 0 ? 'text-negative' : undefined)}>
                    {fmt(sg.total)}
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${sg.symbol}-detail`}>
                    <td className="bg-muted/40 p-0" />
                    <td colSpan={4} className="p-0">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-muted/40">
                            <th className="px-8 py-1 text-left text-xs font-medium text-muted-foreground">Term</th>
                            <th className="px-2 py-1 text-left text-xs font-medium text-muted-foreground">Dates · Days held</th>
                            <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Qty</th>
                            <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Cost basis</th>
                            <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Proceeds</th>
                            <th className="px-2 py-1 text-right text-xs font-medium text-muted-foreground">Gain / Loss</th>
                          </tr>
                        </thead>
                        <tbody>
                          <SymbolDetailRows lots={sg.lots} fyStart={fyStart} />
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AttentionSection({ items }: { items: AttentionItem[] }) {
  const { privacyMode } = usePrivacy()
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-4 text-warning" />
        <p className="text-sm font-semibold">Needs attention ({items.length})</p>
      </div>
      {items.map((item, i) => (
        <Alert key={i} className="border-warning/40 bg-warning/10 py-2">
          <AlertDescription>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{item.symbol}</span>
              <span className="text-sm text-muted-foreground">sold {item.sell_date} · qty {item.qty} · proceeds {privacyMode ? MASK : inr(item.sell_value)}</span>
            </div>
            <p className="mt-1 text-xs">{item.reason}</p>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

export function CapitalGains() {
  const { privacyMode } = usePrivacy()
  const { data: yearsData, isLoading: yearsLoading } = useCapitalGainsYears()
  const fys = yearsData?.fys ?? []

  const [selectedFy, setSelectedFy] = usePersistentState<string>('cg-selected-fy', '')
  const activeFy = selectedFy && fys.includes(selectedFy) ? selectedFy : (fys[fys.length - 1] ?? '')

  const [slabRate, setSlabRate] = usePersistentState<number>('cg-slab-rate', 30)

  const { data, isLoading } = useCapitalGains(activeFy)

  const totalStcg = (data?.lots ?? []).reduce((s, l) => s + (isLongTerm(l.tax_bucket) ? 0 : l.gain), 0)
  const totalLtcg = (data?.lots ?? []).reduce((s, l) => s + (isLongTerm(l.tax_bucket) ? l.gain : 0), 0)

  const slabTax = slabRate > 0
    ? (data?.buckets ?? [])
        .filter(b => b.rate == null && b.taxable > 0)
        .reduce((s, b) => s + Math.round(b.taxable * slabRate) / 100, 0)
    : 0
  const totalEstTax = (data?.totals.est_tax ?? 0) + slabTax

  return (
    <PageShell>
      <PageHeader
        title="Capital Gains"
        actions={<InfoPopover text={HELP_TEXT} className="w-96" />}
      />

      {yearsLoading ? (
        <Section>
          <Skeleton className="h-5 w-24" />
        </Section>
      ) : fys.length === 0 ? (
        <Section>
          <Alert>
            <AlertDescription>No sell trades found. Import your tradebook to see capital gains.</AlertDescription>
          </Alert>
        </Section>
      ) : (
        <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Fiscal year</Label>
          <ToggleGroup type="single" variant="outline" size="sm" value={activeFy} onValueChange={(v) => v && setSelectedFy(v)}>
            {fys.map((fy) => (
              <ToggleGroupItem key={fy} value={fy}>FY {fy}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="space-y-1">
          <Label htmlFor="slab-rate" className="text-xs">Your slab rate (applied to slab-rate gains)</Label>
          <div className="relative w-36">
            <Input
              id="slab-rate"
              type="number"
              min={0}
              max={42}
              step={5}
              value={slabRate}
              onChange={(e) => setSlabRate(Number(e.target.value) || 0)}
              className="pr-6"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      {activeFy === '2024-25' && (
        <Alert className="border-info/40 bg-info/10">
          <AlertCircle className="size-4" />
          <AlertDescription>
            Tax rates changed on 23 Jul 2024. Lots sold before that date use the old rates (STCG 15%, LTCG 10%);
            lots sold on/after use the new rates (STCG 20%, LTCG 12.5%). Both appear as separate buckets below.
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <Skeleton className="h-24 w-full" />}

      {data && (
        <div className="flex flex-col gap-4">
          {data.buckets.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-3">
              {data.buckets.map(bucket => (
                <BucketCard key={bucket.key} bucket={bucket} slabRate={slabRate} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No realized gains or losses for this FY.</p>
          )}

          {data.buckets.length > 0 && (
            <Section className="max-w-md">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={CHIP_CLASS.orange}>ST</Badge>
                    <span className="text-sm text-muted-foreground">Short-term gains</span>
                  </div>
                  <MoneyText value={totalStcg} colorize className="text-sm font-semibold" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={CHIP_CLASS.blue}>LT</Badge>
                    <span className="text-sm text-muted-foreground">Long-term gains</span>
                  </div>
                  <MoneyText value={totalLtcg} colorize className="text-sm font-semibold" />
                </div>
                <Separator className="my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total gross gain</span>
                  <MoneyText value={data.totals.gross_gain} colorize className="text-sm font-semibold" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Est. tax{slabRate > 0 ? '' : ' (flat-rate buckets only)'}
                  </span>
                  <MoneyText value={totalEstTax} className="text-sm font-semibold text-negative" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Surcharge + 4% cess not included.
                  {slabRate === 0 && ' Set your slab rate above to include slab-rate gains.'}
                </p>
              </div>
            </Section>
          )}

          <Separator />

          <ContentHeader title="Realized P&amp;L by symbol" description="Click a row to see the opening position and individual lots." />
          <Section bodyClassName="p-0">
            <SymbolTable lots={data.lots} fy={activeFy} />
          </Section>

          <AttentionSection items={data.attention} />

          {data.intraday.trades > 0 && (
            <Alert>
              <Info className="size-4" />
              <AlertDescription>
                {data.intraday.trades} intraday trade{data.intraday.trades !== 1 ? 's' : ''} detected
                (same-day buy+sell) · approx. P&L{' '}
                <span className={cn('font-medium', gainColor(data.intraday.pnl) === 'var(--positive)' ? 'text-positive' : gainColor(data.intraday.pnl) === 'var(--negative)' ? 'text-negative' : undefined)}>
                  {privacyMode ? MASK : inr(data.intraday.pnl)}
                </span>{' '}
                — treated as speculative business income, not capital gains.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
        </>
      )}
    </PageShell>
  )
}
