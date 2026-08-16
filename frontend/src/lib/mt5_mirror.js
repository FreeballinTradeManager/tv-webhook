// mt5_mirror.js
// Per-account MT5 mirror config storage + dry-run payload builder + log.
//
// PHASE 1 CONTRACT (locked):
//   · TradeCore does NOT talk to MT5. Not yet.
//   · This module computes what TradeCore WOULD send if it were armed.
//   · Every account starts armed=false. The ARM button in the UI stays
//     hard-disabled until Phase 2 (real adapter) ships.
//   · The log is a browser-local ring buffer — safe to clear, safe to
//     export, no PII leaves the machine.
//
// Config shape (per account, stored in localStorage):
//   {
//     enabled:    bool,          // include this account in the mirror
//     armed:      false,         // never true in Phase 1
//     broker:     "FTMO" | "FundedNext" | "The5ers" | "Custom",
//     platform:   "MT5" | "MT4" | "cTrader",
//     login:      string,        // MT5 account number (display only)
//     server:     string,        // MT5 server name (display only)
//     suffix:     string,        // per-broker symbol suffix, e.g. "" or ".cash"
//     symbolOverride: string | null,  // force MT5 symbol regardless of Pine
//     sizingMode: "match_risk" | "fixed_lot" | "match_qty",
//     fixedLot:   number,        // used by fixed_lot / match_qty
//     riskCapUsd: number,        // hard $ cap per trade (0 = no cap)
//   }
//
// Passwords are NOT stored here. Even in Phase 2 they belong in the encrypted
// backend Vault, not in localStorage.

import { computeMt5Order } from "./mt5_lot_math";

const CFG_KEY = "tradecore_mt5_mirror_cfg_v1";
const LOG_KEY = "tradecore_mt5_mirror_log_v1";
const MAX_LOG = 500;

// ---- Config -----------------------------------------------------------------

export const DEFAULT_CFG = {
  enabled:        false,
  armed:          false,     // hard-false in Phase 1
  broker:         "FTMO",
  platform:       "MT5",
  login:          "",
  server:         "",
  suffix:         "",        // FTMO MT5 uses bare tickers
  symbolOverride: null,
  sizingMode:     "match_risk",
  fixedLot:       0.10,
  riskCapUsd:     100,
  // Task #217 — futures↔CFD price conversion (Duplikium-style)
  priceConversionMode: "market",   // "market" | "fixed_offset" | "live_reanchor"
  symbolOffsets:  {},              // { NAS100: -15, US500: -3, ... } — overrides DEFAULT_CFD_OFFSETS
};

export const BROKER_PRESETS = [
  { key: "FTMO",       label: "FTMO",         suffix: "",       platform: "MT5"     },
  { key: "FundedNext", label: "Funded Next",  suffix: "",       platform: "MT5"     },
  { key: "The5ers",    label: "The5%ers",     suffix: ".cash",  platform: "MT5"     },
  { key: "Blueberry",  label: "Blueberry Funded", suffix: "",   platform: "MT5"     },
  { key: "TopOne",     label: "TopOneTrader", suffix: "",       platform: "cTrader" },
  { key: "MyFundedFX", label: "MyFundedFX",   suffix: "",       platform: "MT5"     },
  { key: "Custom",     label: "Custom broker", suffix: "",      platform: "MT5"     },
];

function loadCfgAll() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); }
  catch { return {}; }
}
function saveCfgAll(o) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(o || {})); } catch {}
}

export function getMirrorCfg(accountId) {
  const all = loadCfgAll();
  return { ...DEFAULT_CFG, ...(all[String(accountId)] || {}) };
}

export function setMirrorCfg(accountId, patch) {
  const all = loadCfgAll();
  const key = String(accountId);
  // Phase 1 safety: forbid setting armed=true from anywhere in the app.
  const safe = { ...patch };
  if (safe.armed === true) safe.armed = false;
  all[key] = { ...DEFAULT_CFG, ...(all[key] || {}), ...safe };
  saveCfgAll(all);
  return all[key];
}

