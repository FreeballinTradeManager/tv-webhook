// Task #74 — Broker CSV import.
//
// Parses a raw CSV file, auto-detects the source broker/journal by
// looking at the header row, and normalizes each row into TradeCore's
// Trade shape so it can be POSTed via Trade.create.
//
// Supported detection (fuzzy on header names — brokers rename fields
// between versions):
//   • Tradovate         → symbol / qty / buyPrice / sellPrice / pnl
//   • MetaTrader 4/5    → Ticket / Time / Type / Volume / Symbol / Profit
//   • Tradezella        → "Trade Date" / Side / Qty / Entry Price / Exit Price / PnL
//   • Interactive Brokers → Symbol / Quantity / T. Price / Realized P&L
//   • NinjaTrader       → Instrument / Qty / Market pos. / Profit
//   • Generic           → any CSV; user maps columns manually
//
// Output row shape (Trade.create-compatible):
//   {
//     symbol, direction, qty_total, entry_price, exit_price,
//     entry_time, exit_time, profit_loss, status: "closed",
//     source: "csv_import:{broker_key}",
//   }

// ─────────────────────────────────────────────────────────────
// Low-level CSV parsing — handles quoted fields with commas + escaped
// double quotes ("" inside "..."). Not a full RFC 4180 parser (skips
// multi-line quoted fields) but fine for broker exports.
// ─────────────────────────────────────────────────────────────
export function parseCsv(text) {
  const rows = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter(l => l.length);
  for (const line of lines) {
    const row = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { cur += c; }
      } else {
        if (c === ',') { row.push(cur); cur = ""; }
        else if (c === '"') { inQuotes = true; }
        else { cur += c; }
      }
    }
    row.push(cur);
    rows.push(row);
  }
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map(h => h.trim()), rows: rows.slice(1) };
}

// ─────────────────────────────────────────────────────────────
// Broker detectors — each one takes the header list (lowercased,
// trimmed) and returns a confidence score 0..1. Highest wins.
// ─────────────────────────────────────────────────────────────
const DETECTORS = [
  {
    key: "tradovate",
    name: "Tradovate",
    detect: (h) => {
      const wanted = ["symbol", "qty", "buyprice", "sellprice", "pnl"];
      return wanted.filter(w => h.some(x => x.replace(/[^a-z]/g, "").includes(w))).length / wanted.length;
    },
  },
  {
    key: "mt5",
    name: "MetaTrader 4/5",
    detect: (h) => {
      const wanted = ["ticket", "time", "type", "volume", "symbol", "profit"];
      return wanted.filter(w => h.some(x => x === w)).length / wanted.length;
    },
  },
  {
    key: "tradezella",
    name: "Tradezella",
    detect: (h) => {
      const wanted = ["trade date", "side", "qty", "entry price", "exit price", "pnl"];
      const norm = h.map(x => x.replace(/\s+/g, " "));
      return wanted.filter(w => norm.some(x => x === w)).length / wanted.length;
    },
  },
  {
    key: "ibkr",
    name: "Interactive Brokers",
    detect: (h) => {
      const wanted = ["symbol", "quantity", "t. price", "realized p/l", "realized p&l"];
      const norm = h.map(x => x.replace(/\s+/g, " "));
      return wanted.filter(w => norm.some(x => x === w)).length / wanted.length;
    },
  },
  {
    key: "ninjatrader",
    name: "NinjaTrader",
    detect: (h) => {
      const wanted = ["instrument", "qty", "market pos.", "profit"];
      const norm = h.map(x => x.replace(/\s+/g, " "));
      return wanted.filter(w => norm.some(x => x === w)).length / wanted.length;
    },
  },
];

