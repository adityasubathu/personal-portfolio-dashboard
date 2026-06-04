import { useState } from 'react'
import { Box, Button, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconUpload } from '@tabler/icons-react'
import { useTradedInstruments, useNavHistory, uploadOhlc } from '../api/portfolio'
import { useNavTracked, useRemoveNavTrackedMutation } from '../api/mf'
import { LwChart } from '../components/LwChart'
import { SsePanel } from '../components/SsePanel'
import { useSse } from '../hooks/useSse'
import { apiUrl } from '../api/client'
import type { NavPoint } from '../types/portfolio'

export function NavHistory() {
  const { data: navSeries, isLoading: navLoading } = useNavHistory()
  const { data: instruments } = useTradedInstruments()
  const { data: tracked } = useNavTracked()
  const removeTrackedMut = useRemoveNavTrackedMutation()

  const priceSyncSse = useSse(`${apiUrl('/api/v1/portfolio/sync-price-history/stream')}`)

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
  const valueData: NavPoint[] = (navSeries ?? []).map((p: { date: string; value: number }) => ({
    time: p.date,
    value: p.value,
  }))
  const investedData: NavPoint[] = (navSeries ?? []).map((p: { date: string; invested: number }) => ({
    time: p.date,
    value: p.invested,
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

      {/* Portfolio value chart */}
      {navLoading && <Text size="sm" c="dimmed">Loading NAV history…</Text>}
      {valueData.length > 0 && (
        <Box>
          <Text size="xs" c="dimmed" mb={4}>Blue = market value · Orange = invested cost</Text>
          <LwChart
            seriesType="area"
            line={valueData}
            persistKey="portfolio_nav_h"
            defaultHeight={400}
            compareLines={[
              { data: valueData, label: 'Value', color: '#3b82f6' },
              { data: investedData, label: 'Invested', color: '#f59e0b' },
            ]}
          />
        </Box>
      )}

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
        </Group>
        <SsePanel sse={priceSyncSse} heading="Syncing price history…" />
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
