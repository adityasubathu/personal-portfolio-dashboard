import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  createSeriesMarkers,
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
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

type SeriesType = 'candlestick' | 'area' | 'line' | 'histogram'

interface LwChartProps {
  seriesType: SeriesType
  candles?: Candle[]
  line?: NavPoint[]
  label?: string
  compareLines?: Array<{ data: NavPoint[]; label: string; color: string }>
  markers?: TradeMarker[]
  persistKey: string
  defaultHeight?: number
  priceFormatter?: (price: number) => string
  showOhlcInfo?: boolean
  hideControls?: boolean
  hideMainTag?: boolean
  priceScaleWidth?: number
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatTooltipValue(value: number): string {
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(2)}K`
  return `${sign}₹${abs.toFixed(2)}`
}

function formatTooltipDate(time: Time): string {
  const s = String(time).slice(0, 10) // take 'YYYY-MM-DD', strip any ' HH:MM:SS' suffix
  const [y, m, d] = s.split('-')
  return `${d} ${MONTHS[parseInt(m) - 1]} ${y}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSeriesValue(data: unknown): number | null {
  if (data == null) return null
  if (typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.close === 'number') return d.close   // candlestick
    if (typeof d.value === 'number') return d.value   // line / area
  }
  return null
}

// Tooltip DOM helpers — all imperative, no React reconciliation

function makeTooltipRoot(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:10;'
  return el
}

interface TagEl {
  wrap: HTMLDivElement
  label: HTMLDivElement
  tipLeft: HTMLDivElement   // right-facing triangle (default: tag is to the left)
  tipRight: HTMLDivElement  // left-facing triangle (flipped: tag is to the right)
  connector: HTMLDivElement // thin vertical line when tooltip is pushed far from actual Y
}

function makeTagEl(color: string): TagEl {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute;display:flex;align-items:center;'

  const tipLeft = document.createElement('div')
  // right-facing triangle on the right edge of the label
  tipLeft.style.cssText = `width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:6px solid ${color};flex-shrink:0;`

  const tipRight = document.createElement('div')
  // left-facing triangle on the left edge of the label
  tipRight.style.cssText = `width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-right:6px solid ${color};flex-shrink:0;display:none;`

  const label = document.createElement('div')
  label.style.cssText = `background:${color};color:#fff;font-size:11px;font-family:sans-serif;padding:2px 7px;border-radius:3px;white-space:nowrap;`

  // default layout: [label][tipLeft]  (tip points right, tag to the left)
  wrap.appendChild(label)
  wrap.appendChild(tipLeft)
  wrap.appendChild(tipRight)

  const connector = document.createElement('div')
  connector.style.cssText = `position:absolute;width:1px;background:${color};display:none;`

  return { wrap, label, tipLeft, tipRight, connector }
}

function makeDateEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:absolute;background:#374151;color:#fff;font-size:11px;font-family:sans-serif;padding:2px 7px;border-radius:3px;white-space:nowrap;transform:translateX(-50%);display:none;pointer-events:none;'
  return el
}

