// whatif.js
// Counterfactual P&L analyzer — pure JS on Trade rows.
//
// The trader picks a set of EXCLUSION filters. We compute the P&L of the
// remaining trades and compare to the actual P&L of the whole set. Delta
// tells them how much a bad habit is costing (or how much a rule is
// helping if the delta is negative — meaning your filter excludes winners).
//
// Filter shape:
//   {
//     exclude_tags:     ["revenge", "fomo"]         — drop trades tagged with any
//     exclude_sessions: ["ASIA"]                    — drop trades in these sessions
//     exclude_symbols:  ["GC"]                      — drop trades on these symbols
//     exclude_days:     ["Sun"]                     — drop trades on these weekdays
//     only_symbols:     ["MNQ"]                     — keep ONLY these (optional)
//     only_sessions:    ["NY"]                      — keep ONLY these (optional)
//     only_tags:        ["disciplined"]             — keep ONLY tagged-with-any (optional)
//     min_qty:          number                       — drop trades below this size
//     max_qty:          number                       — drop trades above this size
//   }

const DAY_MS = 86_400_000;

function pnlOf(t) {
  const v = t?.profit_loss ?? t?.pnl ?? t?.realized_pnl;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function symOf(t) {
  return String(t?.symbol || t?.ticker || "").toUpperCase().replace(/1!$/, "");
}

function sessionOf(t) {
  if (t?.session) return String(t.session).toUpperCase();
  // Same 5-session model as Trade Log
  const iso = t?.entry_time || t?.created_date;
  if (!iso) return "OTHER";
  const d = new Date(iso);
  const h = ((d.getUTCHours() - 4) + 24) % 24 + d.getUTCMinutes() / 60;   // ~ET
  if (h >= 18 || h < 1)  return "ASIA";
  if (h >= 3  && h < 8)  return "LONDON";
  if (h >= 8  && h < 9.5)  return "PRE-NY";
  if (h >= 9.5 && h < 16)  return "NY";
  if (h >= 16 && h < 18)  return "POST-NY";
  return "OTHER";
}

function weekdayOf(t) {
  const iso = t?.entry_time || t?.created_date;
  if (!iso) return null;
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(iso).getDay()];
}

function tagsOf(t) {
  return (t?.tags || []).map(x => String(x).toLowerCase());
}

// -----------------------------------------------------------------------------
// Filter — returns { kept, dropped } arrays

export function applyWhatIf(trades, f = {}) {
  const kept = [], dropped = [];
  for (const t of (trades || [])) {
    if (!isClosed(t)) { dropped.push({ trade: t, reason: "open" }); continue; }
    const drop = decideDrop(t, f);
    if (drop) dropped.push({ trade: t, reason: drop });
    else kept.push(t);
  }
  return { kept, dropped };
}

function isClosed(t) {
  return t?.status === "closed" || t?.exit_time || t?.close_time;
}

function decideDrop(t, f) {
  const excludeTags = new Set((f.exclude_tags || []).map(x => x.toLowerCase()));
  const excludeSessions = new Set((f.exclude_sessions || []).map(x => x.toUpperCase()));
  const excludeSymbols = new Set((f.exclude_symbols || []).map(x => x.toUpperCase().replace(/1!$/, "")));
  const excludeDays = new Set(f.exclude_days || []);

  const onlyTags     = f.only_tags     ? new Set(f.only_tags.map(x => x.toLowerCase())) : null;
  const onlySessions = f.only_sessions ? new Set(f.only_sessions.map(x => x.toUpperCase())) : null;
  const onlySymbols  = f.only_symbols  ? new Set(f.only_symbols.map(x => x.toUpperCase().replace(/1!$/, ""))) : null;

  const tags    = tagsOf(t);
  const session = sessionOf(t);
  const sym     = symOf(t);
  const day     = weekdayOf(t);
  const qty     = Number(t.quantity || t.qty || 0);

  if (tags.some(x => excludeTags.has(x)))  return `tag:${tags.find(x => excludeTags.has(x))}`;
  if (excludeSessions.has(session))         return `session:${session}`;
  if (excludeSymbols.has(sym))              return `symbol:${sym}`;
  if (day && excludeDays.has(day))          return `day:${day}`;
  if (f.min_qty != null && qty < f.min_qty) return `min_qty:${qty}<${f.min_qty}`;
  if (f.max_qty != null && qty > f.max_qty) return `max_qty:${qty}>${f.max_qty}`;

  if (onlyTags && !tags.some(x => onlyTags.has(x)))    return `not_only_tag`;
  if (onlySessions && !onlySessions.has(session))       return `not_only_session:${session}`;
  if (onlySymbols && !onlySymbols.has(sym))             return `not_only_symbol:${sym}`;

  return null;
}

