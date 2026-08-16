// trade_digest.js
// Rolling-window statistics from an array of Trade rows (Base44 shape).
// Pure JS — no async, no external deps. Feeds the Weekly Digest card and
// any other analytics widget that wants a "last N days" summary.
//
// Trade shape (whatever /api/trades returns is fine — we're defensive):
//   { id, symbol, side, entry_price, exit_price, stop_loss, take_profit,
//     quantity, pnl, status, entry_time, exit_time, close_time, created_date,
//     tags, session, notes, ... }

const DAY_MS = 86_400_000;

// -----------------------------------------------------------------------------
// Filter closed trades within a rolling window ending now.
export function tradesInWindow(trades, days = 7) {
  const now  = Date.now();
  const from = now - days * DAY_MS;
  return (trades || []).filter(t => {
    if (t.status !== "closed" && t.status !== "cancelled" && t.exit_time == null && t.close_time == null) return false;
    const ts = new Date(t.exit_time || t.close_time || t.exit_date || t.close_date || t.created_date || 0).getTime();
    return ts >= from && ts <= now;
  });
}

// -----------------------------------------------------------------------------
// Realized $ per trade — falls back through common Base44 field names.
function pnlOf(t) {
  const cand = t.pnl ?? t.realized_pnl ?? t.profit ?? t.p_and_l ?? t.pnl_usd ?? t.net_pnl;
  const n = Number(cand);
  return isFinite(n) ? n : 0;
}

// R multiple = pnl / initial-risk. Risk = qty × |entry - stop|.
// Only meaningful if entry + stop + qty are all present.
function rMultipleOf(t) {
  const q = Number(t.quantity || t.qty || 0);
  const e = Number(t.entry_price ?? t.entry ?? 0);
  const s = Number(t.stop_loss ?? t.stop_price ?? t.stop ?? 0);
  const r = q > 0 && e > 0 && s > 0 ? Math.abs(e - s) * q : null;
  if (!r) return null;
  const p = pnlOf(t);
  return p / r;
}

function sessionOf(t) {
  if (t.session) return String(t.session).toUpperCase();
  // Derive from entry_time hour in ET — approximate
  const iso = t.entry_time || t.entry_date || t.created_date;
  if (!iso) return "?";
  const h = new Date(iso).getUTCHours() - 4;   // rough ET without DST
  const hr = (h + 24) % 24;
  if (hr >= 3  && hr < 9)  return "PRE-NY";
  if (hr >= 9  && hr < 16) return "NY";
  return "ASIA";
}

function tickerOf(t) {
  return String(t.symbol || t.ticker || "?").replace("1!", "").toUpperCase();
}

// -----------------------------------------------------------------------------
// Streak — walk newest → oldest, count consecutive wins/losses.
function currentStreak(trades) {
  const closed = trades.slice().sort((a, b) => {
    const ta = new Date(a.exit_time || a.close_time || a.created_date || 0).getTime();
    const tb = new Date(b.exit_time || b.close_time || b.created_date || 0).getTime();
    return tb - ta;
  });
  if (closed.length === 0) return { kind: "none", count: 0 };
  const firstPnl = pnlOf(closed[0]);
  if (firstPnl === 0) return { kind: "scratch", count: 1 };
  const dir = firstPnl > 0 ? "W" : "L";
  let count = 0;
  for (const t of closed) {
    const p = pnlOf(t);
    if (p === 0) break;
    const d = p > 0 ? "W" : "L";
    if (d !== dir) break;
    count++;
  }
  return { kind: dir, count };
}

