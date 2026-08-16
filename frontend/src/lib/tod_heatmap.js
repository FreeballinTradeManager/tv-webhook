// tod_heatmap.js
// Bucket trades into a 7-day × 24-hour grid indexed in ET-approximate
// (UTC-4). Every cell holds { count, wins, losses, net_pnl, best, worst }.
//
// Weekend cells stay in the grid on purpose — Sunday 18:00+ is when Asia
// opens for futures, one of Natalia's active windows per memory.
//
// Trade shape: same as the rest of the app — accepts profit_loss, pnl,
// realized_pnl.

const DAY_MS = 86_400_000;
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const HOUR_LABELS_ET = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}`);

function pnlOf(t) {
  const v = t?.profit_loss ?? t?.pnl ?? t?.realized_pnl;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// Approximate ET without DST — good enough for hour bucketing
function etHourDayOf(iso) {
  if (!iso) return null;
  const d  = new Date(iso);
  const et = new Date(d.getTime() - 4 * 3600_000);   // UTC-4
  return {
    weekday: et.getUTCDay(),
    hour:    et.getUTCHours(),
  };
}

function isClosed(t) {
  return t?.status === "closed" || t?.exit_time || t?.close_time;
}

// -----------------------------------------------------------------------------
// Bucket the trade set. Returns:
//   {
//     cells:      [7][24] of { count, wins, losses, net_pnl, best, worst }
//     max_abs:    largest |net_pnl| across all cells (for color scaling)
//     day_totals: [7] of { count, net_pnl, wins, losses }
//     hour_totals:[24] of { count, net_pnl, wins, losses }
//     total:      { count, net_pnl, wins, losses }
//   }

export function heatmap(trades, windowDays = null) {
  let scoped = (trades || []).filter(isClosed);
  if (windowDays != null && windowDays > 0) {
    const cutoff = Date.now() - windowDays * DAY_MS;
    scoped = scoped.filter(t => {
      const ts = new Date(t.exit_time || t.close_time || t.entry_time || t.created_date || 0).getTime();
      return ts >= cutoff;
    });
  }

  const cells = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      count: 0, wins: 0, losses: 0, net_pnl: 0, best: null, worst: null,
    })));

  const dayTotals  = Array.from({ length: 7  }, () => ({ count: 0, net_pnl: 0, wins: 0, losses: 0 }));
  const hourTotals = Array.from({ length: 24 }, () => ({ count: 0, net_pnl: 0, wins: 0, losses: 0 }));
  const total = { count: 0, net_pnl: 0, wins: 0, losses: 0 };

  let maxAbs = 0;

  for (const t of scoped) {
    const iso  = t.entry_time || t.created_date || t.exit_time;
    const pos  = etHourDayOf(iso);
    if (!pos) continue;
    const p = pnlOf(t);
    const cell = cells[pos.weekday][pos.hour];
    cell.count += 1;
    cell.net_pnl += p;
    if (p > 0) cell.wins++;
    else if (p < 0) cell.losses++;
    if (cell.best === null  || p > cell.best)  cell.best  = p;
    if (cell.worst === null || p < cell.worst) cell.worst = p;

    dayTotals[pos.weekday].count++;
    dayTotals[pos.weekday].net_pnl += p;
    if (p > 0) dayTotals[pos.weekday].wins++;
    else if (p < 0) dayTotals[pos.weekday].losses++;

    hourTotals[pos.hour].count++;
    hourTotals[pos.hour].net_pnl += p;
    if (p > 0) hourTotals[pos.hour].wins++;
    else if (p < 0) hourTotals[pos.hour].losses++;

    total.count++;
    total.net_pnl += p;
    if (p > 0) total.wins++;
    else if (p < 0) total.losses++;

    if (Math.abs(cell.net_pnl) > maxAbs) maxAbs = Math.abs(cell.net_pnl);
  }

  return { cells, max_abs: maxAbs, day_totals: dayTotals, hour_totals: hourTotals, total };
}

// Convert a cell's net_pnl into a 0..1 intensity relative to the max.
// Returns { intensity: 0..1, kind: "win" | "loss" | "flat" }.
export function cellIntensity(cell, maxAbs) {
  if (!cell || cell.count === 0 || maxAbs === 0) return { intensity: 0, kind: "empty" };
  if (cell.net_pnl > 0) return { intensity: Math.min(1, cell.net_pnl / maxAbs), kind: "win" };
  if (cell.net_pnl < 0) return { intensity: Math.min(1, -cell.net_pnl / maxAbs), kind: "loss" };
  return { intensity: 0.15, kind: "flat" };
}

// Rank the top-N + bottom-N (day, hour) cells by net P&L. Useful for a
// "your best cell is Thu 09:00" callout.
export function topCells(cells, n = 3) {
  const flat = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = cells[d][h];
      if (c.count > 0) flat.push({ weekday: d, hour: h, ...c });
    }
  }
  const sorted = flat.slice().sort((a, b) => b.net_pnl - a.net_pnl);
  return {
    best:  sorted.slice(0, n),
    worst: sorted.slice(-n).reverse(),
  };
}
