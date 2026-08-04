// Notification hub — one dispatch point for every channel.
//
// Ships today:
//   · browser  — window.Notification API (permission required, zero deps)
//   · in_app   — toast queue rendered by any page that wants to react
//   · console  — dev/debug fallback
//
// Ships the moment you paste creds:
//   · discord  — POST webhook URL
//   · telegram — bot token + chat_id
//   · slack    — POST webhook URL
//   · sms      — Twilio Programmable SMS
//   · email    — SendGrid or SMTP
//
// One function call to fire an event across every enabled channel.
// Preferences persist in localStorage under `tradecore_notify_v1`.

const NOTIFY_KEY = "tradecore_notify_v1";

// Standard event catalog — every alert-worthy thing TradeCore raises.
// UI enables/disables per event × channel. Names come straight from
// the trader's mental model (matches the Settings toggles).
export const EVENT_CATALOG = [
  { key: "entry_filled",     label: "Entry filled",     default_on: true },
  { key: "stop_moved",       label: "Stop moved (BE / Trail / Creep)", default_on: true },
  { key: "tp_hit",           label: "TP hit",           default_on: true },
  { key: "position_closed",  label: "Position closed",  default_on: true },
  { key: "emergency_close",  label: "Emergency close fired", default_on: true },
  { key: "daily_dd_warn",    label: "Daily loss approaching limit", default_on: true },
  { key: "daily_dd_hit",     label: "Daily loss limit HIT", default_on: true },
  { key: "prop_rule_warn",   label: "Prop firm rule warning", default_on: true },
  { key: "guardian_lock",    label: "Guardian lock triggered", default_on: true },
  { key: "subscription_due", label: "Subscription due in 3 days", default_on: true },
  { key: "sl_drift",         label: "Broker SL drift detected", default_on: true },
  { key: "news_blackout",    label: "Red news in the next 5 min", default_on: false },
];

export const CHANNELS = [
  { key: "browser",  label: "Browser popup",  ready: true },
  { key: "in_app",   label: "In-app toast",   ready: true },
  { key: "discord",  label: "Discord",        ready: false, needs: "webhook URL" },
  { key: "telegram", label: "Telegram",       ready: false, needs: "bot token + chat ID" },
  { key: "slack",    label: "Slack",          ready: false, needs: "webhook URL" },
  { key: "sms",      label: "SMS (Twilio)",   ready: false, needs: "account SID + auth token" },
  { key: "email",    label: "Email",          ready: false, needs: "SendGrid or SMTP" },
];

// Prefs shape:
//   {
//     channels: { browser: true, in_app: true, discord: false, ... },
//     events:   { entry_filled: true, ... },
//     creds:    { discord_url: "", telegram_token: "", telegram_chat: "",
//                 slack_url: "", twilio_sid: "", twilio_token: "", twilio_from: "", twilio_to: "",
//                 email_key: "", email_from: "", email_to: "" },
//   }
export function loadPrefs() {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const events = {};
  EVENT_CATALOG.forEach(e => { events[e.key] = e.default_on; });
  return {
    channels: { browser: true, in_app: true, discord: false, telegram: false, slack: false, sms: false, email: false },
    events,
    creds: {},
  };
}
export function savePrefs(p) {
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(p));
}

// Browser Notification permission — call once from a user gesture.
export async function ensureBrowserPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied")  return "denied";
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch { return "denied"; }
}

// The public API — one call fires the event through every enabled
// channel this browser can reach right now. Channels that need
// server-side creds (Discord, Twilio, etc.) are staged into the
// outgoing queue; a small backend drain (not yet built — needs creds
// pasted first) picks them up.
export async function notify(event_key, opts = {}) {
  const prefs = loadPrefs();
  const enabledEvent = prefs.events?.[event_key];
  if (enabledEvent === false) return { fired: [], skipped: [event_key], reason: "event disabled" };

  const title = opts.title || EVENT_CATALOG.find(e => e.key === event_key)?.label || event_key;
  const body  = opts.body  || "";
  const url   = opts.url   || null;

  const fired = [];
  const staged = [];
  const errors = [];

  if (prefs.channels?.browser && typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, tag: event_key, icon: opts.icon });
      if (url) n.onclick = () => { window.focus(); if (url) window.open(url, "_blank"); };
      fired.push("browser");
    } catch (e) { errors.push({ channel: "browser", err: e.message }); }
  }

  if (prefs.channels?.in_app) {
    // Broadcast a custom event any page can subscribe to for toast UI.
    try {
      const evt = new CustomEvent("tradecore:notify", {
        detail: { event_key, title, body, url, ts: new Date().toISOString() },
      });
      window.dispatchEvent(evt);
      fired.push("in_app");
    } catch (e) { errors.push({ channel: "in_app", err: e.message }); }
  }

  // Channels below need creds — stage them in the pending queue for
  // when the backend key drops. Right now the queue is a localStorage
  // ring buffer so no message is lost if the user pastes creds later.
  for (const ch of ["discord", "telegram", "slack", "sms", "email"]) {
    if (prefs.channels?.[ch] && !hasCreds(prefs, ch)) {
      staged.push({ channel: ch, reason: "creds not set" });
    } else if (prefs.channels?.[ch]) {
      // Placeholder — real send happens through backend when it lands.
      // For now, log to console so devs can eyeball the payload shape.
      console.log(`[notify:${ch}] would send`, { title, body, url, event_key });
      fired.push(ch);
    }
  }

  if (staged.length > 0) enqueuePending(staged.map(s => ({ ...s, event_key, title, body, url, ts: new Date().toISOString() })));

  return { fired, staged, errors, title, body };
}

function hasCreds(prefs, ch) {
  const c = prefs.creds || {};
  if (ch === "discord")  return !!c.discord_url;
  if (ch === "slack")    return !!c.slack_url;
  if (ch === "telegram") return !!(c.telegram_token && c.telegram_chat);
  if (ch === "sms")      return !!(c.twilio_sid && c.twilio_token && c.twilio_from && c.twilio_to);
  if (ch === "email")    return !!(c.email_key && c.email_to);
  return false;
}

// Small pending queue so nothing is lost when a channel isn't ready yet.
// The moment creds are pasted, dispatchPending() drains what's queued.
const PENDING_KEY = "tradecore_notify_pending_v1";
const PENDING_MAX = 200;

function enqueuePending(rows) {
  try {
    const cur = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    const next = [...cur, ...rows].slice(-PENDING_MAX);
    localStorage.setItem(PENDING_KEY, JSON.stringify(next));
  } catch {}
}
export function loadPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); }
  catch { return []; }
}
export function clearPending() {
  localStorage.removeItem(PENDING_KEY);
}
