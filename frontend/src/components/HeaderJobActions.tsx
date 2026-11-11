import { CandlestickChart, ChevronDown, FileSearch, LineChart, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useJobs } from '@/api/jobs'
import { useAppStatus } from '@/api/status'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useStartJob } from '@/hooks/useStartJob'
import { SECTOR_DISMISSALS_KEY, isJobActive } from '@/lib/jobs'
import type { JobKind, NavSource } from '@/types/jobs'

const NAV_SOURCE_OPTIONS: Array<{ value: NavSource; label: string; hint: string; action: string }> = [
  { value: 'mfapi', label: 'mfapi.in', hint: 'Full NAV history from mfapi.in.', action: 'Download NAV history for every fund from mfapi.in' },
  { value: 'finapi', label: 'FinAPI', hint: 'Free tier — 30 req/min, no API key needed.', action: 'Download NAV history for every fund from FinAPI' },
  { value: 'amfi', label: 'AMFI latest', hint: 'Latest NAV only, from the AMFI daily feed.', action: 'Fetch the latest NAV for every fund from the AMFI daily feed' },
]

function Hint({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4} className="max-w-64">{text}</TooltipContent>
    </Tooltip>
  )
}

function JobIcon({ active, icon: Icon }: { active: boolean; icon: typeof LineChart }) {
  return active ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />
}

export function HeaderJobActions() {
  const { data: jobs = [] } = useJobs()
  const { data: appStatus } = useAppStatus()
  const start = useStartJob()
  const [navSource, setNavSource] = usePersistentState<NavSource>('navSource', 'mfapi')

  const navOption = NAV_SOURCE_OPTIONS.find((o) => o.value === navSource)
  const active = (kind: JobKind) => jobs.some((j) => j.kind === kind && isJobActive(j))

  function startDisclosures() {
    try {
      localStorage.removeItem(SECTOR_DISMISSALS_KEY)
    } catch {
      // storage unavailable — dismissals simply persist
    }
    start('mf_disclosures')
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center">
        <Hint text={`${navOption?.action}, then recompute XIRR.`}>
          <Button size="sm" variant="outline" className="rounded-r-none" aria-label="Sync MF NAVs" onClick={() => start('mf_nav_history', { source: navSource })}>
            <JobIcon active={active('mf_nav_history')} icon={LineChart} />
            <span className="hidden sm:inline">MF NAV</span>
          </Button>
        </Hint>
        <Popover>
          <Hint text={`Choose where MF NAV syncs from (now: ${navOption?.label}).`}>
            <PopoverTrigger asChild>
              <Button size="icon-sm" variant="outline" className="-ml-px rounded-l-none" aria-label="Choose NAV source">
                <ChevronDown className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </Hint>
          <PopoverContent align="end" className="w-auto p-3">
            <p className="mb-2 text-xs font-medium">NAV source</p>
            <ToggleGroup type="single" variant="outline" size="sm" value={navSource} onValueChange={(v) => v && setNavSource(v as NavSource)}>
              {NAV_SOURCE_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="mt-2 w-0 min-w-full text-xs text-muted-foreground">{navOption?.hint}</p>
          </PopoverContent>
        </Popover>
      </div>
      {!appStatus?.demo_mode && (
        <Hint text="Download daily price history for every stock you've traded and the tracked indices from Kite, then refresh latest prices and XIRR. Waits up to 10 min for a Kite login if needed.">
          <Button size="sm" variant="outline" aria-label="Sync Kite prices" onClick={() => start('kite_price_history')}>
            <JobIcon active={active('kite_price_history')} icon={CandlestickChart} />
            <span className="hidden sm:inline">Kite prices</span>
          </Button>
        </Hint>
      )}
      <Hint text="Load AMFI market-cap categories and the latest fund portfolio disclosures, then classify held stocks by NSE sector. Clears dismissed sector warnings.">
        <Button size="sm" variant="outline" aria-label="Sync MF disclosures" onClick={startDisclosures}>
          <JobIcon active={active('mf_disclosures')} icon={FileSearch} />
          <span className="hidden sm:inline">Disclosures</span>
        </Button>
      </Hint>
    </div>
  )
}
