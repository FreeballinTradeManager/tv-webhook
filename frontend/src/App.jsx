import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
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
import Setup from './pages/Setup'
import Demo from './pages/Demo'
import Snippets from './pages/Snippets'
import AlertTemplates from './pages/AlertTemplates'
import Playbook from './pages/Playbook'
import Logs from './pages/Logs'
import Watchlist from './pages/Watchlist'
import Subscriptions from './pages/Subscriptions'
import Reports from './pages/Reports'
import PublicStats from './pages/PublicStats'
import TradeShare from './pages/TradeShare'
import PropFirmOnboarding from './pages/PropFirmOnboarding'
import ConnectPMT from './pages/ConnectPMT'
import AssetRegistry from './pages/AssetRegistry'
import TradingSchedule from './pages/TradingSchedule'
import ChartDrawings from './pages/ChartDrawings'
import ManualSignal from './pages/ManualSignal'
import Mt5Mirror from './pages/Mt5Mirror'
import Webhooks from './pages/Webhooks'
import Integrations from './pages/Integrations'
import TradeJournal from './pages/TradeJournal'
import AIInsights from './pages/AIInsights'
import WhatIf from './pages/WhatIf'
import DailyJournal from './pages/DailyJournal'
import SignIn, { isAuthed } from './pages/SignIn'

// Redirect to /SignIn when there's no session. Preserves the path they
// tried to hit so we can bounce them back after login.
function RequireAuth({ children }) {
  const location = useLocation()
  if (!isAuthed()) {
    return <Navigate to="/SignIn" state={{ from: location.pathname }} replace />
  }
  return children
}

// Auth pages don't render inside the sidebar Layout — full-screen.
function AuthOnly({ children }) {
  if (isAuthed()) return <Navigate to="/Dashboard" replace />
  return children
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Public auth routes — full-screen, no sidebar */}
        <Route path="/SignIn" element={<AuthOnly><SignIn /></AuthOnly>} />
        <Route path="/SignUp" element={<AuthOnly><SignIn /></AuthOnly>} />
        <Route path="/Login"  element={<AuthOnly><SignIn /></AuthOnly>} />

        {/* Public read-only stats — no auth required. Opt-in per trader. */}
        <Route path="/public/:handle" element={<PublicStats />} />
        <Route path="/p/:handle"      element={<PublicStats />} />

        {/* Per-trade share URL — public, opt-in. Task #117. */}
        <Route path="/trade/:id/share" element={<TradeShare />} />
        <Route path="/t/:id"           element={<TradeShare />} />

        {/* Protected app routes — sidebar Layout, auth-gated */}
        <Route path="/*" element={
          <RequireAuth>
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
                <Route path="/Setup" element={<Setup />} />
                <Route path="/Onboarding" element={<Setup />} />
                <Route path="/Onboarding/prop-firm"          element={<PropFirmOnboarding />} />
                <Route path="/Onboarding/prop-firm/:firmKey" element={<PropFirmOnboarding />} />
                <Route path="/Demo" element={<Demo />} />
                <Route path="/Sandbox" element={<Demo />} />
                <Route path="/Snippets" element={<Snippets />} />
                <Route path="/AlertTemplates" element={<AlertTemplates />} />
                <Route path="/Templates"      element={<AlertTemplates />} />
                <Route path="/Playbook"       element={<Playbook />} />
                <Route path="/Rules"          element={<Playbook />} />
                <Route path="/Logs"           element={<Logs />} />
                <Route path="/Signals"        element={<Logs />} />
                <Route path="/Watchlist"      element={<Watchlist />} />
                <Route path="/Subscriptions"  element={<Subscriptions />} />
                <Route path="/Billing"        element={<Subscriptions />} />
                <Route path="/Reports"        element={<Reports />} />
                <Route path="/Report"         element={<Reports />} />
                <Route path="/DailyJournal" element={<DailyJournal />} />
                <Route path="/Journal" element={<DailyJournal />} />
                <Route path="/ConnectPMT" element={<ConnectPMT />} />
                <Route path="/Connect"    element={<ConnectPMT />} />
                <Route path="/AssetRegistry"    element={<AssetRegistry />} />
                <Route path="/Assets"           element={<AssetRegistry />} />
                <Route path="/TradingSchedule"  element={<TradingSchedule />} />
                <Route path="/Schedule"         element={<TradingSchedule />} />
                <Route path="/ChartDrawings"    element={<ChartDrawings />} />
                <Route path="/Drawings"         element={<ChartDrawings />} />
                <Route path="/ManualSignal"     element={<ManualSignal />} />
                <Route path="/TestSignal"       element={<ManualSignal />} />
                <Route path="/Mt5Mirror"        element={<Mt5Mirror />} />
                <Route path="/MT5"              element={<Mt5Mirror />} />
                <Route path="/Mirror"           element={<Mt5Mirror />} />
                <Route path="/CFD"              element={<Mt5Mirror />} />
                <Route path="/Forex"            element={<Mt5Mirror />} />
                <Route path="/Webhooks"         element={<Webhooks />} />
                <Route path="/OutgoingWebhooks" element={<Webhooks />} />
                <Route path="/Notifications"    element={<Webhooks />} />
                <Route path="/Integrations"     element={<Integrations />} />
                <Route path="/Connect"          element={<Integrations />} />
                <Route path="/Services"         element={<Integrations />} />
                <Route path="/API"              element={<Integrations />} />
                <Route path="/TradeJournal"     element={<TradeJournal />} />
                <Route path="/TradeLog"         element={<TradeJournal />} />
                <Route path="/Log"              element={<TradeJournal />} />
                <Route path="/AIInsights"       element={<AIInsights />} />
                <Route path="/AI"               element={<AIInsights />} />
                <Route path="/Insights"         element={<AIInsights />} />
                <Route path="/Coach"            element={<AIInsights />} />
                <Route path="/WhatIf"           element={<WhatIf />} />
                <Route path="/WhatIfAnalyzer"   element={<WhatIf />} />
                <Route path="/Counterfactual"   element={<WhatIf />} />
                <Route path="*" element={<PageNotFound />} />
              </Routes>
            </Layout>
          </RequireAuth>
        } />
      </Routes>
    </>
  )
}