// -----------------------------------------------------------------------------
// Main aggregator
export function digest(trades, days = 7) {
  const window = tradesInWindow(trades, days);
  const n = window.length;
  if (n === 0) {
    return {
      days, count: 0, empty: true,
      total_pnl: 0, win_rate: 0, wins: 0, losses: 0, scratches: 0,
      best: null, worst: null, biggest_win: 0, biggest_loss: 0,
      avg_win: 0, avg_loss: 0, avg_r: null, expectancy: null,
      profit_factor: null, top_symbol: null, top_symbol_count: 0,
      symbol_pnl: {}, session_pnl: { "PRE-NY": 0, NY: 0, ASIA: 0 },
      streak: { kind: "none", count: 0 },
      top_tag: null, top_tag_count: 0, tag_counts: {},
      previous_period: null,
    };
  }

  let total = 0, sumWin = 0, sumLoss = 0, wins = 0, losses = 0, scratches = 0;
  let biggest_win = 0, biggest_loss = 0;
  let best = null, worst = null;
  const symPnl = {}, symCount = {}, sessionPnl = { "PRE-NY": 0, NY: 0, ASIA: 0 };
  const tagCount = {};
  const rs = [];

  for (const t of window) {
    const p = pnlOf(t);
    total += p;
    if (p > 0) { wins++;   sumWin  += p;  }
    else if (p < 0) { losses++; sumLoss += p; }
    else scratches++;

    if (p > biggest_win)  { biggest_win  = p; best  = t; }
    if (p < biggest_loss) { biggest_loss = p; worst = t; }

    const sym = tickerOf(t);
    symPnl[sym]   = (symPnl[sym]   || 0) + p;
    symCount[sym] = (symCount[sym] || 0) + 1;

    const sess = sessionOf(t);
    if (sessionPnl[sess] !== undefined) sessionPnl[sess] += p;

    const r = rMultipleOf(t);
    if (r != null && isFinite(r)) rs.push(r);

    for (const tag of (t.tags || [])) {
      const k = String(tag).toLowerCase();
      tagCount[k] = (tagCount[k] || 0) + 1;
    }
  }

  const win_rate = n > 0 ? wins / (wins + losses || 1) : 0;
  const avg_win  = wins   > 0 ? sumWin  / wins   : 0;
  const avg_loss = losses > 0 ? sumLoss / losses : 0;
  const avg_r    = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  // Expectancy = winRate*avgWin + lossRate*avgLoss
  const expectancy = wins + losses > 0
    ? (win_rate * avg_win) + ((1 - win_rate) * avg_loss)
    : null;
  const profit_factor = sumLoss < 0 ? sumWin / Math.abs(sumLoss) : (sumWin > 0 ? Infinity : null);

  // Top symbol by count
  const topSym = Object.entries(symCount).sort((a, b) => b[1] - a[1])[0];
  const topTag = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];

  // Compare to the previous same-length window
  const previous = comparePreviousWindow(trades, days);

  return {
    days, count: n, empty: false,
    total_pnl: total,
    win_rate, wins, losses, scratches,
    best, worst,
    biggest_win, biggest_loss,
    avg_win, avg_loss,
    avg_r,
    expectancy,
    profit_factor,
    top_symbol:       topSym?.[0] || null,
    top_symbol_count: topSym?.[1] || 0,
    symbol_pnl:       symPnl,
    session_pnl:      sessionPnl,
    streak:           currentStreak(window),
    top_tag:          topTag?.[0] || null,
    top_tag_count:    topTag?.[1] || 0,
    tag_counts:       tagCount,
    previous_period:  previous,
  };
}

// -----------------------------------------------------------------------------
// Previous-window totals for delta display. Returns { total_pnl, count, win_rate }.
function comparePreviousWindow(trades, days) {
  const now  = Date.now();
  const start = now - 2 * days * DAY_MS;
  const end   = now - days * DAY_MS;
  const prev = (trades || []).filter(t => {
    const ts = new Date(t.exit_time || t.close_time || t.created_date || 0).getTime();
    return ts >= start && ts < end && (t.status === "closed" || t.exit_time != null);
  });
  if (prev.length === 0) return null;
  let total = 0, w = 0, l = 0;
  for (const t of prev) {
    const p = pnlOf(t);
    total += p;
    if (p > 0) w++; else if (p < 0) l++;
  }
  return { total_pnl: total, count: prev.length,
           win_rate: w + l > 0 ? w / (w + l) : 0 };
}
