// Prop-firm Rule Profiles — save once, reuse everywhere.
//
// The trader configures her prop firm's rules once (e.g. "Lucid 25k"),
// saves it as a Rule Profile, then attaches it to an Account or an
// Account Group. Rotation reads the profile at run-time so daily loss
// limits, trailing DD, consistency rule, max losing accounts all
// enforce automatically without hardcoding anything per account.
//
// Modes:
//   · Evaluation — full field set (target, trailing DD, consistency)
//   · Live       — subset (target, loss limit, max losing accounts)
//   · Custom     — every field visible
//
// Consistency limit is auto-computed as Profit Target × Consistency %.

const KEY = "tradecore_rule_profiles_v1";

// Shape of a profile row. All fields except name+mode are optional so
// Live-mode profiles don't have to fill in evaluation-only stuff.
export const EMPTY_PROFILE = {
  id: "",
  name: "",
  mode: "Live",              // "Live" | "Evaluation" | "Custom"
  firm: "",                  // free-text tag, e.g. "Lucid", "Apex", "MFFU"
  size: "",                  // free-text, e.g. "25k", "50k", "150k"
  profit_target: 0,
  daily_loss_limit: 0,
  loss_limit: 0,             // Live-mode field (all-time loss cap)
  trailing_dd: 0,
  consistency_on: false,
  consistency_source: "percent",    // "percent" | "fixed"  — pick which drives the cap
  consistency_pct: 50,              // used when source="percent"
  consistency_fixed_usd: 0,         // used when source="fixed" — a straight $ cap regardless of target
  max_losing_accounts: 0,
  uses_per_account: 1,       // rotation: how many times a single account fires before advancing (1 or 2 typical)
  notes: "",
};

export function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
export function saveProfiles(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}
export function upsertProfile(p) {
  const list = loadProfiles();
  const idx = list.findIndex(x => x.id === p.id);
  if (idx >= 0) list[idx] = p;
  else list.push({ ...p, id: p.id || `rp_${Date.now()}_${Math.random().toString(36).slice(2,6)}` });
  saveProfiles(list);
  return list;
}
export function deleteProfile(id) {
  const list = loadProfiles().filter(x => x.id !== id);
  saveProfiles(list);
  return list;
}
export function profileById(id) {
  return loadProfiles().find(x => x.id === id) || null;
}

// The one derived value the trader cares about: absolute $ that the
// account's biggest winning day can be. Two sources:
//   · "percent" — computed from target × pct (e.g. $1250 × 50% = $625)
//   · "fixed"   — a straight $ cap the trader typed (e.g. $300 regardless of target)
export function consistencyLimit(profile) {
  if (!profile || !profile.consistency_on) return null;
  if (profile.consistency_source === "fixed") {
    const v = Number(profile.consistency_fixed_usd) || 0;
    return v > 0 ? v : null;
  }
  const target = Number(profile.profit_target) || 0;
  const pct = Number(profile.consistency_pct) || 0;
  return target * (pct / 100);
}

// Which fields are visible for each mode. The card renders from this
// so adding a mode later is a one-line edit.
// consistency_source + consistency_pct + consistency_fixed_usd all sit
// under the consistency block; the block itself is gated by consistency_on.
export const MODE_FIELDS = {
  Live: [
    "firm", "size", "profit_target", "loss_limit",
    "max_losing_accounts", "uses_per_account", "notes",
  ],
  Evaluation: [
    "firm", "size", "profit_target",
    "consistency_on",
    "trailing_dd", "daily_loss_limit",
    "max_losing_accounts", "uses_per_account", "notes",
  ],
  Custom: [
    "firm", "size", "profit_target", "loss_limit",
    "consistency_on",
    "trailing_dd", "daily_loss_limit",
    "max_losing_accounts", "uses_per_account", "notes",
  ],
};

