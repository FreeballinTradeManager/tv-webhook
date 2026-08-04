// Pine v2.74 (6.24 base) signal vocabulary.
//
// The indicator emits three shapes we observe or receive as webhooks:
//
//   1. Entry alerts — _kind is the entry family (3EMA, 3EMA-RE, FVG,
//      STACK100, 200X, REVBUY-XX, REVSELL-XX, RUNBUY-XX, RUNSELL-XX).
//   2. SL updates — strategy_name = "SL TRAIL (#R1_PRENY)" etc., with
//      the SL type (TRAIL/CREEP/BE/JUMP) and the active session in ().
//   3. CLOSE alerts — strategy_name = "CLOSE (reason)", "C(EMERGENCY)",
//      or "CLOSE (FORCE_FLAT)".
//
// This lib is the ONE place we decode those strings into structured
// {family, kind, session, exit_leader, label, color} objects that the
// journal, timeline, alert-templates page, and per-trade pill all use.
// See freeballin_pro_v2_74_final.md + freeballin_pro_v2_74_filters.md.

// ---------------------------------------------------------------------------
// Entry-family catalog. Colors match the Pine indicator's own label colors
// (Pine palette) and the LOCKED TradeCore visual style.
// ---------------------------------------------------------------------------

export const ENTRY_FAMILIES = [
  { key: "3EMA",     label: "3-EMA stack",      color: "bg-emerald-600 text-white",
    description: "First entry on a fresh 3-EMA stack alignment (13>21>55) with bias." },
  { key: "3EMA-RE",  label: "3-EMA re-entry",   color: "bg-blue-600 text-white",
    description: "Re-entry on continued 3-EMA stack after a prior exit." },
  { key: "FVG",      label: "5m FVG re-entry",  color: "bg-blue-600 text-white",
    description: "5-minute fair-value-gap re-entry within an aligned 3-EMA stack." },
  { key: "STACK100", label: "Session-open 4-stack", color: "bg-emerald-600 text-white",
    description: "Opening-drive 4-EMA stack (55>100) fires within the first N bars of a session." },
  { key: "200X",     label: "200-EMA cascade",  color: "bg-emerald-700 text-white",
    description: "13 crosses 200 with the recent 21+55+100 cascade behind it. Rare, high-conviction." },

  { key: "REVBUY",   label: "REV Buy",          color: "bg-purple-500 text-white",
    description: "Reversal Buy — 13 crossing back above 21/55/100 after an aligned bearish move. Path shows the trigger (FVG · ARM · SB · 55/100/200 · XSB · XCISD)." },
  { key: "REVSELL",  label: "REV Sell",         color: "bg-purple-600 text-white",
    description: "Reversal Sell — 13 crossing back below 21/55/100 after an aligned bullish move." },
  { key: "RUNBUY",   label: "RUN Buy",          color: "bg-sky-500 text-white",
    description: "Run-through Buy — with-trend acceleration in a stacked bullish structure." },
  { key: "RUNSELL",  label: "RUN Sell",         color: "bg-sky-600 text-white",
    description: "Run-through Sell — with-trend acceleration in a stacked bearish structure." },
  { key: "RECONNECT",label: "Reconnect",        color: "bg-slate-500 text-white",
    description: "Trade restored on Pine recompile / reconnect from the IN TRADE panel." },
];

// REV/RUN path suffixes ("REVBUY-FVG", "RUNSELL-100" etc.).
export const REV_RUN_PATHS = [
  { key: "FVG",   label: "Fair-value gap trigger" },
  { key: "ARM",   label: "Bar-of-impulse arm entry" },
  { key: "SB",    label: "Structure-break confirmation" },
  { key: "55",    label: "13 × 55 EMA cross" },
  { key: "100",   label: "13 × 100 EMA cross" },
  { key: "200",   label: "13 × 200 EMA cross" },
  { key: "XSB",   label: "Cross + structure-break combo" },
  { key: "XCISD", label: "Cross + CISD (30m) combo" },
];

// ---------------------------------------------------------------------------
// SL updates — TRAIL, CREEP, BE, JUMP. Each with its Pine palette color.
// ---------------------------------------------------------------------------

