import { useSearchParams } from 'react-router-dom'
import { LogIn, Square } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { JobPanel } from './JobPanel'
import { useCancelJobMutation, useJob, useMarkJobReadMutation } from '@/api/jobs'
import { useKiteStatus } from '@/api/kite'
import { JOB_LABELS, isJobActive } from '@/lib/jobs'
import { notify } from '@/lib/notify'
import type { JobDetail, KitePriceHistoryResult, MfNavHistoryResult } from '@/types/jobs'

function failedLines(job: JobDetail): string[] {
  if (job.kind === 'mf_nav_history') return (job.result as MfNavHistoryResult | null)?.failed ?? []
  if (job.kind === 'kite_price_history') return (job.result as KitePriceHistoryResult | null)?.result.failed ?? []
  return []
}

function JobResult({ job }: { job: JobDetail }) {
  const lines = failedLines(job)
  if (!lines.length) return null
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-semibold text-warning">{lines.length} failed</p>
      {lines.map((line) => (
        <p key={line} className="text-xs text-warning">• {line}</p>
      ))}
    </div>
  )
}

function KiteJobActions({ job }: { job: JobDetail }) {
  const { data: kite } = useKiteStatus()
  const cancel = useCancelJobMutation()
  const waiting = job.status === 'waiting_login'
  return (
    <DialogFooter>
      {waiting && kite?.login_url && (
        <Button size="sm" asChild>
          <a href={kite.login_url} target="_blank" rel="noreferrer">
            <LogIn className="size-3.5" />
            Login with Kite
          </a>
        </Button>
      )}
      <Button
        size="sm"
        variant="destructive"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(job.id, { onError: (e) => notify.error(String(e)) })}
      >
        <Square className="size-3" />
        {waiting ? 'Cancel' : 'Halt'}
      </Button>
    </DialogFooter>
  )
}

export function JobDialog() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('job')
  const jobId = raw ? Number(raw) : null
  const { data: job, isError } = useJob(jobId)
  const markRead = useMarkJobReadMutation()

  if (jobId == null) return null

  function close() {
    if (job && !isJobActive(job) && !job.read_at) markRead.mutate(job.id)
    const next = new URLSearchParams(searchParams)
    next.delete('job')
    setSearchParams(next)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{job ? JOB_LABELS[job.kind] : 'Background job'}</DialogTitle>
          {job?.summary && <DialogDescription>{job.summary}</DialogDescription>}
        </DialogHeader>
        {isError && <p className="text-xs text-muted-foreground">This job no longer exists.</p>}
        {job && (
          <JobPanel job={job}>
            <JobResult job={job} />
          </JobPanel>
        )}
        {job?.kind === 'kite_price_history' && isJobActive(job) && <KiteJobActions job={job} />}
      </DialogContent>
    </Dialog>
  )
}
