import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, type MantineColorSchemeManager } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './overrides.css'
import App from './App'
import { PrivacyProvider } from './hooks/PrivacyProvider'
import { theme } from './theme'

const queryClient = new QueryClient()

const systemColorScheme: MantineColorSchemeManager = {
  get: () => 'auto',
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={systemColorScheme}>
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
