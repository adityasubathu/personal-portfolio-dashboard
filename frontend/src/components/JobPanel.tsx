import { useEffect, useRef, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isJobActive } from '@/lib/jobs'
import { shortDateTime } from '@/lib/format'
import type { JobDetail } from '@/types/jobs'

const STATUS_TEXT: Record<JobDetail['status'], string> = {
  running: 'Running…',
  waiting_login: 'Waiting for Kite login…',
  done: 'Finished',
  failed: 'Failed',
}

interface JobPanelProps {
  job: JobDetail
  children?: ReactNode
  className?: string
}

export function JobPanel({ job, children, className }: JobPanelProps) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job.logs.length, job.status])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        {isJobActive(job) && <Loader2 className="size-3.5 animate-spin" />}
        {STATUS_TEXT[job.status]} · started {shortDateTime(job.started_at)}
        {job.finished_at && ` · finished ${shortDateTime(job.finished_at)}`}
      </p>
      <div ref={logRef} className="h-64 space-y-2 overflow-auto rounded-md bg-muted p-2">
        <pre className="font-mono text-[11px] leading-4 whitespace-pre-wrap break-words text-muted-foreground">
          {job.logs.join('\n')}
        </pre>
        {job.status === 'failed' && job.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            <p className="font-semibold">Error</p>
            <p>{job.error}</p>
          </div>
        )}
        {job.status === 'done' && children}
      </div>
    </div>
  )
}
