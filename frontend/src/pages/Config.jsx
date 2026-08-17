import React from "react";
import TabbedPage from "@/components/TabbedPage";
import Accounts from "./Accounts";
import Rotation from "./Rotation";
import Strategies from "./Strategies";
import Mt5Mirror from "./Mt5Mirror";
import Integrations from "./Integrations";
import TradingSchedule from "./TradingSchedule";
import AssetRegistry from "./AssetRegistry";
import Webhooks from "./Webhooks";
import ConnectPMT from "./ConnectPMT";

/**
 * Task #231 — consolidated Config page. Replaces 9 top-level nav items
 * (Accounts, Rotation, Strategies, Mt5Mirror, Integrations, Trading-
 * Schedule, AssetRegistry, Webhooks, ConnectPMT). Old URLs still work.
 *
 * Ordered by the trader's onboarding sequence: accounts first, then
 * copies (mt5), then rotation, then strategies + everything else.
 */
export default function Config() {
  return (
    <TabbedPage
      title="Config"
      subtitle="Accounts · Copies · Rotation · Strategies · Integrations — set once, run forever"
      tabs={[
        { key: "accounts",     label: "Accounts",     icon: "💼", Component: Accounts },
        { key: "mt5",          label: "MT5 mirror",   icon: "🔁", Component: Mt5Mirror },
        { key: "rotation",     label: "Rotation",     icon: "🔄", Component: Rotation },
        { key: "strategies",   label: "Strategies",   icon: "📚", Component: Strategies },
        { key: "schedule",     label: "Schedule",     icon: "🕐", Component: TradingSchedule },
        { key: "assets",       label: "Assets",       icon: "🎯", Component: AssetRegistry },
        { key: "webhooks",     label: "Webhooks",     icon: "🔔", Component: Webhooks },
        { key: "integrations", label: "Integrations", icon: "🔌", Component: Integrations },
        { key: "pmt",          label: "PMT connect",  icon: "📡", Component: ConnectPMT },
      ]}
    />
  );
}
