// bracket_pnl.js
// Per-leg P&L breakdown for bracketed trades. Not every fill lands in the
// TradeCore log (Pine's 3-leg TP ladder means multiple fills per trade),
// so we INFER per-leg P&L from entry + stop + TP prices + exit_price + qty.
//
// Model (matches Pine's standard 3-runner bracket):
//   · If TP1 was hit → close 1 contract at TP1
//   · If TP2 was hit → close 1 contract at TP2
//   · If TP3 was hit → close 1 contract at TP3
//   · Any remaining qty exits at exit_price (or stop if stopped out)
//   · Commission per contract × leg_qty deducted per leg
//
// Every leg gets a { role, price, qty, gross_pnl, commission, net_pnl, hit }.
// Trader sees "TP1 · 1ct · gross +$25 · fee -$1 · net +$24" per leg.

import { ASSET_REGISTRY } from "./asset_registry";

// -----------------------------------------------------------------------------
// Per-account commission storage. Trader sets it once per broker in
// account.commission_per_contract; we cache in localStorage until backend
// #40 auth pushes it to Account.commission_per_contract.
const COMM_KEY = "tradecore_commission_per_ct_v1";

// Sensible defaults per broker (round-turn per contract, USD)
export const DEFAULT_COMMISSIONS = {
  tradovate:   1.50,   // Apex/Lucid/Tradeify/MFFU typical
  ninjatrader: 1.65,
  ibkr:        0.85,   // per-side, so ×2 for round-turn — user overrides
  rithmic:     1.20,
  simulated:   0,
  observed:    1.50,
  mt5:         3.00,   // FTMO/FN MT5 CFD commissions vary a lot
};

function loadCommMap() {
  try { return JSON.parse(localStorage.getItem(COMM_KEY) || "{}"); }
  catch { return {}; }
}
function saveCommMap(o) {
  try { localStorage.setItem(COMM_KEY, JSON.stringify(o || {})); } catch {}
}

export function getCommissionPerContract(accountId, brokerKind) {
  const map = loadCommMap();
  const override = map[String(accountId)];
  if (override != null) return Number(override);
  return DEFAULT_COMMISSIONS[String(brokerKind || "").toLowerCase()] ?? 1.50;
}

export function setCommissionPerContract(accountId, val) {
  const map = loadCommMap();
  map[String(accountId)] = Number(val) || 0;
  saveCommMap(map);
}

// -----------------------------------------------------------------------------
// Look up point-value from ASSET_REGISTRY. Falls back to reasonable defaults.
function pointValueFor(sym) {
  if (!sym) return 1;
  // Strip common suffixes: MNQ1! → MNQ, MNQU2025 → MNQ, NAS100.cash → NAS100
  let s = String(sym).toUpperCase();
  s = s.replace(/[12]!$/, "");
  s = s.replace(/[FGHJKMNQUVXZ]\d{2,4}$/, "");
  s = s.replace(/\.(CASH|PRO|M|R)$/i, "");
  return ASSET_REGISTRY[s]?.pv ?? 1;
}

// Normalize side
function isLong(trade) {
  const d = String(trade.direction || trade.side || "").toLowerCase();
  return d === "long" || d === "buy";
}

// Return the exit price from whichever field is populated
function exitOf(t) {
  const v = t.exit_price ?? t.avg_fill_price ?? t.close_price;
  return v == null || v === "" ? null : Number(v);
}

// Did this TP get hit given the trade's exit price?
function tpHit(tpPrice, exitPx, long) {
  if (!tpPrice || exitPx == null) return false;
  return long ? exitPx >= tpPrice : exitPx <= tpPrice;
}

// Did the trade stop out?
function stopHit(t, exitPx, long) {
  const sl = t.stop_loss ?? t.stop_price;
  if (!sl || exitPx == null) return false;
  return long ? exitPx <= sl * 1.0005 : exitPx >= sl * 0.9995;
}

