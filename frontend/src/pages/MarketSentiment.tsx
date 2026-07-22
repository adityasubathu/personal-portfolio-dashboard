import { useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Loader,
  Popover,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { IconAlertCircle, IconInfoCircle, IconRefresh } from '@tabler/icons-react'
import { useSentimentSummary, useSentimentSeries, sentimentKeys } from '../api/marketSentiment'
import { usePersistentState } from '../hooks/usePersistentState'
import { LwChart } from '../components/LwChart'
import type { SentimentSummary, SentimentFlags, IndicatorPoint, VixShort, VixMid, VixLong } from '../types/marketSentiment'
import type { NavPoint } from '../types/charts'

// ── Helpers ──────────────────────────────────────────────────────────────────

const RANGE_OPTIONS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 252 },
  { label: '3Y', days: 756 },
  { label: 'All', days: 0 },
]

function filterByDays<T extends { time: string }>(arr: T[], days: number): T[] {
  if (days === 0 || arr.length === 0) return arr
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return arr.filter((p) => p.time >= cutoffStr)
}

function toNavPoints(pts: IndicatorPoint[]): NavPoint[] {
  return pts.filter((p) => p.value !== null) as NavPoint[]
}

function trendColor(trend: string): string {
  const t = trend.toLowerCase()
  if (t.includes('bullish') || t.includes('strong up') || t.includes('uptrend')) return 'green'
  if (t.includes('downtrend') || t.includes('bearish') || t.includes('strong down')) return 'red'
  return 'yellow'
}

const numFormatter = (p: number) => p.toFixed(0)
const oscFormatter = (p: number) => p.toFixed(2)

// ── Chart explanations ────────────────────────────────────────────────────────

