import React from "react";
import TabbedPage from "@/components/TabbedPage";
import Trades from "./Trades";
import TradeJournal from "./TradeJournal";
import DailyJournal from "./DailyJournal";
import AIInsights from "./AIInsights";
import WhatIf from "./WhatIf";

/**
 * Task #231 — consolidated Journal page. Replaces 5 top-level nav items
 * (Trades, TradeJournal, DailyJournal, AIInsights, WhatIf) with one nav
 * item + 5 tabs. All old URLs still work — App.jsx keeps the individual
 * routes so bookmarks and existing links don't break.
 */
export default function Journal() {
  return (
    <TabbedPage
      title="Journal"
      subtitle="Every trade you took · what you were thinking · what the data says now"
      tabs={[
        { key: "trades",  label: "All trades",   icon: "📈", Component: Trades },
        { key: "log",     label: "Log view",     icon: "📓", Component: TradeJournal },
        { key: "daily",   label: "Daily notes",  icon: "📝", Component: DailyJournal },
        { key: "ai",      label: "AI insights",  icon: "✨", Component: AIInsights },
        { key: "whatif",  label: "What-if",      icon: "🔮", Component: WhatIf },
      ]}
    />
  );
}
