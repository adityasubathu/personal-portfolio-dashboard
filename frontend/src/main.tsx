import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App'
import { PrivacyProvider } from './hooks/PrivacyProvider'

const queryClient = new QueryClient()

const darkQuery = matchMedia('(prefers-color-scheme: dark)')
darkQuery.addEventListener('change', (e) => {
  document.documentElement.classList.toggle('dark', e.matches)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster position="bottom-right" richColors />
    <PrivacyProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </PrivacyProvider>
  </StrictMode>,
)
