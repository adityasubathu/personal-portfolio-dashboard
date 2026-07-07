import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ActionIcon, Alert, Badge, Box, Button, Group, Paper, PasswordInput,
  Stack, Table, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconLogin, IconTrash, IconX, IconFlask } from '@tabler/icons-react'
import {
  useKiteStatus,
  useSaveKiteConfigMutation,
  useDeleteKiteConfigMutation,
  useKiteSyncMutation,
} from '../api/kite'
import { apiUrl } from '../api/client'
import { useAppStatus } from '../api/status'

export function Kite() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: status, refetch } = useKiteStatus()
  const saveMut = useSaveKiteConfigMutation()
  const deleteMut = useDeleteKiteConfigMutation()
  const syncMut = useKiteSyncMutation()
  const { data: appStatus } = useAppStatus()
  const demoMode = appStatus?.demo_mode ?? false

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')

  // Show login result from OAuth callback
  useEffect(() => {
    const login = searchParams.get('login')
    const error = searchParams.get('error')
    if (login === 'success') {
      notifications.show({ color: 'green', message: 'Kite login successful.' })
      setSearchParams({})
      refetch()
    } else if (error) {
      notifications.show({ color: 'red', message: `Login failed: ${error}` })
      setSearchParams({})
    }
  }, [searchParams, setSearchParams, refetch])

  // Pre-fill API key if configured
  useEffect(() => {
    if (status?.api_key) setApiKey(status.api_key)
  }, [status?.api_key])

  async function handleSave() {
    if (!apiKey || !apiSecret) return
    try {
      await saveMut.mutateAsync({ api_key: apiKey, api_secret: apiSecret })
      setApiSecret('')
      notifications.show({ color: 'green', message: 'Config saved.' })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  async function handleDelete() {
    try {
      await deleteMut.mutateAsync()
      setApiKey('')
      notifications.show({ color: 'green', message: 'Config deleted.' })
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
  }

  function handleSync() {
    syncMut.mutate()
  }

  if (demoMode) {
    return (
      <Stack gap="lg" maw={560}>
        <Title order={3}>Kite Integration</Title>
        <Alert icon={<IconFlask size={14} />} color="violet" variant="light" title="Demo mode">
          Kite integration is disabled in demo mode. The app is running with sample data — no live prices or sync available.
        </Alert>
      </Stack>
    )
  }

  return (
    <Stack gap="lg" maw={560}>
      <Title order={3}>Kite Integration</Title>

      {/* Status */}
      {status && (
        <Box>
          <Text fw={600} mb="xs">Status</Text>
          <Group gap="xs">
            <Badge color={status.configured ? 'blue' : 'gray'} variant="light">
              {status.configured ? 'Configured' : 'Not configured'}
            </Badge>
            {status.configured && (
              <Badge color={status.token_valid ? 'green' : 'red'} variant="light">
                Token {status.token_valid ? 'valid' : 'expired'}
              </Badge>
            )}
          </Group>
          {status.last_sync && (
            <Text size="xs" c="dimmed" mt={4}>
              Last sync: {new Date(status.last_sync.synced_at).toLocaleString('en-IN')}
              {' '}({status.last_sync.status})
              {status.last_sync.error_message && ` — ${status.last_sync.error_message}`}
            </Text>
          )}
        </Box>
      )}

      {/* Config form */}
      <Box>
        <Text fw={600} mb="xs">API Credentials</Text>
        <Stack gap="xs">
          <TextInput
            label="API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            size="xs"
          />
          <PasswordInput
            label="API Secret"
            placeholder={status?.configured ? '(leave blank to keep current)' : ''}
            value={apiSecret}
            onChange={(e) => setApiSecret(e.currentTarget.value)}
            size="xs"
          />
          <Group>
            <Button size="xs" loading={saveMut.isPending} onClick={handleSave}>
              Save
            </Button>
            {status?.configured && (
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconTrash size={12} />}
                loading={deleteMut.isPending}
                onClick={handleDelete}
              >
                Delete config
              </Button>
            )}
          </Group>
        </Stack>
      </Box>

      {/* Auth */}
      {status?.configured && (
        <Box>
          <Text fw={600} mb="xs">Authentication</Text>
          {status.token_valid ? (
            <Alert color="green" variant="light">
              <Text size="xs">
                Token valid until {status.token_expiry ? new Date(status.token_expiry).toLocaleString('en-IN') : '—'}
              </Text>
            </Alert>
          ) : (
            <Alert color="orange" variant="light">
              <Text size="xs" mb="xs">Token expired or not set. Login with Kite to refresh.</Text>
              <Button
                size="xs"
                leftSection={<IconLogin size={12} />}
                component="a"
                href={apiUrl('/api/v1/kite/auth/url')}
                onClick={async (e) => {
                  e.preventDefault()
                  try {
                    const r = await fetch(apiUrl('/api/v1/kite/auth/url'))
                    const { url } = await r.json()
                    window.location.href = url
                  } catch (err) {
                    notifications.show({ color: 'red', message: String(err) })
                  }
                }}
              >
                Login with Kite
              </Button>
            </Alert>
          )}
        </Box>
      )}

      {/* Sync */}
      {status?.configured && status.token_valid && (
        <Box>
          <Text fw={600} mb="xs">Sync Holdings</Text>
          <Button
            size="sm"
            leftSection={<IconRefresh size={14} />}
            loading={syncMut.isPending}
            onClick={handleSync}
          >
            Sync now
          </Button>

          {(syncMut.isSuccess || syncMut.isError) && (
            <Paper withBorder p="sm" mt="sm">
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  {syncMut.isSuccess && syncMut.data.status === 'SUCCESS' ? 'Sync complete' : 'Sync failed'}
                </Text>
                <ActionIcon variant="subtle" size="sm" onClick={() => syncMut.reset()}>
                  <IconX size={14} />
                </ActionIcon>
              </Group>

              {syncMut.isSuccess && syncMut.data.status === 'SUCCESS' && (
                <Alert color="green" variant="light">
                  <Text size="sm">
                    Synced {syncMut.data.holdings_count} holdings, {syncMut.data.positions_count} positions.
                  </Text>
                </Alert>
              )}

              {syncMut.isSuccess && syncMut.data.status !== 'SUCCESS' && (
                <Stack gap="xs">
                  <Alert color="red" variant="filled">
                    <Text size="sm">{syncMut.data.error_message ?? syncMut.data.status}</Text>
                  </Alert>
                  {syncMut.data.discrepancies && syncMut.data.discrepancies.length > 0 && (
                    <Table fz="sm" withColumnBorders={false} withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Symbol</Table.Th>
                          <Table.Th>ISIN</Table.Th>
                          <Table.Th>Issue</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Kite qty</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Local qty</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {syncMut.data.discrepancies.map((d) => (
                          <Table.Tr key={d.isin}>
                            <Table.Td fw={500}>{d.symbol}</Table.Td>
                            <Table.Td c="dimmed">{d.isin}</Table.Td>
                            <Table.Td>
                              <Badge size="sm" color={d.kind === 'new_on_kite' ? 'blue' : d.kind === 'missing_from_kite' ? 'orange' : 'red'} variant="light">
                                {d.kind === 'new_on_kite' ? 'New on Kite' : d.kind === 'missing_from_kite' ? 'Missing from Kite' : 'Qty mismatch'}
                              </Badge>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>{d.kite_qty ?? '—'}</Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>{d.local_qty ?? '—'}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              )}

              {syncMut.isError && (
                <Alert color="red" variant="filled" title="Error">
                  <Text size="sm">{String(syncMut.error)}</Text>
                </Alert>
              )}
            </Paper>
          )}
        </Box>
      )}
    </Stack>
  )
}
