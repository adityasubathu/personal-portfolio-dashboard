import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs } from '@/api/jobs'
import { JOB_INVALIDATES, JOB_LABELS, isJobActive, jobHref } from '@/lib/jobs'
import { notify } from '@/lib/notify'

/** Toasts and refreshes dependent queries for every job that finishes while the app is open. */
export function useJobWatcher() {
  const { data: jobs } = useJobs()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const seenFinished = useRef<Set<number> | null>(null)

  useEffect(() => {
    if (!jobs) return
    const finished = jobs.filter((j) => !isJobActive(j))
    if (seenFinished.current === null) {
      seenFinished.current = new Set(finished.map((j) => j.id))
      return
    }
    for (const job of finished) {
      if (seenFinished.current.has(job.id)) continue
      seenFinished.current.add(job.id)
      JOB_INVALIDATES[job.kind].forEach((queryKey) => qc.invalidateQueries({ queryKey }))
      notify.withAction(job.status === 'done' ? 'success' : 'error', JOB_LABELS[job.kind], job.summary ?? undefined, {
        label: 'View',
        onClick: () => navigate(jobHref(job, pathname)),
      })
    }
  }, [jobs, qc, navigate, pathname])
}