export function LwChart({
  seriesType,
  candles,
  line,
  label,
  compareLines,
  markers,
  persistKey,
  defaultHeight = 520,
  priceFormatter,
  showOhlcInfo = false,
  hideControls = false,
  hideMainTag = false,
  priceScaleWidth,
}: LwChartProps) {
  const { privacyMode } = usePrivacy()
  const privacyModeRef = useRef(privacyMode)
  privacyModeRef.current = privacyMode
  const priceFormatterRef = useRef(priceFormatter)
  priceFormatterRef.current = priceFormatter

  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mainSeriesRef = useRef<ISeriesApi<any> | null>(null)
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  // Map from series → {label, color, tagEl} for the crosshair callback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesMetaRef = useRef<Map<ISeriesApi<any>, { label: string; color: string; tag: TagEl }>>(new Map())
  const tooltipRootRef = useRef<HTMLDivElement | null>(null)
  const dateElRef = useRef<HTMLDivElement | null>(null)

  const [height, setHeight] = usePersistentState<number>(persistKey, defaultHeight)
  const heightRef = useRef(height)
  heightRef.current = height
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
      rightPriceScale: { borderColor: '#d1d5db', ...(priceScaleWidth != null ? { minimumWidth: priceScaleWidth } : {}) },
      timeScale: { borderColor: '#d1d5db', timeVisible: true },
      localization: {
        priceFormatter: privacyModeRef.current ? () => '•••' : (priceFormatter ?? undefined),
      },
    })
    chartRef.current = chart

    const MAIN_COLOR = '#3b82f6'

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
        lineColor: MAIN_COLOR,
        topColor: 'rgba(59,130,246,0.3)',
        bottomColor: 'rgba(59,130,246,0.0)',
      })
    } else if (seriesType === 'histogram') {
      mainSeriesRef.current = chart.addSeries(HistogramSeries, {
        color: MAIN_COLOR,
        priceLineVisible: false,
      })
    } else {
      mainSeriesRef.current = chart.addSeries(LineSeries, { color: MAIN_COLOR })
    }

    // Tooltip overlay
    const root = makeTooltipRoot()
    containerRef.current.appendChild(root)
    tooltipRootRef.current = root

    const mainTag = makeTagEl(MAIN_COLOR)
    root.appendChild(mainTag.wrap)
    root.appendChild(mainTag.connector)
    mainTag.wrap.style.display = 'none'
    mainTag.connector.style.display = 'none'
    if (!hideMainTag) {
      seriesMetaRef.current.set(mainSeriesRef.current, { label: label ?? '', color: MAIN_COLOR, tag: mainTag })
    }

    const dateEl = makeDateEl()
    root.appendChild(dateEl)
    dateElRef.current = dateEl

    // OHLC info box (top-left, candlestick only)
    let ohlcEl: HTMLDivElement | null = null
    if (showOhlcInfo && seriesType === 'candlestick') {
      ohlcEl = document.createElement('div')
      ohlcEl.style.cssText = 'position:absolute;top:8px;left:8px;z-index:10;pointer-events:none;font-size:13px;font-family:sans-serif;line-height:1.7;background:rgba(55,65,81,0.82);color:#fff;padding:5px 10px;border-radius:4px;display:none;'
      containerRef.current.appendChild(ohlcEl)
    }

    // Crosshair subscription
    const sub = chart.subscribeCrosshairMove((param) => {
      const allMeta = [...seriesMetaRef.current.values()]

      if (!param.time || !param.point) {
        allMeta.forEach(({ tag }) => { tag.wrap.style.display = 'none'; tag.connector.style.display = 'none' })
        dateEl.style.display = 'none'
        if (ohlcEl) ohlcEl.style.display = 'none'
        return
      }

      const chartWidth = containerRef.current?.clientWidth ?? 0
      const chartHeight = heightRef.current

      // Gather tooltip positions
      const positions: { y: number; tag: TagEl; value: number; color: string; label: string }[] = []

      for (const [series, meta] of seriesMetaRef.current) {
        const raw = param.seriesData.get(series)
        const value = extractSeriesValue(raw)
        if (value == null) { meta.tag.wrap.style.display = 'none'; meta.tag.connector.style.display = 'none'; continue }

        const x = chart.timeScale().timeToCoordinate(param.time)
        const y = series.priceToCoordinate(value)
        if (x == null || y == null) { meta.tag.wrap.style.display = 'none'; meta.tag.connector.style.display = 'none'; continue }

        positions.push({ y, tag: meta.tag, value, color: meta.color, label: meta.label })
      }

      // Anti-overlap: sort by Y (top first), push down as needed
      positions.sort((a, b) => a.y - b.y)
      const TAG_H = 22   // approximate tag height px
      const GAP = 4
      const adjustedY: number[] = []
      for (let i = 0; i < positions.length; i++) {
        let ay = positions[i].y - TAG_H / 2
        if (i > 0) {
          const prevBottom = adjustedY[i - 1] + TAG_H
          if (ay < prevBottom + GAP) ay = prevBottom + GAP
        }
        adjustedY.push(ay)
      }

      const x = chart.timeScale().timeToCoordinate(param.time) ?? 0

      for (let i = 0; i < positions.length; i++) {
        const { y: actualY, tag, value, color, label: seriesLabel } = positions[i]
        const ty = adjustedY[i]
        const shift = Math.abs(ty + TAG_H / 2 - actualY)

        const formatted = privacyModeRef.current
          ? '...'
          : priceFormatterRef.current
            ? priceFormatterRef.current(value)
            : formatTooltipValue(value)
        tag.label.textContent = seriesLabel ? `${seriesLabel}: ${formatted}` : formatted

        // Estimate label width to decide flip
        const labelW = tag.label.offsetWidth || tag.label.textContent!.length * 7 + 14
        const TIP_W = 6
        const totalW = labelW + TIP_W
        const EDGE_MARGIN = 8
        const flipped = x < totalW + EDGE_MARGIN

        if (flipped) {
          // tag to the right: [tipRight][label]
          tag.tipLeft.style.display = 'none'
          tag.tipRight.style.display = ''
          tag.wrap.style.flexDirection = 'row'
          tag.wrap.style.left = `${x}px`
          tag.wrap.style.transform = `translateY(-50%)`
          tag.wrap.style.top = `${ty + TAG_H / 2}px`
        } else {
          // tag to the left: [label][tipLeft]
          tag.tipLeft.style.display = ''
          tag.tipRight.style.display = 'none'
          tag.wrap.style.flexDirection = 'row'
          tag.wrap.style.left = `${x - totalW}px`
          tag.wrap.style.transform = `translateY(-50%)`
          tag.wrap.style.top = `${ty + TAG_H / 2}px`
        }
        tag.wrap.style.display = 'flex'

        // Connector line when tooltip is displaced far from actual Y
        if (shift > TAG_H / 2) {
          const connTop = Math.min(actualY, ty + TAG_H / 2)
          const connH = Math.abs(actualY - (ty + TAG_H / 2))
          tag.connector.style.cssText = `position:absolute;width:1px;background:${color};left:${x - 1}px;top:${connTop}px;height:${connH}px;`
          tag.connector.style.display = 'block'
        } else {
          tag.connector.style.display = 'none'
        }
      }

      // OHLC info box
      if (ohlcEl && mainSeriesRef.current) {
        const raw = param.seriesData.get(mainSeriesRef.current) as CandlestickData<Time> | undefined
        if (raw && typeof raw.open === 'number') {
          const fmt = priceFormatterRef.current ?? ((v: number) => v.toFixed(2))
          const pct = (raw.close - raw.open) / raw.open * 100
          const sign = pct >= 0 ? '+' : ''
          const pctColor = pct >= 0 ? '#4ade80' : '#f87171'
          ohlcEl.innerHTML =
            `O&nbsp;${fmt(raw.open)}&nbsp;&nbsp;H&nbsp;${fmt(raw.high)}&nbsp;&nbsp;L&nbsp;${fmt(raw.low)}&nbsp;&nbsp;C&nbsp;${fmt(raw.close)}&nbsp;&nbsp;<span style="color:${pctColor}">${sign}${pct.toFixed(2)}%</span>`
          ohlcEl.style.display = 'block'
        }
      }

      // Date tooltip
      dateEl.textContent = formatTooltipDate(param.time)
      dateEl.style.left = `${x}px`
      dateEl.style.top = `${chartHeight - 28}px`
      dateEl.style.display = 'block'
    })

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, heightRef.current)
    })
    ro.observe(containerRef.current)

    return () => {
      chart.unsubscribeCrosshairMove(sub)
      ro.disconnect()
      markersPluginRef.current = null
      seriesMetaRef.current.clear()
      tooltipRootRef.current = null
      dateElRef.current = null
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      s.setData(line.map((p) => ({ time: p.time as Time, value: p.value })) as any[])
    }

    if (markers?.length) {
      if (markersPluginRef.current) {
        markersPluginRef.current.setMarkers(toMarkers(markers))
      } else {
        markersPluginRef.current = createSeriesMarkers(s, toMarkers(markers))
      }
    }

    // Re-apply minimumWidth after data is set so it overrides the natural scale width
    if (priceScaleWidth != null) {
      chartRef.current?.priceScale('right').applyOptions({ minimumWidth: priceScaleWidth })
    }
  }, [candles, line, markers, seriesType, priceScaleWidth])

  // Add compare series
  useEffect(() => {
    const chart = chartRef.current
    const root = tooltipRootRef.current
    const dateEl = dateElRef.current
    if (!chart || !compareLines) return

    const series = compareLines.map(({ data, color, label }) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 2 })
      s.setData(data.map((p) => ({ time: p.time as Time, value: p.value })) as LineData<Time>[])

      if (root && dateEl) {
        const tag = makeTagEl(color)
        root.insertBefore(tag.wrap, dateEl)
        root.insertBefore(tag.connector, dateEl)
        tag.wrap.style.display = 'none'
        tag.connector.style.display = 'none'
        seriesMetaRef.current.set(s, { label, color, tag })
      }

      return s
    })

    return () => {
      if (chartRef.current === chart) {
        series.forEach((s) => {
          const meta = seriesMetaRef.current.get(s)
          if (meta && root) {
            root.removeChild(meta.tag.wrap)
            root.removeChild(meta.tag.connector)
          }
          seriesMetaRef.current.delete(s)
          chart.removeSeries(s)
        })
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
      {!hideControls && (
        <Group justify="flex-end" mb={4} gap="xs">
          <Button size="xs" variant="subtle" leftSection={<IconRefresh size={12} />} onClick={() => setHeight(defaultHeight)}>
            Reset size
          </Button>
        </Group>
      )}
      <Box
        ref={containerRef}
        style={{
          height,
          borderRadius: '4px 4px 0 0',
          overflow: 'hidden',
          border: '1px solid var(--mantine-color-gray-3)',
          borderBottom: 'none',
          position: 'relative',
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
