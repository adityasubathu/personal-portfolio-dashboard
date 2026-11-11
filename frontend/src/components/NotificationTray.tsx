import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, CircleCheck, CircleX, Loader2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useClearJobsMutation, useDeleteJobMutation, useJobs } from '@/api/jobs'
import { JOB_LABELS, isJobActive, jobHref } from '@/lib/jobs'
import { relativeTime } from '@/lib/format'
import type { JobSummary } from '@/types/jobs'

function JobIcon({ job }: { job: JobSummary }) {
  if (isJobActive(job)) return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
  return job.status === 'done'
    ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-positive" />
    : <CircleX className="mt-0.5 size-3.5 shrink-0 text-negative" />
}

function jobLine(job: JobSummary): string {
  if (job.status === 'waiting_login') return 'Waiting for Kite login…'
  if (isJobActive(job)) return job.last_log ?? 'Starting…'
  return job.summary ?? ''
}

export function NotificationTray() {
  const [open, setOpen] = useState(false)
  const { data: jobs = [] } = useJobs()
  const deleteJob = useDeleteJobMutation()
  const clearJobs = useClearJobsMutation()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const anyActive = jobs.some(isJobActive)
  const count = jobs.filter((j) => isJobActive(j) || !j.read_at).length
  const hasFinished = jobs.some((j) => !isJobActive(j))

  function openJob(job: JobSummary) {
    setOpen(false)
    navigate(jobHref(job, pathname))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          {anyActive ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
          {count > 0 && (
            <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 text-[10px]">{count}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <span className="text-sm font-semibold">Notifications</span>
          {hasFinished && (
            <Button size="xs" variant="ghost" disabled={clearJobs.isPending} onClick={() => clearJobs.mutate()}>
              Clear all
            </Button>
          )}
        </div>
        {jobs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No notifications</p>
        ) : (
          <ul className="max-h-96 overflow-auto">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50">
                <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => openJob(job)}>
                  <JobIcon job={job} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      {JOB_LABELS[job.kind]}
                      {!isJobActive(job) && !job.read_at && (
                        <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{jobLine(job)}</span>
                    <span className="block text-[10px] text-muted-foreground">{relativeTime(job.finished_at ?? job.started_at)}</span>
                  </span>
                </button>
                {!isJobActive(job) && (
                  <Button variant="ghost" size="icon-xs" aria-label="Delete notification" onClick={() => deleteJob.mutate(job.id)}>
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
