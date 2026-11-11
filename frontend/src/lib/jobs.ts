import type { JobKind, JobSummary } from '@/types/jobs'

export const JOB_LABELS: Record<JobKind, string> = {
  mf_nav_history: 'MF NAV sync',
  kite_price_history: 'Kite price sync',
  mf_disclosures: 'Disclosure sync',
}

export const JOB_INVALIDATES: Record<JobKind, string[][]> = {
  mf_nav_history: [['portfolio'], ['charts']],
  kite_price_history: [['portfolio'], ['market-sentiment'], ['charts'], ['kite']],
  mf_disclosures: [['mf-breakdown']],
}

export function isJobActive(job: Pick<JobSummary, 'status'>): boolean {
  return job.status === 'running' || job.status === 'waiting_login'
}

export function jobHref(job: Pick<JobSummary, 'id' | 'kind'>, pathname: string): string {
  return job.kind === 'mf_disclosures' ? `/portfolio/disclosures/${job.id}` : `${pathname}?job=${job.id}`
}
