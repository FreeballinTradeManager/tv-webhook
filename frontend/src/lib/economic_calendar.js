// economic_calendar.js
// Upcoming high-impact economic events. MVP uses a hardcoded schedule of
// known Fed / BLS / BEA / BOE / ECB release dates through end of 2026.
// Phase 2 (once ForexFactory integration is wired via /Integrations) will
// replace this with a live scrape from ff-calendar.
//
// Every event has:
//   { iso, name, impact, currency, category, note }
//
// impact: "red" (market-moving) | "orange" (notable) | "yellow" (low)
// category: "central_bank" | "employment" | "inflation" | "growth"

// -----------------------------------------------------------------------------
// Hardcoded calendar — remainder of 2026 known dates. All times ET.
// FOMC dates from Fed's published 2026 schedule. NFP is 1st Fri of month
// at 8:30 ET. CPI is typically mid-month 8:30 ET. PPI follows CPI by a day.
//
// This is a starter — trader can override/append via localStorage later.

const HARDCODED_EVENTS = [
  // ── August 2026 ──────────────────────────────────────────────────
  { iso: "2026-08-13T12:30:00Z", name: "CPI (July)",           impact: "red",    currency: "USD", category: "inflation",  note: "Consumer Price Index — headline + core" },
  { iso: "2026-08-14T12:30:00Z", name: "PPI (July)",           impact: "orange", currency: "USD", category: "inflation",  note: "Producer Price Index" },
  { iso: "2026-08-15T12:30:00Z", name: "Retail Sales (July)",  impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-08-20T18:00:00Z", name: "FOMC Minutes",         impact: "red",    currency: "USD", category: "central_bank", note: "Minutes from July 30 meeting" },
  { iso: "2026-08-22T14:00:00Z", name: "Jackson Hole Speech",  impact: "red",    currency: "USD", category: "central_bank", note: "Powell keynote at Jackson Hole" },
  { iso: "2026-08-28T12:30:00Z", name: "GDP Q2 2nd est.",      impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-08-29T12:30:00Z", name: "PCE (July)",           impact: "red",    currency: "USD", category: "inflation",  note: "Fed's preferred inflation gauge" },

  // ── September 2026 ───────────────────────────────────────────────
  { iso: "2026-09-05T12:30:00Z", name: "NFP (August)",         impact: "red",    currency: "USD", category: "employment", note: "Non-Farm Payrolls + Unemployment Rate" },
  { iso: "2026-09-11T12:30:00Z", name: "CPI (August)",         impact: "red",    currency: "USD", category: "inflation" },
  { iso: "2026-09-12T12:30:00Z", name: "PPI (August)",         impact: "orange", currency: "USD", category: "inflation" },
  { iso: "2026-09-16T12:30:00Z", name: "Retail Sales (August)", impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-09-16T18:00:00Z", name: "FOMC Rate Decision",   impact: "red",    currency: "USD", category: "central_bank", note: "Rate decision + statement + dot plot" },
  { iso: "2026-09-16T18:30:00Z", name: "Powell Press Conf.",   impact: "red",    currency: "USD", category: "central_bank" },
  { iso: "2026-09-25T12:30:00Z", name: "GDP Q2 3rd est.",      impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-09-26T12:30:00Z", name: "PCE (August)",         impact: "red",    currency: "USD", category: "inflation" },

  // ── October 2026 ─────────────────────────────────────────────────
  { iso: "2026-10-03T12:30:00Z", name: "NFP (September)",      impact: "red",    currency: "USD", category: "employment" },
  { iso: "2026-10-08T18:00:00Z", name: "FOMC Minutes",         impact: "orange", currency: "USD", category: "central_bank" },
  { iso: "2026-10-15T12:30:00Z", name: "CPI (September)",      impact: "red",    currency: "USD", category: "inflation" },
  { iso: "2026-10-16T12:30:00Z", name: "PPI (September)",      impact: "orange", currency: "USD", category: "inflation" },
  { iso: "2026-10-17T12:30:00Z", name: "Retail Sales (Sep)",   impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-10-30T12:30:00Z", name: "GDP Q3 advance",       impact: "red",    currency: "USD", category: "growth" },
  { iso: "2026-10-31T12:30:00Z", name: "PCE (September)",      impact: "red",    currency: "USD", category: "inflation" },

  // ── November 2026 ────────────────────────────────────────────────
  { iso: "2026-11-04T18:00:00Z", name: "FOMC Rate Decision",   impact: "red",    currency: "USD", category: "central_bank", note: "Rate decision + statement" },
  { iso: "2026-11-04T18:30:00Z", name: "Powell Press Conf.",   impact: "red",    currency: "USD", category: "central_bank" },
  { iso: "2026-11-07T13:30:00Z", name: "NFP (October)",        impact: "red",    currency: "USD", category: "employment" },
  { iso: "2026-11-13T13:30:00Z", name: "CPI (October)",        impact: "red",    currency: "USD", category: "inflation" },
  { iso: "2026-11-14T13:30:00Z", name: "PPI (October)",        impact: "orange", currency: "USD", category: "inflation" },
  { iso: "2026-11-17T13:30:00Z", name: "Retail Sales (Oct)",   impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-11-27T13:30:00Z", name: "GDP Q3 2nd est.",      impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-11-28T13:30:00Z", name: "PCE (October)",        impact: "red",    currency: "USD", category: "inflation" },

  // ── December 2026 ────────────────────────────────────────────────
  { iso: "2026-12-05T13:30:00Z", name: "NFP (November)",       impact: "red",    currency: "USD", category: "employment" },
  { iso: "2026-12-10T13:30:00Z", name: "CPI (November)",       impact: "red",    currency: "USD", category: "inflation" },
  { iso: "2026-12-11T13:30:00Z", name: "PPI (November)",       impact: "orange", currency: "USD", category: "inflation" },
  { iso: "2026-12-16T13:30:00Z", name: "Retail Sales (Nov)",   impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-12-16T19:00:00Z", name: "FOMC Rate Decision",   impact: "red",    currency: "USD", category: "central_bank", note: "Final decision of 2026 + dot plot" },
  { iso: "2026-12-16T19:30:00Z", name: "Powell Press Conf.",   impact: "red",    currency: "USD", category: "central_bank" },
  { iso: "2026-12-22T13:30:00Z", name: "GDP Q3 3rd est.",      impact: "orange", currency: "USD", category: "growth" },
  { iso: "2026-12-23T13:30:00Z", name: "PCE (November)",       impact: "red",    currency: "USD", category: "inflation" },
];

// -----------------------------------------------------------------------------
// Config storage (per-user blackout preferences)

const CFG_KEY = "tradecore_news_blackout_cfg_v1";

const DEFAULT_CFG = {
  enabled:          true,
  min_impact:       "red",       // "red" | "orange" | "yellow"
  pre_blackout_min: 5,
  post_blackout_min: 5,
  show_tile:        true,
  max_upcoming:     3,
};

function loadCfg() {
  try { return { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(CFG_KEY) || "{}") }; }
  catch { return DEFAULT_CFG; }
}
function saveCfg(o) { try { localStorage.setItem(CFG_KEY, JSON.stringify(o || {})); } catch {} }

export function getNewsBlackoutCfg() { return loadCfg(); }
export function setNewsBlackoutCfg(patch) {
  const next = { ...loadCfg(), ...patch };
  saveCfg(next);
  return next;
}

// -----------------------------------------------------------------------------
// Query API

const IMPACT_RANK = { red: 3, orange: 2, yellow: 1 };

export function upcomingEvents(minImpact = "red", limit = 5) {
  const now = Date.now();
  const min = IMPACT_RANK[minImpact] ?? 3;
  return HARDCODED_EVENTS
    .filter(e => IMPACT_RANK[e.impact] >= min)
    .filter(e => new Date(e.iso).getTime() > now)
    .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
    .slice(0, limit);
}

// Compute blackout status right now — { active, event, phase }
//   phase: "pre" (before) | "during" (event moment) | "post" (after)
export function currentBlackoutStatus(cfg = null) {
  const c = cfg || loadCfg();
  if (!c.enabled) return { active: false };

  const now = Date.now();
  const upcoming = upcomingEvents(c.min_impact, 3);
  for (const e of upcoming) {
    const eventMs = new Date(e.iso).getTime();
    const preStart  = eventMs - (c.pre_blackout_min * 60 * 1000);
    const postEnd   = eventMs + (c.post_blackout_min * 60 * 1000);
    if (now >= preStart && now < eventMs) {
      return { active: true, event: e, phase: "pre",  ends_at: eventMs };
    }
    if (now >= eventMs && now <= postEnd) {
      return { active: true, event: e, phase: "post", ends_at: postEnd };
    }
  }
  return { active: false };
}

// Format countdown to an event as "in 2h 15m" / "in 45m" / "in 30s"
export function fmtCountdown(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "passed";
  const sec = Math.floor(ms / 1000);
  const day = Math.floor(sec / 86400);
  const hr  = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  const s   = sec % 60;
  if (day > 0) return `in ${day}d ${hr}h`;
  if (hr > 0)  return `in ${hr}h ${min}m`;
  if (min > 5) return `in ${min}m`;
  if (min > 0) return `in ${min}m ${s}s`;
  return `in ${s}s`;
}

// Format event time as local HH:MM
export function fmtLocalTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", weekday: "short", month: "short", day: "numeric" });
}
