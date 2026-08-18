import React from "react";
import TabbedPage from "@/components/TabbedPage";
import RiskCalculator from "./RiskCalculator";
import Alerts from "./Alerts";
import AlertTemplates from "./AlertTemplates";
import Snippets from "./Snippets";
import ManualSignal from "./ManualSignal";
import Logs from "./Logs";
import Playbook from "./Playbook";
import Watchlist from "./Watchlist";

/**
 * Task #231 — consolidated Tools page. Task #232 — removed Backtester
 * tab (it's a manual bar-replay clicker, not a strategy backtester; we
 * test strategies in TradingView native and via task #170 Alert Replay).
 * /Backtester route still works for bookmark compat.
 */
export default function Tools() {
  return (
    <TabbedPage
      title="Tools"
      subtitle="Risk math · Alerts · Manual fire · Signal log"
      tabs={[
        // Ruthless cut — only what she uses. Everything else stays URL-accessible.
        { key: "manual",    label: "Manual fire",   icon: "⚡",  Component: ManualSignal },
        { key: "logs",      label: "Signal log",    icon: "📜", Component: Logs },
        { key: "templates", label: "Alert JSON",    icon: "📋", Component: AlertTemplates },
        { key: "risk",      label: "Risk calc",     icon: "🧮", Component: RiskCalculator },
      ]}
    />
  );
}
