import { DataTable } from '@/components/DataTable'
import type { Column } from '@/components/DataTable'
import { shortDate } from '@/lib/format'
import type { IngestDonePayload, SyncedFund } from '@/types/mfBreakdown'

const SYNCED_FUND_COLUMNS: Column<SyncedFund>[] = [
  { key: 'name', label: 'Fund', sortable: true, render: (f) => <span className="text-xs">{f.name}</span> },
  {
    key: 'as_of',
    label: 'Portfolio as of',
    sortable: true,
    render: (f) => <span className="text-xs">{f.as_of ? shortDate(f.as_of) : '—'}</span>,
  },
  {
    key: 'rows',
    label: 'Holdings',
    sortable: true,
    align: 'right',
    render: (f) => <span className="text-xs">{f.rows}</span>,
  },
]

function staleFunds(funds: SyncedFund[], serverLatest: string): SyncedFund[] {
  return funds.filter((f) => !f.as_of || f.as_of < serverLatest)
}

export function IngestResult({ result }: { result: IngestDonePayload }) {
  const { amfi, ingest, nse } = result
  return (
    <div className="space-y-1">
      {amfi?.error ? (
        <p className="text-xs text-negative">AMFI: {amfi.error}</p>
      ) : amfi ? (
        <p className="text-xs">AMFI: {amfi.rows_loaded} stocks loaded ({amfi.large}L / {amfi.mid}M / {amfi.small}S) from {amfi.file}</p>
      ) : null}
      {ingest?.error ? (
        <p className="text-xs text-negative">Ingest: {ingest.error}</p>
      ) : ingest?.already_current ? (
        <p className="text-xs">All schemes are up to date{ingest.as_of ? ` (as of ${ingest.as_of})` : ''}</p>
      ) : ingest ? (
        <p className="text-xs">
          Ingest: {ingest.schemes_processed} scheme(s) updated, {ingest.rows_upserted} row(s)
          {typeof ingest.schemes_skipped === 'number' && ingest.schemes_skipped > 0 ? ` · ${ingest.schemes_skipped} already current` : ''}
        </p>
      ) : null}
      {ingest?.funds?.length ? (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs font-semibold">Portfolio date per fund</p>
          <DataTable
            columns={SYNCED_FUND_COLUMNS}
            rows={ingest.funds}
            defaultSort="as_of"
            defaultDir="desc"
            rowKey={(f) => f.isin}
          />
          {ingest.server_latest_filing && staleFunds(ingest.funds, ingest.server_latest_filing).length ? (
            <p className="text-xs text-warning">
              {staleFunds(ingest.funds, ingest.server_latest_filing).length} fund(s) behind the
              server's newest filing ({shortDate(ingest.server_latest_filing)}) — they haven't disclosed for it yet
            </p>
          ) : null}
        </div>
      ) : null}
      {ingest?.unmatched_equities?.length ? (
        <p className="text-xs text-warning">{ingest.unmatched_equities.length} unmatched equities — use classify panel to fix</p>
      ) : null}
      {ingest?.missing_funds?.length ? (
        <div className="mt-1 space-y-1">
          <p className="text-xs font-semibold text-negative">Not found in OpenFin for {ingest.missing_funds.length} held fund{ingest.missing_funds.length === 1 ? '' : 's'}:</p>
          {ingest.missing_funds.map((f) => (
            <p key={f.isin} className="text-xs text-negative">• {f.isin} — {f.name}</p>
          ))}
        </div>
      ) : null}
      {nse?.error ? (
        <p className="text-xs text-negative">NSE: {nse.error}</p>
      ) : nse ? (
        <div className="mt-1.5 space-y-1">
          <p className="text-xs">
            NSE: {nse.classified} classified, {nse.skipped_cached} already known
            {typeof nse.unclassified === 'number' && nse.unclassified > 0 ? `, ${nse.unclassified} unclassified` : ''}
            {typeof nse.errors === 'number' && nse.errors > 0 ? `, ${nse.errors} errors` : ''}
            {typeof nse.mismatched === 'number' && nse.mismatched > 0 ? `, ${nse.mismatched} ISIN mismatches` : ''}
          </p>
          {nse.unresolved_isins?.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                {nse.unresolved_isins.length} held ISIN{nse.unresolved_isins.length === 1 ? '' : 's'} not on the NSE main board
              </summary>
              <div className="mt-1 space-y-1">
                {nse.unresolved_isins.map((u) => (
                  <p key={u.isin} className="text-xs text-muted-foreground">• {u.name} ({u.isin})</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
