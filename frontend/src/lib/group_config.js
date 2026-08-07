// Extended per-group config that layers on top of the backend Group model.
// Backend keeps the source-of-truth account list + basic cascade order.
// This lib stores the "customization surface" trader configures in the UI:
//
//   · rule_profile_id  — attach a saved Rule Profile (rules the rotation follows)
//   · time_masters     — list of { start_hh, start_mm, end_hh, end_mm, account_id }
//                         so a specific account is master during a specific window
//                         (e.g. Business Group: acct 1 master 18:00–01:00, acct 2 master 11:45–15:00)
//   · cascade_order    — explicit account_id ordering within the group; masters + rest
//   · uses_per_account — how many trades a single account fires before rotating (1/2/3/5)
//                         overrides Rule Profile default when set locally
//   · notes            — free-text
//
// All fields optional; unset means "use backend defaults / no time-masters".
// The routing engine reads this at run-time (once wired) — until then, this
// is the source of truth for the UI display.

const KEY = "tradecore_group_config_v1";

export const EMPTY_GROUP_CFG = {
  rule_profile_id: "",
  time_masters: [],      // [{ start_hh: 18, start_mm: 0, end_hh: 1, end_mm: 0, account_id: "X" }]
  cascade_order: [],     // [account_id, ...]
  uses_per_account: 0,   // 0 = inherit from Rule Profile
  notes: "",
};

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}
function saveAll(obj) {
  localStorage.setItem(KEY, JSON.stringify(obj));
}

export function getGroupConfig(groupId) {
  const all = loadAll();
  return { ...EMPTY_GROUP_CFG, ...(all[groupId] || {}) };
}

export function setGroupConfig(groupId, cfg) {
  const all = loadAll();
  all[groupId] = { ...EMPTY_GROUP_CFG, ...cfg };
  saveAll(all);
  return all[groupId];
}

export function clearGroupConfig(groupId) {
  const all = loadAll();
  delete all[groupId];
  saveAll(all);
}

// Utility: given the current NY hour+minute and a config, return the
// account_id that should be master right now. Falls back to the first
// entry in cascade_order if no time-master matches.
export function currentMasterFor(cfg, nowHour, nowMin) {
  if (!cfg || !cfg.time_masters || cfg.time_masters.length === 0) {
    return cfg?.cascade_order?.[0] || null;
  }
  const nowMinTotal = nowHour * 60 + nowMin;
  for (const tm of cfg.time_masters) {
    const s = tm.start_hh * 60 + tm.start_mm;
    const e = tm.end_hh   * 60 + tm.end_mm;
    // Handle wrap (e.g. 18:00 – 01:00)
    const inWindow = s < e
      ? (nowMinTotal >= s && nowMinTotal < e)
      : (nowMinTotal >= s || nowMinTotal < e);
    if (inWindow) return tm.account_id;
  }
  return cfg.cascade_order?.[0] || null;
}

// True when an account has already earned its profit target today.
// Reads Account.pnl_today vs Profile.profit_target.
export function accountHitTarget(account, profile) {
  if (!profile || !profile.profit_target || profile.profit_target <= 0) return false;
  const pnl = Number(account?.pnl_today || 0);
  return pnl >= Number(profile.profit_target);
}

// The one function the rotation engine cares about:
// "Given the group's config + members + attached profile + right now,
//  which account should fire the next signal?"
//
// Order of checks:
//   1. Time-master for the current window (if any) — unless that account
//      already hit its profit target OR is stopped/benched → skip
//   2. Walk the cascade_order top-to-bottom, pick the first account that:
//        · is active (state != stopped/benched)
//        · hasn't hit its profit target
//   3. Return null if the whole group is exhausted (all hit target / stopped).
//      Caller then advances to next_group in the cascade chain.
export function pickCurrentAccount(cfg, accounts, profile, nowHour, nowMin) {
  const byId = Object.fromEntries((accounts || []).map(a => [a.id, a]));
  const eligible = (id) => {
    const a = byId[id];
    if (!a) return false;
    if (a.state === "stopped" || a.state === "benched") return false;
    if (accountHitTarget(a, profile)) return false;
    return true;
  };

  const nowMinTotal = nowHour * 60 + nowMin;
  for (const tm of cfg?.time_masters || []) {
    const s = tm.start_hh * 60 + tm.start_mm;
    const e = tm.end_hh   * 60 + tm.end_mm;
    const inWindow = s < e
      ? (nowMinTotal >= s && nowMinTotal < e)
      : (nowMinTotal >= s || nowMinTotal < e);
    if (inWindow && eligible(tm.account_id)) return tm.account_id;
  }

  for (const id of cfg?.cascade_order || []) {
    if (eligible(id)) return id;
  }

  return null;
}

// Utility: reorder cascade — pass old array + fromIdx + toIdx (swap up/down)
export function moveInCascade(order, fromIdx, toIdx) {
  const copy = [...order];
  if (fromIdx < 0 || fromIdx >= copy.length || toIdx < 0 || toIdx >= copy.length) return copy;
  const [row] = copy.splice(fromIdx, 1);
  copy.splice(toIdx, 0, row);
  return copy;
}

// Build a default cascade_order from a list of accounts if none set
export function defaultCascadeFrom(accounts) {
  return accounts.map(a => a.id).filter(Boolean);
}
