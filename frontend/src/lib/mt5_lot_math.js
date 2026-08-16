// mt5_lot_math.js
// Convert a futures-order shape (contracts + tick stop) into MT5 lot sizing
// (lots + points-of-stop) for the mirror dry-run.
//
// The trader's Pine indicator thinks in FUTURES units:
//   qty     = 3 contracts of MNQ
//   stop    = 40 ticks (each MNQ tick = 0.25 pt × $0.50 = $0.50 per tick)
//   risk    = 3 × 40 × $0.50 = $60
//
// The FTMO / MT5 account thinks in LOTS + POINTS:
//   NAS100 CFD, $1 per point per 1.0 lot, min lot 0.01
//   $60 risk / $1 per point / 100 points of stop = 0.60 lot
//
// This module does both directions and gives a full dry-run breakdown so the
// trader can eyeball whether the size is what they'd size manually.

import { MT5_INSTRUMENTS, resolveMt5Symbol } from "./mt5_symbol_map";

// Futures-side reference: dollar risk per 1 contract per 1 tick, per symbol.
// Used to compute the risk the Pine trade is taking. If the Pine ticker is
// not in this list we fall back to price-diff × qty × 1 (approximate).
export const FUTURES_TICK_VALUE = {
  MNQ:  0.50,   NQ:   5.00,
  MES:  1.25,   ES:  12.50,
  MYM:  0.50,   YM:   5.00,
  MGC:  1.00,   GC:  10.00,
  MCL:  0.10,   CL:  10.00,
  MNG:  0.25,   NG:  10.00,
  MBT: 10.00,   BTC: 25.00,
  MET:  1.00,   ETH:  5.00,
};

export const FUTURES_TICK_SIZE = {
  MNQ:  0.25,   NQ:   0.25,
  MES:  0.25,   ES:   0.25,
  MYM:  1.00,   YM:   1.00,
  MGC:  0.10,   GC:   0.10,
  MCL:  0.01,   CL:   0.01,
  MNG:  0.001,  NG:   0.001,
  MBT:  5.00,   BTC:  5.00,
  MET:  0.50,   ETH:  0.05,
};

// Compute the $ risk that a Pine-side trade is putting on the line.
//   qty         : integer contracts
//   stopTicks   : integer ticks of stop distance
//   futuresRoot : "MNQ", "ES", etc. (stripped)
export function futuresRisk(qty, stopTicks, futuresRoot) {
  const tv = FUTURES_TICK_VALUE[futuresRoot];
  if (!tv || !qty || !stopTicks) return null;
  return qty * stopTicks * tv;
}

// Compute the point-distance of a stop given entry + stop prices.
export function stopDistancePoints(entryPx, stopPx, kind = "index") {
  if (entryPx == null || stopPx == null) return null;
  const raw = Math.abs(Number(entryPx) - Number(stopPx));
  if (!isFinite(raw)) return null;
  // For forex, the "point" size differs (JPY 0.01, others 0.0001). Caller
  // converts to pips separately — this function returns raw price diff.
  return raw;
}

