import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Dashboard } from './pages/Dashboard'
import { NavHistory } from './pages/NavHistory'
import { Breakdown } from './pages/Breakdown'
import { FundBreakdown } from './pages/FundBreakdown'
import { PriceChart } from './pages/PriceChart'
import { NavChart } from './pages/NavChart'
import { Trades } from './pages/Trades'
import { Import } from './pages/Import'
import { Kite } from './pages/Kite'
import { Settings } from './pages/Settings'
import { PolicyTracker } from './pages/PolicyTracker'
import { MarketSentiment } from './pages/MarketSentiment'
import { CapitalGains } from './pages/CapitalGains'

function App() {
  return (
    <Routes>
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
    </Routes>
  )
}

export default App
