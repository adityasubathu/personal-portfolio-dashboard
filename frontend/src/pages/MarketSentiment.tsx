import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react'
import { useSentimentSummary, useSentimentSeries, sentimentKeys } from '../api/marketSentiment'
import { usePersistentState } from '../hooks/usePersistentState'
import { LwChart } from '../components/LwChart'
import type { SentimentSummary, SentimentFlags, IndicatorPoint } from '../types/marketSentiment'
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
    },
    {
      horizon: 'Mid-term',
      trend: horizons.mid.trend,
      detail1: `ADX: ${horizons.mid.adx ?? '—'}`,
      detail2: `Weekly RSI: ${horizons.mid.weekly_rsi ?? '—'}`,
      vol: horizons.mid.vol_regime,
    },
    {
      horizon: 'Long-term',
      trend: horizons.long.trend,
      detail1: `SMA200 slope: ${horizons.long.sma200_slope ?? '—'}`,
      detail2: `Drawdown from ATH: ${horizons.long.drawdown_from_ath_pct != null ? `${horizons.long.drawdown_from_ath_pct}%` : '—'}`,
      vol: `Vol pct: ${horizons.long.vol_percentile != null ? `${horizons.long.vol_percentile}%ile` : '—'}`,
    },
  ]

  return (
    <Table withTableBorder withColumnBorders fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={110}>Horizon</Table.Th>
          <Table.Th w={160}>Trend</Table.Th>
          <Table.Th>Momentum</Table.Th>
          <Table.Th w={140}>Volatility</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.horizon}>
            <Table.Td fw={500}>{r.horizon}</Table.Td>
            <Table.Td>
              <Badge color={trendColor(r.trend)} variant="light" size="sm">
                {r.trend}
              </Badge>
            </Table.Td>
            <Table.Td c="dimmed" fz="xs">
              {r.detail1} &nbsp;·&nbsp; {r.detail2}
            </Table.Td>
            <Table.Td c="dimmed" fz="xs">
              {r.vol}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
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

  return (
    <Group gap="xs" wrap="wrap">
      {active.map((item) => (
        <Badge key={item.label} color={item.color} variant="light" size="sm">
          {item.label}
        </Badge>
      ))}
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
  const { data: series, isLoading: seriesLoading } = useSentimentSeries(2000)

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
      macd_hist: toNavPoints(filterByDays(osc.macd_hist, d)),
      adx: toNavPoints(filterByDays(osc.adx, d)),
      atr_pct: toNavPoints(filterByDays(osc.atr_pct, d)),
      rv20: toNavPoints(filterByDays(osc.realized_vol_20, d)),
      rv60: toNavPoints(filterByDays(osc.realized_vol_60, d)),
    }
  }, [series?.oscillators, rangeDays])

  function toggleOverlay(key: OverlayKey) {
    setEnabledOverlays((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
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
      {summary?.flags && <FlagsBanner flags={summary.flags} />}

      {/* Range selector */}
      <Group justify="space-between" align="center" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={rangeLabel}
          onChange={setRangeLabel}
          data={RANGE_OPTIONS.map((r) => r.label)}
        />
        <Group gap={6} wrap="wrap">
          {OVERLAY_DEFS.map((d) => (
            <Checkbox
              key={d.key}
              size="xs"
              label={<Text fz="xs" c={enabledOverlays.includes(d.key) ? undefined : 'dimmed'}>{d.label}</Text>}
              checked={enabledOverlays.includes(d.key)}
              onChange={() => toggleOverlay(d.key)}
              styles={{ input: { borderColor: d.color, ...(enabledOverlays.includes(d.key) ? { backgroundColor: d.color } : {}) } }}
            />
          ))}
        </Group>
      </Group>

      {/* Price chart */}
      {seriesLoading ? (
        <Loader size="sm" />
      ) : filteredCandles.length > 0 ? (
        <LwChart
          seriesType="candlestick"
          candles={filteredCandles}
          compareLines={compareLines}
          persistKey="market-sentiment-price"
          defaultHeight={440}
          priceFormatter={numFormatter}
        />
      ) : null}

      {/* Oscillator panels */}
      {oscData && (
        <>
          <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
            Oscillators
          </Text>

          <Stack gap="xs">
            <Box>
              <Text fz="xs" c="dimmed" mb={2}>RSI (14) — overbought &gt;70 / oversold &lt;30</Text>
              <LwChart
                seriesType="line"
                line={oscData.rsi14}
                persistKey="market-sentiment-rsi"
                defaultHeight={130}
                priceFormatter={oscFormatter}
              />
            </Box>

            <Box>
              <Text fz="xs" c="dimmed" mb={2}>MACD Histogram</Text>
              <LwChart
                seriesType="line"
                line={oscData.macd_hist}
                persistKey="market-sentiment-macd"
                defaultHeight={130}
                priceFormatter={oscFormatter}
              />
            </Box>

            <Box>
              <Text fz="xs" c="dimmed" mb={2}>ADX — trend strength (&gt;25 = trending)</Text>
              <LwChart
                seriesType="line"
                line={oscData.adx}
                persistKey="market-sentiment-adx"
                defaultHeight={130}
                priceFormatter={oscFormatter}
              />
            </Box>
          </Stack>

          <Text fz="xs" fw={600} c="dimmed" tt="uppercase" mt="xs">
            Volatility
          </Text>

          <Stack gap="xs">
            <Box>
              <Text fz="xs" c="dimmed" mb={2}>ATR %</Text>
              <LwChart
                seriesType="line"
                line={oscData.atr_pct}
                persistKey="market-sentiment-atr"
                defaultHeight={130}
                priceFormatter={oscFormatter}
              />
            </Box>

            <Box>
              <Text fz="xs" c="dimmed" mb={2}>Realized Volatility (annualized %)</Text>
              <LwChart
                seriesType="line"
                line={oscData.rv20}
                compareLines={[{ label: 'RV 60', color: '#8b5cf6', data: oscData.rv60 }]}
                persistKey="market-sentiment-vol"
                defaultHeight={130}
                priceFormatter={oscFormatter}
              />
            </Box>
          </Stack>
        </>
      )}
    </Stack>
  )
}
