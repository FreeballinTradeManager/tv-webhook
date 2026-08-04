// Broker mode helpers — one source of truth for the observe vs direct gate.
//
// "observe"  — TradeCore is a passive listener. PMT / TradersPost owns the
//              TV→broker path; we just receive a copy for journal/analytics/
//              rotation/rules/positions/timelines. We NEVER send orders.
// "direct"   — TradeCore holds broker credentials and can execute
//              (Emergency Flatten, Modify SL/TP, drift push, etc.).
//
// Every writing UI action must call `isObserveMode(account)` and either
// disable itself or route through `ObserveGateNotice` (or equivalent).

export const OBSERVE_TOOLTIP =
  "This account is in observe mode — TradeCore only reads signals from your primary webhook. " +
  "Connect a Tradovate-direct account to enable broker actions like Emergency Flatten and Modify SL.";

export const OBSERVE_BADGE_LABEL = "Observe mode · read-only";

export function isObserveMode(account) {
  return account?.mode === "observe";
}

// Convenience: turn an Account into disabled/title props for any writing
// <button> so callers don't have to remember the wiring.
//   const g = observeGate(account)
//   <button disabled={g.disabled} title={g.title}>Close All</button>
export function observeGate(account) {
  const observe = isObserveMode(account);
  return {
    disabled: observe,
    title: observe ? OBSERVE_TOOLTIP : undefined,
    dataObserve: observe ? "true" : undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// Task #178 — Unprotected Position detection.
// A "live" trade (qty_open > 0, status open/live/active) with no
// working stop at the broker is one price gap away from a blown
// account. Callers render a red banner + quick-action to set an SL.
// Empty-string / 0 / null all count as no-stop. Pending trades that
// haven't filled yet don't count either.
// ─────────────────────────────────────────────────────────────
export const UNPROTECTED_MESSAGE =
  "No working stop at broker. Set one now or emergency-flatten if the trade got away from you.";

export function isUnprotected(trade) {
  if (!trade) return false;
  const status = String(trade.status || "").toLowerCase();
  if (status === "pending" || status === "closed" || status === "cancelled") return false;
  const qty = trade.qty_open ?? trade.qty_total ?? 0;
  if (qty <= 0) return false;
  const stop = trade.stop_loss ?? trade.stop_price ?? null;
  return stop == null || stop === "" || Number(stop) === 0;
}
