import { Routes, Route } from 'react-router-dom'
import Layout from './Layout'
import ScrollToTop from './components/ScrollToTop'
import PageNotFound from './lib/PageNotFound'
import Dashboard from './pages/Dashboard'
import NewTrade from './pages/NewTrade'
import RiskCalculator from './pages/RiskCalculator'
import Trades from './pages/Trades'
import Accounts from './pages/Accounts'
import Analytics from './pages/Analytics'
import Strategies from './pages/Strategies'
import Alerts from './pages/Alerts'
import Settings from './pages/Settings'
import Backtester from './pages/Backtester'
import Vault from './pages/Vault'
import LivePositions from './pages/LivePositions'
import Rotation from './pages/Rotation'

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/Dashboard" element={<Dashboard />} />
          <Route path="/NewTrade" element={<NewTrade />} />
          <Route path="/RiskCalculator" element={<RiskCalculator />} />
          <Route path="/Trades" element={<Trades />} />
          <Route path="/Accounts" element={<Accounts />} />
          <Route path="/Analytics" element={<Analytics />} />
          <Route path="/Strategies" element={<Strategies />} />
          <Route path="/Alerts" element={<Alerts />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/Backtester" element={<Backtester />} />
          <Route path="/Vault" element={<Vault />} />
          <Route path="/LivePositions" element={<LivePositions />} />
          <Route path="/Live" element={<LivePositions />} />
          <Route path="/Rotation" element={<Rotation />} />
          <Route path="/Groups" element={<Rotation />} />
          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Layout>
    </>
  )
}
