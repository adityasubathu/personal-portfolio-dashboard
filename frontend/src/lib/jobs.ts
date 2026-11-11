import type { JobKind, JobSummary } from '@/types/jobs'

export const SECTOR_DISMISSALS_KEY = 'sectorClassifyDismissedNames'

export const JOB_LABELS: Record<JobKind, string> = {
  mf_nav_history: 'MF NAV sync',
  kite_price_history: 'Kite price sync',
  kite_index_history: 'Index refresh',
  mf_disclosures: 'Disclosure sync',
}

export const JOB_INVALIDATES: Record<JobKind, string[][]> = {
  mf_nav_history: [['portfolio'], ['charts']],
  kite_price_history: [['portfolio'], ['market-sentiment'], ['charts'], ['kite']],
  kite_index_history: [['market-sentiment'], ['charts']],
  mf_disclosures: [['mf-breakdown']],
}

export const KITE_JOB_KINDS: JobKind[] = ['kite_price_history', 'kite_index_history']

export function isJobActive(job: Pick<JobSummary, 'status'>): boolean {
  return job.status === 'running' || job.status === 'waiting_login'
}

export function jobHref(job: Pick<JobSummary, 'id' | 'kind'>, pathname: string): string {
  return job.kind === 'mf_disclosures' ? `/portfolio/disclosures/${job.id}` : `${pathname}?job=${job.id}`
}