// -----------------------------------------------------------------------------
// PRICE CONVERSION (task #217 — Duplikium/Duplikan-style)
// -----------------------------------------------------------------------------
// Futures and CFDs of the same underlying trade at different prices:
//   · MNQ  ≈ NAS100 CFD + (basis/dividends/funding) — typically ±10-40pt
//   · ES   ≈ US500  CFD + basis
//   · GC   ≈ XAUUSD (usually near-identical, small)
//   · CL   ≈ USOIL  (front month can differ by $0.10-$0.50)
//
// If Pine fires "buy MNQ 24500 stop 24480" and TradeCore mirrors literally
// to NAS100 CFD (which is currently 24485), the stop gets crossed instantly.
// We solve this with three modes, chosen per-account via cfg.priceConversionMode:
//
//   "market" (default)     → fire market order on CFD side. Compute stop as
//                            RELATIVE points/pips from Pine's entry-stop diff.
//                            Broker's fill IS the reference. This is what
//                            Duplikium defaults to; safest across all pairs.
//
//   "fixed_offset"         → convertedEntry = pineEntry + cfg.offset.
//                            Same offset applied to stop + TPs. User configures
//                            per-symbol offset in cfg.symbolOffsets (map keyed
//                            by CFD core symbol). Predictable but manual.
//
//   "live_reanchor"        → PHASE 2B ONLY. Fetch bid/ask from MetaAPI, treat
//                            the fresh CFD price as the "true entry", shift
//                            stop + TPs by the same amount as (fresh - pine).
//                            Preserves original R:R. Requires live data feed;
//                            marked as "pending" in Phase 1 dry-run.
//
// The dry-run log surfaces BOTH the futures price AND the converted CFD price
// so the trader can eyeball the delta before we ever ARM real sends.
// -----------------------------------------------------------------------------

// Rough live-mid-of-mid deltas observed against front-month futures. These
// are DEFAULTS shown as hints — real usage requires the trader to config
// their own offset per pair (or use "market" mode which sidesteps this).
export const DEFAULT_CFD_OFFSETS = {
  NAS100:  -15,     // MNQ tends ~15pt above NAS100 CFD in active session
  US500:   -3,      // ES vs US500 CFD basis
  US30:    -20,     // YM vs US30
  XAUUSD:  0,       // GC vs XAUUSD near-identical
  USOIL:   0.20,    // CL vs USOIL
  BTCUSD:  -50,     // MBT vs BTC CFD
  NGAS:    0.02,
};

function convertPrices(pineSignal, spec, targetCore, cfg) {
  const mode = cfg.priceConversionMode || "market";
  const pe = pineSignal?.entry, ps = pineSignal?.stop;
  const pt1 = pineSignal?.tp1, pt2 = pineSignal?.tp2, pt3 = pineSignal?.tp3;

  if (mode === "market") {
    // Market order — no explicit entry price. Stop/TPs expressed as points/pips
    // from the (not-yet-known) fill price. We RETAIN Pine's distance, not price.
    const distStop = (pe != null && ps != null) ? Math.abs(pe - ps) : null;
    const distTP1  = (pe != null && pt1 != null) ? Math.abs(pe - pt1) : null;
    const distTP2  = (pe != null && pt2 != null) ? Math.abs(pe - pt2) : null;
    const distTP3  = (pe != null && pt3 != null) ? Math.abs(pe - pt3) : null;
    return {
      mode: "market",
      entry_ref: null, stop_ref: null, tp1_ref: null, tp2_ref: null, tp3_ref: null,
      // Distances the adapter will apply post-fill:
      stop_distance: distStop, tp1_distance: distTP1, tp2_distance: distTP2, tp3_distance: distTP3,
      note: "Market order — stop/TPs applied as ± points from actual CFD fill price.",
    };
  }

  if (mode === "fixed_offset") {
    const offsets = { ...DEFAULT_CFD_OFFSETS, ...(cfg.symbolOffsets || {}) };
    const off = Number(offsets[targetCore] ?? 0);
    return {
      mode:      "fixed_offset",
      offset:    off,
      entry_ref: pe != null ? +(pe + off).toFixed(spec.kind === "forex" ? 5 : 2) : null,
      stop_ref:  ps != null ? +(ps + off).toFixed(spec.kind === "forex" ? 5 : 2) : null,
      tp1_ref:   pt1 != null ? +(pt1 + off).toFixed(spec.kind === "forex" ? 5 : 2) : null,
      tp2_ref:   pt2 != null ? +(pt2 + off).toFixed(spec.kind === "forex" ? 5 : 2) : null,
      tp3_ref:   pt3 != null ? +(pt3 + off).toFixed(spec.kind === "forex" ? 5 : 2) : null,
      note:      `Fixed offset ${off >= 0 ? "+" : ""}${off} applied to all prices.`,
    };
  }

  if (mode === "live_reanchor") {
    // Phase 2B. Would fetch bid/ask from MetaAPI, shift Pine's prices by
    // (freshMid - pineEntry). Kept as a stub so cfg round-trips cleanly.
    return {
      mode:      "live_reanchor",
      entry_ref: null, stop_ref: null, tp1_ref: null, tp2_ref: null, tp3_ref: null,
      pending:   true,
      note:      "Live reanchor — Phase 2B unlock. Falling back to Pine prices unchanged in dry-run.",
    };
  }

  return { mode: "market", note: "unknown mode → fallback to market" };
}