// -----------------------------------------------------------------------------
// Summary — compute stats on a set of trades

export function summarize(trades) {
  const list = (trades || []).filter(isClosed);
  const n = list.length;
  let total = 0, w = 0, l = 0, wSum = 0, lSum = 0;
  for (const t of list) {
    const p = pnlOf(t);
    total += p;
    if (p > 0) { w++; wSum += p; }
    else if (p < 0) { l++; lSum += p; }
  }
  const winRate = w + l > 0 ? w / (w + l) : 0;
  const avgWin  = w > 0 ? wSum / w : 0;
  const avgLoss = l > 0 ? lSum / l : 0;
  const pf      = lSum < 0 ? wSum / Math.abs(lSum) : (wSum > 0 ? Infinity : 0);
  const expectancy = w + l > 0 ? (winRate * avgWin) + ((1 - winRate) * avgLoss) : 0;
  return {
    count: n, total_pnl: total, wins: w, losses: l, win_rate: winRate,
    avg_win: avgWin, avg_loss: avgLoss, profit_factor: pf, expectancy,
  };
}

// -----------------------------------------------------------------------------
// The main run — compares actual vs filtered

export function runWhatIf(trades, filter, windowDays = null) {
  let scoped = trades || [];
  if (windowDays != null && windowDays > 0) {
    const cutoff = Date.now() - windowDays * DAY_MS;
    scoped = scoped.filter(t => {
      const ts = new Date(t.exit_time || t.close_time || t.entry_time || t.created_date || 0).getTime();
      return ts >= cutoff;
    });
  }
  const actual = summarize(scoped);
  const { kept, dropped } = applyWhatIf(scoped, filter);
  const filtered = summarize(kept);

  return {
    actual,
    filtered,
    delta: {
      total_pnl:     filtered.total_pnl - actual.total_pnl,
      count:         filtered.count - actual.count,
      win_rate:      filtered.win_rate - actual.win_rate,
      profit_factor: filtered.profit_factor - actual.profit_factor,
      expectancy:    filtered.expectancy - actual.expectancy,
    },
    dropped: dropped.map(d => ({
      symbol: d.trade.symbol || d.trade.ticker,
      pnl: pnlOf(d.trade),
      reason: d.reason,
      entry_time: d.trade.entry_time,
    })),
    kept_count:    kept.length,
    dropped_count: dropped.length,
  };
}

// -----------------------------------------------------------------------------
// Discover available filter values from a trade set — feeds the UI dropdowns

export function discoverFacets(trades) {
  const tags = new Set(), sessions = new Set(), symbols = new Set(), days = new Set();
  for (const t of (trades || [])) {
    for (const x of tagsOf(t)) tags.add(x);
    sessions.add(sessionOf(t));
    symbols.add(symOf(t));
    const d = weekdayOf(t);
    if (d) days.add(d);
  }
  return {
    tags:     [...tags].sort(),
    sessions: [...sessions].filter(Boolean).sort(),
    symbols:  [...symbols].filter(Boolean).sort(),
    days:     ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].filter(d => days.has(d)),
  };
}
