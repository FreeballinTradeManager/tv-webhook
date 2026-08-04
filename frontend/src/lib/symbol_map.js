// Per-account symbol map — the trader can say "when a Pine alert names
// NQ, on this account trade MNQ instead" (e.g. an MFFU 25k account can
// only handle micros). Kept in localStorage keyed by account.id so an
// account without a mapping just uses the incoming symbol as-is.
//
// Shape: { [account_id]: { [pine_symbol]: broker_symbol } }
// Example: { "acc-1": { "NQ": "MNQ", "ES": "MES" } }

const KEY = "tradecore_symbol_map_v1";

export function loadMap()  { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } }
export function saveMap(m) { localStorage.setItem(KEY, JSON.stringify(m)); }

// The single lookup call the rest of the app uses.
// Returns broker symbol if a mapping exists, else pine_symbol unchanged.
export function resolveSymbol(account_id, pine_symbol) {
  if (!account_id || !pine_symbol) return pine_symbol;
  const all = loadMap();
  const acc = all[account_id];
  if (!acc) return pine_symbol;
  return acc[pine_symbol] || pine_symbol;
}

export function setMapping(account_id, pine_symbol, broker_symbol) {
  const all = loadMap();
  if (!all[account_id]) all[account_id] = {};
  if (!broker_symbol || pine_symbol === broker_symbol) {
    delete all[account_id][pine_symbol];
    if (Object.keys(all[account_id]).length === 0) delete all[account_id];
  } else {
    all[account_id][pine_symbol] = broker_symbol;
  }
  saveMap(all);
  return all;
}

export function accountMappings(account_id) {
  const all = loadMap();
  return all[account_id] || {};
}
