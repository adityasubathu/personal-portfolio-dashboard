import { ArrowLeftRight } from 'lucide-react'
import { useFundChanges } from '@/api/mfBreakdown'
import { PageShell } from '@/components/PageShell'
import { PageHeader } from '@/components/PageHeader'
import { ContentHeader } from '@/components/ContentHeader'
import { MetricCard } from '@/components/MetricCard'
import { Section } from '@/components/Section'
import { EmptyState } from '@/components/EmptyState'
import { MoneyText } from '@/components/MoneyText'
import { FundChangePanels } from '@/components/FundChangePanels'
import { ChangeLegend } from '@/components/ChangeBar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { usePersistentState } from '@/hooks/usePersistentState'
import { dayMonth, inrCompact, shortDate, signedPp } from '@/lib/format'
import { CHIP_CLASS } from '@/lib/colors'
import { cn } from '@/lib/utils'
import type { ChangeBucket, ChangeRollup, ClassificationLevel, FundChange } from '@/types/mfBreakdown'

const NOT_A_SECTOR = new Set(['Non-Equity', 'Unknown'])

function period(previous: string[], latest: string[]) {
  const fmt = (dates: string[]) => dates.map(shortDate).join(', ')
  return `${fmt(previous)} → ${fmt(latest)}`
}

function columnLabels(previous: string[], latest: string[]) {
  return previous.length === 1 && latest.length === 1
    ? { beforeLabel: dayMonth(previous[0]), afterLabel: dayMonth(latest[0]) }
    : { beforeLabel: 'Before', afterLabel: 'After' }
}

function extremeSector(buckets: ChangeBucket[], sign: 1 | -1) {
  const candidates = buckets.filter((b) => !NOT_A_SECTOR.has(b.label) && b.trade_pp * sign > 0)
  return candidates.sort((a, b) => (b.trade_pp - a.trade_pp) * sign)[0]
}

function SummaryCards({ rollup, fundCount }: { rollup: ChangeRollup; fundCount: number }) {
  const add = extremeSector(rollup.dimensions.sector, 1)
  const cut = extremeSector(rollup.dimensions.sector, -1)
  const equity = rollup.dimensions.asset_class.find((b) => b.label === 'Equity')
  const cash = rollup.dimensions.asset_class.find((b) => b.label === 'Cash')
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Funds compared" value={`${rollup.fund_count} of ${fundCount}`} detail={period(rollup.previous_as_of, rollup.latest_as_of)} />
      <MetricCard
        label="Biggest sector add (trades)"
        value={add ? `${signedPp(add.trade_pp)}pp` : '—'}
        detail={add?.label}
        tone={add ? 'positive' : 'neutral'}
      />
      <MetricCard
        label="Biggest sector cut (trades)"
        value={cut ? `${signedPp(cut.trade_pp)}pp` : '—'}
        detail={cut?.label}
        tone={cut ? 'negative' : 'neutral'}
      />
      <MetricCard
        label="Equity trades"
        value={equity ? `${signedPp(equity.trade_pp)}pp` : '—'}
        detail={cash ? `Cash ${signedPp(cash.trade_pp)}pp` : undefined}
        tone={equity && equity.trade_pp > 0.005 ? 'positive' : equity && equity.trade_pp < -0.005 ? 'negative' : 'neutral'}
      />
    </div>
  )
}

function FundTrigger({ fund }: { fund: FundChange }) {
  const top = fund.dimensions?.sector.find((b) => !NOT_A_SECTOR.has(b.label))
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="truncate font-semibold">{fund.name}</span>
      {fund.fund_type && <Badge variant="outline" className={CHIP_CLASS.blue}>{fund.fund_type}</Badge>}
      <span className="text-xs text-muted-foreground">
        {fund.previous_as_of ? `${dayMonth(fund.previous_as_of)} → ${dayMonth(fund.latest_as_of)}` : 'No previous disclosure yet'}
      </span>
      <span className="ml-auto flex items-center gap-4 text-xs">
        {top && (
          <span className="text-muted-foreground">
            Top trade: <span className={cn('font-semibold', top.trade_pp > 0 ? 'text-positive' : 'text-negative')}>{signedPp(top.trade_pp)}pp</span> {top.label}
          </span>
        )}
        <MoneyText value={fund.holding_value} compact />
      </span>
    </div>
  )
}

export function FundChanges() {
  const { data, isLoading } = useFundChanges()
  const [level, setLevel] = usePersistentState<ClassificationLevel>('fund-changes-level', 'sector')

  return (
    <PageShell>
      <PageHeader
        title="Fund Changes"
        description="How your active equity fund managers repositioned between their two latest disclosures."
      />

      {isLoading && (
        <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>
      )}

      {data && data.funds.length === 0 && (
        <EmptyState
          icon={<ArrowLeftRight className="size-5" />}
          title="No disclosure history yet"
          description="Run Disclosures from the header — it stores the last 3 months of portfolios for your active equity funds."
        />
      )}

      {data?.rollup && (
        <>
          <SummaryCards rollup={data.rollup} fundCount={data.funds.length} />
          <ContentHeader
            title="Across your active equity funds"
            description={`Weighted by your holding value (${inrCompact(data.rollup.total_value)}) · ${period(data.rollup.previous_as_of, data.rollup.latest_as_of)}`}
          />
          <ChangeLegend />
          <FundChangePanels
            dimensions={data.rollup.dimensions}
            {...columnLabels(data.rollup.previous_as_of, data.rollup.latest_as_of)}
            level={level}
            onLevelChange={setLevel}
            showValue
          />
        </>
      )}

      {data && data.funds.length > 0 && (
        <Section title="By fund" description="Each fund's own change, in pp of that fund's NAV" bodyClassName="px-4 py-0">
          <Accordion type="multiple">
            {data.funds.map((fund) => (
              <AccordionItem key={fund.scheme_isin} value={fund.scheme_isin} disabled={!fund.dimensions}>
                <AccordionTrigger className="items-center py-3 hover:no-underline">
                  <FundTrigger fund={fund} />
                </AccordionTrigger>
                <AccordionContent>
                  {fund.dimensions && fund.previous_as_of && (
                    <FundChangePanels
                      dimensions={fund.dimensions}
                      beforeLabel={dayMonth(fund.previous_as_of)}
                      afterLabel={dayMonth(fund.latest_as_of)}
                      level={level}
                      onLevelChange={setLevel}
                      showValue
                    />
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>
      )}
    </PageShell>
  )
}
