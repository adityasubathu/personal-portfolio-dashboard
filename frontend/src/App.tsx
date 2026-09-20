import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Skeleton } from '@/components/ui/skeleton'
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const NavHistory = lazy(() => import('./pages/NavHistory').then((m) => ({ default: m.NavHistory })));
const Breakdown = lazy(() => import('./pages/Breakdown').then((m) => ({ default: m.Breakdown })));
const FundBreakdown = lazy(() => import('./pages/FundBreakdown').then((m) => ({ default: m.FundBreakdown })));
const PriceChart = lazy(() => import('./pages/PriceChart').then((m) => ({ default: m.PriceChart })));
const NavChart = lazy(() => import('./pages/NavChart').then((m) => ({ default: m.NavChart })));
const Trades = lazy(() => import('./pages/Trades').then((m) => ({ default: m.Trades })));
const Import = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })));
const Kite = lazy(() => import('./pages/Kite').then((m) => ({ default: m.Kite })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const PolicyTracker = lazy(() => import('./pages/PolicyTracker').then((m) => ({ default: m.PolicyTracker })));
const MarketSentiment = lazy(() => import('./pages/MarketSentiment').then((m) => ({ default: m.MarketSentiment })));
const CapitalGains = lazy(() => import('./pages/CapitalGains').then((m) => ({ default: m.CapitalGains })));

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-44 w-full" />
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}><Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/portfolio/nav-history" element={<NavHistory />} />
        <Route path="/portfolio/breakdown" element={<Breakdown />} />
        <Route path="/portfolio/fund-breakdown" element={<FundBreakdown />} />
        <Route path="/market/sentiment" element={<MarketSentiment />} />
        <Route path="/portfolio/capital-gains" element={<CapitalGains />} />
        <Route path="/charts/price" element={<PriceChart />} />
        <Route path="/charts/nav" element={<NavChart />} />
        <Route path="/trades" element={<Trades />} />
        <Route path="/import" element={<Import />} />
        <Route path="/kite" element={<Kite />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/policy" element={<PolicyTracker />} />
      </Route>
    </Routes></Suspense>
  )
}

export default App