export const SL_UPDATES = [
  { key: "TRAIL", label: "Trail SL", color: "bg-orange-500 text-white",
    description: "ATR-based trail leader (starts at TP1/TP2/TP3 per panel setting)." },
  { key: "CREEP", label: "Creep SL", color: "bg-slate-800 text-white",
    description: "Creep/Hybrid ratchet stop — walks the leader up N ticks off MFE." },
  { key: "BE",    label: "Break-even SL", color: "bg-yellow-500 text-black",
    description: "Break-even latch (fires at panel-configured R multiple after entry)." },
  { key: "JUMP",  label: "Jump SL",  color: "bg-orange-600 text-white",
    description: "TP-hit stop jump (S>E, E>1, 1>2, 2>3 per panel setting)." },
];

// ---------------------------------------------------------------------------
// CLOSE reasons — from Pine's exitReason (`stop`, `BE`, `jump`, `trail`,
// `creep`, `C<55`, `C>55`, `all TPs`, `EOD`, `15:55 cutoff`, `Friday`,
// `GHOST`, `FORCE FLAT`, `MANUAL`).
// ---------------------------------------------------------------------------

export const CLOSE_REASONS = [
  { key: "stop",         label: "Stop hit",         color: "bg-red-600 text-white" },
  { key: "BE",           label: "Break-even hit",   color: "bg-yellow-500 text-black" },
  { key: "jump",         label: "Jump stop hit",    color: "bg-orange-500 text-white" },
  { key: "jump2",        label: "Jump 2 stop hit",  color: "bg-orange-500 text-white" },
  { key: "jump3",        label: "Jump 3 stop hit",  color: "bg-orange-500 text-white" },
  { key: "trail",        label: "Trail stop hit",   color: "bg-orange-600 text-white" },
  { key: "creep",        label: "Creep stop hit",   color: "bg-slate-700 text-white" },
  { key: "C<55",         label: "Close under EMA55",color: "bg-red-500 text-white" },
  { key: "C>55",         label: "Close above EMA55",color: "bg-red-500 text-white" },
  { key: "all TPs",      label: "All TPs filled",   color: "bg-teal-600 text-white" },
  { key: "EOD",          label: "End of day",       color: "bg-slate-600 text-white" },
  { key: "15:55 cutoff", label: "15:55 cutoff",     color: "bg-slate-600 text-white" },
  { key: "Friday",       label: "Friday early-cut", color: "bg-slate-600 text-white" },
  { key: "GHOST",        label: "Ghost clear",      color: "bg-slate-500 text-white" },
  { key: "FORCE FLAT",   label: "Manual FORCE FLAT",color: "bg-red-700 text-white" },
  { key: "MANUAL",       label: "Manual close",     color: "bg-slate-600 text-white" },
  { key: "SKIPPED",      label: "Skipped (drift)",  color: "bg-slate-500 text-white" },
];

// ---------------------------------------------------------------------------
// Session tags — the Pine strategy_name suffixes "#R1_PRENY / #R2_NEWYORK /
// #R3_ASIA" match the three trading rotations. Keys match how the Pine
// emits them so we can look them up directly from raw payloads.
// ---------------------------------------------------------------------------

export const SESSIONS = [
  { key: "R1_PRENY",  label: "R1 · Pre-NY",  hours: "21:00–10:00 ET (evening → London)" },
  { key: "R2_NEWYORK",label: "R2 · New York",hours: "10:00–15:00 ET" },
  { key: "R3_ASIA",   label: "R3 · Asia",    hours: "18:00–21:00 ET" },
];

// ---------------------------------------------------------------------------
// Parsers. Feed these raw strings from a webhook / Trade / observe event.
// ---------------------------------------------------------------------------

