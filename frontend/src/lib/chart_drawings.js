// Task #133 — Chart annotation persistence.
// TradingView's charting library and Lightweight Charts both hand
// annotations back as JSON structures. We persist them to localStorage
// keyed by chart_id (usually the symbol + timeframe) so drawings survive
// reloads even before backend #40 auth ships.
//
// Shape:
//   {
//     symbol: "MNQ1!",
//     timeframe: "5m",
//     drawings: [
//       { id, type: "line" | "rect" | "trendline" | "note",
//         points: [{ time, price }, ...],
//         style: {...},
//         note?: string,
//         created_at: ISO,
//       }
//     ],
//     saved_at: ISO,
//   }

const DRAW_KEY_PREFIX = "tradecore_chart_drawings_v1:";

function key(chartId) {
  return `${DRAW_KEY_PREFIX}${chartId}`;
}

// Retrieve drawings for a chart. Returns { drawings: [...], saved_at }.
export function loadDrawings(chartId) {
  if (!chartId) return { drawings: [], saved_at: null };
  try {
    const raw = localStorage.getItem(key(chartId));
    if (!raw) return { drawings: [], saved_at: null };
    return JSON.parse(raw);
  } catch { return { drawings: [], saved_at: null }; }
}

// Persist an updated drawing list for a chart.
export function saveDrawings(chartId, drawings) {
  if (!chartId) return;
  const payload = {
    drawings: Array.isArray(drawings) ? drawings : [],
    saved_at: new Date().toISOString(),
  };
  localStorage.setItem(key(chartId), JSON.stringify(payload));
  return payload;
}

// Append one drawing.
export function addDrawing(chartId, drawing) {
  const current = loadDrawings(chartId);
  const withIds = { id: drawing.id || `dw-${Date.now()}-${Math.floor(Math.random()*1000)}`,
                    created_at: drawing.created_at || new Date().toISOString(),
                    ...drawing };
  const next = [...current.drawings, withIds];
  return saveDrawings(chartId, next);
}

// Remove one drawing by id.
export function removeDrawing(chartId, id) {
  const current = loadDrawings(chartId);
  const next = current.drawings.filter(d => d.id !== id);
  return saveDrawings(chartId, next);
}

// Update one drawing by id (partial merge).
export function updateDrawing(chartId, id, patch) {
  const current = loadDrawings(chartId);
  const next = current.drawings.map(d => d.id === id ? { ...d, ...patch } : d);
  return saveDrawings(chartId, next);
}

// Clear all drawings for one chart.
export function clearDrawings(chartId) {
  if (!chartId) return;
  localStorage.removeItem(key(chartId));
}

// Enumerate every chartId we have drawings for.
export function listChartsWithDrawings() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(DRAW_KEY_PREFIX)) {
      const chartId = k.slice(DRAW_KEY_PREFIX.length);
      const data = loadDrawings(chartId);
      out.push({ chartId, count: data.drawings.length, saved_at: data.saved_at });
    }
  }
  return out.sort((a, b) => (b.saved_at || "").localeCompare(a.saved_at || ""));
}

// Convenience: standard chart id from a symbol + timeframe.
export function chartIdOf(symbol, timeframe) {
  return `${(symbol || "SYM").toUpperCase()}::${(timeframe || "").toLowerCase()}`;
}
