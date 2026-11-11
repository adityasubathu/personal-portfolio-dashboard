import { useLocation, useNavigate } from 'react-router-dom'
import { CandlestickChart, ChevronDown, LineChart, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useJobs, useStartJobMutation } from '@/api/jobs'
import { useKiteStatus } from '@/api/kite'
import { useAppStatus } from '@/api/status'
import { usePersistentState } from '@/hooks/usePersistentState'
import { isJobActive, jobHref } from '@/lib/jobs'
import { notify } from '@/lib/notify'
import type { JobKind, NavSource } from '@/types/jobs'

const NAV_SOURCE_OPTIONS: Array<{ value: NavSource; label: string; hint: string }> = [
  { value: 'mfapi', label: 'mfapi.in', hint: 'Full NAV history from mfapi.in.' },
  { value: 'finapi', label: 'FinAPI', hint: 'Free tier — 30 req/min, no API key needed.' },
  { value: 'amfi', label: 'AMFI latest', hint: 'Latest NAV only, from the AMFI daily feed.' },
]

function JobIcon({ active, icon: Icon }: { active: boolean; icon: typeof LineChart }) {
  return active ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />
}

export function HeaderJobActions() {
  const { data: jobs = [] } = useJobs()
  const { data: appStatus } = useAppStatus()
  const { data: kite } = useKiteStatus()
  const startJob = useStartJobMutation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [navSource, setNavSource] = usePersistentState<NavSource>('navSource', 'mfapi')

  const active = (kind: JobKind) => jobs.some((j) => j.kind === kind && isJobActive(j))

  function start(kind: JobKind, params: Record<string, unknown> = {}) {
    startJob.mutate(
      { kind, params },
      {
        onSuccess: (job) => navigate(jobHref(job, pathname)),
        onError: (e) => notify.error(String(e)),
      },
    )
  }

  function startKite() {
    if (kite?.configured && !kite.token_valid && kite.login_url) window.open(kite.login_url, '_blank', 'noopener')
    start('kite_price_history')
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        <Button size="sm" variant="outline" className="rounded-r-none" onClick={() => start('mf_nav_history', { source: navSource })}>
          <JobIcon active={active('mf_nav_history')} icon={LineChart} />
          <span className="hidden sm:inline">MF NAV</span>
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="icon-sm" variant="outline" className="-ml-px rounded-l-none" aria-label="Choose NAV source">
              <ChevronDown className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <p className="mb-2 text-xs font-medium">NAV source</p>
            <ToggleGroup type="single" variant="outline" size="sm" value={navSource} onValueChange={(v) => v && setNavSource(v as NavSource)}>
              {NAV_SOURCE_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="mt-2 text-xs text-muted-foreground">{NAV_SOURCE_OPTIONS.find((o) => o.value === navSource)?.hint}</p>
          </PopoverContent>
        </Popover>
      </div>
      {!appStatus?.demo_mode && (
        <Button size="sm" variant="outline" onClick={startKite}>
          <JobIcon active={active('kite_price_history')} icon={CandlestickChart} />
          <span className="hidden sm:inline">Kite prices</span>
        </Button>
      )}
    </div>
  )
}
