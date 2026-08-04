// Task #131 — Trading hours + holiday calendar per asset.
//
// CME Globex futures + FX. Times are ET (America/New_York). Weekly
// maintenance halt Fri 17:00 → Sun 18:00 ET. Individual products have
// intra-day maintenance breaks (17:00–18:00 ET daily) except FX and CL
// which have shorter breaks.
//
// Holiday list = US federal holidays that trigger early CME closes /
// full closes for equity index / metals / energy futures. Rolled every
// year — the 2026–2027 dates below cover the current + next year.
// If we later add a scraper, keep this file as fallback.

export const ASSET_HOURS = {
  // Equity index — MNQ / NQ / MES / ES / MYM / YM / M2K / RTY
  EQUITY_INDEX: {
    label: "CME Equity Index",
    contracts: ["MNQ", "NQ", "MES", "ES", "SP", "MYM", "YM", "M2K", "RTY"],
    weekly: [
      { day: "Sun", open: "18:00", close: "17:00" },   // opens Sun 18:00
      { day: "Mon", open: "18:00", close: "17:00" },
      { day: "Tue", open: "18:00", close: "17:00" },
      { day: "Wed", open: "18:00", close: "17:00" },
      { day: "Thu", open: "18:00", close: "17:00" },
      // Fri close at 17:00; no reopen until Sun 18:00.
    ],
    daily_break_min: 60,        // 17:00–18:00 ET
    rth: { open: "09:30", close: "16:00" },
    settle_cash: "16:00",
  },
  // Metals — MGC / GC + MSI / SI + Copper HG
  METALS: {
    label: "COMEX Metals",
    contracts: ["MGC", "GC", "SI", "SIL", "HG"],
    weekly: [
      { day: "Sun", open: "18:00", close: "17:00" },
      { day: "Mon", open: "18:00", close: "17:00" },
      { day: "Tue", open: "18:00", close: "17:00" },
      { day: "Wed", open: "18:00", close: "17:00" },
      { day: "Thu", open: "18:00", close: "17:00" },
    ],
    daily_break_min: 60,
    rth: { open: "08:20", close: "13:30" },
    settle_cash: "13:30",
  },
  // Energy — CL / NG / MNG / RB / HO
  ENERGY: {
    label: "NYMEX Energy",
    contracts: ["CL", "MNG", "NG", "RB", "HO"],
    weekly: [
      { day: "Sun", open: "18:00", close: "17:00" },
      { day: "Mon", open: "18:00", close: "17:00" },
      { day: "Tue", open: "18:00", close: "17:00" },
      { day: "Wed", open: "18:00", close: "17:00" },
      { day: "Thu", open: "18:00", close: "17:00" },
    ],
    daily_break_min: 60,
    rth: { open: "09:00", close: "14:30" },
    settle_cash: "14:30",
  },
  // FX pairs — E-Micro + full-size
  FX: {
    label: "CME FX",
    contracts: ["EURUSD", "6E", "GBPUSD", "6B", "AUDUSD", "6A", "USDJPY", "6J"],
    weekly: [
      { day: "Sun", open: "17:00", close: "17:00" },
      { day: "Mon", open: "17:00", close: "16:00" },
      { day: "Tue", open: "17:00", close: "16:00" },
      { day: "Wed", open: "17:00", close: "16:00" },
      { day: "Thu", open: "17:00", close: "16:00" },
    ],
    daily_break_min: 60,
    rth: { open: "07:20", close: "14:00" },
    settle_cash: "14:00",
  },
};

