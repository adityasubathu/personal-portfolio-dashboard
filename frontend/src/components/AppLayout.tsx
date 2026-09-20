import { Outlet } from 'react-router-dom'
import { Eye, EyeOff, FlaskConical } from 'lucide-react'
import { AppSidebar } from './AppSidebar'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { usePrivacy } from '../hooks/usePrivacy'
import { useAppStatus } from '../api/status'

export function AppLayout() {
  const { privacyMode, togglePrivacy } = usePrivacy()
  const { data: status } = useAppStatus()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b bg-background px-3">
          <SidebarTrigger />
          <Button
            variant="ghost"
            size="icon"
            onClick={togglePrivacy}
            aria-label={privacyMode ? 'Show values' : 'Hide values'}
          >
            {privacyMode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </header>
        <div className="px-3 py-4 md:px-4">
          {status?.demo_mode && (
            <Alert className="mb-4 border-info/40 bg-info/10">
              <FlaskConical className="size-4" />
              <AlertDescription>Demo mode — using sample data. Kite integration is disabled.</AlertDescription>
            </Alert>
          )}
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
