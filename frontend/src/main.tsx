import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, type MantineColorSchemeManager } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'
import './index.css'
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

const darkQuery = matchMedia('(prefers-color-scheme: dark)')
darkQuery.addEventListener('change', (e) => {
  document.documentElement.classList.toggle('dark', e.matches)
  document.documentElement.setAttribute('data-mantine-color-scheme', e.matches ? 'dark' : 'light')
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={systemColorScheme}>
      <Notifications />
      <Toaster position="bottom-right" richColors />
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
