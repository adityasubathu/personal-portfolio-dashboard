import { useState } from 'react'
import { FlaskConical } from 'lucide-react'
import {
  useDeleteTradesMutation,
  useDeletePriceHistoryMutation,
  useDeleteNavHistoryMutation,
  useDeleteMfBreakdownMutation,
  useDeleteManualAssetsMutation,
  useDbInfo,
} from '../api/settings'
import { useAppStatus, useResetDemoMutation } from '../api/status'
import type { DeleteResult } from '../types/charts'
import { ConfirmActionButton } from '../components/ConfirmActionButton'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '@/components/PageShell'
import { Section } from '@/components/Section'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'

interface DangerButtonProps {
  label: string
  description: string
  mutate: () => Promise<DeleteResult>
}

function DangerButton({ label, description, mutate }: DangerButtonProps) {
  async function confirm() {
    try {
      const r = await mutate()
      notify.success(r.message)
    } catch (e) {
      notify.error(String(e))
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ConfirmActionButton
        variant="outline"
        className="text-destructive hover:text-destructive"
        size="xs"
        confirmTitle={`Confirm: ${label}`}
        confirmDescription={`${description} This cannot be undone.`}
        onConfirm={confirm}
      >
        Delete
      </ConfirmActionButton>
    </div>
  )
}

export function Settings() {
  const { data: db } = useDbInfo()
  const { data: appStatus } = useAppStatus()
  const demoMode = appStatus?.demo_mode ?? false
  const resetDemoMut = useResetDemoMutation()
  const deleteTradesMut = useDeleteTradesMutation()
  const deletePriceHistoryMut = useDeletePriceHistoryMutation()
  const deleteNavHistoryMut = useDeleteNavHistoryMutation()
  const deleteMfBreakdownMut = useDeleteMfBreakdownMutation()
  const deleteManualAssetsMut = useDeleteManualAssetsMutation()
  const [resetLoading, setResetLoading] = useState(false)

  async function handleResetDemo() {
    setResetLoading(true)
    try {
      await resetDemoMut.mutateAsync()
      notify.success('Demo data reset successfully')
    } catch (e) {
      notify.error(String(e))
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" />

      {db && (
        <Section title="Database">
          <p className="text-xs">Host: {db.host}:{db.port} / Database: {db.name}</p>
        </Section>
      )}

      {demoMode && (
        <Section title="Demo Mode">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium">
                <FlaskConical className="size-3.5" />
                Reset demo data
              </p>
              <p className="text-xs text-muted-foreground">Wipes all data and re-seeds the demo portfolio from scratch. No restart needed.</p>
            </div>
            <Button variant="outline" size="sm" disabled={resetLoading} onClick={handleResetDemo}>
              Reset
            </Button>
          </div>
        </Section>
      )}

      <Section title={<span className="text-destructive">Danger Zone</span>} className="border-destructive/40" bodyClassName="p-4 pt-0">
        <DangerButton
          label="Delete all trades"
          description="Removes all trades, holdings, import logs, and orphan instruments."
          mutate={() => deleteTradesMut.mutateAsync()}
        />
        <DangerButton
          label="Delete price history"
          description="Removes all Kite OHLC price history rows."
          mutate={() => deletePriceHistoryMut.mutateAsync()}
        />
        <DangerButton
          label="Delete NAV history"
          description="Removes all MF/ETF NAV history rows."
          mutate={() => deleteNavHistoryMut.mutateAsync()}
        />
        <DangerButton
          label="Delete MF breakdown data"
          description="Removes scheme breakdown and AMFI classification rows."
          mutate={() => deleteMfBreakdownMut.mutateAsync()}
        />
        <DangerButton
          label="Delete manual assets"
          description="Removes all FD, PPF, NPS, and cash entries."
          mutate={() => deleteManualAssetsMut.mutateAsync()}
        />
      </Section>
    </PageShell>
  )
}
