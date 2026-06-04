import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert, Badge, Box, Button, Group, PasswordInput,
  Stack, Text, TextInput, Title,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconRefresh, IconLogin, IconTrash } from '@tabler/icons-react'
import {
  useKiteStatus,
  useSaveKiteConfigMutation,
  useDeleteKiteConfigMutation,
  useKiteSyncMutation,
} from '../api/kite'
import { apiUrl } from '../api/client'

export function Kite() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: status, refetch } = useKiteStatus()
  const saveMut = useSaveKiteConfigMutation()
  const deleteMut = useDeleteKiteConfigMutation()
  const syncMut = useKiteSyncMutation()

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

  async function handleSync() {
    try {
      const r = await syncMut.mutateAsync()
      if (r.status === 'SUCCESS') {
        notifications.show({ color: 'green', message: `Synced ${r.holdings_count} holdings, ${r.positions_count} positions.` })
      } else {
        notifications.show({ color: 'orange', message: r.error_message ?? r.status })
      }
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) })
    }
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
            size="xs"
            leftSection={<IconRefresh size={12} />}
            loading={syncMut.isPending}
            onClick={handleSync}
          >
            Sync now
          </Button>
        </Box>
      )}
    </Stack>
  )
}
