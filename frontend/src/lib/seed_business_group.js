// One-click "Seed my Business group" — creates a group named "Business"
// with your requested time-based master rotation:
//   · Account 1 = master during 18:00–01:00 ET (overnight master)
//   · Account 2 = master during 11:45–15:00 ET (day master)
//   · Accounts 3, 4, 5 = cascade pool for everything else
//
// Reads any Rule Profile called "Lucid 25k" / "Tradeify 25k" / etc.
// from the trader's saved profiles and attaches it if picked.
// Does NOT create backend Group rows — layers config on top of an
// existing group. Backend group must exist first (create via Rotation
// page's "New Group" button, name it "Business", then click Seed).

import { setGroupConfig, EMPTY_GROUP_CFG } from "./group_config";

export function seedBusinessGroupConfig(groupId, memberAccountIds, options = {}) {
  const [a1, a2, a3, a4, a5] = memberAccountIds;
  const cfg = {
    ...EMPTY_GROUP_CFG,
    rule_profile_id: options.rule_profile_id || "",
    uses_per_account: options.uses_per_account || 1,
    time_masters: [
      // Overnight master: 18:00 ET → 01:00 ET (wraps midnight)
      ...(a1 ? [{ start_hh: 18, start_mm: 0, end_hh: 1, end_mm: 0, account_id: a1 }] : []),
      // Day master: 11:45 ET → 15:00 ET
      ...(a2 ? [{ start_hh: 11, start_mm: 45, end_hh: 15, end_mm: 0, account_id: a2 }] : []),
    ],
    cascade_order: [a1, a2, a3, a4, a5].filter(Boolean),
    notes: "Business group — acct 1 overnight master (18:00–01:00), acct 2 day master (11:45–15:00), acct 3/4/5 cascade pool.",
  };
  setGroupConfig(groupId, cfg);
  return cfg;
}
