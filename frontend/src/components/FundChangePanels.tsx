import { Section } from '@/components/Section'
import { ChangeTable } from '@/components/ChangeTable'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LEVEL_OPTIONS } from '@/lib/constants'
import type { ChangeDimensions, ClassificationLevel } from '@/types/mfBreakdown'

interface FundChangePanelsProps {
  dimensions: ChangeDimensions
  beforeLabel: string
  afterLabel: string
  level: ClassificationLevel
  onLevelChange: (level: ClassificationLevel) => void
  showValue?: boolean
}

export function FundChangePanels({ dimensions, beforeLabel, afterLabel, level, onLevelChange, showValue }: FundChangePanelsProps) {
  const levelLabel = LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? 'Sector'
  const tableProps = { beforeLabel, afterLabel, showValue }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 2xl:grid-cols-2">
        <Section title="Asset class" bodyClassName="p-0">
          <ChangeTable buckets={dimensions.asset_class} labelHeader="Asset class" {...tableProps} />
        </Section>
        <Section title="Market cap" bodyClassName="p-0">
          <ChangeTable buckets={dimensions.market_cap} labelHeader="Market cap" {...tableProps} />
        </Section>
      </div>
      <Section
        title="Industry"
        description="NSE classification"
        bodyClassName="p-0"
        action={
          <ToggleGroup type="single" variant="outline" size="sm" value={level} onValueChange={(v) => v && onLevelChange(v as ClassificationLevel)}>
            {LEVEL_OPTIONS.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
          </ToggleGroup>
        }
      >
        <ChangeTable key={level} buckets={dimensions[level]} labelHeader={levelLabel} {...tableProps} />
      </Section>
    </div>
  )
}
