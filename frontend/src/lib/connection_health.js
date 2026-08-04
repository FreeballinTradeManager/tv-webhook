// Task #61 — broker feed health.
//
// TradeCore is only useful when signals are actually reaching it. This
// module derives a health status from the account's last_signal_at
// timestamp (server sets this on every incoming webhook).
//
// Especially critical for observe-mode users (PMT / TradersPost): if
// their SECOND-webhook setup drifts, our journal goes dark silently.
// The pill on the account card is what tells them.

const MIN = 60_000;

export const HEALTH = {
  LIVE:    { key: "live",    label: "LIVE",    tone: "emerald", dotClass: "bg-emerald-500 shadow-emerald-500/50",   textClass: "text-emerald-300" },
  SILENT:  { key: "silent",  label: "SILENT",  tone: "slate",   dotClass: "bg-slate-500",                          textClass: "text-slate-400"   },
  STALE:   { key: "stale",   label: "STALE",   tone: "red",     dotClass: "bg-red-500 shadow-red-500/60 animate-pulse", textClass: "text-red-300"     },
  UNKNOWN: { key: "unknown", label: "NO DATA", tone: "slate",   dotClass: "bg-slate-700",                          textClass: "text-slate-500"   },
};

// Age thresholds (ms). Tunable per user later via Settings (task #181).
export const LIVE_MS   = 10 * MIN;   // <10min → LIVE
export const SILENT_MS = 60 * MIN;   // 10-60min → SILENT
                                     // >60min → STALE

export function feedHealth(account, now = Date.now()) {
  if (!account) return HEALTH.UNKNOWN;
  const last = account.last_signal_at ? new Date(account.last_signal_at).getTime() : null;
  if (!last) return HEALTH.UNKNOWN;
  const age = now - last;
  if (age < LIVE_MS)   return HEALTH.LIVE;
  if (age < SILENT_MS) return HEALTH.SILENT;
  return HEALTH.STALE;
}

// Human-friendly "3m ago" / "2h ago" — no library dep.
export function relativeAge(ts, now = Date.now()) {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000));
  if (s < 60)          return `${s}s ago`;
  if (s < 60 * 60)     return `${Math.floor(s / 60)}m ago`;
  if (s < 60 * 60 * 24) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Roll up a fleet into ONE global status — worst wins, so the header
// indicator screams if any active account has gone stale.
export function fleetHealth(accounts = []) {
  const active = accounts.filter(a => a?.active !== false);
  if (!active.length) return HEALTH.UNKNOWN;
  const statuses = active.map(a => feedHealth(a));
  if (statuses.some(s => s === HEALTH.STALE))  return HEALTH.STALE;
  if (statuses.some(s => s === HEALTH.LIVE))   return HEALTH.LIVE;
  if (statuses.some(s => s === HEALTH.SILENT)) return HEALTH.SILENT;
  return HEALTH.UNKNOWN;
}
