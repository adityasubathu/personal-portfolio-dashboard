import { NavLink, Outlet } from 'react-router-dom'
import {
  ActionIcon,
  Alert,
  AppShell,
  Burger,
  Group,
  Indicator,
  NavLink as MantineNavLink,
  Text,
  ScrollArea,
  Tooltip,
} from '@mantine/core'
import { IconFlask } from '@tabler/icons-react'
import { useDisclosure } from '@mantine/hooks'
import {
  IconLayoutDashboard,
  IconChartLine,
  IconBuildingBank,
  IconChartDonut,
  IconChartCandle,
  IconChartHistogram,
  IconChecklist,
  IconList,
  IconUpload,
  IconBrandGoogle,
  IconSettings,
  IconEye,
  IconEyeOff,
} from '@tabler/icons-react'
import { usePrivacy } from '../hooks/usePrivacy'
import { usePolicyTracker } from '../api/policyTracker'
import { useAppStatus } from '../api/status'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/portfolio/nav-history', label: 'NAV History', icon: IconChartLine },
  { to: '/portfolio/breakdown', label: 'Breakdown', icon: IconChartDonut },
  { to: '/portfolio/fund-breakdown', label: 'Fund Detail', icon: IconBuildingBank },
  { to: '/charts/price', label: 'Price Chart', icon: IconChartCandle },
  { to: '/charts/nav', label: 'Fund NAV Chart', icon: IconChartHistogram },
  { to: '/trades', label: 'Trades', icon: IconList },
  { to: '/import', label: 'Import', icon: IconUpload },
  { to: '/kite', label: 'Kite', icon: IconBrandGoogle },
  { to: '/policy', label: 'Policy', icon: IconChecklist },
  { to: '/settings', label: 'Settings', icon: IconSettings },
]

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure()
  const { privacyMode, togglePrivacy } = usePrivacy()
  const { data: policyData } = usePolicyTracker()
  const actionCount = policyData?.action_count ?? 0
  const { data: status } = useAppStatus()
  const demoMode = status?.demo_mode ?? false

  return (
    <AppShell
      header={{ height: 48 }}
      footer={{ height: 40 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="sm">Portfolio Tracker</Text>
          </Group>
          <Tooltip label={privacyMode ? 'Show values' : 'Hide values'} position="bottom">
            <ActionIcon variant={privacyMode ? 'filled' : 'subtle'} color={privacyMode ? 'blue' : 'gray'} onClick={togglePrivacy} aria-label="Toggle privacy mode">
              {privacyMode ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea h="100%">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }}>
              {({ isActive }) => (
                <MantineNavLink
                  component="div"
                  label={label}
                  leftSection={
                    to === '/policy' && actionCount > 0 ? (
                      <Indicator color="orange" size={8} offset={2}>
                        <Icon size={16} />
                      </Indicator>
                    ) : (
                      <Icon size={16} />
                    )
                  }
                  active={isActive}
                  styles={{ root: { borderRadius: 6 } }}
                />
              )}
            </NavLink>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        {demoMode && (
          <Alert icon={<IconFlask size={14} />} color="violet" variant="light" mb="md" py={6} px="md">
            Demo mode — using sample data. Kite integration is disabled.
          </Alert>
        )}
        <Outlet />
      </AppShell.Main>

      <AppShell.Footer style={{ borderTop: '1px solid var(--mantine-color-gray-3)', background: 'var(--mantine-color-gray-0)', height: 40 }} />
    </AppShell>
  )
}