// -----------------------------------------------------------------------------
// Main: compute per-leg breakdown for a trade.
//
//   trade      — Base44 trade shape
//   commPerCt  — commission per contract (from getCommissionPerContract)
//   ladder     — optional custom per-leg qty split, defaults to [1, 1, 1]
//                (matches Pine's default 3-runner bracket)
//
// Returns:
//   {
//     legs: [{ role, price, qty, gross_pnl, commission, net_pnl, hit }],
//     summary: { gross_pnl, commission, net_pnl, qty_total, exit_price, side },
//     model:   "inferred" | "known"
//   }
export function bracketBreakdown(trade, commPerCt = 1.5, ladder = null) {
  const long   = isLong(trade);
  const entry  = Number(trade.entry_price ?? trade.entry ?? 0);
  const qtyTotal = Number(trade.quantity ?? trade.qty ?? 0);
  const exitPx = exitOf(trade);
  const pv     = pointValueFor(trade.symbol || trade.ticker);
  const sym    = trade.symbol || trade.ticker || "";

  // Per-leg qty split — defaults to 1/1/rest for a 3-lot trade
  const [q1_want, q2_want, q3_want] = ladder ||
    (qtyTotal >= 3 ? [1, 1, qtyTotal - 2] :
     qtyTotal === 2 ? [1, 0, 1] :
     [0, 0, qtyTotal]);

  const legs = [];
  let qtyRemaining = qtyTotal;

  const hitTP1 = tpHit(trade.take_profit_1, exitPx, long);
  const hitTP2 = tpHit(trade.take_profit_2, exitPx, long);
  const hitTP3 = tpHit(trade.take_profit_3, exitPx, long);
  const wasStopped = stopHit(trade, exitPx, long);

  // Helper — add a leg with computed gross + commission
  const addLeg = (role, price, qty, hit) => {
    if (qty <= 0 || price == null || entry === 0) return;
    const perContract = long ? (price - entry) : (entry - price);
    const gross = perContract * pv * qty;
    const comm  = Math.abs(commPerCt) * qty;
    legs.push({
      role, price, qty, hit,
      gross_pnl:  gross,
      commission: -comm,
      net_pnl:    gross - comm,
    });
    qtyRemaining -= qty;
  };

  // ── TP1
  if (hitTP1 && q1_want > 0 && qtyRemaining > 0) {
    addLeg("TP1", trade.take_profit_1, Math.min(q1_want, qtyRemaining), true);
  }
  // ── TP2
  if (hitTP2 && q2_want > 0 && qtyRemaining > 0) {
    addLeg("TP2", trade.take_profit_2, Math.min(q2_want, qtyRemaining), true);
  }
  // ── TP3 (runner)
  if (hitTP3 && q3_want > 0 && qtyRemaining > 0) {
    addLeg("TP3", trade.take_profit_3, Math.min(q3_want, qtyRemaining), true);
  }

  // ── Remaining exit — stop-out or manual close
  if (qtyRemaining > 0 && exitPx != null) {
    const remRole = wasStopped ? "SL" : "EXIT";
    addLeg(remRole, exitPx, qtyRemaining, true);
  }

  // Summary
  const gross_pnl  = legs.reduce((a, l) => a + l.gross_pnl,  0);
  const commission = legs.reduce((a, l) => a + l.commission, 0);
  const net_pnl    = gross_pnl + commission;

  return {
    legs,
    summary: {
      gross_pnl, commission, net_pnl,
      qty_total: qtyTotal, exit_price: exitPx,
      side: long ? "LONG" : "SHORT",
      symbol: sym, point_value: pv,
    },
    model: "inferred",
    tp_hit_flags: { TP1: hitTP1, TP2: hitTP2, TP3: hitTP3, stopped: wasStopped },
  };
}

// Utility: format $ with sign, no cents on big numbers
export function fmtPnl(n) {
  if (n == null || !isFinite(n)) return "$0";
  const s = n < 0 ? "-" : n > 0 ? "+" : "";
  const v = Math.abs(n);
  return `${s}$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}
