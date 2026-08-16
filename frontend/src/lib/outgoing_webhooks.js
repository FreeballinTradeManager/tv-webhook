// outgoing_webhooks.js
// Fan-out to third-party services: Discord, Slack, Zapier, n8n, custom URL.
//
// Same architecture as MT5 mirror — user configures hooks per event type,
// TradeCore fires whenever the matching event is observed. Everything is
// browser-local for MVP; a backend proxy for retries + full response comes
// with Phase 2 auth (task #40).
//
// CORS reality:
//   · Discord webhooks     — reject browser POSTs (CORS-blocked). We fire
//                            with mode:"no-cors" — request lands, response
//                            is opaque. Backend proxy fixes this later.
//   · Slack webhooks       — same as Discord.
//   · Zapier catch hooks   — CORS-open, full response readable.
//   · n8n webhooks         — CORS-open by default (self-hosted config).
//   · Custom URL           — depends on the target's CORS config.
//
// Config shape (per hook, stored in localStorage):
//   {
//     id:          "hook-<random>",
//     name:        "Discord — trade alerts",
//     kind:        "discord" | "slack" | "zapier" | "n8n" | "generic",
//     url:         "https://discord.com/api/webhooks/...",
//     events:      { entry: true, sl_update: false, tp: true, close: true,
//                    kill_switch: true, daily_summary: false },
//     enabled:     true,
//     custom_template: null | "<user JSON template with {{placeholders}}>",
//     mention:     "" | "<@user_id>" | "@channel"      // Discord/Slack mention
//   }

const CFG_KEY = "tradecore_outgoing_hooks_cfg_v1";
const LOG_KEY = "tradecore_outgoing_hooks_log_v1";
const MAX_LOG = 500;

// -----------------------------------------------------------------------------
// Event catalog — the only event keys we fire hooks for. Adding new event
// types means adding here and updating the callers.
export const HOOK_EVENTS = {
  entry:         { label: "Trade entry (BUY / SELL)",    color: 0x3b82f6 },  // blue
  sl_update:     { label: "SL update (BE / JUMP / trail)", color: 0xef4444 },  // red
  tp:            { label: "TP hit (TP1 / TP2 / TP3)",    color: 0x14b8a6 },  // teal
  close:         { label: "Position close",              color: 0x94a3b8 },  // slate
  kill_switch:   { label: "Kill switch fired",           color: 0xdc2626 },  // dark red
  daily_summary: { label: "Daily summary (once/day)",    color: 0x8b5cf6 },  // purple
};

export const HOOK_KINDS = [
  { key: "discord", label: "Discord",  placeholder: "https://discord.com/api/webhooks/…",
    hint: "Server Settings → Integrations → Webhooks → New Webhook → Copy URL" },
  { key: "slack",   label: "Slack",    placeholder: "https://hooks.slack.com/services/…",
    hint: "https://api.slack.com/apps → Incoming Webhooks → Add New → Copy URL" },
  { key: "zapier",  label: "Zapier",   placeholder: "https://hooks.zapier.com/hooks/catch/…",
    hint: "Zap: Trigger = Webhooks by Zapier → Catch Hook → Copy URL" },
  { key: "n8n",     label: "n8n",      placeholder: "https://<n8n-host>/webhook/…",
    hint: "n8n workflow: Trigger = Webhook → Copy Test/Production URL" },
  { key: "generic", label: "Custom",   placeholder: "https://example.com/webhook",
    hint: "POST { event, ticker, side, ... } to your endpoint" },
];

// -----------------------------------------------------------------------------
// Config CRUD

function loadCfg() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || "[]"); }
  catch { return []; }
}
function saveCfg(list) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(list)); } catch {}
}

export function listHooks() { return loadCfg(); }

