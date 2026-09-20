import { useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'
import { useImports, useImportMutation, useRollbackMutation, useSplitCreditMutation } from '../api/trades'
import { useTradedInstruments } from '../api/portfolio'
import type { ImportResponse } from '../types/trades'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { notify } from '@/lib/notify'

function ImportResult({ result }: { result: ImportResponse }) {
  return (
    <div className="mt-3 space-y-2">
      {result.results.map((r) => (
        <Alert key={r.batch_id} className={r.errors.length ? 'border-warning/40 bg-warning/10' : 'border-positive/40 bg-positive/10'}>
          <AlertTitle>{r.filename}</AlertTitle>
          <AlertDescription>
            <p>
              {r.success_count}/{r.row_count} rows imported
              {r.errors.length > 0 && ` · ${r.errors.length} error(s)`}
            </p>
            {r.errors.map((e, i) => (
              <p key={i} className="text-negative">Row {e.row}: {e.message}</p>
            ))}
          </AlertDescription>
        </Alert>
      ))}
      {result.violations.length > 0 && (
        <Alert className="border-warning/40 bg-warning/10">
          <AlertTitle>Holding violations</AlertTitle>
          <AlertDescription>
            {result.violations.map((v, i) => (
              <p key={i}>{v.tradingsymbol}: sold {v.total_sell} vs bought {v.total_buy} (net {v.net})</p>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export function Import() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const importMut = useImportMutation()
  const rollbackMut = useRollbackMutation()
  const splitMut = useSplitCreditMutation()
  const { data: imports } = useImports()
  const { data: instruments } = useTradedInstruments()

  const [splitInstrId, setSplitInstrId] = useState<string>('')
  const [splitDate, setSplitDate] = useState('')
  const [splitQty, setSplitQty] = useState('')
  const [splitResult, setSplitResult] = useState<string | null>(null)

  async function handleUpload() {
    const files = fileRef.current?.files
    if (!files?.length) return
    try {
      const r = await importMut.mutateAsync(Array.from(files))
      setImportResult(r)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) {
      notify.error(String(e))
    }
  }

  async function handleRollback(batchId: string) {
    try {
      await rollbackMut.mutateAsync(batchId)
      notify.success('Batch rolled back.')
    } catch (e) {
      notify.error(String(e))
    }
  }

  async function handleSplitCredit() {
    if (!splitInstrId || !splitDate || !splitQty) return
    try {
      const r = await splitMut.mutateAsync({
        instrument_id: Number(splitInstrId),
        trade_date: splitDate,
        quantity: Number(splitQty),
      })
      setSplitResult(
        r.violations.length
          ? `Done. ${r.violations.length} violation(s) detected.`
          : 'Split credit recorded.',
      )
    } catch (e) {
      setSplitResult(`Error: ${e}`)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Import Trades" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Upload CSV">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              multiple
              className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
            <Button size="xs" disabled={importMut.isPending} onClick={handleUpload}>
              <Upload className="size-3.5" />
              Import
            </Button>
          </div>
          {importResult && <ImportResult result={importResult} />}
        </Section>

        <Section title="Record Split / Bonus Credit">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-44 space-y-1">
              <Label>Instrument</Label>
              <Select value={splitInstrId} onValueChange={setSplitInstrId}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue placeholder="— select —" />
                </SelectTrigger>
                <SelectContent>
                  {instruments?.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.symbol} {i.isin ? `(${i.isin})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="split-date">Date</Label>
              <Input id="split-date" type="date" value={splitDate} onChange={(e) => setSplitDate(e.target.value)} />
            </div>
            <div className="w-28 space-y-1">
              <Label htmlFor="split-qty">Quantity</Label>
              <Input id="split-qty" type="number" min={0} value={splitQty} onChange={(e) => setSplitQty(e.target.value)} />
            </div>
            <Button size="xs" disabled={splitMut.isPending} onClick={handleSplitCredit}>
              Record
            </Button>
          </div>
          {splitResult && <p className="mt-2 text-xs text-muted-foreground">{splitResult}</p>}
        </Section>

        {imports && imports.length > 0 && (
          <Section title="Import History" className="lg:col-span-2" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="sticky top-0 z-10 bg-card">
                    <th className="h-8 px-2 text-left font-medium text-muted-foreground">File</th>
                    <th className="h-8 px-2 text-left font-medium text-muted-foreground">Imported at</th>
                    <th className="h-8 px-2 text-left font-medium text-muted-foreground">Rows</th>
                    <th className="h-8 px-2 text-left font-medium text-muted-foreground">Errors</th>
                    <th className="h-8 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((log) => (
                    <tr key={log.batch_id} className="hover:bg-muted/50">
                      <td className="px-2 py-1.5">{log.filename ?? '—'}</td>
                      <td className="px-2 py-1.5">{new Date(log.imported_at).toLocaleString('en-IN')}</td>
                      <td data-numeric className="px-2 py-1.5">{log.row_count ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        {log.error_count ? (
                          <Badge variant="destructive">{log.error_count}</Badge>
                        ) : (
                          <Badge variant="secondary">0</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <ConfirmActionButton
                          size="xs"
                          variant="destructive"
                          confirmTitle="Rollback import?"
                          confirmDescription={`Rollback ${log.filename ?? 'this import'} and its imported trades?`}
                          onConfirm={() => handleRollback(log.batch_id)}
                        >
                          <Trash2 className="size-3" />
                          Rollback
                        </ConfirmActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
