import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, FlaskConical, LogIn, RefreshCw, Trash2, X } from 'lucide-react'
import {
  useKiteStatus,
  useSaveKiteConfigMutation,
  useDeleteKiteConfigMutation,
  useKiteSyncMutation,
} from '../api/kite'
import { useAppStatus } from '../api/status'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { notify } from '@/lib/notify'

export function Kite() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: status, refetch } = useKiteStatus()
  const saveMut = useSaveKiteConfigMutation()
  const deleteMut = useDeleteKiteConfigMutation()
  const syncMut = useKiteSyncMutation()
  const { data: appStatus } = useAppStatus()
  const demoMode = appStatus?.demo_mode ?? false

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    const login = searchParams.get('login')
    const error = searchParams.get('error')
    if (login === 'success') {
      notify.success('Kite login successful.')
      setSearchParams({})
      refetch()
    } else if (error) {
      notify.error(`Login failed: ${error}`)
      setSearchParams({})
    }
  }, [searchParams, setSearchParams, refetch])

  async function handleSave() {
    const key = apiKey || status?.api_key
    if (!key || !apiSecret) return
    try {
      await saveMut.mutateAsync({ api_key: key, api_secret: apiSecret })
      setApiSecret('')
      notify.success('Config saved.')
    } catch (e) {
      notify.error(String(e))
    }
  }

  async function handleDelete() {
    try {
      await deleteMut.mutateAsync()
      setApiKey('')
      notify.success('Config deleted.')
    } catch (e) {
      notify.error(String(e))
    }
  }

  function handleSync() {
    syncMut.mutate()
  }

  if (demoMode) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PageHeader title="Kite Integration" />
        <Alert>
          <FlaskConical className="size-4" />
          <AlertTitle>Demo mode</AlertTitle>
          <AlertDescription>Kite integration is disabled in demo mode. The app is running with sample data — no live prices or sync available.</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title="Kite Integration" />

      {status && (
        <Section title="Status">
          <div className="flex items-center gap-2">
            <Badge variant={status.configured ? 'default' : 'secondary'}>
              {status.configured ? 'Configured' : 'Not configured'}
            </Badge>
            {status.configured && (
              <Badge className={status.token_valid ? 'bg-positive/10 text-positive' : undefined} variant={status.token_valid ? 'outline' : 'destructive'}>
                Token {status.token_valid ? 'valid' : 'expired'}
              </Badge>
            )}
          </div>
          {status.last_sync && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last sync: {new Date(status.last_sync.synced_at).toLocaleString('en-IN')}
              {' '}({status.last_sync.status})
              {status.last_sync.error_message && ` — ${status.last_sync.error_message}`}
            </p>
          )}
        </Section>
      )}

      <Section title="API Credentials">
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="kite-api-key">API Key</Label>
            <Input id="kite-api-key" value={apiKey || status?.api_key || ''} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kite-api-secret">API Secret</Label>
            <div className="relative">
              <Input
                id="kite-api-secret"
                type={showSecret ? 'text' : 'password'}
                placeholder={status?.configured ? '(leave blank to keep current)' : ''}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="xs" disabled={saveMut.isPending} onClick={handleSave}>
              Save
            </Button>
            {status?.configured && (
              <ConfirmActionButton
                size="xs"
                variant="outline"
                confirmTitle="Delete Kite configuration?"
                confirmDescription="Saved Kite configuration will be removed."
                onConfirm={handleDelete}
              >
                <Trash2 className="size-3" />
                Delete config
              </ConfirmActionButton>
            )}
          </div>
        </div>
      </Section>

      {status?.configured && (
        <Section title="Authentication">
          {status.token_valid ? (
            <Alert className="border-positive/40 bg-positive/10">
              <AlertDescription>
                Token valid until {status.token_expiry ? new Date(status.token_expiry).toLocaleString('en-IN') : '—'}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-warning/40 bg-warning/10">
              <AlertDescription className="gap-2">
                Token expired or not set. Login with Kite to refresh.
                <Button size="xs" asChild>
                  <a href={status.login_url ?? undefined}>
                    <LogIn className="size-3" />
                    Login with Kite
                  </a>
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </Section>
      )}

      {status?.configured && status.token_valid && (
        <Section title="Sync Holdings">
          <Button size="sm" disabled={syncMut.isPending} onClick={handleSync}>
            <RefreshCw className="size-3.5" />
            Sync now
          </Button>

          {(syncMut.isSuccess || syncMut.isError) && (
            <Section
              className="mt-2"
              title={syncMut.isSuccess && syncMut.data.status === 'SUCCESS' ? 'Sync complete' : 'Sync failed'}
              action={
                <Button variant="ghost" size="icon-xs" onClick={() => syncMut.reset()} aria-label="Close">
                  <X className="size-3.5" />
                </Button>
              }
            >
              {syncMut.isSuccess && syncMut.data.status === 'SUCCESS' && (
                <Alert className="border-positive/40 bg-positive/10">
                  <AlertDescription>
                    Synced {syncMut.data.holdings_count} holdings, {syncMut.data.positions_count} positions.
                  </AlertDescription>
                </Alert>
              )}

              {syncMut.isSuccess && syncMut.data.status !== 'SUCCESS' && (
                <div className="flex flex-col gap-2">
                  <Alert variant="destructive">
                    <AlertDescription>{syncMut.data.error_message ?? syncMut.data.status}</AlertDescription>
                  </Alert>
                  {syncMut.data.discrepancies && syncMut.data.discrepancies.length > 0 && (
                    <Table className="text-xs">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Symbol</TableHead>
                          <TableHead>ISIN</TableHead>
                          <TableHead>Issue</TableHead>
                          <TableHead className="text-right">Kite qty</TableHead>
                          <TableHead className="text-right">Local qty</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {syncMut.data.discrepancies.map((d) => (
                          <TableRow key={d.isin}>
                            <TableCell className="font-medium">{d.symbol}</TableCell>
                            <TableCell className="text-muted-foreground">{d.isin}</TableCell>
                            <TableCell>
                              <Badge variant={d.kind === 'new_on_kite' ? 'default' : d.kind === 'missing_from_kite' ? 'outline' : 'destructive'}>
                                {d.kind === 'new_on_kite' ? 'New on Kite' : d.kind === 'missing_from_kite' ? 'Missing from Kite' : 'Qty mismatch'}
                              </Badge>
                            </TableCell>
                            <TableCell data-numeric className="text-right">{d.kite_qty ?? '—'}</TableCell>
                            <TableCell data-numeric className="text-right">{d.local_qty ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}

              {syncMut.isError && (
                <Alert variant="destructive">
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{String(syncMut.error)}</AlertDescription>
                </Alert>
              )}
            </Section>
          )}
        </Section>
      )}
    </div>
  )
}
