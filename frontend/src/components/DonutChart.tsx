import { useMemo, useState } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { Box, Group, Stack, Text } from '@mantine/core'
import { categoryColor, sectorColor } from '../lib/colors'
import { inrCompact } from '../lib/format'
import { usePrivacy } from '../hooks/usePrivacy'

ChartJS.register(ArcElement, Tooltip, Legend)

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

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: colors,
        borderWidth: 1,
        cutout: '70%',
      },
    ],
  }

  const totalValue = total ?? values.reduce((a, b) => a + b, 0)
  const totalPct = values.reduce((a, b) => a + b, 0)

  const options = {
    responsive: false,
    onHover: (_: unknown, activeElements: { index: number }[]) => {
      setHovered(activeElements.length > 0 ? activeElements[0].index : null)
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  }

  const pctValues = useMemo(() => {
    if (totalPct === 0) return values.map(() => 0)
    return values.map((v) => (v / totalPct) * 100)
  }, [values, totalPct])

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap" justify="center">
      <Box style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <Doughnut key={privacyMode ? 'private' : 'public'} data={data} options={options} width={size} height={size} />
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {hovered !== null ? (
            <>
              <Text size="xs" style={{ maxWidth: size * 0.55, textAlign: 'center', lineHeight: 1.2 }}>{labels[hovered]}</Text>
              <Text size="sm" fw={700}>{privacyMode ? '₹•••' : inrCompact(values[hovered])}</Text>
              <Text size="xs">{pctValues[hovered].toFixed(1)}%</Text>
            </>
          ) : (
            <>
              <Text size="xs" c="dimmed">Total</Text>
              <Text size="sm" fw={700}>{privacyMode ? '₹•••' : inrCompact(totalValue)}</Text>
            </>
          )}
        </Box>
      </Box>

      <Stack gap={4} w={280}>
        {labels.map((label, i) => (
          <Group key={label} gap="xs" wrap="nowrap">
            <Box style={{ width: 10, height: 10, borderRadius: 2, background: colors[i], flexShrink: 0 }} />
            <Text size="xs" style={{ flex: 1 }}>{label}</Text>
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {pctValues[i].toFixed(2)}%
            </Text>
            <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {privacyMode ? '₹•••' : inrCompact(values[i])}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  )
}
