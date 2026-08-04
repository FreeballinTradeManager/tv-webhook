// Task #121 — Asset registry.
// One place to look up contract specs for every symbol we trade:
// tick size, point value ($/point), margin (day + overnight), root
// symbol normalization, and which asset class it belongs to. Feeds
// the risk calculator, margin preview, per-account lot sizer, heat
// monitor, order routing, and PnL math.
//
// Numbers are 2026 CME published day margins for the micro/mini
// contracts most futures traders touch. Verify with your broker for
// live figures — margins move day-to-day.

export const ASSET_REGISTRY = {
  // ── Equity Index ─────────────────────────────────────────────────
  MNQ: { class: "Equity Index", exchange: "CME",  name: "Micro E-mini NASDAQ",  tick: 0.25, pv: 2,   day_margin: 150,   overnight_margin: 2140,  session: "US" },
  NQ:  { class: "Equity Index", exchange: "CME",  name: "E-mini NASDAQ",         tick: 0.25, pv: 20,  day_margin: 1500,  overnight_margin: 21400, session: "US" },
  MES: { class: "Equity Index", exchange: "CME",  name: "Micro E-mini S&P 500",  tick: 0.25, pv: 5,   day_margin: 80,    overnight_margin: 1436,  session: "US" },
  ES:  { class: "Equity Index", exchange: "CME",  name: "E-mini S&P 500",        tick: 0.25, pv: 50,  day_margin: 800,   overnight_margin: 14360, session: "US" },
  MYM: { class: "Equity Index", exchange: "CBOT", name: "Micro E-mini Dow",      tick: 1,    pv: 0.5, day_margin: 60,    overnight_margin: 1040,  session: "US" },
  YM:  { class: "Equity Index", exchange: "CBOT", name: "E-mini Dow",            tick: 1,    pv: 5,   day_margin: 600,   overnight_margin: 10400, session: "US" },
  M2K: { class: "Equity Index", exchange: "CME",  name: "Micro E-mini Russell",  tick: 0.10, pv: 5,   day_margin: 80,    overnight_margin: 774,   session: "US" },
  RTY: { class: "Equity Index", exchange: "CME",  name: "E-mini Russell",        tick: 0.10, pv: 50,  day_margin: 800,   overnight_margin: 7740,  session: "US" },

  // ── Metals ───────────────────────────────────────────────────────
  MGC: { class: "Metals",       exchange: "COMEX", name: "Micro Gold",           tick: 0.10, pv: 10,  day_margin: 200,   overnight_margin: 1050,  session: "US" },
  GC:  { class: "Metals",       exchange: "COMEX", name: "Gold",                 tick: 0.10, pv: 100, day_margin: 2000,  overnight_margin: 10500, session: "US" },
  SI:  { class: "Metals",       exchange: "COMEX", name: "Silver",               tick: 0.005, pv: 5000, day_margin: 3500, overnight_margin: 14000, session: "US" },
  HG:  { class: "Metals",       exchange: "COMEX", name: "Copper",               tick: 0.0005, pv: 25000, day_margin: 2500, overnight_margin: 9500, session: "US" },

  // ── Energy ───────────────────────────────────────────────────────
  CL:  { class: "Energy",       exchange: "NYMEX", name: "WTI Crude Oil",        tick: 0.01, pv: 1000, day_margin: 1500, overnight_margin: 6600, session: "US" },
  MCL: { class: "Energy",       exchange: "NYMEX", name: "Micro WTI",            tick: 0.01, pv: 100,  day_margin: 150,  overnight_margin: 660,  session: "US" },
  NG:  { class: "Energy",       exchange: "NYMEX", name: "Natural Gas",          tick: 0.001, pv: 10000, day_margin: 2500, overnight_margin: 5900, session: "US" },
  MNG: { class: "Energy",       exchange: "NYMEX", name: "Micro Natural Gas",    tick: 0.001, pv: 1000, day_margin: 250,  overnight_margin: 590,  session: "US" },
  RB:  { class: "Energy",       exchange: "NYMEX", name: "RBOB Gasoline",        tick: 0.0001, pv: 42000, day_margin: 2500, overnight_margin: 6000, session: "US" },
  HO:  { class: "Energy",       exchange: "NYMEX", name: "Heating Oil",          tick: 0.0001, pv: 42000, day_margin: 2500, overnight_margin: 6000, session: "US" },

  // ── FX ───────────────────────────────────────────────────────────
  EURUSD: { class: "FX", exchange: "CME", name: "Euro / USD",            tick: 0.00005, pv: 125000, day_margin: 500, overnight_margin: 2860, session: "24x5" },
  "6E":   { class: "FX", exchange: "CME", name: "Euro FX",               tick: 0.00005, pv: 125000, day_margin: 500, overnight_margin: 2860, session: "24x5" },
  GBPUSD: { class: "FX", exchange: "CME", name: "British Pound / USD",   tick: 0.0001,  pv: 62500,  day_margin: 500, overnight_margin: 2130, session: "24x5" },
  "6B":   { class: "FX", exchange: "CME", name: "British Pound",         tick: 0.0001,  pv: 62500,  day_margin: 500, overnight_margin: 2130, session: "24x5" },
  AUDUSD: { class: "FX", exchange: "CME", name: "Aussie / USD",          tick: 0.0001,  pv: 100000, day_margin: 300, overnight_margin: 1470, session: "24x5" },
  "6A":   { class: "FX", exchange: "CME", name: "Australian Dollar",     tick: 0.0001,  pv: 100000, day_margin: 300, overnight_margin: 1470, session: "24x5" },
  USDJPY: { class: "FX", exchange: "CME", name: "USD / Yen",             tick: 0.005,   pv: 1250,   day_margin: 300, overnight_margin: 1600, session: "24x5" },
  "6J":   { class: "FX", exchange: "CME", name: "Japanese Yen",          tick: 0.000005, pv: 12500000, day_margin: 300, overnight_margin: 1600, session: "24x5" },
};

