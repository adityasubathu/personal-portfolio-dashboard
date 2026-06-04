import { Routes, Route } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Text } from '@mantine/core'

// Stub pages — will be replaced in Phase 3
function Stub({ name }: { name: string }) {
  return <Text c="dimmed" p="md">{name} — coming in Phase 3</Text>
}

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Stub name="Dashboard" />} />
        <Route path="/portfolio/nav-history" element={<Stub name="NAV History" />} />
        <Route path="/portfolio/breakdown" element={<Stub name="Breakdown" />} />
        <Route path="/portfolio/fund-breakdown" element={<Stub name="Fund Detail" />} />
        <Route path="/charts/price" element={<Stub name="Price Chart" />} />
        <Route path="/charts/nav" element={<Stub name="Fund NAV Chart" />} />
        <Route path="/trades" element={<Stub name="Trades" />} />
        <Route path="/import" element={<Stub name="Import" />} />
        <Route path="/kite" element={<Stub name="Kite" />} />
        <Route path="/settings" element={<Stub name="Settings" />} />
      </Route>
    </Routes>
  )
}

export default App