const EXPLANATIONS = {
  price: `Each candle shows the Open, High, Low, and Close price for one trading day. Green = closed higher than open; red = lower. Hover to see the OHLC values in the top-left corner.\n\nOverlays:\n• EMA 9 / EMA 20 — fast-moving averages; when the 9 crosses below the 20 it's an early "momentum flipping" signal.\n• SMA 50 / 100 / 200 — slower averages marking medium and long-term trend direction. The 200-DMA is the classic bull/bear regime line.\n• Bollinger Bands — drawn 2 standard deviations above/below a 20-day average. Narrow bands = low volatility ("squeeze"), often preceding a big move. Position (%B) = where price sits within the bands — near the top = stretched high, near the bottom = stretched low.`,

  rsi: `RSI (Relative Strength Index) is a 0–100 oscillator measuring how strong recent up-moves are vs. down-moves over 14 periods.\n\nAbove 70 = overbought — rallied hard, due for a pause or pullback.\nBelow 30 = oversold.\nAround 50 = neutral / balanced.\n\n1D RSI uses daily closes and reacts quickly. 1W RSI uses weekly closes — much smoother, it filters out daily noise to show medium-term momentum. Divergence between the two (e.g. 1D overbought but 1W neutral) often means the move is a short-term spike rather than a sustained trend.`,

  macd: `The MACD histogram shows the gap between a fast (12-day) and slow (26-day) exponential moving average.\n\nBars growing above zero = upward momentum accelerating.\nBars shrinking toward zero = momentum fading, even if price is still rising — it often flips direction before price does.\nCrossing zero is a trend-change signal.\n\nWatch for the histogram reversing direction while price continues — that divergence is the main signal to pay attention to.`,

  adx: `ADX (Average Directional Index) measures how strong a trend is, regardless of direction. It runs 0–100.\n\nBelow ~20 = weak or no trend — the market is choppy and range-bound. Moving average signals will whipsaw.\nAbove ~25 = a real trend is in place, making trend-following reads more reliable.\n\nADX doesn't tell you which direction the trend is, only how strong it is. Pair it with RSI or price-vs-MA to determine direction.`,

  atr: `ATR (Average True Range) measures the average daily trading range — High minus Low, adjusted for overnight gaps — over 14 days. Expressing it as % of price makes it comparable across different price levels and time periods.\n\nRising ATR% = market getting choppier, bigger daily swings.\nFalling ATR% = market calming down, tighter ranges.\n\nThere's no inherently "good" or "bad" level — it's a volatility thermometer. High ATR% means stop-loss levels need to be wider to avoid being shaken out by noise.`,

  vol: `Realized volatility is the actual standard deviation of daily returns over the past 20 or 60 trading days, annualized to a yearly percentage.\n\nRV 20 (amber line) reacts faster to regime changes — it'll spike as soon as volatility picks up.\nRV 60 (purple line) is smoother — it shows the sustained volatility environment rather than short bursts.\n\nComparing the two tells you if a volatility spike is fading (RV 20 drops back toward RV 60) or becoming a new regime (RV 60 starts rising to meet RV 20).`,

  tableShort: `Short-term momentum uses two indicators:\n\n• RSI(14) — 0–100 oscillator. Above 70 = overbought; below 30 = oversold; ~50 = neutral.\n• MACD histogram — gap between a fast and slow EMA shown as bars. Bars growing above zero = momentum accelerating; shrinking toward zero = fading before price moves.`,

  tableMid: `Mid-term momentum uses two indicators:\n\n• ADX — measures trend strength (not direction). Below ~20 = no real trend; above ~25 = trend is in place and MA signals are more reliable.\n• Weekly RSI — same RSI formula on weekly closes. Much smoother than daily; shows the underlying medium-term momentum without day-to-day noise.`,

  tableLong: `Long-term momentum uses three reads:\n\n• SMA200 slope — is the 200-day average itself rising, flat, or falling? Cleaner regime signal than price-vs-200DMA alone.\n• Drawdown from ATH — how far current price has fallen from the most recent peak, and how long the drawdown has lasted.\n• Rolling 1-year return — the % return over the trailing 252 trading days. Puts current performance in context: unusually strong, weak, or normal vs. history.`,

  tableVol: `Volatility regime classifies the current realized volatility environment:\n\n• Low — vol is below its historical median; market is calm.\n• Normal — vol is in its typical range.\n• High — vol is elevated; expect wider daily swings and less reliable trend signals.\n\nBased on rolling 60-day realized volatility percentile vs. the full 6-year window.`,

  gap: `Gap analysis measures the % difference between today's open and yesterday's close.\n\nA big gap = strong overnight sentiment shift driven by news or global cues. The gap badge appears when today's gap exceeds 0.5% in either direction.\n\n"Fill rate" (not shown here) = how often the gap gets closed same-day — a texture read on whether gaps tend to be sustained or quickly faded by the market.`,

  vixShort: `India VIX day-over-day and 5-day % change.\n\nVIX measures implied volatility — what options traders are pricing in as forward risk. It often moves *before* Nifty price reacts, making it the earliest warning signal on the dashboard.\n\nA sharp single-day spike (+10–15%) = sudden fear entering the market. A fast drop after a spike = fear unwinding. Small daily moves = business as usual.`,

  vixMid: `India VIX vs its own 20-day simple moving average.\n\nVIX persistently above its MA = a stretch of elevated, sustained nervousness — often coincides with choppy or range-bound Nifty price action.\nVIX below its MA and drifting down = a sustained calm/complacency regime.\n\nThe duration above or below matters more than any single day's level. Pairs naturally with ADX: both classify trending vs. choppy regime, but VIX does it from the implied side.`,

  vixLong: `India VIX percentile rank vs its full 6-year history.\n\nAbsolute VIX levels drift over market cycles, so percentile rank is far more meaningful than a raw number.\n\nLow percentile (<20th) = historically complacent — can precede surprise volatility events.\nHigh percentile (>80th) = historically fearful — often coincides with capitulation-type bottoms or major uncertainty.\nMid-range = normal regime, nothing notable.\n\nPairs directly with the realized-vol percentile in the adjacent column: together they give you a forward-looking (implied) vs. backward-looking (realized) comparison.`,
}

