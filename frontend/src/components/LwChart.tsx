import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type CandlestickData,
  type LineData,
  type AreaData,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { ActionIcon, Box, Button, Group } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { usePersistentState } from '../hooks/usePersistentState'
import type { Candle, NavPoint, TradeMarker } from '../types/charts'

type SeriesType = 'candlestick' | 'area' | 'line'

interface LwChartProps {
  seriesType: SeriesType
  candles?: Candle[]
  line?: NavPoint[]
  compareLines?: Array<{ data: NavPoint[]; label: string; color: string }>
  markers?: TradeMarker[]
  persistKey: string
  defaultHeight?: number
  onVisibleRangeChange?: (from: Time, to: Time) => void
}

function toMarkers(markers: TradeMarker[]): SeriesMarker<Time>[] {
  return markers.map((m) => ({
    time: m.time as Time,
    position: m.type === 'BUY' ? 'belowBar' : 'aboveBar',
    color: m.type === 'BUY' ? '#16a34a' : '#dc2626',
    shape: m.type === 'BUY' ? 'arrowUp' : 'arrowDown',
    text: `${m.type} ${m.qty}@${m.price}`,
  }))
}

export function LwChart({
  seriesType,
  candles,
  line,
  compareLines,
  markers,
  persistKey,
  defaultHeight = 520,
}: LwChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | ISeriesApi<'Line'> | null>(null)
  const [height, setHeight] = usePersistentState<number>(persistKey, defaultHeight)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  // Build chart once
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151', style: LineStyle.Dotted },
        horzLines: { color: '#374151', style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', timeVisible: true },
    })
    chartRef.current = chart

    if (seriesType === 'candlestick') {
      const s = chart.addCandlestickSeries({
        upColor: '#16a34a',
        downColor: '#dc2626',
        borderVisible: false,
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
      })
      mainSeriesRef.current = s as unknown as typeof mainSeriesRef.current
    } else if (seriesType === 'area') {
      const s = chart.addAreaSeries({ lineColor: '#3b82f6', topColor: 'rgba(59,130,246,0.3)', bottomColor: 'rgba(59,130,246,0.0)' })
      mainSeriesRef.current = s as unknown as typeof mainSeriesRef.current
    } else {
      const s = chart.addLineSeries({ color: '#3b82f6' })
      mainSeriesRef.current = s as unknown as typeof mainSeriesRef.current
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height)
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesType])

  // Update data
  useEffect(() => {
    const s = mainSeriesRef.current
    if (!s) return
    if (seriesType === 'candlestick' && candles) {
      ;(s as ISeriesApi<'Candlestick'>).setData(
        candles.map((c) => ({ ...c, time: c.time as Time })) as CandlestickData<Time>[],
      )
      if (markers) {
        ;(s as ISeriesApi<'Candlestick'>).setMarkers(toMarkers(markers))
      }
    } else if (line) {
      const lineData = line.map((p) => ({ time: p.time as Time, value: p.value })) as (LineData<Time> | AreaData<Time>)[]
      ;(s as ISeriesApi<'Area'>).setData(lineData)
      if (markers) {
        ;(s as ISeriesApi<'Area'>).setMarkers(toMarkers(markers))
      }
    }
  }, [candles, line, markers, seriesType])

  // Add compare series
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !compareLines) return
    const series = compareLines.map(({ data, color }) => {
      const s = chart.addLineSeries({ color, lineWidth: 2 })
      s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })) as LineData<Time>[])
      return s
    })
    return () => series.forEach((s) => chart.removeSeries(s))
  }, [compareLines])

  // Sync height
  useEffect(() => {
    chartRef.current?.resize(containerRef.current?.clientWidth ?? 600, height)
  }, [height])

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartY.current = e.clientY
      dragStartH.current = height
      setIsDragging(true)

      const onMove = (me: MouseEvent) => {
        const newH = Math.max(160, dragStartH.current + me.clientY - dragStartY.current)
        setHeight(newH)
      }
      const onUp = () => {
        setIsDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [height, setHeight],
  )

  return (
    <Box>
      <Group justify="flex-end" mb={4} gap="xs">
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={12} />}
          onClick={() => setHeight(defaultHeight)}
        >
          Reset size
        </Button>
      </Group>
      <Box
        ref={containerRef}
        style={{
          height,
          borderRadius: '4px 4px 0 0',
          overflow: 'hidden',
          border: '1px solid var(--mantine-color-dark-4)',
          borderBottom: 'none',
        }}
      />
      <Box
        onMouseDown={onMouseDown}
        style={{
          height: 7,
          cursor: 'ns-resize',
          background: isDragging
            ? 'var(--mantine-color-blue-8)'
            : 'var(--mantine-color-dark-4)',
          borderRadius: '0 0 4px 4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="24" height="4" viewBox="0 0 24 4" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          <line x1="2" y1="1.5" x2="22" y2="1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="2" y1="3.5" x2="22" y2="3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </Box>
    </Box>
  )
}
