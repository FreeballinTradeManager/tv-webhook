// Frontend audit log — localStorage-backed ring buffer for trader-facing
// UI actions. Not a compliance log (that lives server-side once #100
// gets a backend), but useful right now for "what did I click that
// caused X" post-mortems.
//
// Usage:
//   import { audit } from "@/lib/audit_log";
//   audit("kill_switch.fire", { reason: "emergency", flattenAll: true });
//
// Auto-adds ts + session id. Cap at ~500 rows so localStorage stays lean.

const KEY  = "tradecore_audit_log_v1";
const CAP  = 500;
const SESSKEY = "tradecore_audit_session_v1";

function sessionId() {
  let s = sessionStorage.getItem(SESSKEY);
  if (!s) {
    s = `s_${new Date().toISOString().slice(0,10)}_${Math.random().toString(36).slice(2,8)}`;
    sessionStorage.setItem(SESSKEY, s);
  }
  return s;
}

export function audit(event, payload = {}) {
  try {
    const rows = loadAudit();
    rows.push({
      ts: new Date().toISOString(),
      session: sessionId(),
      event,
      payload,
    });
    if (rows.length > CAP) rows.splice(0, rows.length - CAP);
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch (e) {
    console.warn("audit failed:", e);
  }
}
export function loadAudit() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}
export function clearAudit() { localStorage.removeItem(KEY); }

// Standard event catalog — makes greps easier and keeps names honest.
export const AUDIT_EVENTS = {
  KILL_SWITCH_FIRE:    "kill_switch.fire",
  KILL_SWITCH_RELEASE: "kill_switch.release",
  ACCOUNT_PAUSE:       "account.pause",
  ACCOUNT_RESUME:      "account.resume",
  ACCOUNT_DELETE:      "account.delete",
  POSITION_CLOSE:      "position.close",
  GUARDIAN_RESET:      "guardian.reset",
  RULES_CLEAR:         "rules.clear",
  RULES_TICK:          "rules.tick",
  TRADE_CREATE:        "trade.create",
  TRADE_DELETE:        "trade.delete",
  TRADE_EDIT:          "trade.edit",
  JOURNAL_EDIT:        "journal.edit",
  WEBHOOK_KILL:        "webhook_retry.kill",
  WEBHOOK_RETRY_NOW:   "webhook_retry.retry_now",
  SETTINGS_SAVE:       "settings.save",
  SYMBOL_MAP_EDIT:     "symbol_map.edit",
};