function ChartInfo({ text }: { text: string }) {
  const [opened, setOpened] = useState(false)
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      width={320}
      position="bottom"
      withArrow
      shadow="md"
      clickOutsideEvents={['mousedown', 'touchstart']}
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setOpened((o) => !o)}
          style={{ flexShrink: 0 }}
        >
          <IconInfoCircle size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown maw={320}>
        <Text size="xs" style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }}>
          {text}
        </Text>
      </Popover.Dropdown>
    </Popover>
  )
}

// ── VIX cell formatters ───────────────────────────────────────────────────────

function fmtChg(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function vixShortLabel(v: VixShort | undefined): string {
  if (!v || v.vix_current == null) return '—'
  const cur = v.vix_current.toFixed(1)
  const d = fmtChg(v.vix_day_chg)
  const w = fmtChg(v.vix_5d_chg)
  return `VIX ${cur} · 1d: ${d} · 5d: ${w}`
}

function vixMidLabel(v: VixMid | undefined): string {
  if (!v || v.vix_current == null) return '—'
  const cur = v.vix_current.toFixed(1)
  if (v.vix_vs_sma20_pct == null) return `VIX ${cur}`
  const dir = v.vix_above_sma20 ? 'above' : 'below'
  const gap = Math.abs(v.vix_vs_sma20_pct).toFixed(1)
  return `VIX ${cur} · ${gap}% ${dir} 20d MA`
}

function vixLongLabel(v: VixLong | undefined): string {
  if (!v || v.vix_current == null) return '—'
  const cur = v.vix_current.toFixed(1)
  const pct = v.vix_pct_rank != null ? `${v.vix_pct_rank}th %ile` : '—'
  return `VIX ${cur} · ${pct}`
}

// ── Summary table ─────────────────────────────────────────────────────────────

function SentimentSummaryCard({ data }: { data: SentimentSummary }) {
  const { horizons } = data
  if (!horizons) return null

  const rows = [
    {
      horizon: 'Short-term',
      trend: horizons.short.trend,
      detail1: `RSI(14): ${horizons.short.rsi14 ?? '—'}`,
      detail2: `MACD hist: ${horizons.short.macd_hist ?? '—'}`,
      vol: horizons.short.vol_regime,
      momentumInfo: EXPLANATIONS.tableShort,
      vixLabel: vixShortLabel(horizons.short.vix),
      vixInfo: EXPLANATIONS.vixShort,
    },
    {
      horizon: 'Mid-term',
      trend: horizons.mid.trend,
      detail1: `ADX: ${horizons.mid.adx ?? '—'}`,
      detail2: `Weekly RSI: ${horizons.mid.weekly_rsi ?? '—'}`,
      vol: horizons.mid.vol_regime,
      momentumInfo: EXPLANATIONS.tableMid,
      vixLabel: vixMidLabel(horizons.mid.vix),
      vixInfo: EXPLANATIONS.vixMid,
    },
    {
      horizon: 'Long-term',
      trend: horizons.long.trend,
      detail1: `SMA200 slope: ${horizons.long.sma200_slope ?? '—'}`,
      detail2: `Drawdown from ATH: ${horizons.long.drawdown_from_ath_pct != null ? `${horizons.long.drawdown_from_ath_pct}%` : '—'}`,
      vol: `Vol pct: ${horizons.long.vol_percentile != null ? `${horizons.long.vol_percentile}%ile` : '—'}`,
      momentumInfo: EXPLANATIONS.tableLong,
      vixLabel: vixLongLabel(horizons.long.vix),
      vixInfo: EXPLANATIONS.vixLong,
    },
  ]

  return (
    <Box px={128}>
      <Table withTableBorder withColumnBorders fz="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={120}>Horizon</Table.Th>
            <Table.Th w={160}>Trend</Table.Th>
            <Table.Th w={220}>Momentum</Table.Th>
            <Table.Th w={160}>
              <Group gap={4} align="center" wrap="nowrap">
                Volatility (realized)
                <ChartInfo text={EXPLANATIONS.tableVol} />
              </Group>
            </Table.Th>
            <Table.Th w={260}>Volatility (implied)</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.horizon}>
              <Table.Td fw={500}>{r.horizon}</Table.Td>
              <Table.Td>
                <Badge color={trendColor(r.trend)} variant="light" size="sm" fz="0.825rem">
                  {r.trend}
                </Badge>
              </Table.Td>
              <Table.Td c="dimmed" fz="sm">
                <Group gap={4} align="center" wrap="nowrap">
                  <span>{r.detail1} &nbsp;·&nbsp; {r.detail2}</span>
                  <ChartInfo text={r.momentumInfo} />
                </Group>
              </Table.Td>
              <Table.Td c="dimmed" fz="sm">
                {r.vol}
              </Table.Td>
              <Table.Td c="dimmed" fz="sm">
                <Group gap={4} align="center" wrap="nowrap">
                  <span>{r.vixLabel}</span>
                  <ChartInfo text={r.vixInfo} />
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  )
}

