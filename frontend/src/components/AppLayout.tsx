import { NavLink, Outlet } from 'react-router-dom'
import {
  AppShell,
  Burger,
  Group,
  NavLink as MantineNavLink,
  Text,
  ScrollArea,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  IconLayoutDashboard,
  IconChartLine,
  IconBuildingBank,
  IconChartDonut,
  IconChartCandle,
  IconChartHistogram,
  IconList,
  IconUpload,
  IconBrandGoogle,
  IconSettings,
} from '@tabler/icons-react'

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
  { to: '/settings', label: 'Settings', icon: IconSettings },
]

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure()

  return (
    <AppShell
      header={{ height: 48 }}
      footer={{ height: 40 }}
      navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          <Text fw={700} size="sm">Portfolio Tracker</Text>
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
                  leftSection={<Icon size={16} />}
                  active={isActive}
                  styles={{ root: { borderRadius: 6 } }}
                />
              )}
            </NavLink>
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>

      <AppShell.Footer style={{ borderTop: '1px solid var(--mantine-color-gray-3)', background: 'var(--mantine-color-gray-0)', height: 40 }} />
    </AppShell>
  )
}
