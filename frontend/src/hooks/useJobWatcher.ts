import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useJobs } from '@/api/jobs'
import { JOB_INVALIDATES, isJobActive } from '@/lib/jobs'
import type { JobSummary } from '@/types/jobs'

/**
 * Refreshes dependent queries for every job that finishes while the app is open,
 * and returns those jobs while they are still unread so they can pop up under the bell.
 */
export function useJobWatcher(): JobSummary[] {
  const { data: jobs } = useJobs()
  const qc = useQueryClient()
  const [finishedOnLoad, setFinishedOnLoad] = useState<Set<number> | null>(null)
  const invalidated = useRef(new Set<number>())

  if (jobs && finishedOnLoad === null) {
    setFinishedOnLoad(new Set(jobs.filter((j) => !isJobActive(j)).map((j) => j.id)))
  }

  const freshlyFinished = useMemo(
    () => (finishedOnLoad && jobs ? jobs.filter((j) => !isJobActive(j) && !finishedOnLoad.has(j.id)) : []),
    [jobs, finishedOnLoad],
  )

  useEffect(() => {
    for (const job of freshlyFinished) {
      if (invalidated.current.has(job.id)) continue
      invalidated.current.add(job.id)
      JOB_INVALIDATES[job.kind].forEach((queryKey) => qc.invalidateQueries({ queryKey }))
    }
  }, [freshlyFinished, qc])

  return freshlyFinished.filter((j) => !j.read_at)
}
