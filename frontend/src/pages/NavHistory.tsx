import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Square, RefreshCw, Upload } from 'lucide-react'
import { useTradedInstruments, useNavHistory, uploadOhlc } from '../api/portfolio'
import { useNavTracked, useRemoveNavTrackedMutation, useSyncNavHistoryMutation, useSyncNavMutation } from '../api/mf'
import { LwChart } from '../components/LwChart'
import { SsePanel } from '../components/SsePanel'
import { useSse } from '../hooks/useSse'
import { usePersistentState } from '../hooks/usePersistentState'
import { apiUrl } from '../api/client'
import type { NavPoint as NavSeriesPoint } from '../types/portfolio'
import type { NavPoint } from '../types/charts'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notify } from '@/lib/notify'

function navPriceFormatter(price: number): string {
  const abs = Math.abs(price)
  const sign = price < 0 ? '-' : ''
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(2)}K`
  return `${sign}₹${abs.toFixed(2)}`
}

function unitNavFormatter(value: number): string {
  return value.toFixed(2)
}

function HaltSyncButton() {
  const [halting, setHalting] = useState(false)

  async function halt() {
    setHalting(true)
    try {
      await fetch(apiUrl('/api/v1/portfolio/sync-price-history/cancel'), { method: 'POST' })
    } catch {
      // best-effort — the SSE stream will surface the halt message
    } finally {
      setHalting(false)
    }
  }

  return (
    <Button size="xs" variant="destructive" disabled={halting} onClick={halt}>
      <Square className="size-3" />
      Halt
    </Button>
  )
}

export function NavHistory() {
  const { data: navSeries, isLoading: navLoading } = useNavHistory()
  const { data: instruments } = useTradedInstruments()
  const { data: tracked } = useNavTracked()
  const removeTrackedMut = useRemoveNavTrackedMutation()
  const syncHistoryMut = useSyncNavHistoryMutation()
  const syncNavMut = useSyncNavMutation()
  const [navSource, setNavSource] = usePersistentState<'mfapi' | 'finapi'>('navSource', 'mfapi')

  const qc = useQueryClient()
  const priceSyncSse = useSse(`${apiUrl('/api/v1/portfolio/sync-price-history/stream')}`)

  useEffect(() => {
    if (priceSyncSse.result) {
      qc.invalidateQueries({ queryKey: ['market-sentiment'] })
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    }
  }, [priceSyncSse.result, qc])

  const [fetchTicker, setFetchTicker] = useState('')
  const [fetchStart, setFetchStart] = useState('')
  const [fetchEnd, setFetchEnd] = useState('')
  const ohlcUrl = `${apiUrl('/api/v1/portfolio/fetch-ohlc/stream')}?ticker=${encodeURIComponent(fetchTicker)}&start_date=${fetchStart}&end_date=${fetchEnd}`
  const ohlcFetchSse = useSse(ohlcUrl)

  useEffect(() => {
    if (ohlcFetchSse.result) {
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    }
  }, [ohlcFetchSse.result, qc])

  const [uploadInstrId, setUploadInstrId] = useState<string>('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<string | null>(null)

  const instrOptions = useMemo(
    () =>
      instruments?.map((i) => ({
        value: String(i.id),
        label: `${i.symbol ?? '?'}${i.isin ? ` (${i.isin})` : ''} — ${i.n_prices} rows`,
      })) ?? [],
    [instruments],
  )

  const valueData = useMemo<NavPoint[]>(
    () => (navSeries ?? []).map((p: NavSeriesPoint) => ({ time: p.date, value: p.value })),
    [navSeries],
  )
  const investedData = useMemo<NavPoint[]>(
    () => (navSeries ?? []).map((p: NavSeriesPoint) => ({ time: p.date, value: p.invested })),
    [navSeries],
  )
  const unitNavData = useMemo<NavPoint[]>(
    () =>
      (navSeries ?? [])
        .filter((p: NavSeriesPoint) => p.unit_nav != null)
        .map((p: NavSeriesPoint) => ({ time: p.date, value: p.unit_nav as number })),
    [navSeries],
  )

  // Stable identities — LwChart's compare-series effect keys off these, and a
  // fresh array on every render tears down and re-adds ~4800 points of series.
  const portfolioCompareLines = useMemo(
    () => [
      { data: valueData, label: 'Value', color: '#3b82f6' },
      { data: investedData, label: 'Invested', color: '#f59e0b' },
    ],
    [valueData, investedData],
  )
  const unitNavCompareLines = useMemo(
    () => [{ data: unitNavData, label: 'Unit NAV', color: '#10b981' }],
    [unitNavData],
  )

  async function handleUploadOhlc() {
    if (!uploadInstrId || !uploadFile) return
    try {
      const r = await uploadOhlc(Number(uploadInstrId), uploadFile)
      setUploadResult(JSON.stringify(r))
      qc.invalidateQueries({ queryKey: ['portfolio'] })
    } catch (e) {
      notify.error(String(e))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Portfolio NAV History" />

      {navLoading && <p className="text-sm text-muted-foreground">Loading NAV history…</p>}

      <div className="grid gap-4 grid-cols-2">
        {valueData.length > 0 && (
          <Section title="Portfolio value" description="Blue = market value · Orange = invested cost" bodyClassName="p-2">
            <LwChart
              seriesType="line"
              persistKey="portfolio_nav_h"
              defaultHeight={400}
              priceFormatter={navPriceFormatter}
              compareLines={portfolioCompareLines}
            />
          </Section>
        )}

        {unitNavData.length > 0 && (
          <Section title="Unit NAV" description="Performance excluding cash flows (base = 100 on 5 Nov 2022)" bodyClassName="p-2">
            <LwChart
              seriesType="line"
              persistKey="portfolio_unit_nav_h"
              defaultHeight={300}
              priceFormatter={unitNavFormatter}
              compareLines={unitNavCompareLines}
              maskInPrivacy={false}
            />
          </Section>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Section title="Sync MF NAV">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              disabled={syncHistoryMut.isPending}
              onClick={() =>
                syncHistoryMut.mutate(navSource, {
                  onError: (e) => notify.error(String(e)),
                })
              }
            >
              <RefreshCw className="size-3.5" />
              Sync NAV History ({navSource === 'finapi' ? 'FinAPI' : 'mfapi.in'})
            </Button>
            <ToggleGroup type="single" variant="outline" size="sm" value={navSource} onValueChange={(v) => v && setNavSource(v as 'mfapi' | 'finapi')}>
              <ToggleGroupItem value="mfapi">mfapi.in</ToggleGroupItem>
              <ToggleGroupItem value="finapi">FinAPI</ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="xs"
              variant="outline"
              disabled={syncNavMut.isPending}
              onClick={() =>
                syncNavMut.mutate(undefined, {
                  onError: (e) => notify.error(String(e)),
                })
              }
            >
              Latest-only (AMFI fallback)
            </Button>
          </div>
          {navSource === 'finapi' && (
            <p className="mt-1 text-xs text-muted-foreground">Free tier — 30 req/min, no API key needed</p>
          )}
          {syncHistoryMut.data && !syncHistoryMut.data.error && (
            <p className="mt-1 text-xs">
              History: {String(syncHistoryMut.data.funds_synced ?? '?')} funds synced ·{' '}
              {String(syncHistoryMut.data.rows_added ?? '?')} rows added ·{' '}
              latest {String(syncHistoryMut.data.latest_nav_date ?? '—')}
              {Array.isArray(syncHistoryMut.data.failed) && (syncHistoryMut.data.failed as unknown[]).length > 0 && (
                <span className="text-warning"> · {(syncHistoryMut.data.failed as unknown[]).length} failed</span>
              )}
            </p>
          )}
          {syncHistoryMut.data?.error && <p className="mt-1 text-xs text-negative">{syncHistoryMut.data.error}</p>}
          {syncNavMut.data && !syncNavMut.data.error && (
            <p className="mt-1 text-xs">
              AMFI: {String(syncNavMut.data.updated ?? '?')} updated · latest {String(syncNavMut.data.latest_nav_date ?? '—')}
              {Array.isArray(syncNavMut.data.missing) && (syncNavMut.data.missing as unknown[]).length > 0 && (
                <span className="text-warning"> · {(syncNavMut.data.missing as unknown[]).length} missing</span>
              )}
            </p>
          )}
          {syncNavMut.data?.error && <p className="mt-1 text-xs text-negative">{syncNavMut.data.error}</p>}
        </Section>

        <Section
          title="Sync Price History (Kite)"
          action={
            <div className="flex items-center gap-2">
              <Button size="xs" onClick={priceSyncSse.start} disabled={priceSyncSse.status === 'running'}>
                <RefreshCw className="size-3.5" />
                Sync now
              </Button>
              {priceSyncSse.status === 'running' && <HaltSyncButton />}
            </div>
          }
        >
          <SsePanel sse={priceSyncSse} heading="Syncing price history…" doneHeading="Synced" errorHeading="Sync failed" className="max-w-xl" />
        </Section>

        <Section title="Fetch OHLC from Kite">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-52 space-y-1">
              <Label htmlFor="ohlc-ticker">Ticker (e.g. NSE:NIFTY50)</Label>
              <Input id="ohlc-ticker" value={fetchTicker} onChange={(e) => setFetchTicker(e.target.value)} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="ohlc-start">Start date</Label>
              <Input id="ohlc-start" type="date" value={fetchStart} onChange={(e) => setFetchStart(e.target.value)} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="ohlc-end">End date (optional)</Label>
              <Input id="ohlc-end" type="date" value={fetchEnd} onChange={(e) => setFetchEnd(e.target.value)} />
            </div>
            <Button size="xs" onClick={ohlcFetchSse.start} disabled={!fetchTicker || !fetchStart || ohlcFetchSse.status === 'running'}>
              Fetch
            </Button>
          </div>
          <SsePanel sse={ohlcFetchSse} heading="Fetching OHLC data…" />
        </Section>

        <Section title="Upload OHLC CSV">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-72 space-y-1">
              <Label>Instrument</Label>
              <Select value={uploadInstrId} onValueChange={setUploadInstrId}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {instrOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>CSV file</Label>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium"
              />
            </div>
            <Button size="xs" disabled={!uploadInstrId || !uploadFile} onClick={handleUploadOhlc}>
              <Upload className="size-3.5" />
              Upload
            </Button>
          </div>
          {uploadResult && <p className="mt-2 text-xs text-muted-foreground">{uploadResult}</p>}
        </Section>

        {tracked && tracked.length > 0 && (
          <Section title="Manually Tracked NAV Funds">
            <div className="space-y-1">
              {tracked.map((t) => (
                <div key={t.instrument_id} className="flex items-center justify-between">
                  <p className="text-xs">
                    {t.name ?? '—'} <span className="text-muted-foreground">({t.isin ?? '—'})</span>
                  </p>
                  <Button size="xs" variant="ghost" className="text-negative" onClick={() => removeTrackedMut.mutate(t.instrument_id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