export function upsertHook(hook) {
  const list = loadCfg();
  if (!hook.id) hook.id = `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const idx = list.findIndex(h => h.id === hook.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...hook };
  else list.push({
    enabled: true,
    events: { entry: true, sl_update: false, tp: true, close: true, kill_switch: true, daily_summary: false },
    kind: "discord", name: "", url: "", mention: "", custom_template: null,
    ...hook,
  });
  saveCfg(list);
  return hook.id;
}

export function deleteHook(id) {
  saveCfg(loadCfg().filter(h => h.id !== id));
}

export function toggleHook(id, enabled) {
  const list = loadCfg();
  const h = list.find(x => x.id === id);
  if (h) { h.enabled = !!enabled; saveCfg(list); }
}

// -----------------------------------------------------------------------------
// Delivery log

function loadLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); }
  catch { return []; }
}
function saveLog(list) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_LOG))); } catch {}
}

export function getDeliveryLog({ limit = 100, hookId = null } = {}) {
  let list = loadLog();
  if (hookId) list = list.filter(r => r.hook_id === hookId);
  return list.slice(-limit).reverse();
}
export function clearDeliveryLog() { saveLog([]); }

function appendLog(entry) {
  const list = loadLog();
  list.push({
    ...entry,
    id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
  });
  saveLog(list);
}

// -----------------------------------------------------------------------------
// Payload builders — one per kind. Called with the normalized event object:
//   { event, ticker, side, qty, entry, stop, tp1, tp2, tp3, account_name,
//     mirror_position_id, note, pnl }

function fmtNum(n, digits = 2) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function readableTitle(e) {
  const s = (e.side || "").toUpperCase();
  const t = e.ticker || "?";
  switch (e.event) {
    case "entry":         return `${s === "SELL" ? "🔴" : "🟢"} ${s} ${t} × ${e.qty ?? "?"}`;
    case "sl_update":     return `🟥 SL update — ${t}`;
    case "tp":            return `🟦 ${e.event_sub || "TP"} — ${t}`;
    case "close":         return `⬛ Close — ${t}${e.pnl != null ? `  (${e.pnl >= 0 ? "+" : ""}$${fmtNum(e.pnl)})` : ""}`;
    case "kill_switch":   return `🚨 KILL SWITCH FIRED`;
    case "daily_summary": return `📊 Daily summary`;
    default:              return `${e.event} — ${t}`;
  }
}

function textLines(e) {
  const lines = [];
  if (e.account_name) lines.push(`Account: **${e.account_name}**`);
  if (e.entry != null) lines.push(`Entry: \`${fmtNum(e.entry)}\``);
  if (e.stop != null)  lines.push(`Stop:  \`${fmtNum(e.stop)}\``);
  if (e.tp1 != null)   lines.push(`TP1:   \`${fmtNum(e.tp1)}\``);
  if (e.tp2 != null)   lines.push(`TP2:   \`${fmtNum(e.tp2)}\``);
  if (e.tp3 != null)   lines.push(`TP3:   \`${fmtNum(e.tp3)}\``);
  if (e.pnl != null)   lines.push(`P&L:   ${e.pnl >= 0 ? "🟢" : "🔴"} $${fmtNum(e.pnl)}`);
  if (e.note)          lines.push(`Note: ${e.note}`);
  return lines;
}

function buildDiscord(e, hook) {
  const color = HOOK_EVENTS[e.event]?.color ?? 0x64748b;
  const content = hook.mention ? String(hook.mention) : undefined;
  return {
    content,
    embeds: [{
      title:       readableTitle(e),
      description: textLines(e).join("\n") || undefined,
      color,
      timestamp:   new Date().toISOString(),
      footer:      { text: `TradeCore · ${e.event}` },
    }],
  };
}

