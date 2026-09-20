import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { usePolicyTracker, useSetTriggerStateMutation } from '../api/policyTracker'
import type { TriggerResult, TriggerStatus } from '../types/policyTracker'
import { PageHeader } from '../components/PageHeader'
import { Section } from '@/components/Section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { CHIP_CLASS } from '@/lib/colors'
import { notify } from '@/lib/notify'

const STATUS_CLASS: Record<TriggerStatus, string> = {
  ok: CHIP_CLASS.green,
  watch: CHIP_CLASS.blue,
  action: CHIP_CLASS.orange,
  breach: 'bg-destructive text-white',
  manual: CHIP_CLASS.gray,
}

const ROW_ACCENT: Partial<Record<TriggerStatus, string>> = {
  action: 'border-l-2 border-warning bg-warning/5 pl-2.5',
  breach: 'border-l-2 border-destructive bg-destructive/5 pl-2.5',
}

function isNestedRecord(v: unknown): v is Record<string, Record<string, unknown>> {
  return typeof v === 'object' && v !== null && Object.values(v).every(
    (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
  )
}

function DetailView({ detail, threshold }: { detail: Record<string, unknown>; threshold: Record<string, unknown> | null }) {
  if (typeof detail.premium_pct === 'number') {
    const premium = detail.premium_pct as number
    const low = threshold?.low as number | undefined
    const high = threshold?.high as number | undefined
    const bg = low !== undefined && high !== undefined
      ? premium < low
        ? 'bg-positive/15'
        : premium <= high
          ? 'bg-warning/15'
          : 'bg-destructive/15'
      : undefined
    return (
      <table className="w-auto text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-right">Exchange close</th>
            <th className="px-2 py-1 text-right">NAV</th>
            <th className="px-2 py-1 text-right">Premium</th>
            <th className="px-2 py-1 text-right">As of</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 text-right">{(detail.exchange_close as number).toFixed(2)}</td>
            <td className="px-2 py-1 text-right">{(detail.nav as number).toFixed(4)}</td>
            <td className={cn('rounded px-2 py-1 text-right', bg)}>
              {premium > 0 ? '+' : ''}{premium.toFixed(2)}%
            </td>
            <td className="px-2 py-1 text-right">{detail.nav_date as string}{detail.stale ? ' ⚠' : ''}</td>
          </tr>
        </tbody>
        {low !== undefined && high !== undefined && (
          <tfoot>
            <tr>
              <td colSpan={4} className="px-2 py-1 text-muted-foreground italic">
                low ≤{low}% · high {'>'}{high}%
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    )
  }

  if (Array.isArray(detail.rung_levels)) {
    const peak = detail.peak as number
    const current = detail.current as number
    const drawdown = detail.drawdown_pct as number
    const levels = detail.rung_levels as number[]
    const pcts = detail.rung_pcts as number[]
    const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
    return (
      <table className="w-auto text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-right">Current</th>
            <th className="px-2 py-1 text-right">Peak</th>
            <th className="px-2 py-1 text-right">Drawdown</th>
            {pcts.map((p, i) => <th key={i} className="px-2 py-1 text-right">Rung {i + 1} (−{p}%)</th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-2 py-1 text-right">{fmt(current)}</td>
            <td className="px-2 py-1 text-right">{fmt(peak)}</td>
            <td className={cn('px-2 py-1 text-right', drawdown <= -15 && 'text-negative')}>
              {drawdown.toFixed(2)}%
            </td>
            {levels.map((lvl, i) => (
              <td key={i} className={cn('px-2 py-1 text-right', current <= lvl && 'text-negative')}>
                {fmt(lvl)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    )
  }

  if (isNestedRecord(detail)) {
    const rows = Object.entries(detail)
    const cols = Object.keys(rows[0][1])
    const thresholdNum = threshold
      ? (Object.values(threshold).find((v) => typeof v === 'number') as number | undefined)
      : undefined
    return (
      <table className="w-auto text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1" />
            {cols.map((c) => <th key={c} className="px-2 py-1 text-right">{c.replace(/_/g, ' ')}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, vals]) => (
            <tr key={name}>
              <td className="px-2 py-1 font-medium">{name}</td>
              {cols.map((c) => {
                const raw = (vals as Record<string, unknown>)[c]
                const n = typeof raw === 'number' ? raw : null
                const isdiff = c === 'diff'
                const breached = isdiff && n !== null && thresholdNum !== undefined && Math.abs(n) > thresholdNum
                return (
                  <td key={c} className={cn('px-2 py-1 text-right', breached && 'text-negative')}>
                    {n !== null ? (c.endsWith('_pct') || isdiff ? `${n > 0 ? '+' : ''}${n.toFixed(2)}%` : String(n)) : String(raw)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {thresholdNum !== undefined && (
          <tfoot>
            <tr>
              <td colSpan={cols.length + 1} className="px-2 py-1 text-muted-foreground italic">
                threshold ±{thresholdNum.toFixed(1)}%
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    )
  }

  return (
    <>
      {Object.entries(detail).map(([k, v]) => (
        <p key={k} className="font-mono text-xs">
          {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
        </p>
      ))}
      {threshold && (
        <>
          <p className="mt-1 text-xs font-medium">thresholds:</p>
          {Object.entries(threshold).map(([k, v]) => (
            <p key={k} className="font-mono text-xs">
              {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </p>
          ))}
        </>
      )}
    </>
  )
}

function TriggerRow({ trigger }: { trigger: TriggerResult }) {
  const [expanded, setExpanded] = useState(false)
  const [auditNote, setAuditNote] = useState(
    (trigger.detail?.result as string | undefined) ?? ''
  )
  const mut = useSetTriggerStateMutation()

  async function ack(extra?: { value_text?: string }) {
    try {
      await mut.mutateAsync({ key: trigger.key, value_bool: true, ...extra })
    } catch (e) {
      notify.error(String(e))
    }
  }

  async function toggle(val: boolean) {
    try {
      await mut.mutateAsync({ key: trigger.key, value_bool: val })
    } catch (e) {
      notify.error(String(e))
    }
  }

  const hasDetail = Object.keys(trigger.detail).length > 0 || trigger.threshold != null

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className={cn('border-b py-3 last:border-b-0', ROW_ACCENT[trigger.status])}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{trigger.label}</p>
              {trigger.cta && trigger.status !== 'ok' && (
                <p className="text-xs text-muted-foreground italic">— {trigger.cta}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{trigger.summary}</p>

            {trigger.mode === 'manual_ack' && trigger.status !== 'ok' && (
              <div className="mt-1 flex items-center gap-2">
                {trigger.key.includes('audit') && (
                  <Input
                    placeholder="Result note (e.g. +1.2% vs TRI — pass)"
                    value={auditNote}
                    onChange={(e) => setAuditNote(e.target.value)}
                    className="h-7 flex-1 text-xs"
                  />
                )}
                <Button
                  size="xs"
                  variant="outline"
                  disabled={mut.isPending}
                  onClick={() => ack(trigger.key.includes('audit') && auditNote ? { value_text: auditNote } : undefined)}
                >
                  Mark done
                </Button>
              </div>
            )}

            {trigger.mode === 'manual_input' && (
              <div className="mt-1 flex items-center gap-2">
                <Switch
                  size="sm"
                  checked={trigger.status === 'action'}
                  onCheckedChange={toggle}
                  id={`trigger-${trigger.key}`}
                />
                <Label htmlFor={`trigger-${trigger.key}`} className="text-xs font-normal">
                  {trigger.key === 'sp500_inflows_open' ? 'Fund open to inflows' : 'Purchase intent active'}
                </Label>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-start gap-2">
            <Badge className={STATUS_CLASS[trigger.status]} variant="outline">{trigger.status}</Badge>
            {hasDetail && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-xs">
                  <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        </div>

        {hasDetail && (
          <CollapsibleContent>
            <div className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
              <DetailView detail={trigger.detail} threshold={trigger.threshold} />
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  )
}

export function PolicyTracker() {
  const { data, isLoading } = usePolicyTracker()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!data) return null

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageHeader
        title="Policy Tracker"
        meta={
          <div className={cn('rounded-md px-3 py-1.5', data.action_count > 0 ? 'bg-warning/10' : 'bg-positive/10')}>
            <p className={cn('text-sm font-medium', data.action_count > 0 ? 'text-warning' : 'text-positive')}>
              {data.action_count > 0
                ? `${data.action_count} action${data.action_count > 1 ? 's' : ''} pending`
                : 'All clear'}
            </p>
            <p className="text-xs text-muted-foreground">as of {new Date(data.generated_at).toLocaleTimeString('en-IN')}</p>
          </div>
        }
      />

      {data.sections.map((section) => (
        <Section key={section.section} title={section.section}>
          {section.triggers.map((trigger) => (
            <TriggerRow key={trigger.key} trigger={trigger} />
          ))}
        </Section>
      ))}
    </div>
  )
}