// Seed presets the trader can drop in with one click. Add more here as
// she gives me the exact rules.
export const SEED_PROFILES = [
  {
    name: "Lucid 25k (Evaluation)",
    mode: "Evaluation",
    firm: "Lucid",
    size: "25k",
    profit_target: 1250,
    trailing_dd: 1000,
    daily_loss_limit: 750,
    consistency_on: true,
    consistency_pct: 50,   // 50% single-day cap
    max_losing_accounts: 2,
    loss_limit: 0,
    notes: "Placeholder — verify exact numbers with Lucid before trusting.",
  },
  {
    name: "Lucid 50k (Evaluation)",
    mode: "Evaluation",
    firm: "Lucid",
    size: "50k",
    profit_target: 2500,
    trailing_dd: 2000,
    daily_loss_limit: 1250,
    consistency_on: true,
    consistency_pct: 50,
    max_losing_accounts: 2,
    loss_limit: 0,
    notes: "Placeholder — verify exact numbers with Lucid before trusting.",
  },
  {
    name: "Apex 25k (Evaluation)",
    mode: "Evaluation",
    firm: "Apex",
    size: "25k",
    profit_target: 1500,
    trailing_dd: 1500,
    daily_loss_limit: 0,
    consistency_on: false,
    consistency_pct: 0,
    max_losing_accounts: 3,
    loss_limit: 0,
    notes: "Apex has no daily loss / no consistency — trailing DD only.",
  },
  {
    name: "MFFU 50k (Live)",
    mode: "Live",
    firm: "MFFU",
    size: "50k",
    profit_target: 3000,
    loss_limit: 2500,
    max_losing_accounts: 2,
    daily_loss_limit: 0,
    trailing_dd: 0,
    consistency_on: false,
    consistency_pct: 0,
    notes: "Live payout account — no consistency once funded.",
  },
  {
    name: "Tradeify 25k (Advanced Eval)",
    mode: "Evaluation",
    firm: "Tradeify",
    size: "25k",
    profit_target: 1500,
    trailing_dd: 1500,
    daily_loss_limit: 625,
    consistency_on: false,
    consistency_pct: 0,
    max_losing_accounts: 2,
    loss_limit: 0,
    notes: "Static DD variant — no consistency rule during eval. Placeholder $, verify current Tradeify page.",
  },
  {
    name: "Tradeify 25k (Live PA)",
    mode: "Live",
    firm: "Tradeify",
    size: "25k",
    profit_target: 1500,
    loss_limit: 1500,
    max_losing_accounts: 2,
    daily_loss_limit: 0,
    trailing_dd: 0,
    consistency_on: false,
    consistency_pct: 0,
    notes: "Funded PA — verify current Tradeify page.",
  },
  {
    name: "Tradeify 50k (Advanced Eval)",
    mode: "Evaluation",
    firm: "Tradeify",
    size: "50k",
    profit_target: 3000,
    trailing_dd: 2500,
    daily_loss_limit: 1250,
    consistency_on: false,
    consistency_pct: 0,
    max_losing_accounts: 2,
    loss_limit: 0,
    notes: "Static DD variant — no consistency rule during eval. Placeholder $, verify current Tradeify page.",
  },
  {
    name: "Tradeify 50k (Live PA)",
    mode: "Live",
    firm: "Tradeify",
    size: "50k",
    profit_target: 3000,
    loss_limit: 2500,
    max_losing_accounts: 2,
    daily_loss_limit: 0,
    trailing_dd: 0,
    consistency_on: false,
    consistency_pct: 0,
    notes: "Funded PA — payout eligibility per Tradeify's PA schedule.",
  },
];

// Bulk-seed: only creates presets that don't already exist by name.
export function seedDefaultProfiles() {
  const existing = new Set(loadProfiles().map(p => p.name.toLowerCase()));
  let added = 0;
  for (const preset of SEED_PROFILES) {
    if (existing.has(preset.name.toLowerCase())) continue;
    upsertProfile({ ...EMPTY_PROFILE, ...preset });
    added += 1;
  }
  return added;
}