// -----------------------------------------------------------------------------
// Main sizing routine. Given a Pine signal + a target MT5 instrument,
// compute the lot size the mirror WOULD fire.
//
//   pineSignal = { ticker, qty, entry, stop, side, tp1, tp2, tp3 }
//   sizingMode = one of:
//     "match_risk"  → match the $ risk the Pine trade is taking (most common)
//     "fixed_lot"   → always use fixedLot regardless of Pine size
//     "match_qty"   → fire fixedLot × qty (rough proportional)
//   cfg = { sizingMode, fixedLot, riskCapUsd, suffix, symbolOverride,
//           priceConversionMode, symbolOffsets }
// -----------------------------------------------------------------------------
export function computeMt5Order(pineSignal, cfg) {
  cfg = cfg || {};
  const sig = pineSignal || {};

  // Resolve target symbol (either the mapped one or a per-account override)
  const resolved = cfg.symbolOverride
    ? { core: cfg.symbolOverride, kind: MT5_INSTRUMENTS[cfg.symbolOverride]?.kind || "index",
        spec: MT5_INSTRUMENTS[cfg.symbolOverride],
        target: cfg.symbolOverride + (cfg.suffix || ""), source: "override",
        note: "manual override" }
    : resolveMt5Symbol(sig.ticker, cfg.suffix || "");

  if (!resolved || !resolved.spec) {
    return {
      ok: false,
      reason: "no_symbol_map",
      pine_ticker: sig.ticker,
      note: `No MT5 mapping for ${sig.ticker || "(missing symbol)"}. Skip.`,
    };
  }

  const spec = resolved.spec;
  const futuresRoot = stripFuturesRoot(sig.ticker);
  const pineRisk = futuresRisk(sig.qty, guessStopTicks(sig, futuresRoot), futuresRoot);

  // Stop distance in target's native units (points for indices, pips for forex)
  const pxDiff = stopDistancePoints(sig.entry, sig.stop, spec.kind);

  let stopPoints  = null;   // for indices/metals/energy/crypto
  let stopPips    = null;   // for forex

  if (pxDiff != null) {
    if (spec.kind === "forex" && spec.pip_size) {
      stopPips = pxDiff / spec.pip_size;
    } else {
      stopPoints = pxDiff;
    }
  }

  // ---- Sizing -------------------------------------------------------------
  const mode = cfg.sizingMode || "match_risk";
  let lots = null;
  let sizingNote = "";

  const roundLot = (raw) => {
    const step = spec.lot_step || 0.01;
    const min  = spec.min_lot || 0.01;
    const snapped = Math.max(min, Math.round(raw / step) * step);
    return Math.round(snapped * 100) / 100;   // clean 2-dp display
  };

  if (mode === "fixed_lot") {
    lots = roundLot(Number(cfg.fixedLot) || 0.01);
    sizingNote = `fixed ${lots} lot`;
  } else if (mode === "match_qty") {
    const perContract = Number(cfg.fixedLot) || 0.10;
    lots = roundLot(perContract * (sig.qty || 1));
    sizingNote = `${perContract} lot × ${sig.qty || 1} contracts`;
  } else {
    // match_risk (default) — solve lot for the same $ risk as Pine
    if (!pineRisk) {
      // No Pine risk to match — fall back to fixed
      lots = roundLot(Number(cfg.fixedLot) || 0.10);
      sizingNote = `no pine risk to match, using fallback ${lots}`;
    } else if (spec.kind === "forex" && stopPips && spec.pip_value_per_lot) {
      lots = roundLot(pineRisk / (stopPips * spec.pip_value_per_lot));
      sizingNote = `match risk $${pineRisk.toFixed(0)} @ ${stopPips.toFixed(1)} pip stop`;
    } else if (stopPoints && spec.point_value_per_lot) {
      lots = roundLot(pineRisk / (stopPoints * spec.point_value_per_lot));
      sizingNote = `match risk $${pineRisk.toFixed(0)} @ ${stopPoints.toFixed(1)}pt stop`;
    } else {
      lots = roundLot(Number(cfg.fixedLot) || 0.10);
      sizingNote = "no stop distance, using fallback";
    }
  }

  // ---- Cap ----------------------------------------------------------------
  const cap = Number(cfg.riskCapUsd);
  let cappedRisk = null;
  let cappedLots = lots;
  if (cap > 0 && lots) {
    if (spec.kind === "forex" && stopPips && spec.pip_value_per_lot) {
      const capLot = cap / (stopPips * spec.pip_value_per_lot);
      cappedLots = Math.min(lots, roundLot(capLot));
    } else if (stopPoints && spec.point_value_per_lot) {
      const capLot = cap / (stopPoints * spec.point_value_per_lot);
      cappedLots = Math.min(lots, roundLot(capLot));
    }
  }
  if (cappedLots !== lots) {
    lots = cappedLots;
    sizingNote += `  →  CAPPED @ $${cap}`;
  }

  // ---- Estimated risk at chosen lot --------------------------------------
  let estimatedRisk = null;
  if (spec.kind === "forex" && stopPips && spec.pip_value_per_lot) {
    estimatedRisk = lots * stopPips * spec.pip_value_per_lot;
  } else if (stopPoints && spec.point_value_per_lot) {
    estimatedRisk = lots * stopPoints * spec.point_value_per_lot;
  }

  // ---- Price conversion (task #217) -------------------------------------
  const converted = convertPrices(sig, spec, resolved.core, cfg);

  return {
    ok:            true,
    pine_ticker:   sig.ticker,
    pine_qty:      sig.qty,
    pine_risk_usd: pineRisk,

    target:        resolved.target,
    core:          resolved.core,
    kind:          spec.kind,
    map_source:    resolved.source,
    map_note:      resolved.note,

    side:          (sig.side || "").toUpperCase(),   // BUY / SELL

    // Original Pine prices (futures) — kept for reference / audit
    entry:         sig.entry,
    stop:          sig.stop,
    tp1:           sig.tp1,
    tp2:           sig.tp2,
    tp3:           sig.tp3,

    // Converted CFD prices — what the mirror would actually send
    converted,

    stop_points:   stopPoints,
    stop_pips:     stopPips,

    lots,
    sizing_mode:   mode,
    sizing_note:   sizingNote,
    estimated_risk_usd: estimatedRisk,
  };
}

// helper - kept internal
function stripFuturesRoot(sym) {
  if (!sym) return "";
  let s = String(sym).trim().toUpperCase();
  s = s.replace(/[12]!$/, "");
  s = s.replace(/[FGHJKMNQUVXZ]\d{2,4}$/, "");
  return s;
}

// Try to derive stop distance in TICKS from the Pine signal (payload may have
// stop_ticks explicit, otherwise diff entry-stop and divide by tick size).
function guessStopTicks(sig, futuresRoot) {
  if (sig.stop_ticks) return Number(sig.stop_ticks);
  const ts = FUTURES_TICK_SIZE[futuresRoot];
  if (!ts || sig.entry == null || sig.stop == null) return null;
  return Math.round(Math.abs(Number(sig.entry) - Number(sig.stop)) / ts);
}
