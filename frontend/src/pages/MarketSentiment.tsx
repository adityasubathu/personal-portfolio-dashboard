import { useMemo, useState, useRef, useCallback } from 'react'
import {
  Divider,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { AlertCircle, Info, RefreshCw } from 'lucide-react'
import { useSentimentSummary, useSentimentSeries, useMarketBreadth, useRefreshIndicesMutation, useSectorTrends } from '../api/marketSentiment'
import { usePersistentState } from '../hooks/usePersistentState'
import { LwChart } from '../components/LwChart'
import { PageHeader } from '../components/PageHeader'
import { Panel } from '../components/Panel'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { notify } from '@/lib/notify'
import type { SentimentSummary, SentimentFlags, IndicatorPoint, VixShort, VixMid, VixLong, MarketBreadth, SectorTrendRow, SentimentIndex, TrendCell } from '../types/marketSentiment'
import { pct, heatmapBg, heatmapTextColor } from '../lib/format'
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

// Maps the Mantine colour-name vocabulary the sentiment data model speaks
// (green/red/orange/...) to Tailwind tone classes for Badge.
const COLOR_CLASS: Record<string, string> = {
  green: 'bg-positive/10 text-positive',
  red: 'bg-negative/10 text-negative',
  orange: 'bg-warning/10 text-warning',
  yellow: 'bg-warning/10 text-warning',
  blue: 'bg-info/10 text-info',
  teal: 'bg-info/10 text-info',
  violet: 'bg-primary/10 text-primary',
  gray: 'bg-muted text-muted-foreground',
}

// Four-step gradient over the shared trend labels (3/2/1/0 signals passing).
const TREND_COLORS: Record<string, string> = {
  'Bullish': 'green',
  'Mostly Bullish': 'teal',
  'Mostly Bearish': 'orange',
  'Bearish': 'red',
}

function trendColor(trend: string): string {
  return TREND_COLORS[trend] ?? 'gray'
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

  trendShort: `Every horizon asks the same three yes/no questions and counts the yeses. Short-term measures them over weeks:\n\n1. Is the price above its 20-day average?\n2. Is the trend still gaining strength? (MACD histogram above zero)\n3. Has the price actually risen over the last month?\n\n3/3 → Bullish · 2/3 → Mostly Bullish · 1/3 → Mostly Bearish · 0/3 → Bearish\n\n↘ means "losing steam": the price is up, but question 2 failed — the trend has stopped gaining strength. An early warning that the move may be tiring.`,

  trendMid: `Every horizon asks the same three yes/no questions and counts the yeses. Mid-term measures them over months:\n\n1. Is the price above its 50-day average?\n2. Is the trend still gaining strength? (+DI above −DI, from the ADX system)\n3. Has the price actually risen over the last 3 months?\n\n3/3 → Bullish · 2/3 → Mostly Bullish · 1/3 → Mostly Bearish · 0/3 → Bearish\n\n↘ means "losing steam": the price is up, but question 2 failed — the trend has stopped gaining strength.`,

  trendLong: `Every horizon asks the same three yes/no questions and counts the yeses. Long-term measures them over a year or more:\n\n1. Is the price above its 200-day average?\n2. Is the trend still gaining strength? (is the 200-day line still sloping up)\n3. Has the price actually risen over the last year?\n\n3/3 → Bullish · 2/3 → Mostly Bullish · 1/3 → Mostly Bearish · 0/3 → Bearish\n\n↘ means "losing steam": the price is up, but question 2 failed — still above the 200-day average, but that average has gone flat. This is the most common 2/3 case by far.\n\nThe Golden Cross is deliberately not scored here — it reports the last 50/200 crossover, which can be months stale. It appears as its own badge instead.`,

  tableShort: `Short-term momentum uses two indicators:\n\n• RSI(14) — 0–100 oscillator. Above 70 = overbought; below 30 = oversold; ~50 = neutral.\n• MACD histogram — gap between a fast and slow EMA shown as bars. Bars growing above zero = momentum accelerating; shrinking toward zero = fading before price moves.`,

  tableMid: `Mid-term momentum uses two indicators:\n\n• ADX — measures trend strength (not direction). Below ~20 = no real trend; above ~25 = trend is in place and MA signals are more reliable.\n• Weekly RSI — same RSI formula on weekly closes. Much smoother than daily; shows the underlying medium-term momentum without day-to-day noise.`,

  tableLong: `Long-term momentum uses three reads:\n\n• SMA200 slope — is the 200-day average itself rising, flat, or falling? Measured over 21 sessions; flat means it moved less than 0.015%/day (about ±3.8% a year). Cleaner regime signal than price-vs-200DMA alone.\n• Drawdown from ATH — how far current price has fallen from the most recent peak, and how long the drawdown has lasted.\n• Rolling 1-year return — the % return over the trailing 252 trading days. Puts current performance in context: unusually strong, weak, or normal vs. history.`,

  tableVol: `Volatility regime classifies the current realized volatility environment:\n\n• Low — vol is below its historical median; market is calm.\n• Normal — vol is in its typical range.\n• High — vol is elevated; expect wider daily swings and less reliable trend signals.\n\nBased on rolling 60-day realized volatility percentile vs. the full 6-year window.`,

  gap: `Gap analysis measures the % difference between today's open and yesterday's close.\n\nA big gap = strong overnight sentiment shift driven by news or global cues. The gap badge appears when today's gap exceeds 0.5% in either direction.\n\n"Fill rate" (not shown here) = how often the gap gets closed same-day — a texture read on whether gaps tend to be sustained or quickly faded by the market.`,

  vixShort: `India VIX day-over-day and 5-day % change.\n\nVIX measures implied volatility — what options traders are pricing in as forward risk. It often moves *before* Nifty price reacts, making it the earliest warning signal on the dashboard.\n\nA sharp single-day spike (+10–15%) = sudden fear entering the market. A fast drop after a spike = fear unwinding. Small daily moves = business as usual.`,

  vixMid: `India VIX vs its own 20-day simple moving average.\n\nVIX persistently above its MA = a stretch of elevated, sustained nervousness — often coincides with choppy or range-bound Nifty price action.\nVIX below its MA and drifting down = a sustained calm/complacency regime.\n\nThe duration above or below matters more than any single day's level. Pairs naturally with ADX: both classify trending vs. choppy regime, but VIX does it from the implied side.`,

  vixLong: `India VIX percentile rank vs its full 6-year history.\n\nAbsolute VIX levels drift over market cycles, so percentile rank is far more meaningful than a raw number.\n\nLow percentile (<20th) = historically complacent — can precede surprise volatility events.\nHigh percentile (>80th) = historically fearful — often coincides with capitulation-type bottoms or major uncertainty.\nMid-range = normal regime, nothing notable.\n\nPairs directly with the realized-vol percentile in the adjacent column: together they give you a forward-looking (implied) vs. backward-looking (realized) comparison.`,

  breadthRegime: `Breadth Regime classifies whether participation in the current market move is broad or narrow, based on the trailing 5-day return of all four index segments.\n\n• Broad Rally — all four (Nifty50, Next50, Mid150, Small250) are up. Healthy, broad-based buying.\n• Broad Selloff — all four are down. Broad-based risk-off.\n• Narrow Rally — Nifty50 up, but Mid150 and Small250 down. Large-cap-only leadership; participation is thinning — a common late-cycle warning.\n• Narrow Selloff — Nifty50 down, but mid/small up. Unusual; often signals rotation out of large-caps into riskier names.\n• Rotation — mixed signals; money is moving between segments rather than making a clear directional move.`,

  relativeStrength: `Relative Strength ranks the four index segments by their trailing 1-month (21-day) return, from highest to lowest.\n\nThe ranking tells you which part of the market is leading:\n\n• Risk-On — Small250 and Mid150 hold the top 2 positions. Investors are reaching for risk in smaller companies — a sign of broader market confidence and healthy breadth.\n• Risk-Off — Nifty50 and Next50 hold the top 2. Capital rotating into large-cap safety; risk appetite declining.\n• Mixed — any other combination; no clear size-factor signal.`,

  segmentDrawdown: `How far each segment has fallen from its own 1-year rolling high (252 trading days).\n\n0% = the segment is currently at a 52-week high. Larger negative values = deeper correction from recent peak.\n\nThe orange "Smallcap drawdown disproportionate" flag appears when the Small250 drawdown is more than 2.5× the Nifty50 drawdown and greater than 5% absolute — a sign that risk appetite has specifically dried up at the smaller end of the market, even if large-caps are holding up.`,

  breadthRatioChart: `These two lines show how the Mid-Cap (Nifty Midcap 150) and Small-Cap (Nifty Smallcap 250) indices are performing relative to large-caps over the past year. Both are rebased to 100 at the start of the 1-year window so they share a comparable scale.\n\nThe large-cap leg is the Nifty 100 — the full large-cap universe (Nifty 50 + Nifty Next 50) — rather than the Nifty 50, which is only its top half. Using the wider index means the comparison is mid/small vs all large-caps, not mid/small vs mega-caps.\n\nRising line = that segment is outperforming large-caps — risk appetite expanding, breadth improving.\nFalling line = that segment is underperforming — rotation toward large-cap safety.\n\nWhen both lines fall while large-caps rise, that is the chart version of a Narrow Rally: the headline index propped up by a handful of the biggest names while the broader market weakens.\n\n(The Breadth Regime and Relative Strength readings above still use the Nifty 50 — there it is one rung of a size ladder (50 → Next 50 → Mid 150 → Small 250) that the Nifty 100 would overlap.)`,

  sectorTrends: `Trend labels use the same scoring as the summary card at the top of the page, so the two always agree for Nifty 50 and Nifty 500. Each horizon asks three yes/no questions — is the price above its moving average, is the trend still gaining strength, and has the price actually risen — and counts the yeses:\n\n• Short (weeks) — 20-day average, MACD, 1-month return\n• Mid (months) — 50-day average, +DI/−DI, 3-month return\n• Long (year+) — 200-day average, 200-day slope, 1-year return\n\n3/3 → Bullish · 2/3 → Mostly Bullish · 1/3 → Mostly Bearish · 0/3 → Bearish\n\nClick any badge to see which questions passed. ↘ means "losing steam" — the price is up, but the trend has stopped gaining strength.\n\nPerformance columns show annualised CAGR. Use the mode toggle to switch between absolute CAGR, excess vs Nifty 50, or excess vs Nifty 500 — positive = outperformed, negative = underperformed.\n\nCells showing — mean the index doesn't have enough history for that window (Healthcare, Consumer Durables, and Oil & Gas launched post-2021, so 5Y/10Y are unavailable).\n\nClick any column header to sort.`,
}

/** Click-to-open explainer popover. `children` is the trigger element. */
function InfoPopover({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <p className="text-xs leading-relaxed whitespace-pre-line">{text}</p>
      </PopoverContent>
    </Popover>
  )
}

/** One oscillator panel: a Section titled with the indicator name, its
 *  explainer in the header, and a short chart sharing the price-scale
 *  width of every other chart on the page. */
function OscillatorChart({
  caption,
  info,
  scaleKey,
  scaleWidth,
  onScaleWidth,
  formatter,
  ...chart
}: {
  caption: React.ReactNode
  info: string
  scaleKey: string
  scaleWidth: number | undefined
  onScaleWidth: (key: string, w: number) => void
  formatter: (v: number) => string
} & React.ComponentProps<typeof LwChart>) {
  return (
    <Section title={caption} action={<ChartInfo text={info} />} bodyClassName="p-2">
      <LwChart
        {...chart}
        priceScaleWidth={scaleWidth}
        onPriceScaleWidth={(w) => onScaleWidth(scaleKey, w)}
        defaultHeight={130}
        priceFormatter={formatter}
        hideControls
        maskInPrivacy={false}
      />
    </Section>
  )
}

function ChartInfo({ text }: { text: string }) {
  return (
    <InfoPopover text={text}>
      <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label="More info">
        <Info className="size-4 text-muted-foreground" />
      </Button>
    </InfoPopover>
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
      trendInfo: EXPLANATIONS.trendShort,
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
      trendInfo: EXPLANATIONS.trendMid,
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
      trendInfo: EXPLANATIONS.trendLong,
      detail1: `SMA200 slope: ${horizons.long.sma200_slope ?? '—'}`,
      detail2: `Drawdown from ATH: ${horizons.long.drawdown_from_ath_pct != null ? `${horizons.long.drawdown_from_ath_pct}%` : '—'}`,
      vol: `Vol pct: ${horizons.long.vol_percentile != null ? `${horizons.long.vol_percentile}%ile` : '—'}`,
      momentumInfo: EXPLANATIONS.tableLong,
      vixLabel: vixLongLabel(horizons.long.vix),
      vixInfo: EXPLANATIONS.vixLong,
    },
  ]

  return (
    <Section bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-card">
              <th className="h-8 w-28 px-2 text-left font-medium text-muted-foreground">Horizon</th>
              <th className="h-8 w-36 px-2 text-left font-medium text-muted-foreground">Trend</th>
              <th className="h-8 w-64 px-2 text-left font-medium text-muted-foreground">Momentum</th>
              <th className="h-8 w-36 px-2 text-left font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Volatility (realized)
                  <ChartInfo text={EXPLANATIONS.tableVol} />
                </span>
              </th>
              <th className="h-8 w-52 px-2 text-left font-medium text-muted-foreground">Volatility (implied)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.horizon} className="hover:bg-muted/50">
                <td className="px-2 py-1.5 font-medium">{r.horizon}</td>
                <td className="px-2 py-1.5">
                  <TrendChip horizon={r.trend} info={r.trendInfo} />
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span>{r.detail1} &nbsp;·&nbsp; {r.detail2}</span>
                    <ChartInfo text={r.momentumInfo} />
                  </span>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {r.vol}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <span>{r.vixLabel}</span>
                    <ChartInfo text={r.vixInfo} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ── Flags banner ──────────────────────────────────────────────────────────────

function FlagChip({ label, color, info }: { label: string; color: string; info: string }) {
  return (
    <InfoPopover text={info}>
      <Badge variant="outline" className={cn('cursor-pointer', COLOR_CLASS[color])}>
        {label}
      </Badge>
    </InfoPopover>
  )
}

function FlagsBanner({ flags }: { flags: SentimentFlags }) {
  const items: { label: string; color: string; show: boolean; info: string }[] = [
    // ── Regime ──
    {
      label: 'Above 200 DMA', color: 'green', show: flags.above_200dma === true,
      info: 'Price is above the 200-day moving average — the most widely watched long-term trend line. Being above it is generally considered a bullish regime: dips tend to find support near the 200 DMA, and trend-following strategies work better.\n\nA sustained move below the 200 DMA flips the regime to bearish.',
    },
    {
      label: 'Below 200 DMA', color: 'red', show: flags.above_200dma === false,
      info: 'Price is below the 200-day moving average — the classic bull/bear regime line. Being below it means the long-term trend is down or under pressure.\n\nRallies often stall at or near the 200 DMA from below. A reclaim (close back above) is a positive signal.',
    },

    // ── Cross signals ──
    {
      label: 'Golden Cross', color: 'yellow', show: flags.cross_state === 'golden',
      info: 'The 50-day moving average has crossed above the 200-day — a "Golden Cross." It confirms that medium-term momentum has turned bullish relative to the long-term trend.\n\nIt\'s a lagging signal (it confirms what price has already done), but it marks a regime shift that tends to persist. The last golden cross often precedes months of follow-through.',
    },
    {
      label: 'Death Cross', color: 'red', show: flags.cross_state === 'death',
      info: 'The 50-day moving average has crossed below the 200-day — a "Death Cross." It confirms that medium-term momentum has turned bearish relative to the long-term trend.\n\nLike the golden cross, it\'s lagging — price has already fallen significantly by the time it fires. But the regime it signals (sustained weakness, rallies failing) tends to persist.',
    },
    {
      label: `${flags.days_since_cross} days since cross`, color: 'gray',
      show: flags.cross_state !== 'none' && flags.days_since_cross != null,
      info: 'How many trading days have passed since the last SMA 50/200 crossover. Early days after a cross = the signal is fresh and the new regime is still establishing. Longer durations = the regime is entrenched and more reliable.',
    },
    {
      label: 'EMA 9 crossed above 20', color: 'green', show: flags.ema_cross === 'bullish',
      info: 'The 9-day EMA just crossed above the 20-day EMA in the last 3 sessions — a short-term bullish momentum shift.\n\nThis is a faster, earlier signal than the golden/death cross (which uses 50/200). It catches trend changes within weeks rather than months. The trade-off: more false signals in choppy markets (check ADX to filter).',
    },
    {
      label: 'EMA 9 crossed below 20', color: 'red', show: flags.ema_cross === 'bearish',
      info: 'The 9-day EMA just crossed below the 20-day EMA in the last 3 sessions — a short-term bearish momentum shift.\n\nEarly warning that the short-term trend is flipping. If ADX is also rising, the downward move has conviction. If ADX is low/flat, it may just be choppy noise.',
    },

    // ── Momentum ──
    {
      label: `RSI Overbought (${flags.rsi14?.toFixed(0)})`, color: 'orange',
      show: flags.rsi14 != null && flags.rsi14 > 70,
      info: 'RSI(14) is above 70 — the market has rallied hard enough that up-moves dominate recent trading sessions. This is "overbought" territory.\n\nIt doesn\'t mean a reversal is imminent — strong trends can stay overbought for weeks. But it means the easy upside is done; new longs carry more risk, and a pause or pullback becomes increasingly likely.',
    },
    {
      label: `RSI Oversold (${flags.rsi14?.toFixed(0)})`, color: 'blue',
      show: flags.rsi14 != null && flags.rsi14 < 30,
      info: 'RSI(14) is below 30 — the market has sold off hard enough that down-moves dominate recent sessions. This is "oversold" territory.\n\nOversold can persist in genuine bear markets, but in an uptrending regime (above 200 DMA) it often marks short-term capitulation — a point where selling exhaustion creates a bounce opportunity.',
    },
    {
      label: 'Momentum divergence', color: 'orange', show: flags.divergence,
      info: 'Price is making a new 20-day high (or low) but RSI is not confirming — it\'s printing a lower high (or higher low). This divergence means the move is losing internal momentum even as price pushes further.\n\nDivergence doesn\'t time reversals precisely, but it\'s a reliable warning that the current leg is running out of fuel. Watch for a follow-through reversal bar to confirm.',
    },
    {
      label: flags.streak > 0 ? `${flags.streak}-day winning streak` : `${Math.abs(flags.streak)}-day losing streak`,
      color: flags.streak > 0 ? 'green' : 'red',
      show: Math.abs(flags.streak) >= 3,
      info: 'The market has closed in the same direction for 3 or more consecutive days.\n\nStreaks of 3–4 days are common and often continue. Streaks of 5+ days are statistically unusual and tend to mean-revert — but in strong trends they can extend. The streak itself is context, not a signal: combine it with RSI and ADX to judge whether it\'s exhaustion or trend strength.',
    },

    // ── Volatility ──
    {
      label: 'Bollinger Squeeze — low vol', color: 'violet', show: flags.bb_squeeze,
      info: 'Bollinger Bandwidth (the gap between upper and lower bands) is at its lowest point in the last 60 trading days. The bands have "squeezed" together, meaning daily price swings have compressed to an unusually narrow range.\n\nSqueezes precede breakouts — volatility is cyclical, and a compression almost always resolves into an expansion. The squeeze doesn\'t tell you which direction; it tells you a big move is loading. Watch the band breach chips and EMA crosses for direction.',
    },
    {
      label: 'Price above upper band', color: 'orange',
      show: flags.bb_pct_b != null && flags.bb_pct_b > 1.0,
      info: 'Price has closed above the upper Bollinger Band — a 2-standard-deviation move above the 20-day average. Statistically, price should be inside the bands ~95% of the time.\n\nIn a squeeze-then-breakout context, this confirms the breakout direction is up. In isolation, it means the rally is stretched — not necessarily reversing, but extended beyond normal range.',
    },
    {
      label: 'Price below lower band', color: 'blue',
      show: flags.bb_pct_b != null && flags.bb_pct_b < 0.0,
      info: 'Price has closed below the lower Bollinger Band — a 2-standard-deviation move below the 20-day average.\n\nIn a downtrend, this can mark acceleration (panic selling). In an uptrend, it often marks the climax of a pullback — price tends to snap back toward the middle band. Context matters: check the 200 DMA regime chip to judge which interpretation applies.',
    },
    {
      label: `Strong trend (ADX ${flags.adx?.toFixed(0)})`, color: 'blue',
      show: flags.adx != null && flags.adx > 30,
      info: 'ADX is above 30 — a strong, sustained trend is in place (direction doesn\'t matter, ADX only measures strength). At this level, trend-following signals (MA crossovers, RSI direction) are more reliable, and mean-reversion strategies are more dangerous.\n\nADX above 40-50 is rare and usually marks the final acceleration phase of a trend — powerful but increasingly likely to exhaust.',
    },
    {
      label: `Choppy (ADX ${flags.adx?.toFixed(0)})`, color: 'gray',
      show: flags.adx != null && flags.adx < 15,
      info: 'ADX is below 15 — there is no meaningful trend in either direction. The market is range-bound and choppy. Moving average crossovers will whipsaw and produce false signals.\n\nThis is a "sit on hands" regime for trend followers. Range-bound strategies (buy support, sell resistance, fade extremes) work better here. Watch for ADX to rise above 20-25 to signal a new trend emerging.',
    },
    {
      label: `VIX Spike ${flags.vix_day_chg != null && flags.vix_day_chg > 0 ? '+' : ''}${flags.vix_day_chg?.toFixed(1)}%`,
      color: 'red',
      show: flags.vix_day_chg != null && flags.vix_day_chg > 10,
      info: 'India VIX jumped more than 10% in a single day — a sharp spike in implied volatility. Options traders are pricing in significantly more forward risk than yesterday.\n\nVIX spikes often precede or accompany sharp market drops. But VIX is mean-reverting: after a spike, it tends to decay back down over the following days/weeks, which historically coincides with market stabilization.',
    },
    {
      label: `VIX Crush ${flags.vix_day_chg?.toFixed(1)}%`,
      color: 'green',
      show: flags.vix_day_chg != null && flags.vix_day_chg < -10,
      info: 'India VIX dropped more than 10% in a single day — a sharp collapse in implied volatility. Fear is unwinding rapidly.\n\nThis often follows a resolution of uncertainty (event passing, support holding, policy clarity). It\'s generally positive for equities in the short term, but if VIX was already low, the crush can signal complacency.',
    },

    // ── Context ──
    {
      label: `Gap ${flags.gap_pct != null && flags.gap_pct > 0 ? '+' : ''}${flags.gap_pct?.toFixed(2)}% today`,
      color: flags.gap_pct != null && flags.gap_pct > 0 ? 'green' : 'red',
      show: flags.gap_pct != null && Math.abs(flags.gap_pct) >= 0.5,
      info: 'Today\'s open was more than 0.5% away from yesterday\'s close — a significant overnight gap driven by global cues, news, or sentiment shift.\n\nGap ups in uptrends and gap downs in downtrends tend to hold (continuation). Gaps against the trend tend to fill (price returns to yesterday\'s close) more often. The size of the gap matters: >1% gaps are harder to fill same-day.',
    },
    {
      label: `Underwater ${flags.underwater_days} days`, color: 'orange',
      show: flags.underwater_days > 20,
      info: 'The market has been below its all-time high for more than 20 trading days. The number shows how long the current drawdown has lasted — not how deep it is (that\'s in the table above).\n\nShort drawdowns (< 20 days) are normal pullbacks in uptrends. Extended drawdowns (40-60+ days) change market character: sentiment shifts, defensive sectors lead, and recovery rallies tend to fail at prior highs. Duration often matters more than depth.',
    },
  ]

  const active = items.filter((i) => i.show)
  if (active.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.map((item) => (
        <FlagChip key={item.label} label={item.label} color={item.color} info={item.info} />
      ))}
    </div>
  )
}

