import { useEffect, useState } from 'react'
import { Box, Button, Group, Select, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { IconPlayerStop, IconRefresh, IconUpload } from '@tabler/icons-react'
import { useTradedInstruments, useNavHistory, uploadOhlc } from '../api/portfolio'
import { useNavTracked, useRemoveNavTrackedMutation, useSyncNavHistoryMutation, useSyncNavMutation } from '../api/mf'
import { LwChart } from '../components/LwChart'
import { SsePanel } from '../components/SsePanel'
import { useSse } from '../hooks/useSse'
import { usePersistentState } from '../hooks/usePersistentState'
import { apiUrl } from '../api/client'
import type { NavPoint as NavSeriesPoint } from '../types/portfolio'
import type { NavPoint } from '../types/charts'

function navPriceFormatter(price: number): string {
  const abs = Math.abs(price)
  const sign = price < 0 ? '-' : ''
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(2)}K`
  return `${sign}₹${abs.toFixed(2)}`
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
    <Button
      size="xs"
      color="red"
      variant="light"
      leftSection={<IconPlayerStop size={12} />}
      loading={halting}
      onClick={halt}
    >
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
    }
  }, [priceSyncSse.result])

  // OHLC fetch SSE — url built from form state
  const [fetchTicker, setFetchTicker] = useState('')
  const [fetchStart, setFetchStart] = useState('')
  const [fetchEnd, setFetchEnd] = useState('')
  const ohlcUrl = `${apiUrl('/api/v1/portfolio/fetch-ohlc/stream')}?ticker=${encodeURIComponent(fetchTicker)}&start_date=${fetchStart}&end_date=${fetchEnd}`
  const ohlcFetchSse = useSse(ohlcUrl)

  // Upload OHLC form
  const [uploadInstrId, setUploadInstrId] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadResult, setUploadResult] = useState<string | null>(null)

  const instrOptions = instruments?.map((i) => ({
    value: String(i.id),
    label: `${i.symbol ?? '?'}${i.isin ? ` (${i.isin})` : ''} — ${i.n_prices} rows`,
  })) ?? []

  // Convert nav series to chart format
  const valueData: NavPoint[] = (navSeries ?? []).map((p: NavSeriesPoint) => ({
    time: p.date,
    value: p.value,
  }))
  const investedData: NavPoint[] = (navSeries ?? []).map((p: NavSeriesPoint) => ({
    time: p.date,
    value: p.invested,
  }))
  const unitNavData: NavPoint[] = (navSeries ?? []).map((p: NavSeriesPoint) => ({
    time: p.date,
    value: p.unit_nav,
  }))

  async function handleUploadOhlc() {
    if (!uploadInstrId || !uploadFile) return
    try {
      const r = await uploadOhlc(Number(uploadInstrId), uploadFile)
      setUploadResult(JSON.stringify(r))
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  return (
    <Stack gap="lg">
      <Title order={3}>Portfolio NAV History</Title>

      {navLoading && <Text size="sm" c="dimmed">Loading NAV history…</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        {/* Portfolio value chart */}
        {valueData.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" mb={4}>Blue = market value · Orange = invested cost</Text>
            <LwChart
              seriesType="line"
              persistKey="portfolio_nav_h"
              defaultHeight={400}
              priceFormatter={navPriceFormatter}
              compareLines={[
                { data: valueData, label: 'Value', color: '#3b82f6' },
                { data: investedData, label: 'Invested', color: '#f59e0b' },
              ]}
            />
          </Box>
        )}

        {/* Unit NAV chart */}
        {unitNavData.length > 0 && (
          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              Unit NAV — performance excluding cash flows (base = 100)
            </Text>
            <LwChart
              seriesType="line"
              persistKey="portfolio_unit_nav_h"
              defaultHeight={300}
              priceFormatter={(v: number) => v.toFixed(2)}
              compareLines={[{ data: unitNavData, label: 'Unit NAV', color: '#10b981' }]}
              maskInPrivacy={false}
            />
          </Box>
        )}
      </SimpleGrid>

      {/* MF NAV sync */}
      <Box>
        <Text fw={600} mb="xs">Sync MF NAV</Text>
        <Group gap="xs" mb={4}>
          <Button
            size="xs"
            leftSection={<IconRefresh size={12} />}
            loading={syncHistoryMut.isPending}
            onClick={() =>
              syncHistoryMut.mutate(navSource, {
                onError: (e) => notifications.show({ color: 'red', message: String(e) }),
              })
            }
          >
            Sync NAV History ({navSource === 'finapi' ? 'FinAPI' : 'mfapi.in'})
          </Button>
          <SegmentedControl
            size="xs"
            value={navSource}
            onChange={(v) => setNavSource(v as 'mfapi' | 'finapi')}
            data={[
              { label: 'mfapi.in', value: 'mfapi' },
              { label: 'FinAPI', value: 'finapi' },
            ]}
          />
          <Button
            size="xs"
            variant="default"
            loading={syncNavMut.isPending}
            onClick={() =>
              syncNavMut.mutate(undefined, {
                onError: (e) => notifications.show({ color: 'red', message: String(e) }),
              })
            }
          >
            Latest-only (AMFI fallback)
          </Button>
        </Group>
        {navSource === 'finapi' && (
          <Text size="xs" c="dimmed" mb="xs">Free tier — 30 req/min, no API key needed</Text>
        )}
        {syncHistoryMut.data && !syncHistoryMut.data.error && (
          <Text size="xs">
            History: {String(syncHistoryMut.data.funds_synced ?? '?')} funds synced ·{' '}
            {String(syncHistoryMut.data.rows_added ?? '?')} rows added ·{' '}
            latest {String(syncHistoryMut.data.latest_nav_date ?? '—')}
            {Array.isArray(syncHistoryMut.data.failed) && (syncHistoryMut.data.failed as unknown[]).length > 0 && (
              <Text span size="xs" c="orange"> · {(syncHistoryMut.data.failed as unknown[]).length} failed</Text>
            )}
          </Text>
        )}
        {syncHistoryMut.data?.error && <Text size="xs" c="red">{syncHistoryMut.data.error}</Text>}
        {syncNavMut.data && !syncNavMut.data.error && (
          <Text size="xs">
            AMFI: {String(syncNavMut.data.updated ?? '?')} updated · latest {String(syncNavMut.data.latest_nav_date ?? '—')}
            {Array.isArray(syncNavMut.data.missing) && (syncNavMut.data.missing as unknown[]).length > 0 && (
              <Text span size="xs" c="orange"> · {(syncNavMut.data.missing as unknown[]).length} missing</Text>
            )}
          </Text>
        )}
        {syncNavMut.data?.error && <Text size="xs" c="red">{syncNavMut.data.error}</Text>}
      </Box>

      {/* Price sync SSE */}
      <Box>
        <Group mb="xs">
          <Text fw={600}>Sync Price History (Kite)</Text>
          <Button
            size="xs"
            leftSection={<IconRefresh size={12} />}
            onClick={priceSyncSse.start}
            loading={priceSyncSse.status === 'running'}
            disabled={priceSyncSse.status === 'running'}
          >
            Sync now
          </Button>
          {priceSyncSse.status === 'running' && (
            <HaltSyncButton />
          )}
        </Group>
        <SsePanel sse={priceSyncSse} heading="Syncing price history…" doneHeading="Synced" errorHeading="Sync failed" maw={560} />
      </Box>

      {/* OHLC fetch SSE */}
      <Box>
        <Text fw={600} mb="xs">Fetch OHLC from Kite</Text>
        <Group align="flex-end" wrap="wrap">
          <TextInput label="Ticker (e.g. NSE:NIFTY50)" value={fetchTicker} onChange={(e) => setFetchTicker(e.currentTarget.value)} size="xs" w={200} />
          <TextInput label="Start date" type="date" value={fetchStart} onChange={(e) => setFetchStart(e.currentTarget.value)} size="xs" w={140} />
          <TextInput label="End date (optional)" type="date" value={fetchEnd} onChange={(e) => setFetchEnd(e.currentTarget.value)} size="xs" w={140} />
          <Button
            size="xs"
            onClick={ohlcFetchSse.start}
            loading={ohlcFetchSse.status === 'running'}
            disabled={!fetchTicker || !fetchStart || ohlcFetchSse.status === 'running'}
          >
            Fetch
          </Button>
        </Group>
        <SsePanel sse={ohlcFetchSse} heading="Fetching OHLC data…" />
      </Box>

      {/* Manual OHLC upload */}
      <Box>
        <Text fw={600} mb="xs">Upload OHLC CSV</Text>
        <Group align="flex-end">
          <Select
            label="Instrument"
            placeholder="Select…"
            data={instrOptions}
            value={uploadInstrId}
            onChange={setUploadInstrId}
            searchable
            size="xs"
            w={280}
          />
          <Box>
            <Text size="xs" mb={4}>CSV file</Text>
            <input
              type="file"
              accept=".csv"
              style={{ fontSize: '0.8rem' }}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </Box>
          <Button
            size="xs"
            leftSection={<IconUpload size={12} />}
            disabled={!uploadInstrId || !uploadFile}
            onClick={handleUploadOhlc}
          >
            Upload
          </Button>
        </Group>
        {uploadResult && <Text size="xs" c="dimmed" mt="xs">{uploadResult}</Text>}
      </Box>

      {/* Tracked funds */}
      {tracked && tracked.length > 0 && (
        <Box>
          <Text fw={600} mb="xs">Manually Tracked NAV Funds</Text>
          <Stack gap={4}>
            {tracked.map((t) => (
              <Group key={t.instrument_id} justify="space-between">
                <Text size="xs">{t.name ?? '—'} <Text span size="xs" c="dimmed">({t.isin ?? '—'})</Text></Text>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  onClick={() => removeTrackedMut.mutate(t.instrument_id)}
                >
                  Remove
                </Button>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}