export function clearMirrorCfg(accountId) {
  const all = loadCfgAll();
  delete all[String(accountId)];
  saveCfgAll(all);
}

export function listConfiguredAccounts() {
  const all = loadCfgAll();
  return Object.keys(all).map(id => ({ id, cfg: all[id] }));
}

// ---- Dry-run log ------------------------------------------------------------

function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
  catch { return []; }
}
function saveLog(list) {
  try {
    const trimmed = list.slice(-MAX_LOG);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function appendDryRun(entry) {
  const list = loadLog();
  const withMeta = {
    ...entry,
    id: `mt5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    armed: false,   // enforce Phase 1 label
    delivery: "dry-run",
  };
  list.push(withMeta);
  saveLog(list);
  return withMeta;
}

export function getDryRunLog({ accountId = null, limit = 100 } = {}) {
  let list = loadLog();
  if (accountId) list = list.filter(r => String(r.account_id) === String(accountId));
  return list.slice(-limit).reverse();   // newest first
}

export function clearDryRunLog(accountId = null) {
  if (!accountId) { saveLog([]); return; }
  const list = loadLog().filter(r => String(r.account_id) !== String(accountId));
  saveLog(list);
}

// ---- Event kind classification (mirrors backend's observe classifier) --------
//
// Pine emits many event types on the same webhook; the mirror needs to react
// differently to each. Groups:
//   ENTRY_LIKE   — new position (BUY / SELL / ENTRY)
//   SL_UPDATE    — modify the working stop (BE / JUMP / CREEP_UPDATE / TRAIL_UPDATE)
//   PARTIAL      — take-profit hit that DOESN'T close the position (TP1 / TP2)
//   FULL_CLOSE   — position flat (CLOSE / STOP_HIT / EMA_EXIT / TP3 / ALL_TPS_FILLED / MASTER_CLOSE)
//   NOOP         — anything else (log but no MT5 action)
//
// Every classification maps to a distinct MT5 REST call in Phase 2C:
//   ENTRY_LIKE   → POST /users/current/accounts/{id}/trade { actionType: "ORDER_TYPE_BUY" | "ORDER_TYPE_SELL" }
//   SL_UPDATE    → POST /trade { actionType: "POSITION_MODIFY", positionId, stopLoss }
//   PARTIAL      → POST /trade { actionType: "POSITION_PARTIAL", positionId, volume: partialLot }
//   FULL_CLOSE   → POST /trade { actionType: "POSITION_CLOSE_ID", positionId }
export function classifyPineEvent(evType) {
  const ev = String(evType || "").toUpperCase();
  if (["BUY", "SELL", "ENTRY", "LONG", "SHORT"].includes(ev)) return "ENTRY_LIKE";
  if (["BE", "JUMP", "CREEP_UPDATE", "TRAIL_UPDATE",
       "STOP_UPDATE", "SL_UPDATE", "MODIFY_SL", "BREAKEVEN"].includes(ev)) return "SL_UPDATE";
  if (["TP1", "TP2", "PARTIAL", "SCALE_OUT"].includes(ev)) return "PARTIAL";
  if (["CLOSE", "EXIT", "STOP_HIT", "EMA_EXIT", "TP3",
       "ALL_TPS_FILLED", "MASTER_CLOSE", "CLOSE_FALLBACK", "FORCE_FLAT",
       "FF", "CLOSE_NOW"].includes(ev)) return "FULL_CLOSE";
  return "NOOP";
}

// Find the most recent open ENTRY dry-run for this (account, ticker) so
// SL_UPDATE / PARTIAL / FULL_CLOSE events can reference the same "mirror
// position." In Phase 2 this is a real MT5 positionId; in Phase 1 it's
// just a tag so the log tells a coherent story.
export function findOpenMirrorPosition(accountId, ticker) {
  const list = loadLog();
  const norm = (t) => (t || "").toString().toUpperCase().replace("1!", "");
  const wanted = norm(ticker);
  // scan newest-first for a matching ENTRY not already flagged closed
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (String(r.account_id) !== String(accountId)) continue;
    if (r.classification !== "ENTRY_LIKE") continue;
    if (norm(r.pine_signal?.ticker) !== wanted) continue;
    if (r.closed) continue;
    return r;
  }
  return null;
}

// Mark an open mirror position closed (by id). Idempotent.
function markMirrorClosed(mirrorEntryId) {
  const list = loadLog();
  let touched = false;
  for (const r of list) {
    if (r.id === mirrorEntryId && !r.closed) {
      r.closed = true;
      r.closed_at = new Date().toISOString();
      touched = true;
    }
  }
  if (touched) saveLog(list);
}

// ---- Ingest a Pine / observe signal → produce a dry-run entry ---------------
//
//   pineSignal = { ticker, side, qty, entry, stop, tp1, tp2, tp3, event_type }
//   account    = full Account row (id + name at minimum)
//   sourceMeta = { event_id, event_type }
//
// Returns the appended log entry. Never sends anything. Handles every event
// class classifyPineEvent() knows about; NOOPs get logged with kind="NOOP"
// so nothing goes silently missing.

export function ingestObserveSignal(pineSignal, account, sourceMeta = {}) {
  if (!account) return null;
  const cfg = getMirrorCfg(account.id);
  if (!cfg.enabled) return null;

  const evType = sourceMeta.event_type || pineSignal?.event_type;
  const kind   = classifyPineEvent(evType);

  // NOOP — log the fact-of-signal but no MT5 action would fire
  if (kind === "NOOP") {
    return appendDryRun({
      account_id:   account.id,
      account_name: account.name,
      broker:       cfg.broker,
      platform:     cfg.platform,
      login:        cfg.login,
      pine_signal:  pineSignal,
      classification: "NOOP",
      would_send:   { ok: false, note: `Event "${evType}" has no MT5 action.` },
      source:       sourceMeta,
    });
  }

  // ENTRY — full computeMt5Order pass
  if (kind === "ENTRY_LIKE") {
    const order = computeMt5Order(pineSignal, cfg);
    return appendDryRun({
      account_id:   account.id,
      account_name: account.name,
      broker:       cfg.broker,
      platform:     cfg.platform,
      login:        cfg.login,
      pine_signal:  pineSignal,
      classification: "ENTRY_LIKE",
      would_send:   order,
      source:       sourceMeta,
    });
  }

  // SL_UPDATE — find open mirror position, describe the modify
  if (kind === "SL_UPDATE") {
    const open = findOpenMirrorPosition(account.id, pineSignal?.ticker);
    if (!open || !open.would_send?.ok) {
      return appendDryRun({
        account_id:   account.id,
        account_name: account.name,
        broker:       cfg.broker,
        platform:     cfg.platform,
        login:        cfg.login,
        pine_signal:  pineSignal,
        classification: "SL_UPDATE",
        would_send:   { ok: false, note: "SL update fired but no open mirror position — skip." },
        source:       sourceMeta,
      });
    }
    return appendDryRun({
      account_id:   account.id,
      account_name: account.name,
      broker:       cfg.broker,
      platform:     cfg.platform,
      login:        cfg.login,
      pine_signal:  pineSignal,
      classification: "SL_UPDATE",
      would_send: {
        ok: true,
        actionType: "POSITION_MODIFY",
        target:     open.would_send.target,
        side:       open.would_send.side,
        mirror_position_id: open.id,
        new_stop:   pineSignal?.stop,
        old_stop:   open.would_send.stop,
        note:       `Modify SL on ${open.would_send.target}: ${open.would_send.stop} → ${pineSignal?.stop}`,
      },
      source:       sourceMeta,
    });
  }

  // PARTIAL — take-profit hit that doesn't close the position
  if (kind === "PARTIAL") {
    const open = findOpenMirrorPosition(account.id, pineSignal?.ticker);
    if (!open || !open.would_send?.ok) {
      return appendDryRun({
        account_id:   account.id,
        account_name: account.name,
        broker:       cfg.broker,
        platform:     cfg.platform,
        login:        cfg.login,
        pine_signal:  pineSignal,
        classification: "PARTIAL",
        would_send:   { ok: false, note: "Partial TP fired but no open mirror position." },
        source:       sourceMeta,
      });
    }
    // Default: scale out 1/3 of the position on each of TP1/TP2 (matches
    // Pine's 3-runner ladder). Real Phase 2C impl reads the TP ladder cfg.
    const partialLot = Math.max(open.would_send.spec?.min_lot || 0.01,
                                Math.round(open.would_send.lots / 3 * 100) / 100);
    return appendDryRun({
      account_id:   account.id,
      account_name: account.name,
      broker:       cfg.broker,
      platform:     cfg.platform,
      login:        cfg.login,
      pine_signal:  pineSignal,
      classification: "PARTIAL",
      would_send: {
        ok: true,
        actionType: "POSITION_PARTIAL",
        target:     open.would_send.target,
        side:       open.would_send.side,
        mirror_position_id: open.id,
        partial_lot: partialLot,
        note:       `Scale out ${partialLot} of ${open.would_send.lots} on ${evType}`,
      },
      source:       sourceMeta,
    });
  }

  // FULL_CLOSE — flatten mirror position
  if (kind === "FULL_CLOSE") {
    const open = findOpenMirrorPosition(account.id, pineSignal?.ticker);
    if (!open || !open.would_send?.ok) {
      return appendDryRun({
        account_id:   account.id,
        account_name: account.name,
        broker:       cfg.broker,
        platform:     cfg.platform,
        login:        cfg.login,
        pine_signal:  pineSignal,
        classification: "FULL_CLOSE",
        would_send:   { ok: false, note: "Close fired but no open mirror position." },
        source:       sourceMeta,
      });
    }
    const closed = appendDryRun({
      account_id:   account.id,
      account_name: account.name,
      broker:       cfg.broker,
      platform:     cfg.platform,
      login:        cfg.login,
      pine_signal:  pineSignal,
      classification: "FULL_CLOSE",
      would_send: {
        ok: true,
        actionType: "POSITION_CLOSE_ID",
        target:     open.would_send.target,
        side:       open.would_send.side,
        mirror_position_id: open.id,
        close_reason: evType,
        note:       `Close ${open.would_send.target} — ${evType}`,
      },
      source:       sourceMeta,
    });
    markMirrorClosed(open.id);
    return closed;
  }

  return null;
}

// ---- Utility: derive a Pine-signal-shape from an observe event row ---------
//
// The /api/webhook/observe/{key}/events endpoint returns raw WebhookSignal
// rows. This unpacks a row's raw_payload into the canonical fields the
// mirror + lot math expect.
export function parseObserveEvent(evt) {
  if (!evt) return null;
  let payload = {};
  if (typeof evt.raw_payload === "string") {
    try { payload = JSON.parse(evt.raw_payload); } catch {}
  } else if (evt.raw_payload && typeof evt.raw_payload === "object") {
    payload = evt.raw_payload;
  }
  const side = String(evt.side || payload.data || payload.side || "").toLowerCase();
  return {
    ticker:  evt.ticker || payload.ticker || payload.symbol || "",
    side:    side.startsWith("b") || side === "long"  ? "BUY"
           : side.startsWith("s") || side === "short" ? "SELL"
           : (evt.event || "").toUpperCase(),
    qty:     Number(evt.qty || payload.quantity || payload.qty || 0) || 0,
    entry:   toNum(payload.price ?? payload.entry_px ?? payload.entry),
    stop:    toNum(payload.sl    ?? payload.stop_px  ?? payload.stop),
    tp1:     toNum(payload.tp1_px ?? payload.tp1),
    tp2:     toNum(payload.tp2_px ?? payload.tp2),
    tp3:     toNum(payload.tp3_px ?? payload.tp3),
    event_type: evt.event,
  };
}
function toNum(v) { const n = Number(v); return isFinite(n) ? n : null; }