// Symbol aliases → canonical root. Tradovate uses "MNQ1!", TV "MNQ",
// PMT "MNQZ2025" etc. Anything not matched maps to itself.
const ALIAS = {
  MNQ1: "MNQ", NQ1: "NQ", MES1: "MES", ES1: "ES",
  MYM1: "MYM", YM1: "YM", M2K1: "M2K", RTY1: "RTY",
  MGC1: "MGC", GC1: "GC", MNG1: "MNG", NG1: "NG",
  CL1: "CL",   MCL1: "MCL", "6E1": "6E", "6B1": "6B",
};

// Normalize any symbol to the registry key.
// "MNQ1!" → "MNQ" · "MNQZ2025" → "MNQ" · "eurusd" → "EURUSD"
export function normalizeSymbol(sym) {
  if (!sym) return null;
  const upper = String(sym).toUpperCase();
  // Strip trailing "1!" or contract month suffixes (Z2025, H26, etc.)
  const stripped = upper.replace(/[!]+$/, "").replace(/(\d+)?[FGHJKMNQUVXZ]\d{2,4}$/i, "").replace(/1$/, "");
  if (ASSET_REGISTRY[upper])    return upper;
  if (ASSET_REGISTRY[stripped]) return stripped;
  if (ALIAS[upper])             return ALIAS[upper];
  if (ALIAS[stripped])          return ALIAS[stripped];
  return null;
}

// Look up spec by symbol (any format). Returns null if not registered.
export function assetSpec(sym) {
  const key = normalizeSymbol(sym);
  return key ? { root: key, ...ASSET_REGISTRY[key] } : null;
}

// Dollar-per-tick for a symbol — the smallest price move × pv.
export function tickValue(sym) {
  const s = assetSpec(sym);
  return s ? s.tick * s.pv : 0;
}

// Convert a tick count into a dollar amount for N contracts.
// tickCount × tick × pv × qty.
export function ticksToUsd(sym, tickCount, qty = 1) {
  const s = assetSpec(sym);
  if (!s) return 0;
  return Math.abs(tickCount) * s.tick * s.pv * qty;
}

// Group symbols by asset class — for correlation/heat rollups.
export function groupByClass() {
  const map = new Map();
  for (const [root, spec] of Object.entries(ASSET_REGISTRY)) {
    const arr = map.get(spec.class) || [];
    arr.push({ root, ...spec });
    map.set(spec.class, arr);
  }
  return map;
}

// Bulk export of contract roots — for symbol pickers.
export function allSymbols() {
  return Object.keys(ASSET_REGISTRY);
}
