// integrations.js
// Central catalog + creds storage for every third-party service TradeCore
// can talk to. Pattern matches MT5 mirror Phase 2A:
//
//   1. UI lists every service, whether user has creds or not
//   2. User signs up externally, pastes creds into the card
//   3. Frontend saves shape client-side (localStorage MVP)
//   4. Backend stub echoes "phase 2A — not wired yet" until Railway env
//      has the corresponding token, then flips to real API calls
//
// Secrets that could route abuse (Twilio, Anthropic, S3) go to backend
// via /api/integrations/{slug}/save; display-only fields (email addresses,
// SMTP hosts) can be cached locally for the card UI.
//
// Every card gets: name, category, signup_url, where_to_find, cred_fields,
// what_it_unlocks, backend_route.
//
// This file is pure config — no React. The Integrations page reads from
// INTEGRATIONS[] and renders one card per entry.

// -----------------------------------------------------------------------------
// Catalog

export const INTEGRATIONS = [
  // ── AI ──────────────────────────────────────────────────────────────────
  {
    slug:          "anthropic",
    name:          "Anthropic (Claude)",
    category:      "AI",
    signup_url:    "https://console.anthropic.com/",
    what_it_unlocks: [
      "AI journal insights (#79) — Claude reviews your closed trades weekly",
      "AI Trade Coach (#86) — chat about your trading history",
      "Voice + AI popup alerts (#63)",
      "AI chart setup recognition (#105) — upload a screenshot, get the setup",
    ],
    where_to_find: "console.anthropic.com → Settings → API Keys → Create Key",
    cred_fields: [
      { key: "api_key", label: "API key", secret: true, placeholder: "sk-ant-api03-…" },
      { key: "model",   label: "Default model", secret: false,
        placeholder: "claude-opus-5", default: "claude-sonnet-5" },
    ],
    monthly_cost:  "Pay-as-you-go, ~$1-10/mo for typical journal use",
    backend_route: "/api/integrations/anthropic",
    icon:          "🧠",
  },

  // ── Notifications ──────────────────────────────────────────────────────
  {
    slug:          "telegram",
    name:          "Telegram Bot",
    category:      "Notify",
    signup_url:    "https://t.me/BotFather",
    what_it_unlocks: [
      "Trade entry / exit alerts to your Telegram chat (#56)",
      "Kill switch fired notification",
      "Daily summary push (once/day)",
    ],
    where_to_find: "In Telegram: message @BotFather → /newbot → follow prompts → copy the HTTP API token. Then get your chat_id by messaging your new bot and hitting https://api.telegram.org/bot<TOKEN>/getUpdates.",
    cred_fields: [
      { key: "bot_token", label: "Bot token", secret: true, placeholder: "123456:ABC-DEF…" },
      { key: "chat_id",   label: "Chat ID",   secret: false, placeholder: "-100123456 or your user id" },
    ],
    monthly_cost:  "Free",
    backend_route: "/api/integrations/telegram",
    icon:          "✈️",
  },

  {
    slug:          "twilio",
    name:          "Twilio (SMS)",
    category:      "Notify",
    signup_url:    "https://www.twilio.com/try-twilio",
    what_it_unlocks: [
      "SMS alerts for critical events (#82) — kill switch, drawdown alarm, connection loss",
      "SMS delivery is what wakes you up when Discord/Telegram are muted",
    ],
    where_to_find: "twilio.com → Console → Account Info → Account SID + Auth Token + your Twilio number",
    cred_fields: [
      { key: "account_sid", label: "Account SID", secret: false, placeholder: "AC…" },
      { key: "auth_token",  label: "Auth token",  secret: true,  placeholder: "…" },
      { key: "from_number", label: "From number", secret: false, placeholder: "+15551234567 (your Twilio number)" },
      { key: "to_number",   label: "To number",   secret: false, placeholder: "+15551234567 (your phone)" },
    ],
    monthly_cost:  "$0.0075/SMS + $1/mo phone number (~$3-15/mo)",
    backend_route: "/api/integrations/twilio",
    icon:          "📱",
  },

  {
    slug:          "smtp",
    name:          "Email (SMTP)",
    category:      "Notify",
    signup_url:    "https://sendgrid.com/free/ or https://myaccount.google.com/apppasswords",
    what_it_unlocks: [
      "Daily / weekly digest email (#83)",
      "Monthly PDF report delivery (#89)",
      "Tax report emailed at year-end (#90)",
    ],
    where_to_find: "For Gmail: myaccount.google.com → 2-step verification → App passwords. For SendGrid: Free tier, 100 emails/day.",
    cred_fields: [
      { key: "host",     label: "SMTP host", secret: false, placeholder: "smtp.gmail.com or smtp.sendgrid.net" },
      { key: "port",     label: "Port",      secret: false, placeholder: "587", default: "587" },
      { key: "user",     label: "Username",  secret: false, placeholder: "you@gmail.com or apikey" },
      { key: "password", label: "Password / API key", secret: true, placeholder: "…" },
      { key: "from",     label: "From address", secret: false, placeholder: "you@gmail.com" },
      { key: "to",       label: "To address",   secret: false, placeholder: "you@gmail.com" },
    ],
    monthly_cost:  "Gmail: free. SendGrid: free tier 100/day.",
    backend_route: "/api/integrations/smtp",
    icon:          "✉️",
  },

  {
    slug:          "browser_push",
    name:          "Browser push (Web Push)",
    category:      "Notify",
    signup_url:    null,   // built in, no signup
    what_it_unlocks: [
      "Native browser notification (#84) — pops even when TradeCore tab is in the background",
      "Zero-config, uses the Notification API",
    ],
    where_to_find: "Click Enable — browser will ask permission. No account needed.",
    cred_fields: [
      { key: "enabled",   label: "Enabled", secret: false, type: "toggle" },
    ],
    monthly_cost:  "Free",
    backend_route: null,   // client-side only
    icon:          "🔔",
  },

  // ── News / Market data ─────────────────────────────────────────────────
  {
    slug:          "forex_factory",
    name:          "Forex Factory (news)",
    category:      "News",
    signup_url:    "https://www.forexfactory.com/calendar",
    what_it_unlocks: [
      "Economic calendar (#38 / #97) — FOMC, NFP, CPI, PPI, retail sales",
      "News blackout auto-pause (#57 / #153) — mute the strategy 5min before red news",
    ],
    where_to_find: "No API key — TradeCore's backend scrapes ff-calendar.json. Just enable it.",
    cred_fields: [
      { key: "enabled",     label: "Enabled",         secret: false, type: "toggle" },
      { key: "min_impact",  label: "Min impact",      secret: false, placeholder: "high / medium / low", default: "high" },
      { key: "blackout_pre_min",  label: "Pre-news blackout min", secret: false, default: "5" },
      { key: "blackout_post_min", label: "Post-news blackout min", secret: false, default: "5" },
    ],
    monthly_cost:  "Free",
    backend_route: "/api/integrations/forex_factory",
    icon:          "📰",
  },

  {
    slug:          "twitter",
    name:          "X (Twitter) API",
    category:      "News",
    signup_url:    "https://developer.twitter.com/en/portal/products",
    what_it_unlocks: [
      "Follow specific trader accounts for tweets (#154)",
      "Auto-fetch tweets from @unusual_whales, @DeItaone, etc.",
    ],
    where_to_find: "developer.twitter.com → Portal → Create Project → Copy Bearer Token",
    cred_fields: [
      { key: "bearer_token", label: "Bearer token", secret: true, placeholder: "AAAAAAAA…" },
      { key: "accounts",     label: "Handles to watch (comma-sep)", secret: false,
        placeholder: "unusual_whales, DeItaone" },
    ],
    monthly_cost:  "Free tier: 500 posts/mo. Basic: $200/mo.",
    backend_route: "/api/integrations/twitter",
    icon:          "𝕏",
  },

  // ── Storage / Sync ─────────────────────────────────────────────────────
  {
    slug:          "aws_s3",
    name:          "AWS S3 (backup)",
    category:      "Storage",
    signup_url:    "https://aws.amazon.com/",
    what_it_unlocks: [
      "Weekly Postgres backup to S3 (#66)",
      "Off-site trade history — survives Railway going down",
    ],
    where_to_find: "AWS Console → IAM → Users → Create user → attach AmazonS3FullAccess policy → Security credentials → Create access key",
    cred_fields: [
      { key: "region",             label: "Region",     secret: false, placeholder: "us-east-1", default: "us-east-1" },
      { key: "bucket",             label: "Bucket name", secret: false, placeholder: "tradecore-backups" },
      { key: "access_key_id",      label: "Access key ID", secret: false, placeholder: "AKIA…" },
      { key: "secret_access_key",  label: "Secret access key", secret: true, placeholder: "…" },
    ],
    monthly_cost:  "S3 storage: ~$0.023/GB/mo. Your trade DB is tiny — pennies.",
    backend_route: "/api/integrations/aws_s3",
    icon:          "🪣",
  },

  {
    slug:          "google_sheets",
    name:          "Google Sheets (sync)",
    category:      "Storage",
    signup_url:    "https://console.cloud.google.com/",
    what_it_unlocks: [
      "Auto-export closed trades to a Google Sheet every day (#91)",
      "Use Sheets for custom analytics + share read-only with accountant",
    ],
    where_to_find: "console.cloud.google.com → Create Project → APIs & Services → Enable Google Sheets API → OAuth consent → Credentials → Create Service Account → download JSON key",
    cred_fields: [
      { key: "spreadsheet_id",     label: "Spreadsheet ID",       secret: false, placeholder: "1AbC…xyz (from sheet URL)" },
      { key: "service_account_email", label: "Service account email", secret: false, placeholder: "…@…iam.gserviceaccount.com" },
      { key: "private_key",        label: "Private key (JSON)",    secret: true,  placeholder: "-----BEGIN PRIVATE KEY-----\\n…" },
      { key: "sheet_name",         label: "Tab name",              secret: false, placeholder: "Trades", default: "Trades" },
    ],
    monthly_cost:  "Free",
    backend_route: "/api/integrations/google_sheets",
    icon:          "📊",
  },

  // ── FX / market data ──────────────────────────────────────────────────
  {
    slug:          "exchange_rate",
    name:          "Exchange Rate API (FX)",
    category:      "Market data",
    signup_url:    "https://www.exchangerate-api.com/",
    what_it_unlocks: [
      "Multi-currency display (#95 / #140) — show EUR / GBP / JPY accounts in USD",
      "Cross-currency P&L conversion for the unified report",
    ],
    where_to_find: "exchangerate-api.com → Free tier → Sign up → copy your API key",
    cred_fields: [
      { key: "api_key",       label: "API key",       secret: true, placeholder: "…" },
      { key: "base_currency", label: "Base currency", secret: false, placeholder: "USD", default: "USD" },
    ],
    monthly_cost:  "Free tier: 1,500 requests/mo",
    backend_route: "/api/integrations/exchange_rate",
    icon:          "💱",
  },

  {
    slug:          "databento",
    name:          "DataBento (futures history)",
    category:      "Market data",
    signup_url:    "https://databento.com/",
    what_it_unlocks: [
      "Bar data past May 5 (fixes the on-disk data wall from memory)",
      "Backtest sim past your local cache",
      "Live tick history for slippage analysis (#135)",
    ],
    where_to_find: "databento.com → Dashboard → API Keys → Create",
    cred_fields: [
      { key: "api_key", label: "API key", secret: true, placeholder: "db-…" },
    ],
    monthly_cost:  "Pay-per-request. ~$0.10/million bars for CME.",
    backend_route: "/api/integrations/databento",
    icon:          "📈",
  },

  // ── Broker (already wired via MT5 setup guide, but listed here for completeness) ──
  {
    slug:          "metaapi",
    name:          "MetaAPI (MT5 bridge)",
    category:      "Broker",
    signup_url:    "https://app.metaapi.cloud/",
    what_it_unlocks: [
      "FTMO / FundedNext / The5%ers CFD execution via MT5 (task #164)",
      "Bridges TradeCore backend → MT4/MT5 broker accounts",
    ],
    where_to_find: "app.metaapi.cloud → Settings → API Tokens → Create. Then provision your MT-account and copy account_id.",
    cred_fields: [
      { key: "token",     label: "API token",       secret: true,  placeholder: "eyJhbG…" },
      { key: "account_id", label: "MT5 account_id", secret: false, placeholder: "b1c7f8e0-…" },
    ],
    monthly_cost:  "Free tier: 1 account, 24h trial. Paid: $2-8/mo per account tier.",
    backend_route: "/api/integrations/metaapi",
    icon:          "🌉",
    external_setup_page: "/Mt5Mirror",   // link to the existing full guide
  },

  // ── Discord / Slack — already wired via #92 Webhooks, listed to point users there ──
  {
    slug:          "discord",
    name:          "Discord Webhooks",
    category:      "Notify",
    signup_url:    null,
    what_it_unlocks: [
      "Trade alerts to your Discord channel (already wired via #92)",
      "Configure per-event which hooks fire — full control on /Webhooks",
    ],
    where_to_find: "Discord Server → Settings → Integrations → Webhooks → New Webhook",
    cred_fields:   [],
    monthly_cost:  "Free",
    backend_route: null,
    icon:          "💬",
    external_setup_page: "/Webhooks",
    already_wired: true,
  },

  {
    slug:          "slack",
    name:          "Slack Webhooks",
    category:      "Notify",
    signup_url:    "https://api.slack.com/apps",
    what_it_unlocks: [
      "Trade alerts to Slack (already wired via #92)",
    ],
    where_to_find: "api.slack.com/apps → Create App → Incoming Webhooks → Copy URL",
    cred_fields:   [],
    monthly_cost:  "Free",
    backend_route: null,
    icon:          "💼",
    external_setup_page: "/Webhooks",
    already_wired: true,
  },
];

