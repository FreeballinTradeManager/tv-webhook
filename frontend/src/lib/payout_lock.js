// payout_lock.js
// Per-account "daily win target" — when today's realized P&L crosses the
// target, TradeCore surfaces a lock advisory and offers one-click pause.
//
// Complements Account.daily_max_loss (down-side). Payout lock is the
// up-side counterpart: "you're up $500, close the book, take the win."
//
// Frontend-only for now — config in localStorage, evaluation in the UI.
// When backend #40 auth ships, this moves to Account.daily_win_target
// with the executor preflight actually blocking new signals.
//
// Config shape (per account, stored in localStorage):
//   {
//     enabled:      bool,
//     target_usd:   number,          // required, > 0
//     warn_at_pct:  number 0..1,     // amber warning at this fraction of target
//     auto_pause:   bool,            // when target hit, offer one-click pause
//     lock_until:   "midnight" | "manual",
//     acknowledged: { [YYYY-MM-DD]: true }  // per-day dismissal — banner mutes if acked
//   }

const CFG_KEY = "tradecore_payout_lock_cfg_v1";

const DEFAULTS = {
  enabled:      false,
  target_usd:   500,
  warn_at_pct:  0.75,      // amber at 75% of target
  auto_pause:   false,     // opt-in — many traders prefer to close manually
  lock_until:   "midnight",
  acknowledged: {},
};

// ---- Config storage ---------------------------------------------------------

function loadAll() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); }
  catch { return {}; }
}
function saveAll(o) { try { localStorage.setItem(CFG_KEY, JSON.stringify(o || {})); } catch {} }

export function getPayoutCfg(accountId) {
  const all = loadAll();
  return { ...DEFAULTS, ...(all[String(accountId)] || {}) };
}

export function setPayoutCfg(accountId, patch) {
  const all = loadAll();
  const key = String(accountId);
  all[key] = { ...DEFAULTS, ...(all[key] || {}), ...patch };
  saveAll(all);
  return all[key];
}

export function ackToday(accountId) {
  const cfg = getPayoutCfg(accountId);
  const today = new Date().toISOString().slice(0, 10);
  const nextAck = { ...(cfg.acknowledged || {}), [today]: true };
  return setPayoutCfg(accountId, { acknowledged: nextAck });
}

export function isAckedToday(accountId) {
  const cfg = getPayoutCfg(accountId);
  const today = new Date().toISOString().slice(0, 10);
  return !!(cfg.acknowledged || {})[today];
}

// ---- Evaluation -------------------------------------------------------------
//
// Given an account (with pnl_today) and its config, return a status object:
//
//   { level:   "off" | "under" | "warn" | "hit" | "acked",
//     progress: 0..1,
//     target:  number,
//     pnl_today: number,
//     to_target: number (positive = still to go, negative = past target),
//     label:   short human string }
//
export function evaluatePayoutLock(account) {
  if (!account) return { level: "off" };
  const cfg = getPayoutCfg(account.id);
  if (!cfg.enabled || !cfg.target_usd || cfg.target_usd <= 0) {
    return { level: "off", target: cfg.target_usd || 0, pnl_today: Number(account.pnl_today) || 0 };
  }

  const pnl    = Number(account.pnl_today) || 0;
  const target = Number(cfg.target_usd);
  const progress  = target > 0 ? pnl / target : 0;
  const to_target = target - pnl;

  if (isAckedToday(account.id)) {
    return { level: "acked", progress, target, pnl_today: pnl, to_target,
             label: "Target hit — acknowledged" };
  }
  if (pnl >= target) {
    return { level: "hit", progress, target, pnl_today: pnl, to_target,
             label: `🎯 Target hit — up $${fmtInt(pnl)} on $${fmtInt(target)} goal` };
  }
  if (progress >= (cfg.warn_at_pct || 0.75)) {
    return { level: "warn", progress, target, pnl_today: pnl, to_target,
             label: `${Math.round(progress * 100)}% of $${fmtInt(target)} target · $${fmtInt(to_target)} to go` };
  }
  return { level: "under", progress, target, pnl_today: pnl, to_target,
           label: `${Math.round(Math.max(0, progress) * 100)}% of $${fmtInt(target)} target` };
}

// Bulk evaluate — one status per account. Used by the Dashboard banner.
export function evaluateAll(accounts) {
  return (accounts || []).map(a => ({ account: a, status: evaluatePayoutLock(a) }));
}

// Accounts that are ready to lock — level=hit and NOT acked
export function pendingLocks(accounts) {
  return evaluateAll(accounts).filter(e => e.status.level === "hit");
}

function fmtInt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString();
}
