import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type CandlestickData,
  type LineData,
  type AreaData,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { Box, Button, Group } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { usePersistentState } from '../hooks/usePersistentState'
import { usePrivacy } from '../hooks/usePrivacy'
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
  priceFormatter?: (price: number) => string
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
  priceFormatter,
}: LwChartProps) {
  const { privacyMode } = usePrivacy()
  const privacyModeRef = useRef(privacyMode)
  privacyModeRef.current = privacyMode

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const [height, setHeight] = usePersistentState<number>(persistKey, defaultHeight)
  const heightRef = useRef(height)
  heightRef.current = height  // always current — avoids stale closure in ResizeObserver
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
        textColor: '#374151',
      },
      grid: {
        vertLines: { color: '#e5e7eb', style: LineStyle.Dotted },
        horzLines: { color: '#e5e7eb', style: LineStyle.Dotted },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#d1d5db' },
      timeScale: { borderColor: '#d1d5db', timeVisible: true },
      localization: {
        priceFormatter: privacyModeRef.current ? () => '•••' : (priceFormatter ?? undefined),
      },
    })
    chartRef.current = chart

    if (seriesType === 'candlestick') {
      mainSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: '#16a34a',
        downColor: '#dc2626',
        borderVisible: false,
        wickUpColor: '#16a34a',
        wickDownColor: '#dc2626',
      })
    } else if (seriesType === 'area') {
      mainSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: '#3b82f6',
        topColor: 'rgba(59,130,246,0.3)',
        bottomColor: 'rgba(59,130,246,0.0)',
      })
    } else {
      mainSeriesRef.current = chart.addSeries(LineSeries, { color: '#3b82f6' })
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, heightRef.current)
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      markersPluginRef.current = null
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesType])

  // Update data + markers
  useEffect(() => {
    const s = mainSeriesRef.current
    if (!s) return

    if (seriesType === 'candlestick' && candles) {
      s.setData(candles.map((c) => ({ ...c, time: c.time as Time })) as CandlestickData<Time>[])
    } else if (line) {
      s.setData(line.map((p) => ({ time: p.time as Time, value: p.value })) as (LineData<Time> | AreaData<Time>)[])
    }

    if (markers?.length) {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers(toMarkers(markers))
      } else {
        markersPluginRef.current = createSeriesMarkers(s, toMarkers(markers))
      }
    }
  }, [candles, line, markers, seriesType])

  // Add compare series
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !compareLines) return
    const series = compareLines.map(({ data, color }) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2 })
      s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })) as LineData<Time>[])
      return s
    })
    return () => {
      // Guard: only remove if the chart hasn't been destroyed and recreated
      if (chartRef.current === chart) {
        series.forEach((s) => chart.removeSeries(s))
      }
    }
  }, [compareLines])

  // Sync height
  useEffect(() => {
    chartRef.current?.resize(containerRef.current?.clientWidth ?? 600, height)
  }, [height])

  // Update price formatter on privacy toggle without recreating the chart
  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.applyOptions({
      localization: {
        priceFormatter: privacyMode ? () => '•••' : (priceFormatter ?? undefined),
      },
    })
  }, [privacyMode, priceFormatter])

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
        <Button size="xs" variant="subtle" leftSection={<IconRefresh size={12} />} onClick={() => setHeight(defaultHeight)}>
          Reset size
        </Button>
      </Group>
      <Box
        ref={containerRef}
        style={{
          height,
          borderRadius: '4px 4px 0 0',
          overflow: 'hidden',
          border: '1px solid var(--mantine-color-gray-3)',
          borderBottom: 'none',
        }}
      />
      <Box
        onMouseDown={onMouseDown}
        style={{
          height: 7,
          cursor: 'ns-resize',
          background: isDragging ? 'var(--mantine-color-blue-8)' : 'var(--mantine-color-gray-3)',
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
