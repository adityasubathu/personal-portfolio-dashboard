import { useState } from 'react'
import { DataTable, type Column } from '@/components/DataTable'
import { ChangeBar } from '@/components/ChangeBar'
import { MoneyText } from '@/components/MoneyText'
import { gainColor, signedPp } from '@/lib/format'
import type { ChangeBucket } from '@/types/mfBreakdown'

const UNCHANGED_PP = 0.05
const isUnchanged = (b: ChangeBucket) => Math.abs(b.trade_pp) < UNCHANGED_PP && Math.abs(b.delta_pp) < UNCHANGED_PP
const sideTotal = (b: ChangeBucket, sign: 1 | -1) =>
  [b.trade_pp, b.drift_pp].filter((v) => v * sign > 0).reduce((a, v) => a + Math.abs(v), 0)

interface ChangeTableProps {
  buckets: ChangeBucket[]
  labelHeader: string
  beforeLabel: string
  afterLabel: string
  showValue?: boolean
}

export function ChangeTable({ buckets, labelHeader, beforeLabel, afterLabel, showValue }: ChangeTableProps) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const unchangedCount = buckets.filter(isUnchanged).length
  const rows = showUnchanged ? buckets : buckets.filter((b) => !isUnchanged(b))
  const scale = Math.max(0, ...buckets.map((b) => Math.max(sideTotal(b, 1), sideTotal(b, -1))))

  const columns: Column<ChangeBucket>[] = [
    { key: 'label', label: labelHeader, render: (b) => b.label },
    { key: 'before', label: `${beforeLabel} %`, align: 'right', render: (b) => b.before_pct.toFixed(2) },
    { key: 'after', label: `${afterLabel} %`, align: 'right', render: (b) => b.after_pct.toFixed(2) },
    { key: 'bar', label: '', align: 'center', render: (b) => <ChangeBar trade={b.trade_pp} drift={b.drift_pp} scale={scale} /> },
    { key: 'delta', label: 'Δ pp', align: 'right', render: (b) => signedPp(b.delta_pp) },
    {
      key: 'trade',
      label: 'Trades',
      align: 'right',
      render: (b) => (
        <span className="font-semibold" style={{ color: gainColor(Math.abs(b.trade_pp) < 0.005 ? 0 : b.trade_pp) }}>
          {signedPp(b.trade_pp)}
        </span>
      ),
    },
    { key: 'drift', label: 'Prices', align: 'right', render: (b) => <span className="text-muted-foreground">{signedPp(b.drift_pp)}</span> },
  ]
  if (showValue) {
    columns.push({
      key: 'value',
      label: 'Your ₹ traded',
      align: 'right',
      render: (b) => <MoneyText value={b.trade_value} compact showSign colorize />,
    })
  }

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(b) => b.label}
      emptyMessage="No changes above 0.05pp."
      footer={
        unchangedCount > 0 ? (
          <tr>
            <td colSpan={columns.length} className="border-t px-2 py-1.5">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowUnchanged(!showUnchanged)}
              >
                {showUnchanged ? `Hide ${unchangedCount} unchanged` : `Show ${unchangedCount} unchanged (|Δ| < ${UNCHANGED_PP}pp)`}
              </button>
            </td>
          </tr>
        ) : undefined
      }
    />
  )
}
