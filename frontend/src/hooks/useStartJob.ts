import { useLocation, useNavigate } from 'react-router-dom'
import { useStartJobMutation } from '@/api/jobs'
import { useKiteStatus } from '@/api/kite'
import { KITE_JOB_KINDS, jobHref } from '@/lib/jobs'
import { notify } from '@/lib/notify'
import type { JobKind } from '@/types/jobs'

/** Starts a background job and opens its dialog; Kite jobs also open the login page when the token is invalid. */
export function useStartJob() {
  const startJob = useStartJobMutation()
  const { data: kite } = useKiteStatus()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return function start(kind: JobKind, params: Record<string, unknown> = {}) {
    if (KITE_JOB_KINDS.includes(kind) && kite?.configured && !kite.token_valid && kite.login_url) {
      window.open(kite.login_url, '_blank', 'noopener')
    }
    startJob.mutate(
      { kind, params },
      {
        onSuccess: (job) => navigate(jobHref(job, pathname)),
        onError: (e) => notify.error(String(e)),
      },
    )
  }
}