// US CME holidays — 2026 + 2027.
// Kind: "closed" (full day off) / "early_close" (RTH shortened) / "open_normal" (label only).
export const HOLIDAYS = [
  // 2026
  { date: "2026-01-01", name: "New Year's Day",            kind: "early_close", details: "Equity 13:00 ET · Metals 13:30 ET · Energy 13:30 ET" },
  { date: "2026-01-19", name: "Martin Luther King Jr. Day",kind: "early_close", details: "Equity 13:00 ET · Metals 13:00 ET" },
  { date: "2026-02-16", name: "Presidents' Day",           kind: "early_close", details: "Equity 13:00 ET · Metals 13:00 ET" },
  { date: "2026-04-03", name: "Good Friday",               kind: "closed",      details: "All CME closed" },
  { date: "2026-05-25", name: "Memorial Day",              kind: "early_close", details: "Equity 13:00 ET · Metals + Energy 13:00 ET" },
  { date: "2026-06-19", name: "Juneteenth",                kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2026-07-03", name: "Independence Day (obs)",    kind: "early_close", details: "Equity 13:00 ET · Metals 13:00 ET" },
  { date: "2026-09-07", name: "Labor Day",                 kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2026-11-11", name: "Veterans Day",              kind: "open_normal", details: "Bond market closed; futures normal" },
  { date: "2026-11-26", name: "Thanksgiving",              kind: "early_close", details: "Equity 13:00 ET · Metals 13:00 ET" },
  { date: "2026-11-27", name: "Day after Thanksgiving",    kind: "early_close", details: "Equity 12:15 ET · Metals 13:15 ET (early close)" },
  { date: "2026-12-24", name: "Christmas Eve",             kind: "early_close", details: "Equity 12:15 ET · Metals 13:15 ET" },
  { date: "2026-12-25", name: "Christmas",                 kind: "closed",      details: "All CME closed" },

  // 2027
  { date: "2027-01-01", name: "New Year's Day",            kind: "early_close", details: "Standard early close" },
  { date: "2027-01-18", name: "Martin Luther King Jr. Day",kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-02-15", name: "Presidents' Day",           kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-03-26", name: "Good Friday",               kind: "closed",      details: "All CME closed" },
  { date: "2027-05-31", name: "Memorial Day",              kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-06-19", name: "Juneteenth (obs)",          kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-07-05", name: "Independence Day (obs)",    kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-09-06", name: "Labor Day",                 kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-11-25", name: "Thanksgiving",              kind: "early_close", details: "Equity 13:00 ET" },
  { date: "2027-11-26", name: "Day after Thanksgiving",    kind: "early_close", details: "Equity 12:15 ET" },
  { date: "2027-12-24", name: "Christmas Eve",             kind: "early_close", details: "Equity 12:15 ET" },
  { date: "2027-12-25", name: "Christmas",                 kind: "closed",      details: "All CME closed" },
];

// Root symbol → asset class lookup.
export function assetClass(root) {
  if (!root) return null;
  const r = String(root).toUpperCase().replace(/[!1]+$/, "");
  for (const [key, spec] of Object.entries(ASSET_HOURS)) {
    if (spec.contracts.includes(r)) return { key, ...spec };
  }
  return null;
}

// Today's ISO date in ET (respects DST).
export function todayETISO() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(now);
}

// Today's ET wall-clock as HH:MM string.
export function nowETTimeHHMM() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
  return fmt.format(now);
}

// Return a status descriptor for a specific asset root right now.
// { state: "open" | "break" | "closed" | "weekend" | "holiday", note, hours }
export function assetStatus(root, atISO = null, atHHMM = null) {
  const spec = assetClass(root);
  if (!spec) return { state: "unknown", note: "asset not registered", hours: null };

  const iso = atISO || todayETISO();
  const hhmm = atHHMM || nowETTimeHHMM();
  const holiday = HOLIDAYS.find(h => h.date === iso);
  if (holiday && holiday.kind === "closed") {
    return { state: "holiday", note: `${holiday.name} — CME closed`, hours: null, holiday };
  }

  // Weekend: Fri after 17:00 → Sun 18:00
  const jsDate = new Date(iso + "T12:00:00-05:00");
  const dow = jsDate.getUTCDay(); // 0=Sun … 6=Sat
  if (dow === 6) return { state: "weekend", note: "Saturday — CME closed", hours: null };
  const [h, m] = hhmm.split(":").map(Number);
  const mins = h * 60 + m;

  if (dow === 5 && mins >= 17 * 60) return { state: "weekend", note: "Friday close — reopens Sunday 18:00 ET", hours: null };
  if (dow === 0 && mins < 18 * 60)  return { state: "weekend", note: "Sunday pre-open — market opens 18:00 ET", hours: null };

  // Daily break 17:00–18:00 ET (all classes we track)
  if (mins >= 17 * 60 && mins < 18 * 60) {
    return { state: "break", note: "Daily maintenance break (17:00–18:00 ET)", hours: null };
  }

  return {
    state: "open",
    note: holiday ? `Early close: ${holiday.details}` : `${spec.label} — normal hours`,
    hours: spec.rth,
    holiday: holiday || null,
  };
}

// Upcoming holidays list, sorted by date, filtered to on/after ref date.
export function upcomingHolidays(refISO = null, limit = 6) {
  const iso = refISO || todayETISO();
  return HOLIDAYS.filter(h => h.date >= iso).slice(0, limit);
}
