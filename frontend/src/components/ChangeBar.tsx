import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { signedPp } from '@/lib/format'

const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--muted-foreground) 0 1.5px, transparent 1.5px 4px)',
}

interface ChangeBarProps {
  trade: number
  drift: number
  scale: number
}

// Zero-centred bar: manager trades solid (green adds, red cuts), price drift hatched.
// Parts of the same sign stack outward from zero with trades nearest the axis.
export function ChangeBar({ trade, drift, scale }: ChangeBarProps) {
  const width = (v: number) => `${scale > 0 ? Math.min(Math.abs(v) / scale, 1) * 100 : 0}%`
  const tradeSeg = (
    <div key="t" className={cn('h-full', trade > 0 ? 'bg-positive' : 'bg-negative')} style={{ width: width(trade) }} />
  )
  const driftSeg = <div key="d" className="h-full opacity-70" style={{ ...HATCH, width: width(drift) }} />

  return (
    <div
      className="flex h-3 w-36 items-center"
      title={`Trades ${signedPp(trade)}pp · Prices ${signedPp(drift)}pp`}
    >
      <div className="flex h-full flex-1 flex-row-reverse">
        {trade < 0 && tradeSeg}
        {drift < 0 && driftSeg}
      </div>
      <div className="h-4 w-px bg-foreground/30" />
      <div className="flex h-full flex-1">
        {trade > 0 && tradeSeg}
        {drift > 0 && driftSeg}
      </div>
    </div>
  )
}

export function ChangeLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 bg-positive" />
        <span className="inline-block h-2.5 w-4 bg-negative" />
        Trades — share-count changes, valued at latest prices
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-4 opacity-70" style={HATCH} />
        Prices — drift had the manager done nothing
      </span>
      <span>All figures are percentage points of fund NAV.</span>
    </p>
  )
}
