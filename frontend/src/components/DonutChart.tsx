import { useMemo } from 'react'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import { Box, Group, Stack, Text } from '@mantine/core'
import { categoryColor, sectorColor } from '../lib/colors'
import { inr, inrCompact } from '../lib/format'

ChartJS.register(ArcElement, Tooltip, Legend)

interface DonutChartProps {
  labels: string[]
  values: number[]
  total?: number
  colorMode?: 'category' | 'sector'
  size?: number
}

export function DonutChart({ labels, values, total, colorMode = 'category', size = 220 }: DonutChartProps) {
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
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; parsed: number }) =>
            `${ctx.label}: ${inr(ctx.parsed)}`,
        },
      },
    },
  }

  const pctValues = useMemo(() => {
    if (totalPct === 0) return values.map(() => 0)
    return values.map((v) => (v / totalPct) * 100)
  }, [values, totalPct])

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap" justify="center">
      <Box style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <Doughnut data={data} options={options} width={size} height={size} />
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
          <Text size="xs" c="dimmed">Total</Text>
          <Text size="sm" fw={700}>{inrCompact(totalValue)}</Text>
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
              {inrCompact(values[i])}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  )
}
