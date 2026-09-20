import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { categoryColor, sectorColor } from '../lib/colors'
import { inrCompact } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'

interface DonutChartProps {
  labels: string[]
  values: number[]
  total?: number
  colorMode?: 'category' | 'sector'
  size?: number
}

export function DonutChart({ labels, values, total, colorMode = 'category', size = 220 }: DonutChartProps) {
  const { privacyMode } = usePrivacy()
  const [hovered, setHovered] = useState<number | null>(null)
  const colors = useMemo(
    () =>
      labels.map((label, i) =>
        colorMode === 'sector' ? sectorColor(i, labels.length, label) : categoryColor(label),
      ),
    [labels, colorMode],
  )

  const totalValue = total ?? values.reduce((a, b) => a + b, 0)
  const totalPct = values.reduce((a, b) => a + b, 0)

  const pctValues = useMemo(() => {
    if (totalPct === 0) return values.map(() => 0)
    return values.map((v) => (v / totalPct) * 100)
  }, [values, totalPct])

  const data = labels.map((label, i) => ({ label, value: values[i] }))

  return (
    <div className="@container w-full">
      <div className="flex flex-col items-center gap-4 @lg:flex-row">
        <div className="relative aspect-square w-full max-w-(--size) shrink-0 @lg:w-(--size)" style={{ '--size': `${size}px` } as React.CSSProperties}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="70%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke="var(--card)"
                strokeWidth={1}
                isAnimationActive={false}
                onMouseEnter={(_, index) => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
              >
                {data.map((entry, i) => (
                  <Cell key={entry.label} fill={colors[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {hovered !== null ? (
              <>
                <p className="max-w-[55%] text-center text-xs leading-tight">{labels[hovered]}</p>
                <p className="text-sm font-bold">{privacyMode ? '₹•••' : inrCompact(values[hovered])}</p>
                <p className="text-xs">{pctValues[hovered].toFixed(1)}%</p>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-sm font-bold">{privacyMode ? '₹•••' : inrCompact(totalValue)}</p>
              </>
            )}
          </div>
        </div>

        <div className="mx-auto w-full min-w-0 flex-1 space-y-1 @lg:max-w-[280px]">
          {labels.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
              <span className="flex-1 text-xs">{label}</span>
              <span data-numeric className="text-xs text-muted-foreground">
                {pctValues[i].toFixed(2)}%
              </span>
              <span data-numeric className="text-xs">
                {privacyMode ? '₹•••' : inrCompact(values[i])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
