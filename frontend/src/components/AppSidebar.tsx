import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CandlestickChart,
  ChartPie,
  Gauge,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LineChart,
  List,
  ListChecks,
  Receipt,
  Settings,
  Upload,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { Badge } from '@/components/ui/badge'
import { usePolicyTracker } from '@/api/policyTracker'

const groups = [
  {
    label: 'Portfolio',
    items: [
      ['/', 'Dashboard', LayoutDashboard],
      ['/portfolio/nav-history', 'NAV History', LineChart],
      ['/portfolio/breakdown', 'Breakdown', ChartPie],
      ['/portfolio/capital-gains', 'Capital Gains', Receipt],
    ],
  },
  {
    label: 'Research',
    items: [
      ['/market/sentiment', 'Market Sentiment', Gauge],
      ['/portfolio/fund-breakdown', 'Fund Detail', Landmark],
      ['/charts/price', 'Price Chart', CandlestickChart],
      ['/charts/nav', 'Fund NAV Chart', BarChart3],
    ],
  },
  {
    label: 'Operations',
    items: [
      ['/policy', 'Policy', ListChecks],
      ['/trades', 'Trades', List],
      ['/import', 'Import', Upload],
      ['/kite', 'Kite', KeyRound],
    ],
  },
  {
    label: 'System',
    items: [['/settings', 'Settings', Settings]],
  },
] as const

export function AppSidebar() {
  const { data: policy } = usePolicyTracker()
  const location = useLocation()

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 text-sm font-semibold">
          <ChartPie className="size-4 shrink-0" />
          <span className="truncate group-data-[collapsible=icon]:hidden">Portfolio Tracker</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-[10px] tracking-wider text-sidebar-foreground/60 uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(([to, label, Icon]) => {
                  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                        <NavLink to={to} end={to === '/'}>
                          <Icon />
                          <span>{label}</span>
                          {to === '/policy' && !!policy?.action_count && (
                            <Badge
                              variant="destructive"
                              className="ml-auto h-4 min-w-4 rounded-full px-1 text-[10px] group-data-[collapsible=icon]:hidden"
                            >
                              {policy.action_count}
                            </Badge>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
