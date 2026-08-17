import React from "react";
import TabbedPage from "@/components/TabbedPage";
import RiskCalculator from "./RiskCalculator";
import Backtester from "./Backtester";
import Alerts from "./Alerts";
import AlertTemplates from "./AlertTemplates";
import Snippets from "./Snippets";
import ManualSignal from "./ManualSignal";
import Logs from "./Logs";
import Playbook from "./Playbook";
import Watchlist from "./Watchlist";

/**
 * Task #231 — consolidated Tools page. Replaces 9 top-level nav items
 * (RiskCalculator, Backtester, Alerts, AlertTemplates, Snippets,
 * ManualSignal, Logs, Playbook, Watchlist). Old URLs still work.
 */
export default function Tools() {
  return (
    <TabbedPage
      title="Tools"
      subtitle="Risk math · Backtests · Alerts · Manual fire · Signal log"
      tabs={[
        { key: "risk",      label: "Risk calc",     icon: "🧮", Component: RiskCalculator },
        { key: "backtest",  label: "Backtester",    icon: "⏪", Component: Backtester },
        { key: "alerts",    label: "Alerts",        icon: "🔔", Component: Alerts },
        { key: "templates", label: "Templates",     icon: "📋", Component: AlertTemplates },
        { key: "snippets",  label: "Snippets",      icon: "💻", Component: Snippets },
        { key: "manual",    label: "Manual fire",   icon: "⚡", Component: ManualSignal },
        { key: "logs",      label: "Signal log",    icon: "📜", Component: Logs },
        { key: "playbook",  label: "Playbook",      icon: "🛡️", Component: Playbook },
        { key: "watchlist", label: "Watchlist",     icon: "👁️", Component: Watchlist },
      ]}
    />
  );
}