function buildSlack(e, hook) {
  const header = readableTitle(e);
  const lines  = textLines(e);
  const mention = hook.mention ? `${hook.mention} ` : "";
  return {
    text: `${mention}${header}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: header } },
      lines.length > 0 && {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
      { type: "context",
        elements: [{ type: "mrkdwn", text: `_TradeCore · ${e.event}_` }] },
    ].filter(Boolean),
  };
}

function buildGeneric(e) {
  // Zapier / n8n / custom URL — flat JSON, the receiver decides what to do.
  return {
    event:              e.event,
    event_sub:          e.event_sub || null,
    account_name:       e.account_name || null,
    ticker:             e.ticker || null,
    side:               e.side || null,
    qty:                e.qty ?? null,
    entry:              e.entry ?? null,
    stop:               e.stop ?? null,
    tp1:                e.tp1 ?? null,
    tp2:                e.tp2 ?? null,
    tp3:                e.tp3 ?? null,
    pnl:                e.pnl ?? null,
    note:               e.note || null,
    mirror_position_id: e.mirror_position_id || null,
    ts:                 new Date().toISOString(),
    source:             "TradeCore",
  };
}

// Simple {{placeholder}} substitution for custom_template mode
function buildCustom(e, template) {
  const flat = buildGeneric(e);
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = flat[k];
    return v == null ? "" : String(v);
  });
}

// -----------------------------------------------------------------------------
// Fire a single hook. Returns { ok, status, note }. Never throws.

async function fireOne(hook, evt) {
  const payload =
    hook.kind === "discord"   ? buildDiscord(evt, hook) :
    hook.kind === "slack"     ? buildSlack(evt, hook)   :
    hook.custom_template      ? buildCustom(evt, hook.custom_template) :
                                buildGeneric(evt);

  const bodyIsJson = typeof payload === "object";
  const init = {
    method: "POST",
    headers: bodyIsJson ? { "Content-Type": "application/json" } : { "Content-Type": "text/plain" },
    body:    bodyIsJson ? JSON.stringify(payload) : payload,
  };

  // Discord + Slack reject browser POSTs → fire opaque and treat as delivered
  const opaque = hook.kind === "discord" || hook.kind === "slack";
  if (opaque) init.mode = "no-cors";

  try {
    const resp = await fetch(hook.url, init);
    // opaque responses have status 0 and always look "ok" — that's fine,
    // the browser sent the request. Full-fidelity retry is a backend job.
    if (opaque) {
      return { ok: true, status: 0, note: "sent (opaque — Discord/Slack CORS)" };
    }
    return { ok: resp.ok, status: resp.status, note: resp.ok ? "delivered" : `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, status: 0, note: String(e?.message || e) };
  }
}

// Fan-out: fire every enabled hook whose event filter matches. Logs each
// attempt. This is what other TradeCore surfaces call.
export async function fireEvent(evt) {
  if (!evt?.event) return { fired: 0, total: 0 };
  const hooks = loadCfg().filter(h => h.enabled && h.events?.[evt.event]);
  if (!hooks.length) return { fired: 0, total: 0 };

  const results = await Promise.all(hooks.map(h => fireOne(h, evt).then(r => ({ h, r }))));
  for (const { h, r } of results) {
    appendLog({
      hook_id:   h.id,
      hook_name: h.name || h.kind,
      hook_kind: h.kind,
      event:     evt.event,
      ticker:    evt.ticker,
      ok:        r.ok,
      status:    r.status,
      note:      r.note,
    });
  }
  return { fired: results.filter(x => x.r.ok).length, total: results.length };
}

// Test-fire — used by the "Send test" button. Doesn't need an event
// classification, just fires the hook with a sample event.
export function sampleEvent(kind = "entry") {
  const base = { account_name: "Lucid 50K (demo)", ticker: "MNQ1!", side: "BUY", qty: 3,
                 entry: 24500, stop: 24480, tp1: 24510, tp2: 24520, tp3: 24530 };
  switch (kind) {
    case "sl_update":     return { ...base, event: "sl_update", note: "BE → 24500" };
    case "tp":            return { ...base, event: "tp", event_sub: "TP1", note: "Scaled 1/3" };
    case "close":         return { ...base, event: "close", pnl: 87.50, note: "TP3 hit" };
    case "kill_switch":   return { event: "kill_switch", note: "All accounts flattened + blocked" };
    case "daily_summary": return { event: "daily_summary", pnl: 432.75, note: "12 trades · 8W/4L · 66% WR" };
    case "entry":
    default:              return { ...base, event: "entry" };
  }
}

export async function testFire(hookId, eventKind = "entry") {
  const hook = loadCfg().find(h => h.id === hookId);
  if (!hook) return { ok: false, note: "hook not found" };
  const evt  = sampleEvent(eventKind);
  const r    = await fireOne(hook, evt);
  appendLog({
    hook_id:   hook.id,
    hook_name: hook.name || hook.kind,
    hook_kind: hook.kind,
    event:     `${evt.event} (test)`,
    ticker:    evt.ticker,
    ok:        r.ok,
    status:    r.status,
    note:      r.note,
  });
  return r;
}