// ── Flags banner ──────────────────────────────────────────────────────────────

function FlagsBanner({ flags }: { flags: SentimentFlags }) {
  const items: { label: string; color: string; show: boolean }[] = [
    {
      label: flags.cross_state === 'golden' ? 'Golden Cross' : 'Death Cross',
      color: flags.cross_state === 'golden' ? 'yellow' : 'red',
      show: flags.cross_state !== 'none',
    },
    {
      label: `${flags.days_since_cross} days since cross`,
      color: 'gray',
      show: flags.cross_state !== 'none' && flags.days_since_cross != null,
    },
    {
      label: 'Momentum divergence',
      color: 'orange',
      show: flags.divergence,
    },
    {
      label: flags.streak > 0 ? `${flags.streak}-day winning streak` : `${Math.abs(flags.streak)}-day losing streak`,
      color: flags.streak > 0 ? 'green' : 'red',
      show: Math.abs(flags.streak) >= 3,
    },
    {
      label: `Gap ${flags.gap_pct != null && flags.gap_pct > 0 ? '+' : ''}${flags.gap_pct?.toFixed(2)}% today`,
      color: flags.gap_pct != null && flags.gap_pct > 0 ? 'green' : 'red',
      show: flags.gap_pct != null && Math.abs(flags.gap_pct) >= 0.5,
    },
  ]

  const active = items.filter((i) => i.show)
  if (active.length === 0) return null

  const hasGap = active.some((i) => i.label.startsWith('Gap'))

  return (
    <Group gap="xs" wrap="wrap" align="center">
      {active.map((item) => (
        <Badge key={item.label} color={item.color} variant="light" size="sm" fz="0.825rem">
          {item.label}
        </Badge>
      ))}
      {hasGap && <ChartInfo text={EXPLANATIONS.gap} />}
    </Group>
  )
}

// ── Overlay toggle config ─────────────────────────────────────────────────────

const OVERLAY_DEFS = [
  { key: 'ema9',      label: 'EMA 9',    color: '#f59e0b', group: 'EMAs' },
  { key: 'ema20',     label: 'EMA 20',   color: '#fb923c', group: 'EMAs' },
  { key: 'sma50',     label: 'SMA 50',   color: '#22c55e', group: 'SMAs' },
  { key: 'sma100',    label: 'SMA 100',  color: '#3b82f6', group: 'SMAs' },
  { key: 'sma200',    label: 'SMA 200',  color: '#8b5cf6', group: 'SMAs' },
  { key: 'bb_upper',  label: 'BB Upper', color: '#94a3b8', group: 'Bollinger' },
  { key: 'bb_mid',    label: 'BB Mid',   color: '#64748b', group: 'Bollinger' },
  { key: 'bb_lower',  label: 'BB Lower', color: '#94a3b8', group: 'Bollinger' },
] as const

