import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './overrides.css'
import App from './App'
import { PrivacyProvider } from './hooks/usePrivacy'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider forceColorScheme="light" theme={{ components: { AppShell: { defaultProps: { header: { height: 48 } } } } }}>
      <Notifications />
      <PrivacyProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </PrivacyProvider>
    </MantineProvider>
  </StrictMode>,
)
