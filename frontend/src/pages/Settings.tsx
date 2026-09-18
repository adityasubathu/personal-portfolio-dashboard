import { useState } from 'react'
import { Box, Button, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconFlask } from '@tabler/icons-react'
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
import { Panel } from '../components/Panel'

interface DangerButtonProps {
  label: string
  description: string
  mutate: () => Promise<DeleteResult>
}

function DangerButton({ label, description, mutate }: DangerButtonProps) {
  async function confirm() {
    try {
      const r = await mutate()
      notifications.show({ color: 'green', message: r.message })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  return (
    <>
      <Group justify="space-between" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
        <div>
          <Text size="sm" fw={500}>{label}</Text>
          <Text size="xs" c="dimmed">{description}</Text>
        </div>
        <ConfirmActionButton color="red" variant="light" size="xs" confirmTitle={`Confirm: ${label}`} confirmDescription={`${description} This cannot be undone.`} onConfirm={confirm}>Delete</ConfirmActionButton>
      </Group>
    </>
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
      notifications.show({ color: 'green', message: 'Demo data reset successfully' })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <Stack gap="lg" maw={600}>
      <PageHeader title="Settings" />

      {db && (
        <Panel title="Database">
          <Text size="xs">Host: {db.host}:{db.port} / Database: {db.name}</Text>
        </Panel>
      )}

      {demoMode && (
        <Box>
          <Text fw={600} mb="xs">Demo Mode</Text>
          <Group justify="space-between" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <div>
              <Text size="sm" fw={500}><IconFlask size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />Reset demo data</Text>
              <Text size="xs" c="dimmed">Wipes all data and re-seeds the demo portfolio from scratch. No restart needed.</Text>
            </div>
            <Button color="violet" variant="light" size="xs" loading={resetLoading} onClick={handleResetDemo}>Reset</Button>
          </Group>
        </Box>
      )}

      <Panel title="Danger Zone" style={{ borderLeft: '3px solid var(--negative)' }}>
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
      </Panel>
    </Stack>
  )
}