type OverlayKey = typeof OVERLAY_DEFS[number]['key']

// ── Page ──────────────────────────────────────────────────────────────────────

export function MarketSentiment() {
  const qc = useQueryClient()
  const { data: summary, isLoading: summaryLoading } = useSentimentSummary()

  const [rangeLabel, setRangeLabel] = usePersistentState<string>('market-sentiment-range', '1Y')
  const [enabledOverlays, setEnabledOverlays] = usePersistentState<OverlayKey[]>(
    'market-sentiment-overlays',
    ['sma50', 'sma200'],
  )

  const rangeDays = RANGE_OPTIONS.find((r) => r.label === rangeLabel)?.days ?? 252
  const { data: series, isLoading: seriesLoading } = useSentimentSeries(0)

  const filteredCandles = useMemo(
    () => filterByDays(series?.candles ?? [], rangeDays),
    [series?.candles, rangeDays],
  )

  const compareLines = useMemo(() => {
    if (!series?.overlays) return []
    return OVERLAY_DEFS.filter((d) => enabledOverlays.includes(d.key)).map((d) => ({
      label: d.label,
      color: d.color,
      data: filterByDays(toNavPoints(series.overlays![d.key]), rangeDays),
    }))
  }, [series?.overlays, enabledOverlays, rangeDays])

  const oscData = useMemo(() => {
    if (!series?.oscillators) return null
    const osc = series.oscillators
    const d = rangeDays
    return {
      rsi14: toNavPoints(filterByDays(osc.rsi14, d)),
      rsi14_weekly: toNavPoints(filterByDays(osc.rsi14_weekly, d)),
      macd_hist: toNavPoints(filterByDays(osc.macd_hist, d)),
      adx: toNavPoints(filterByDays(osc.adx, d)),
      atr_pct: toNavPoints(filterByDays(osc.atr_pct, d)),
      rv20: toNavPoints(filterByDays(osc.realized_vol_20, d)),
      rv60: toNavPoints(filterByDays(osc.realized_vol_60, d)),
    }
  }, [series?.oscillators, rangeDays])

  function toggleOverlay(key: OverlayKey) {
    const next = enabledOverlays.includes(key)
      ? enabledOverlays.filter((k) => k !== key)
      : [...enabledOverlays, key]
    setEnabledOverlays(next)
  }

  if (summaryLoading) return <Loader size="sm" m="xl" />
  if (summary?.no_data) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="blue" variant="light" maw={480}>
        No Nifty 50 price history found. Run a portfolio sync (Kite → Sync) to load index data.
      </Alert>
    )
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Box>
          <Title order={3}>Market Sentiment — Nifty 50</Title>
          {summary?.as_of && (
            <Text fz="xs" c="dimmed">
              As of {summary.as_of} · Close: {summary.close?.toLocaleString('en-IN')}
            </Text>
          )}
        </Box>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={14} />}
          onClick={() => {
            qc.invalidateQueries({ queryKey: sentimentKeys.summary })
            qc.invalidateQueries({ queryKey: ['market-sentiment', 'series'] })
          }}
        >
          Refresh
        </Button>
      </Group>

      {summary?.horizons && <SentimentSummaryCard data={summary} />}
      {summary?.flags && <Box px={128}><FlagsBanner flags={summary.flags} /></Box>}

      {/* Range selector */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={rangeLabel}
          onChange={setRangeLabel}
          data={RANGE_OPTIONS.map((r) => r.label)}
        />
        <Group gap={14} wrap="wrap">
          {OVERLAY_DEFS.map((d) => {
            const enabled = enabledOverlays.includes(d.key)
            return (
              <Group
                key={d.key}
                gap={4}
                align="center"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleOverlay(d.key)}
              >
                <Box
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    border: `2px solid ${d.color}`,
                    backgroundColor: enabled ? d.color : 'transparent',
                    flexShrink: 0,
                  }}
                />
                <Text fz="xs" c={enabled ? undefined : 'dimmed'}>{d.label}</Text>
              </Group>
            )
          })}
        </Group>
      </Group>

      {/* Price chart */}
      {seriesLoading ? (
        <Loader size="sm" />
      ) : filteredCandles.length > 0 ? (
        <>
          <Group justify="flex-end" mb={2}>
            <ChartInfo text={EXPLANATIONS.price} />
          </Group>
          <LwChart
            seriesType="candlestick"
            candles={filteredCandles}
            compareLines={compareLines}
            persistKey="market-sentiment-price"
            defaultHeight={440}
            priceFormatter={numFormatter}
            showOhlcInfo
            hideMainTag
          />
        </>
      ) : null}

      {/* Oscillator panels */}
      {oscData && (
        <>
          <Divider mt="lg" mb="xs" label={<Title order={2} c="black">Oscillators</Title>} labelPosition="center" />

          <Stack gap="lg">
            <Box px={128}>
              <Group justify="center" align="center" gap={6} mb={4}>
                <Text fz="1.75rem" fw={500} c="dimmed">RSI — overbought &gt;70 / oversold &lt;30 ↓</Text>
                <ChartInfo text={EXPLANATIONS.rsi} />
              </Group>
              <LwChart
                seriesType="line"
                line={oscData.rsi14}
                compareLines={[{ label: '1W RSI', color: '#f59e0b', data: oscData.rsi14_weekly }]}
                persistKey="market-sentiment-rsi"
                defaultHeight={130}
                priceFormatter={oscFormatter}
                hideControls
              />
            </Box>

            <Box px={128}>
              <Group justify="center" align="center" gap={6} mb={4}>
                <Text fz="1.75rem" fw={500} c="dimmed">MACD Histogram ↓</Text>
                <ChartInfo text={EXPLANATIONS.macd} />
              </Group>
              <LwChart
                seriesType="histogram"
                line={oscData.macd_hist}
                persistKey="market-sentiment-macd"
                defaultHeight={130}
                priceFormatter={oscFormatter}
                hideControls
              />
            </Box>

            <Box px={128}>
              <Group justify="center" align="center" gap={6} mb={4}>
                <Text fz="1.75rem" fw={500} c="dimmed">ADX — trend strength (&gt;25 = trending) ↓</Text>
                <ChartInfo text={EXPLANATIONS.adx} />
              </Group>
              <LwChart
                seriesType="line"
                line={oscData.adx}
                persistKey="market-sentiment-adx"
                defaultHeight={130}
                priceFormatter={oscFormatter}
                hideControls
              />
            </Box>
          </Stack>

          <Divider mt="xl" mb="xs" label={<Title order={2} c="black">Volatility</Title>} labelPosition="center" />

          <Stack gap="lg">
            <Box px={128}>
              <Group justify="center" align="center" gap={6} mb={4}>
                <Text fz="1.75rem" fw={500} c="dimmed">ATR % ↓</Text>
                <ChartInfo text={EXPLANATIONS.atr} />
              </Group>
              <LwChart
                seriesType="line"
                line={oscData.atr_pct}
                persistKey="market-sentiment-atr"
                defaultHeight={130}
                priceFormatter={oscFormatter}
                hideControls
              />
            </Box>

            <Box px={128}>
              <Group justify="center" align="center" gap={6} mb={4}>
                <Text fz="1.75rem" fw={500} c="dimmed">Realized Volatility (annualized %) ↓</Text>
                <ChartInfo text={EXPLANATIONS.vol} />
              </Group>
              <LwChart
                seriesType="line"
                line={oscData.rv20}
                compareLines={[{ label: 'RV 60', color: '#8b5cf6', data: oscData.rv60 }]}
                persistKey="market-sentiment-vol"
                defaultHeight={130}
                priceFormatter={oscFormatter}
                hideControls
              />
            </Box>
          </Stack>
        </>
      )}
    </Stack>
  )
}