// Split "REVBUY-FVG" / "RUNSELL-100" → { family: "REVBUY", path: "FVG" }
// Passthrough for plain families ("3EMA" → { family: "3EMA", path: null }).
export function parseKind(kind) {
  if (!kind || typeof kind !== "string") return null;
  const parts = kind.split("-");
  const family = parts[0].toUpperCase();
  const path = parts.slice(1).join("-").toUpperCase() || null;
  const spec = ENTRY_FAMILIES.find(f => f.key === family);
  return spec ? { ...spec, family, path, raw: kind } : { family, path, raw: kind, label: kind, color: "bg-slate-600 text-white" };
}

// "SL TRAIL (#R2_NEWYORK)" → { type: "SL_UPDATE", update: "TRAIL", session: "R2_NEWYORK" }
// "CLOSE (stop)"           → { type: "CLOSE",     reason: "stop",   session: null }
// "C(EMERGENCY)"           → { type: "CLOSE",     reason: "EMERGENCY", session: null }
// Anything else            → null
export function parseStrategyName(name) {
  if (!name || typeof name !== "string") return null;
  const n = name.trim();

  const sl = n.match(/^SL\s+(TRAIL|CREEP|BE|JUMP)\s*(?:\(#?([A-Z0-9_]+)\))?/i);
  if (sl) {
    return {
      type: "SL_UPDATE",
      update: sl[1].toUpperCase(),
      session: sl[2] ? sl[2].toUpperCase() : null,
      raw: n,
    };
  }

  const cl = n.match(/^C(?:LOSE)?\s*\(([^)]+)\)/i);
  if (cl) {
    const reason = cl[1].trim();
    return {
      type: "CLOSE",
      reason,
      session: null,
      raw: n,
    };
  }

  const sess = n.match(/^#(R\d_[A-Z]+)/i);
  if (sess) {
    return { type: "SESSION_TAG", session: sess[1].toUpperCase(), raw: n };
  }

  return { type: "UNKNOWN", raw: n };
}

// Pick a version fingerprint from a payload. Looks for explicit
// `pine_version` first, then infers from strategy_name / kind quirks
// unique to v2.74 (session tags · SL TRAIL wording).
export function detectPineVersion(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.pine_version) return String(payload.pine_version);
  if (payload.indicator_version) return String(payload.indicator_version);
  const n = String(payload.strategy_name || payload.comment || "");
  if (/SL\s+(TRAIL|CREEP)/i.test(n))      return "v2.74 (6.24 base)"; // v2.74 introduced Trail/Creep updates
  if (/#R[123]_(PRENY|NEWYORK|ASIA)/i.test(n)) return "v2.7x";
  if (/\bREV(BUY|SELL)-/i.test(n))         return "v2.72+";
  if (/CLOSE\s*\(FORCE_FLAT\)/i.test(n))   return "v2.71+";
  return null;
}

// One-stop resolver — pulls kind + strategy_name off any of our webhook
// shapes and returns a normalized bundle for UI use.
export function classifySignal(input) {
  if (!input) return null;
  const kind = input._kind || input.kind || input.tradeKind || null;
  const sn   = input.strategy_name || input.comment || input.strategyName || null;
  const family = parseKind(kind);
  const meta   = parseStrategyName(sn);
  const version = detectPineVersion(input);
  return { family, meta, version, raw: input };
}

// ---------------------------------------------------------------------------
// Task #128 — Freeballin Trade Manager (v20.87 STOPS) event vocabulary.
// TM is a MANUAL trade manager, not an auto-signal generator — traders drag
// entry/stop lines and pending arms fire ENTRY. Once in-trade, TP hits +
// stop moves emit their own webhooks that TradeCore must recognize.
// ---------------------------------------------------------------------------

export const TM_EVENTS = [
  { key: "ENTRY",         label: "Manual Entry (TM)",     color: "bg-emerald-600 text-white",
    description: "Trader-armed pending order filled via MARKET or STOP/LIMIT. Sends full bracket in one message (PMT) or entry + safety stop pair (TradersPost)." },
  { key: "TP1",           label: "TP1 hit",                color: "bg-teal-600 text-white",
    description: "Partial close of TP1 contract count. Remaining size continues managing." },
  { key: "TP2",           label: "TP2 hit",                color: "bg-teal-600 text-white",
    description: "Partial close of TP2 contract count." },
  { key: "TP3",           label: "TP3 hit",                color: "bg-teal-600 text-white",
    description: "Partial close of TP3 contract count. Runner may remain if configured." },
  { key: "CLOSE50",       label: "Manual Close 50%",       color: "bg-slate-600 text-white",
    description: "One-click half-close of remaining contracts. Fired instantly (input-toggle deferred one bar past recompile)." },
  { key: "MASTER_CLOSE",  label: "MASTER CLOSE",           color: "bg-red-700 text-white",
    description: "Full flatten from the CLOSE ALL toggle or drag price. Also cancels any resting safety stop at TradersPost." },
  { key: "STOP_HIT",      label: "Stop hit",               color: "bg-red-600 text-white",
    description: "Active stop touched — full remainder closes. Reason may be BASE/BE/JUMP/CREEP/TRAIL depending on which leader was tightest." },
  { key: "EMA_EXIT",      label: "EMA close exit",         color: "bg-slate-700 text-white",
    description: "Chosen trail = EMA Close cross closed against the trade — full flatten." },
  { key: "STOP_UPDATE",   label: "Stop update (BE/Jump/Trail/Creep)", color: "bg-orange-500 text-white",
    description: "PMT-only: broker stop overwrite when BE / Jump / Trail / Creep improves the level (with tightness guard)." },
  { key: "CLOSE_FALLBACK",label: "Recompile close fallback", color: "bg-slate-600 text-white",
    description: "Fires when a recompile lost isLive but a close event still needs to reach the broker." },
];

// Detect TM v20.87 payloads from field shape (they don't carry `_kind`).
// Returns { event, version, source } for known events, null otherwise.
export function parseTMEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const evUpper = String(payload.event || "").toUpperCase();
  const dataUpper = String(payload.data || "").toUpperCase();
  const action = String(payload.action || "").toLowerCase();

  // Trade Engine shape carries an explicit `event` field.
  if (evUpper && TM_EVENTS.some(e => e.key === evUpper)) {
    return { event: evUpper, source: "trade_engine", version: "TM v20.87" };
  }
  // PMT shape: `data` = "buy"/"sell"/"CLOSE" + strategy_name tells us which stop update.
  if (dataUpper === "CLOSE") {
    return { event: "MASTER_CLOSE", source: "pmt", version: "TM v20.87" };
  }
  if (dataUpper === "BUY" || dataUpper === "SELL") {
    const sn = String(payload.strategy_name || "").toUpperCase();
    if (sn.startsWith("SL ")) return { event: "STOP_UPDATE", source: "pmt", version: "TM v20.87", update: sn.replace(/^SL\s+/, "") };
    // Quantity 0 = update-only; anything else = new entry or partial close
    const qty = Number(payload.quantity || 0);
    if (qty <= 0) return { event: "STOP_UPDATE", source: "pmt", version: "TM v20.87" };
    // Bracket present = ENTRY; no bracket + partial qty = a TP or CLOSE50
    if (Array.isArray(payload.advance_tp_sl) && payload.advance_tp_sl.length > 0) {
      return { event: "ENTRY", source: "pmt", version: "TM v20.87" };
    }
    return { event: "CLOSE50", source: "pmt", version: "TM v20.87" };
  }
  // TradersPost shape uses `action` verb.
  if (action === "buy" || action === "sell") {
    if (payload.orderType === "stop") return { event: "STOP_UPDATE", source: "traderspost", version: "TM v20.87" };
    return { event: "ENTRY", source: "traderspost", version: "TM v20.87" };
  }
  if (action === "exit") {
    if (payload.quantityType === "percent_of_position") return { event: "CLOSE50", source: "traderspost", version: "TM v20.87" };
    if (payload.quantity)                                return { event: /TP/i.test(payload.strategy_name || "") ? "TP1" : "MASTER_CLOSE", source: "traderspost", version: "TM v20.87" };
    return { event: "MASTER_CLOSE", source: "traderspost", version: "TM v20.87" };
  }
  if (action === "cancel") {
    return { event: "STOP_UPDATE", source: "traderspost", version: "TM v20.87", note: "cancel resting stop" };
  }
  return null;
}
