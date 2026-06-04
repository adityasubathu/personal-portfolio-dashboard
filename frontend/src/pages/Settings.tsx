import { useState } from 'react'
import { Alert, Box, Button, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  useDeleteTradesMutation,
  useDeletePriceHistoryMutation,
  useDeleteNavHistoryMutation,
  useDeleteMfBreakdownMutation,
  useDeleteManualAssetsMutation,
  useDbInfo,
} from '../api/settings'
import type { DeleteResult } from '../types/charts'

interface DangerButtonProps {
  label: string
  description: string
  mutate: () => Promise<DeleteResult>
}

function DangerButton({ label, description, mutate }: DangerButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    try {
      const r = await mutate()
      notifications.show({ color: 'green', message: r.message })
      setOpen(false)
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Group justify="space-between" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
        <div>
          <Text size="sm" fw={500}>{label}</Text>
          <Text size="xs" c="dimmed">{description}</Text>
        </div>
        <Button color="red" variant="light" size="xs" onClick={() => setOpen(true)}>Delete</Button>
      </Group>

      <Modal opened={open} onClose={() => setOpen(false)} title={`Confirm: ${label}`} size="sm">
        <Text size="sm" mb="md">{description} This cannot be undone.</Text>
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={() => setOpen(false)}>Cancel</Button>
          <Button color="red" size="xs" loading={loading} onClick={confirm}>Delete</Button>
        </Group>
      </Modal>
    </>
  )
}

export function Settings() {
  const { data: db } = useDbInfo()
  const deleteTradesMut = useDeleteTradesMutation()
  const deletePriceHistoryMut = useDeletePriceHistoryMutation()
  const deleteNavHistoryMut = useDeleteNavHistoryMutation()
  const deleteMfBreakdownMut = useDeleteMfBreakdownMutation()
  const deleteManualAssetsMut = useDeleteManualAssetsMutation()

  return (
    <Stack gap="lg" maw={600}>
      <Title order={3}>Settings</Title>

      {db && (
        <Alert title="Database" color="blue" variant="light">
          <Text size="xs">Host: {db.host}:{db.port} / Database: {db.name}</Text>
        </Alert>
      )}

      <Box>
        <Text fw={600} mb="xs">Danger Zone</Text>
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
      </Box>
    </Stack>
  )
}