// ── Breadth table ─────────────────────────────────────────────────────────────

function regimeColor(label: string): string {
  if (label === 'Broad Rally') return 'green'
  if (label === 'Broad Selloff' || label === 'Narrow Selloff') return 'red'
  return 'yellow'
}

function MarketBreadthCard({ data }: { data: MarketBreadth }) {
  if (!data.regime || !data.relative_strength || !data.drawdowns) return null

  const dd = data.drawdowns
  const ddStr = [
    `Nifty50: ${dd.nifty50 != null ? dd.nifty50.toFixed(1) : '—'}%`,
    `Next50: ${dd.next50 != null ? dd.next50.toFixed(1) : '—'}%`,
    `Mid150: ${dd.mid150 != null ? dd.mid150.toFixed(1) : '—'}%`,
    `Small250: ${dd.small250 != null ? dd.small250.toFixed(1) : '—'}%`,
  ].join(' | ')

  const tone = data.relative_strength.tone
  const toneLabel = tone === 'risk_on' ? 'Risk-On' : tone === 'risk_off' ? 'Risk-Off' : 'Mixed'
  const toneColor = tone === 'risk_on' ? 'green' : 'yellow'

  return (
    <Section bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="sticky top-0 z-10 bg-card">
              <th className="h-8 w-28 px-2 text-left font-medium text-muted-foreground">Horizon</th>
              <th className="h-8 w-48 px-2 text-left font-medium text-muted-foreground">Signal</th>
              <th className="h-8 px-2 text-left font-medium text-muted-foreground">Reading</th>
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-muted/50">
              <td className="px-2 py-1.5 font-medium">Short-term</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Breadth Regime
                  <ChartInfo text={EXPLANATIONS.breadthRegime} />
                </span>
              </td>
              <td className="px-2 py-1.5">
                <Badge variant="outline" className={COLOR_CLASS[regimeColor(data.regime.label)]}>
                  {data.regime.label}
                </Badge>
              </td>
            </tr>
            <tr className="hover:bg-muted/50">
              <td className="px-2 py-1.5 font-medium">Mid-term</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Relative Strength
                  <ChartInfo text={EXPLANATIONS.relativeStrength} />
                </span>
              </td>
              <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-2">
                  <span className="text-muted-foreground">{data.relative_strength.order}</span>
                  <Badge variant="outline" className={COLOR_CLASS[toneColor]}>
                    {toneLabel}
                  </Badge>
                </span>
              </td>
            </tr>
            <tr className="hover:bg-muted/50">
              <td className="px-2 py-1.5 font-medium">Long-term</td>
              <td className="px-2 py-1.5 text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Segment Drawdown
                  <ChartInfo text={EXPLANATIONS.segmentDrawdown} />
                </span>
              </td>
              <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-2">
                  <span className="text-muted-foreground">{ddStr}</span>
                  {dd.stress_flag && (
                    <Badge variant="outline" className={COLOR_CLASS.orange}>
                      Smallcap drawdown disproportionate
                    </Badge>
                  )}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ── Overlay toggle config ─────────────────────────────────────────────────────

const OVERLAY_DEFS = [
  { key: 'ema9',      label: 'EMA 9',    color: '#e11d48', group: 'EMAs' },
  { key: 'ema20',     label: 'EMA 20',   color: '#fb923c', group: 'EMAs' },
  { key: 'sma50',     label: 'SMA 50',   color: '#22c55e', group: 'SMAs' },
  { key: 'sma100',    label: 'SMA 100',  color: '#3b82f6', group: 'SMAs' },
  { key: 'sma200',    label: 'SMA 200',  color: '#8b5cf6', group: 'SMAs' },
  { key: 'bb_upper',  label: 'BB Upper', color: '#94a3b8', group: 'Bollinger' },
  { key: 'bb_mid',    label: 'BB Mid',   color: '#64748b', group: 'Bollinger' },
  { key: 'bb_lower',  label: 'BB Lower', color: '#94a3b8', group: 'Bollinger' },
] as const

type OverlayKey = typeof OVERLAY_DEFS[number]['key']

// ── Sector Trends Table ───────────────────────────────────────────────────────

// Each horizon asks: is price above its average · is the trend still gaining
// strength · has price actually risen. Same three, windowed to the timescale.
const SIGNAL_LABELS: Record<string, string> = {
  ema20:       'Close > EMA(20)',
  macd:        'MACD histogram > 0',
  ret_1m:      '1-month return > 0',
  sma50:       'Close > SMA(50)',
  di:          '+DI > −DI (trend direction)',
  ret_3m:      '3-month return > 0',
  sma200:      'Close > SMA(200)',
  sma200_slope:'SMA(200) slope rising',
  ret_1y:      '1-year return > 0',
}

function TrendChip({ horizon, info }: { horizon: TrendCell; info?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge variant="outline" className={cn('cursor-pointer', COLOR_CLASS[trendColor(horizon.label)])}>
          {horizon.label}{horizon.fading ? ' ↘' : ''}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="space-y-1">
          {Object.entries(horizon.signals).map(([key, passed]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={cn('text-xs font-semibold', passed ? 'text-positive' : 'text-negative')}>{passed ? '✓' : '✗'}</span>
              <span className={cn('text-xs', !passed && 'text-muted-foreground')}>{SIGNAL_LABELS[key] ?? key}</span>
            </div>
          ))}
          {horizon.fading && (
            <p className="mt-0.5 text-xs text-warning">
              ↘ Losing steam — the price is up, but the trend has stopped gaining strength.
            </p>
          )}
          {info && <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground">{info}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

type SectorBench = 'vs_n50' | 'vs_n500'
type SortKey = 'cagr_2y' | 'cagr_5y' | 'cagr_10y' | 'vs_2y' | 'vs_5y' | 'vs_10y' | null

function cagrVal(row: SectorTrendRow, horizon: '2y' | '5y' | '10y'): number | null {
  return row.perf[`cagr_${horizon}`]
}

function vsVal(row: SectorTrendRow, bench: SectorBench, horizon: '2y' | '5y' | '10y'): number | null {
  return bench === 'vs_n50' ? row.perf[`vs_n50_${horizon}`] : row.perf[`vs_n500_${horizon}`]
}

function rowSortVal(row: SectorTrendRow, key: SortKey, bench: SectorBench): number {
  if (!key) return 0
  if (key === 'cagr_2y') return cagrVal(row, '2y') ?? -Infinity
  if (key === 'cagr_5y') return cagrVal(row, '5y') ?? -Infinity
  if (key === 'cagr_10y') return cagrVal(row, '10y') ?? -Infinity
  if (key === 'vs_2y') return vsVal(row, bench, '2y') ?? -Infinity
  if (key === 'vs_5y') return vsVal(row, bench, '5y') ?? -Infinity
  return vsVal(row, bench, '10y') ?? -Infinity
}

function SectorTrendsTable() {
  const { data } = useSectorTrends()
  const [bench, setBench] = usePersistentState<SectorBench>('sector-trends-bench', 'vs_n50')
  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortAsc, setSortAsc] = useState(false)

  if (!data || data.no_data || !data.rows || data.rows.length < 2) return null

  const PINNED = ['NIFTY BANK', 'NIFTY MIDCAP 150', 'NIFTY SMLCAP 250']
  const benchmarks = data.rows.filter(r => r.is_benchmark)
  const pinned = PINNED.map(sym => data.rows!.find(r => r.symbol === sym)).filter(Boolean) as typeof data.rows
  const sectors = data.rows.filter(r => !r.is_benchmark && !PINNED.includes(r.symbol))

  const sorted = sortKey
    ? [...sectors].sort((a, b) => {
        const av = rowSortVal(a, sortKey, bench)
        const bv = rowSortVal(b, sortKey, bench)
        return sortAsc ? av - bv : bv - av
      })
    : sectors

  const allRows = [...benchmarks, ...pinned, ...sorted]

  // Per-column min/max for heatmap (non-benchmark rows only), 3 CAGR cols + 3 vs cols
  const nonBench = [...pinned, ...sectors]
  const horizons = ['2y', '5y', '10y'] as const
  const cagrColVals = horizons.map(h => nonBench.map(r => cagrVal(r, h)).filter((v): v is number => v !== null))
  const vsColVals   = horizons.map(h => nonBench.map(r => vsVal(r, bench, h)).filter((v): v is number => v !== null))
  const cagrMin = cagrColVals.map(vs => vs.length ? Math.min(...vs) : null)
  const cagrMax = cagrColVals.map(vs => vs.length ? Math.max(...vs) : null)
  const vsMin   = vsColVals.map(vs => vs.length ? Math.min(...vs) : null)
  const vsMax   = vsColVals.map(vs => vs.length ? Math.max(...vs) : null)

  function handleSort(key: SortKey) {
    if (!key) return
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(false) }
  }

  function sortInd(key: SortKey) {
    if (sortKey !== key) return ' ↕'
    return sortAsc ? ' ↑' : ' ↓'
  }

  const benchLabel = bench === 'vs_n50' ? 'Nifty 50' : 'Nifty 500'

  const thStyle: React.CSSProperties = { textAlign: 'right', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }
  const tdRight: React.CSSProperties = { textAlign: 'right' }
  const groupDivider = '2px solid black'
  const subHd: React.CSSProperties = { textAlign: 'center', color: 'var(--mantine-color-dimmed)', fontWeight: 400, fontSize: 'var(--mantine-font-size-xs)' }

  return (
    <Panel p="md">
      <Group justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
        <Group gap={6} align="center">
          <Text fw={600}>Sector Trends</Text>
          {data.as_of && <Text size="xs" c="dimmed">as of {data.as_of}</Text>}
          <ChartInfo text={EXPLANATIONS.sectorTrends} />
        </Group>
        <SegmentedControl
          size="xs"
          value={bench}
          onChange={v => { setBench(v as SectorBench); setSortKey(null) }}
          data={[
            { value: 'vs_n50',  label: 'vs Nifty 50' },
            { value: 'vs_n500', label: 'vs Nifty 500' },
          ]}
        />
      </Group>
      <ScrollArea>
        <Table withTableBorder withColumnBorders fz="sm" style={{ minWidth: 820 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Index</Table.Th>
              <Table.Th style={{ textAlign: 'center' }}>Short</Table.Th>
              <Table.Th style={{ textAlign: 'center' }}>Mid</Table.Th>
              <Table.Th style={{ textAlign: 'center' }}>Long</Table.Th>
              <Table.Th style={{ ...thStyle, borderLeft: groupDivider }} onClick={() => handleSort('cagr_2y')}>2Y{sortInd('cagr_2y')}</Table.Th>
              <Table.Th style={thStyle} onClick={() => handleSort('cagr_5y')}>5Y{sortInd('cagr_5y')}</Table.Th>
              <Table.Th style={thStyle} onClick={() => handleSort('cagr_10y')}>10Y{sortInd('cagr_10y')}</Table.Th>
              <Table.Th style={{ ...thStyle, borderLeft: groupDivider }} onClick={() => handleSort('vs_2y')}>2Y{sortInd('vs_2y')}</Table.Th>
              <Table.Th style={thStyle} onClick={() => handleSort('vs_5y')}>5Y{sortInd('vs_5y')}</Table.Th>
              <Table.Th style={thStyle} onClick={() => handleSort('vs_10y')}>10Y{sortInd('vs_10y')}</Table.Th>
            </Table.Tr>
            <Table.Tr>
              <Table.Th colSpan={4} />
              <Table.Th colSpan={3} style={{ ...subHd, borderLeft: groupDivider }}>Annualised CAGR</Table.Th>
              <Table.Th colSpan={3} style={{ ...subHd, borderLeft: groupDivider }}>Excess CAGR vs {benchLabel} (pp)</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allRows.map((row, idx) => {
              const isBench = row.is_benchmark
              const sepAfterBench = !isBench && idx > 0 && allRows[idx - 1].is_benchmark
              return (
                <Table.Tr
                  key={row.symbol}
                  style={{
                    fontWeight: isBench ? 600 : undefined,
                    borderTop: sepAfterBench ? '2px solid var(--mantine-color-gray-3)' : undefined,
                  }}
                >
                  <Table.Td>
                    <Text size="sm" fw={isBench ? 600 : undefined}>{row.label}</Text>
                  </Table.Td>
                  {(['short', 'mid', 'long'] as const).map(h => (
                    <Table.Td key={h} style={{ textAlign: 'center' }}>
                      {row.trend ? (
                        <TrendChip horizon={row.trend[h]} />
                      ) : <Text c="dimmed" size="xs">—</Text>}
                    </Table.Td>
                  ))}
                  {horizons.map((h, ci) => {
                    const v = cagrVal(row, h)
                    const bg = isBench ? undefined : heatmapBg(v, cagrMin[ci], cagrMax[ci])
                    const fg = isBench ? undefined : heatmapTextColor(v, cagrMin[ci], cagrMax[ci])
                    return (
                      <Table.Td key={`cagr_${h}`} style={{ ...tdRight, background: bg, color: fg, ...(ci === 0 ? { borderLeft: groupDivider } : {}) }}>
                        {v != null ? pct(v, 1) : <Text c="dimmed" size="xs" component="span">—</Text>}
                      </Table.Td>
                    )
                  })}
                  {horizons.map((h, ci) => {
                    const v = vsVal(row, bench, h)
                    const bg = isBench ? undefined : heatmapBg(v, vsMin[ci], vsMax[ci])
                    const fg = isBench ? undefined : heatmapTextColor(v, vsMin[ci], vsMax[ci])
                    return (
                      <Table.Td key={`vs_${h}`} style={{ ...tdRight, background: bg, color: fg, ...(ci === 0 ? { borderLeft: groupDivider } : {}) }}>
                        {v != null ? pct(v, 1, true) : <Text c="dimmed" size="xs" component="span">—</Text>}
                      </Table.Td>
                    )
                  })}
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Panel>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MarketSentiment() {
  const refreshMutation = useRefreshIndicesMutation()
  const [index, setIndex] = usePersistentState<SentimentIndex>('market-sentiment-index', 'nifty50')
  const indexLabel = index === 'nifty50' ? 'Nifty 50' : 'Nifty 500'
  const { data: summary, isLoading: summaryLoading } = useSentimentSummary(index)
  const { data: breadthData } = useMarketBreadth()

  // Sync price scale widths across all charts so x-axes align perfectly.
  // Each chart reports its natural rendered width; we enforce the max on all.
  const [chartPriceScaleWidth, setChartPriceScaleWidth] = useState<number | undefined>(undefined)
  const reportedScaleWidths = useRef<Record<string, number>>({})
  const reportScaleWidth = useCallback((key: string, w: number) => {
    reportedScaleWidths.current[key] = w
    const max = Math.max(...Object.values(reportedScaleWidths.current))
    setChartPriceScaleWidth(prev => (max !== prev ? max : prev))
  }, [])

  const [rangeLabel, setRangeLabel] = usePersistentState<string>('market-sentiment-range', 'All')
  const [enabledOverlays, setEnabledOverlays] = usePersistentState<OverlayKey[]>(
    'market-sentiment-overlays',
    ['sma50', 'sma200'],
  )

  const rangeDays = RANGE_OPTIONS.find((r) => r.label === rangeLabel)?.days ?? 252
  const { data: series, isLoading: seriesLoading } = useSentimentSeries(0, index)

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
  }, [series, enabledOverlays, rangeDays])

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
  }, [series, rangeDays])

  function toggleOverlay(key: OverlayKey) {
    const next = enabledOverlays.includes(key)
      ? enabledOverlays.filter((k) => k !== key)
      : [...enabledOverlays, key]
    setEnabledOverlays(next)
  }

  if (summaryLoading) return <Loader size="sm" m="xl" />
  if (summary?.no_data) {
    return (
      <Alert>
        <AlertCircle className="size-4" />
        <AlertDescription>No {indexLabel} price history found. Run a portfolio sync (Kite → Sync) to load index data.</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Market Sentiment — ${indexLabel}`}
        meta={summary?.as_of && `As of ${summary.as_of} · Close: ${summary.close?.toLocaleString('en-IN')}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" variant="outline" size="sm" value={index} onValueChange={(v) => v && setIndex(v as SentimentIndex)}>
              <ToggleGroupItem value="nifty50">Nifty 50</ToggleGroupItem>
              <ToggleGroupItem value="nifty500">Nifty 500</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup type="single" variant="outline" size="sm" value={rangeLabel} onValueChange={(v) => v && setRangeLabel(v)}>
              {RANGE_OPTIONS.map((r) => <ToggleGroupItem key={r.label} value={r.label}>{r.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <Button
              size="xs"
              variant="ghost"
              disabled={refreshMutation.isPending}
              onClick={() => {
                refreshMutation.mutate(undefined, {
                  onSuccess: (data) => {
                    if (!data.ok) {
                      notify.error(data.error ?? 'Unknown error', 'Index refresh failed')
                    } else if (data.rows_added === 0) {
                      notify.info('No new candles — market may not have opened yet or data is already current.')
                    }
                  },
                  onError: (err) => {
                    notify.error(err instanceof Error ? err.message : 'Request failed', 'Index refresh failed')
                  },
                })
              }}
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      {summary?.horizons && <SentimentSummaryCard data={summary} />}
      {summary?.flags && <Section><FlagsBanner flags={summary.flags} /></Section>}

      {/* Market breadth table + ratio chart */}
      {breadthData && !breadthData.no_data && (
        <>
          <MarketBreadthCard data={breadthData} />
          <Section
            title={`Mid-Cap & Small-Cap vs Large-Cap (${breadthData.ratios!.benchmark}, rebased, 1Y)`}
            action={<ChartInfo text={EXPLANATIONS.breadthRatioChart} />}
            bodyClassName="p-2"
          >
            <LwChart
              seriesType="line"
              line={toNavPoints(breadthData.ratios!.mid150)}
              label={`Mid150 / ${breadthData.ratios!.benchmark}`}
              compareLines={[{ label: `Small250 / ${breadthData.ratios!.benchmark}`, color: '#f59e0b', data: toNavPoints(breadthData.ratios!.small250) }]}
              persistKey="market-sentiment-breadth-ratio"
              priceScaleWidth={chartPriceScaleWidth}
              onPriceScaleWidth={(w) => reportScaleWidth('breadth-ratio', w)}
              defaultHeight={180}
              priceFormatter={(p) => p.toFixed(1)}
              hideControls
            maskInPrivacy={false}
            />
          </Section>
        </>
      )}

      {/* Overlay legend */}
      <div className="flex flex-wrap items-center justify-end gap-3">
          {OVERLAY_DEFS.map((d) => {
            const enabled = enabledOverlays.includes(d.key)
            return (
              <div
                key={d.key}
                className="flex select-none items-center gap-1.5 cursor-pointer"
                onClick={() => toggleOverlay(d.key)}
              >
                <span
                  className="inline-block size-3 shrink-0 rounded-sm"
                  style={{ border: `2px solid ${d.color}`, backgroundColor: enabled ? d.color : 'transparent' }}
                />
                <span className={cn('text-xs', !enabled && 'text-muted-foreground')}>{d.label}</span>
              </div>
            )
          })}
      </div>

      {/* Price chart */}
      {seriesLoading ? (
        <Loader size="sm" />
      ) : filteredCandles.length > 0 ? (
        <Section
          bodyClassName="p-2"
          action={<ChartInfo text={EXPLANATIONS.price} />}
        >
          <LwChart
            seriesType="candlestick"
            candles={filteredCandles}
            compareLines={compareLines}
            persistKey="market-sentiment-price"
              priceScaleWidth={chartPriceScaleWidth}
              onPriceScaleWidth={(w) => reportScaleWidth('price', w)}
            defaultHeight={440}
            priceFormatter={numFormatter}
            showOhlcInfo
            hideMainTag
          maskInPrivacy={false}
          />
        </Section>
      ) : null}

      {/* Oscillator panels */}
      {oscData && (
        <>
          <h2 className="mt-2 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide">Oscillators</h2>

          <div className="grid gap-4 xl:grid-cols-2">
            <OscillatorChart
              caption={<>RSI — overbought &gt;70 / oversold &lt;30 ↓</>}
              info={EXPLANATIONS.rsi}
              scaleKey="rsi"
              scaleWidth={chartPriceScaleWidth}
              onScaleWidth={reportScaleWidth}
              formatter={oscFormatter}
              seriesType="line"
              line={oscData.rsi14}
              label="Daily RSI"
              compareLines={[{ label: 'Weekly RSI', color: '#f59e0b', data: oscData.rsi14_weekly }]}
              horizontalLines={[
                { value: 70, color: '#dc2626', label: 'Overbought' },
                { value: 30, color: '#2563eb', label: 'Oversold' },
              ]}
              persistKey="market-sentiment-rsi"
            />

            <OscillatorChart
              caption={<>MACD Histogram ↓</>}
              info={EXPLANATIONS.macd}
              scaleKey="macd"
              scaleWidth={chartPriceScaleWidth}
              onScaleWidth={reportScaleWidth}
              formatter={oscFormatter}
              seriesType="histogram"
              line={oscData.macd_hist}
              persistKey="market-sentiment-macd"
            />

            <OscillatorChart
              caption={<>ADX — trend strength (&gt;25 = trending) ↓</>}
              info={EXPLANATIONS.adx}
              scaleKey="adx"
              scaleWidth={chartPriceScaleWidth}
              onScaleWidth={reportScaleWidth}
              formatter={oscFormatter}
              seriesType="line"
              line={oscData.adx}
              persistKey="market-sentiment-adx"
            />
          </div>

          <h2 className="mt-2 text-center text-sm font-semibold text-muted-foreground uppercase tracking-wide">Volatility</h2>

          <div className="grid gap-4 xl:grid-cols-2">
            <OscillatorChart
              caption={<>ATR % ↓</>}
              info={EXPLANATIONS.atr}
              scaleKey="atr"
              scaleWidth={chartPriceScaleWidth}
              onScaleWidth={reportScaleWidth}
              formatter={oscFormatter}
              seriesType="line"
              line={oscData.atr_pct}
              persistKey="market-sentiment-atr"
            />

            <OscillatorChart
              caption={<>Realized Volatility (annualized %) ↓</>}
              info={EXPLANATIONS.vol}
              scaleKey="vol"
              scaleWidth={chartPriceScaleWidth}
              onScaleWidth={reportScaleWidth}
              formatter={oscFormatter}
              seriesType="line"
              line={oscData.rv20}
              label="RV 20"
              compareLines={[{ label: 'RV 60', color: '#8b5cf6', data: oscData.rv60 }]}
              persistKey="market-sentiment-vol"
            />
          </div>
        </>
      )}

      <Divider mt="xl" mb="xs" label={<Title order={2} c="black">Sector Trends</Title>} labelPosition="center" />
      <SectorTrendsTable />
    </div>
  )
}