// -----------------------------------------------------------------------------
// Storage — one blob per slug. Secrets encoded flat for MVP; server-side
// vault takes over with backend #40 auth.

const CFG_KEY = "tradecore_integrations_cfg_v1";

function loadAll() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); }
  catch { return {}; }
}
function saveAll(o) { try { localStorage.setItem(CFG_KEY, JSON.stringify(o || {})); } catch {} }

export function getIntegration(slug) {
  return loadAll()[slug] || {};
}

export function setIntegration(slug, patch) {
  const all = loadAll();
  all[slug] = { ...(all[slug] || {}), ...patch, updated_at: new Date().toISOString() };
  saveAll(all);
  return all[slug];
}

export function clearIntegration(slug) {
  const all = loadAll();
  delete all[slug];
  saveAll(all);
}

export function listConfigured() {
  return Object.keys(loadAll());
}

// -----------------------------------------------------------------------------
// Status classification (for the badge on each card)

export function integrationStatus(slug) {
  const int = INTEGRATIONS.find(i => i.slug === slug);
  if (!int) return { level: "unknown", label: "unknown" };
  if (int.already_wired) return { level: "wired", label: "wired via /Webhooks" };
  const cfg = getIntegration(slug);

  // How many required (secret) fields are populated?
  const required = int.cred_fields.filter(f => f.secret);
  const filled = required.filter(f => !!cfg[f.key]).length;

  if (required.length === 0 && Object.keys(cfg).length === 0)
    return { level: "not_configured", label: "Not configured" };
  if (filled === 0)
    return { level: "not_configured", label: "Not configured" };
  if (filled < required.length)
    return { level: "partial", label: `${filled}/${required.length} creds set` };

  // All secrets set. Check verification stamp.
  if (cfg.last_test_ok) return { level: "verified", label: "Verified" };
  if (cfg.last_test_error) return { level: "failed", label: "Test failed" };
  return { level: "configured", label: "Configured (untested)" };
}

// -----------------------------------------------------------------------------
// Test connection — hits backend stub. Backend echoes { phase: "2A" } until
// the corresponding env var is set on Railway; then it starts making real
// calls.

export async function testConnection(slug) {
  const int = INTEGRATIONS.find(i => i.slug === slug);
  if (!int || !int.backend_route) {
    return { ok: false, note: "No backend route for this integration" };
  }
  const cfg = getIntegration(slug);
  try {
    const resp = await fetch(`${int.backend_route}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(cfg),
    });
    const data = await resp.json().catch(() => ({}));
    const ok = resp.ok && data.ok !== false;
    setIntegration(slug, ok
      ? { last_test_ok: new Date().toISOString(), last_test_error: null }
      : { last_test_error: data.reason || `HTTP ${resp.status}`, last_test_ok: null });
    return { ok, phase: data.phase, ...data };
  } catch (e) {
    setIntegration(slug, { last_test_error: String(e?.message || e), last_test_ok: null });
    return { ok: false, note: String(e?.message || e) };
  }
}

// Group integrations by category for the UI
export function integrationsByCategory() {
  const out = {};
  for (const i of INTEGRATIONS) {
    (out[i.category] = out[i.category] || []).push(i);
  }
  return out;
}
