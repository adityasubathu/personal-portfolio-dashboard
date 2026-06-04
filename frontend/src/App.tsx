import { useQuery } from '@tanstack/react-query'
import { Container, Title, Text, Loader, Stack, Code, Badge } from '@mantine/core'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

function App() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['summary-smoke-test'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/v1/portfolio/summary-cards`)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.json()
    },
  })

  return (
    <Container size="sm" mt="xl">
      <Stack gap="md">
        <Title order={2}>Portfolio Tracker — Phase 0 smoke test</Title>
        <Text c="dimmed">Calling <Code>{API_BASE}/api/v1/portfolio/summary-cards</Code></Text>

        {isLoading && <Loader />}
        {error && <Badge color="red">Error: {String(error)}</Badge>}
        {data && (
          <>
            <Badge color="green">API reachable ✓</Badge>
            <Code block>{JSON.stringify(data, null, 2)}</Code>
          </>
        )}
      </Stack>
    </Container>
  )
}

export default App