export function detectBroker(headers) {
  const norm = headers.map(h => (h || "").toLowerCase().trim());
  const scored = DETECTORS.map(d => ({ ...d, score: d.detect(norm) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  // Need ≥0.5 confidence to auto-select; otherwise call it generic.
  if (best.score >= 0.5) return best;
  return { key: "generic", name: "Unknown / Generic CSV", score: 0 };
}

// ─────────────────────────────────────────────────────────────
// Column-mapping presets per broker.
// Each key on the LHS is a TradeCore Trade field; RHS is the header
// name variants we'll accept (case-insensitive, whitespace-collapsed).
// ─────────────────────────────────────────────────────────────
export const COLUMN_PRESETS = {
  tradovate: {
    symbol:       ["symbol", "contract"],
    direction:    ["b/s", "side", "buysell"],
    qty_total:    ["qty", "quantity", "filledqty"],
    entry_price:  ["buyprice", "entry price", "avgprice"],
    exit_price:   ["sellprice", "exit price"],
    entry_time:   ["bought timestamp", "entry time", "boughttimestamp", "opentime"],
    exit_time:    ["sold timestamp", "exit time", "soldtimestamp", "closetime"],
    profit_loss:  ["pnl", "p/l", "realized p&l", "profit"],
  },
  mt5: {
    symbol:       ["symbol"],
    direction:    ["type"],
    qty_total:    ["volume"],
    entry_price:  ["price"],
    exit_price:   ["price"],
    entry_time:   ["time"],
    exit_time:    ["time"],
    profit_loss:  ["profit", "p&l", "net profit"],
  },
  tradezella: {
    symbol:       ["symbol", "ticker"],
    direction:    ["side"],
    qty_total:    ["qty", "quantity", "size"],
    entry_price:  ["entry price", "avg entry"],
    exit_price:   ["exit price", "avg exit"],
    entry_time:   ["entry time", "trade date", "opened"],
    exit_time:    ["exit time", "closed"],
    profit_loss:  ["pnl", "p&l", "net p&l"],
  },
  ibkr: {
    symbol:       ["symbol"],
    direction:    ["buy/sell", "side"],
    qty_total:    ["quantity"],
    entry_price:  ["t. price"],
    exit_price:   ["c. price", "close price"],
    entry_time:   ["date/time", "date"],
    exit_time:    ["date/time"],
    profit_loss:  ["realized p/l", "realized p&l"],
  },
  ninjatrader: {
    symbol:       ["instrument"],
    direction:    ["market pos.", "action"],
    qty_total:    ["qty"],
    entry_price:  ["entry price"],
    exit_price:   ["exit price"],
    entry_time:   ["entry time"],
    exit_time:    ["exit time"],
    profit_loss:  ["profit"],
  },
  generic: {
    symbol: [], direction: [], qty_total: [], entry_price: [],
    exit_price: [], entry_time: [], exit_time: [], profit_loss: [],
  },
};

// Given a set of headers + a preset, resolve TradeCore field →
// header index (or -1 if not found). Callers can override the guess
// via the mapping UI before running the import.
export function autoMap(headers, preset) {
  const norm = headers.map(h => (h || "").toLowerCase().replace(/\s+/g, " ").trim());
  const mapping = {};
  for (const [field, candidates] of Object.entries(preset)) {
    let idx = -1;
    for (const cand of candidates) {
      idx = norm.indexOf(cand.toLowerCase());
      if (idx !== -1) break;
    }
    // Loose contains-match fallback
    if (idx === -1) {
      for (const cand of candidates) {
        idx = norm.findIndex(h => h.includes(cand.toLowerCase()));
        if (idx !== -1) break;
      }
    }
    mapping[field] = idx;
  }
  return mapping;
}

// ─────────────────────────────────────────────────────────────
// Row normalization — takes one raw CSV row + a mapping, returns
// a Trade.create-compatible object OR an error string.
// ─────────────────────────────────────────────────────────────
function normalizeDirection(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (["b", "buy", "long", "0", "bought", "buy_to_open"].includes(s)) return "long";
  if (["s", "sell", "short", "1", "sold", "sell_to_open"].includes(s)) return "short";
  if (s.includes("long"))  return "long";
  if (s.includes("short")) return "short";
  return s; // let backend validate the rest
}
function parseNumber(raw) {
  if (raw == null || raw === "") return null;
  // Strip $, commas, parens (for negatives), spaces.
  let s = String(raw).replace(/[$,\s]/g, "");
  const isNeg = /^\(.*\)$/.test(s);
  if (isNeg) s = "-" + s.slice(1, -1);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Try Date parser first — handles most ISO + US formats.
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString();
  // MM/DD/YYYY HH:MM:SS
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const [_, mm, dd, yy, hh, mi, ss] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss || 0)).toISOString();
  }
  return null;
}

export function normalizeRow(row, mapping, brokerKey) {
  const get = (field) => {
    const idx = mapping[field];
    if (idx == null || idx === -1) return null;
    return row[idx];
  };
  const symbol = String(get("symbol") || "").trim();
  if (!symbol) return { error: "missing symbol" };

  const direction = normalizeDirection(get("direction"));
  const qty       = parseNumber(get("qty_total"));
  const entryPx   = parseNumber(get("entry_price"));
  const exitPx    = parseNumber(get("exit_price"));
  const pnl       = parseNumber(get("profit_loss"));
  const entryT    = parseDate(get("entry_time"));
  const exitT     = parseDate(get("exit_time"));

  return {
    trade: {
      symbol,
      direction: direction || "long",
      qty_total: qty ?? 0,
      qty_open:  0,
      entry_price: entryPx,
      exit_price:  exitPx,
      entry_time:  entryT,
      exit_time:   exitT,
      profit_loss: pnl,
      status: "closed",
      source: `csv_import:${brokerKey}`,
    }
  };
}
