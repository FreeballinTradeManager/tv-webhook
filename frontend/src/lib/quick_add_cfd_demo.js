// quick_add_cfd_demo.js
// Creates a demo Account row for a CFD prop firm (FTMO / FundedNext / etc.)
// and pre-configures the MT5 mirror so the trader lands straight in the
// setup guide with sensible defaults.
//
// Design note: everything happens in ONE Account.create() call — no chained
// backend writes — because the mirror config is client-side localStorage
// only in Phase 1. When Phase 2B ships, the MetaAPI creds go server-side
// via /api/mt5/connect; this file stays the same.

import { Account } from "@/entities/all";
import { setMirrorCfg } from "@/lib/mt5_mirror";

// Preset catalog — starting balance + platform + broker label + typical
// symbol-suffix per firm. FTMO free trial is $10k, FN Stellar Lite trial
// is $15k. Numbers are for tracking only — actual balance comes from the
// broker once creds land.
export const CFD_DEMO_PRESETS = {
  FTMO: {
    name:             "FTMO Free Trial (demo)",
    broker_name:      "FTMO",
    account_type:     "demo",
    account_number:   "",           // fills in when user pastes MT5 login
    currency:         "USD",
    starting_balance: 10000,
    current_balance:  10000,
    daily_max_loss:   500,          // 5% of 10k, matches FTMO's default rule
    total_max_loss:   1000,         // 10% overall
    leverage:         100,
    mirror: {
      broker:              "FTMO",
      platform:            "MT5",
      suffix:              "",       // FTMO uses bare tickers on their MT5
      sizingMode:          "match_risk",
      fixedLot:            0.10,
      riskCapUsd:          50,       // conservative on 10k demo
      priceConversionMode: "market", // safest default
    },
    signup_url: "https://ftmo.com/en/challenges-free-trial/",
  },

  FundedNext: {
    name:             "FundedNext Stellar Lite (demo)",
    broker_name:      "FundedNext",
    account_type:     "demo",
    account_number:   "",
    currency:         "USD",
    starting_balance: 15000,
    current_balance:  15000,
    daily_max_loss:   750,          // 5% of 15k
    total_max_loss:   1500,         // 10%
    leverage:         100,
    mirror: {
      broker:              "FundedNext",
      platform:            "MT5",
      suffix:              "",       // FN uses bare tickers on their MT5
      sizingMode:          "match_risk",
      fixedLot:            0.10,
      riskCapUsd:          75,       // slightly more on 15k
      priceConversionMode: "market",
    },
    signup_url: "https://fundednext.com/",
  },

  The5ers: {
    name:             "The5%ers Bootcamp (demo)",
    broker_name:      "The5ers",
    account_type:     "demo",
    account_number:   "",
    currency:         "USD",
    starting_balance: 20000,
    current_balance:  20000,
    daily_max_loss:   800,          // 4% of 20k
    total_max_loss:   1200,         // 6%
    leverage:         30,           // The5ers uses lower leverage
    mirror: {
      broker:              "The5ers",
      platform:            "MT5",
      suffix:              ".cash",  // The5ers is one of the .cash-suffix brokers
      sizingMode:          "match_risk",
      fixedLot:            0.10,
      riskCapUsd:          100,
      priceConversionMode: "market",
    },
    signup_url: "https://the5ers.com/",
  },
};

// Create the account row + attach the mirror config in one shot.
// Returns the created Account (with .id) so the caller can jump the user
// straight into the setup guide.
export async function addCfdDemoAccount(presetKey) {
  const preset = CFD_DEMO_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown CFD demo preset: ${presetKey}`);

  // Backend Account.create — strip our custom "mirror" + "signup_url" keys
  // so the backend model doesn't error on unknown fields.
  const { mirror, signup_url, ...backendPayload } = preset;
  const created = await Account.create(backendPayload);
  if (!created?.id) throw new Error("Backend did not return account id");

  // Client-side mirror config — enabled by default so the setup guide
  // appears on the /Mt5Mirror page without extra clicks.
  setMirrorCfg(created.id, { enabled: true, ...mirror });

  return { account: created, preset };
}

// Convenience: list of preset keys for the UI buttons
export function listCfdDemoPresets() {
  return Object.entries(CFD_DEMO_PRESETS).map(([key, p]) => ({
    key, name: p.name, broker: p.broker_name,
    balance: p.starting_balance, platform: p.mirror.platform,
    signup_url: p.signup_url,
  }));
}
