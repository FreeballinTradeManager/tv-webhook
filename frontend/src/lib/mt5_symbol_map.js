// mt5_symbol_map.js
// Translate futures symbols (what Pine fires) into MT5 CFD / Forex symbols
// (what an FTMO / Funded Next / MT5 broker account trades).
//
// Different brokers use slightly different symbol suffixes for the SAME
// underlying — .cash, .m, .r, .pro, etc. We store the CORE symbol here;
// each account can override the suffix in its MT5 mirror config so the
// dry-run picks the exact ticker its broker expects.
//
// Broker convention notes:
//   FTMO / Funded Next MT5 typically use bare tickers: NAS100, US500, XAUUSD
//   ICMarkets / Pepperstone often append .m or nothing at all
//   OANDA MT5 uses .pro / _M1 forms — user must set the suffix per account
//
// Two flavours of instrument covered:
//   INDICES  — NAS100, US500, US30, GER40, JP225, UK100 (indices as CFDs)
//   METALS   — XAUUSD (gold), XAGUSD (silver), XPTUSD (platinum)
//   ENERGY   — USOIL / UKOIL (WTI + Brent as CFDs)
//   FOREX    — the 28 majors + minors most MT5 brokers list
//   CRYPTO   — BTCUSD / ETHUSD (CFD versions; not spot)
//
// If a Pine symbol has no entry here we return null and the mirror layer
// logs a "no translation" dry-run entry rather than silently doing nothing.

// -----------------------------------------------------------------------------
// Instrument catalogue — core symbol + kind + typical point value on 1.00 lot.
// point_value_per_lot is measured in USD per 1.0 index-point / dollar move / pip
// (see notes per group). MT5's real fill will use the broker's exact contract
// spec; this table exists so the dry-run can show "would fire 0.4 lot on
// NAS100 ≈ $80 per 100pt move" without pinging the broker.
// -----------------------------------------------------------------------------

export const MT5_INSTRUMENTS = {
  // ---- Index CFDs ---------------------------------------------------------
  // point_value_per_lot = USD per full 1.0 index point on 1.00 lot
  //   NAS100: $1 / point / lot at most CFD brokers (FTMO confirmed)
  //   US500 : $50 / point / lot (mirrors ES futures $50 multiplier)
  //   US30  : $5  / point / lot
  //   GER40 : €25 / point / lot
  NAS100: { kind: "index", core: "NAS100", point_value_per_lot: 1,  min_lot: 0.01, lot_step: 0.01 },
  US500:  { kind: "index", core: "US500",  point_value_per_lot: 50, min_lot: 0.01, lot_step: 0.01 },
  US30:   { kind: "index", core: "US30",   point_value_per_lot: 5,  min_lot: 0.01, lot_step: 0.01 },
  GER40:  { kind: "index", core: "GER40",  point_value_per_lot: 25, min_lot: 0.01, lot_step: 0.01 },
  JP225:  { kind: "index", core: "JP225",  point_value_per_lot: 5,  min_lot: 0.01, lot_step: 0.01 },
  UK100:  { kind: "index", core: "UK100",  point_value_per_lot: 10, min_lot: 0.01, lot_step: 0.01 },

  // ---- Metals -------------------------------------------------------------
  // XAUUSD: $100 / $1 gold move / 1.00 lot (100 oz)
  // XAGUSD: $50 / $1 silver move / 1.00 lot (5000 oz)
  XAUUSD: { kind: "metal", core: "XAUUSD", point_value_per_lot: 100, min_lot: 0.01, lot_step: 0.01 },
  XAGUSD: { kind: "metal", core: "XAGUSD", point_value_per_lot: 50,  min_lot: 0.01, lot_step: 0.01 },
  XPTUSD: { kind: "metal", core: "XPTUSD", point_value_per_lot: 50,  min_lot: 0.01, lot_step: 0.01 },

  // ---- Energy -------------------------------------------------------------
  // USOIL / UKOIL: $10 / $1 move / 1.00 lot (1000 barrels)
  USOIL:  { kind: "energy", core: "USOIL", point_value_per_lot: 10, min_lot: 0.01, lot_step: 0.01 },
  UKOIL:  { kind: "energy", core: "UKOIL", point_value_per_lot: 10, min_lot: 0.01, lot_step: 0.01 },
  NGAS:   { kind: "energy", core: "NGAS",  point_value_per_lot: 10, min_lot: 0.01, lot_step: 0.01 },

  // ---- Forex majors -------------------------------------------------------
  // pip_value_per_lot = USD per pip on 1.00 lot (100k units)
  //   XXXUSD  → $10 per pip (EURUSD, GBPUSD, AUDUSD, NZDUSD)
  //   USDXXX  → ~$10 per pip (varies by quote — computed at fill time)
  //   JPY pairs → $9.10 per pip approx at USDJPY 110 (JPY pip = 0.01, not 0.0001)
  EURUSD: { kind: "forex", core: "EURUSD", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  GBPUSD: { kind: "forex", core: "GBPUSD", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  AUDUSD: { kind: "forex", core: "AUDUSD", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  NZDUSD: { kind: "forex", core: "NZDUSD", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  USDCAD: { kind: "forex", core: "USDCAD", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  USDCHF: { kind: "forex", core: "USDCHF", pip_value_per_lot: 10, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  USDJPY: { kind: "forex", core: "USDJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  EURJPY: { kind: "forex", core: "EURJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  GBPJPY: { kind: "forex", core: "GBPJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  EURGBP: { kind: "forex", core: "EURGBP", pip_value_per_lot: 12, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  AUDJPY: { kind: "forex", core: "AUDJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  CADJPY: { kind: "forex", core: "CADJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  CHFJPY: { kind: "forex", core: "CHFJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  NZDJPY: { kind: "forex", core: "NZDJPY", pip_value_per_lot: 9.1, pip_size: 0.01, min_lot: 0.01, lot_step: 0.01 },
  EURAUD: { kind: "forex", core: "EURAUD", pip_value_per_lot: 7,  pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  EURCHF: { kind: "forex", core: "EURCHF", pip_value_per_lot: 11, pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },
  GBPAUD: { kind: "forex", core: "GBPAUD", pip_value_per_lot: 7,  pip_size: 0.0001, min_lot: 0.01, lot_step: 0.01 },

  // ---- Crypto CFDs --------------------------------------------------------
  BTCUSD: { kind: "crypto", core: "BTCUSD", point_value_per_lot: 1, min_lot: 0.01, lot_step: 0.01 },
  ETHUSD: { kind: "crypto", core: "ETHUSD", point_value_per_lot: 1, min_lot: 0.01, lot_step: 0.01 },
};

// -----------------------------------------------------------------------------
// Pine → MT5 translation table. Multiple aliases per MT5 target.
// Everything Pine might send (NQ, NQ1!, MNQ, MNQ1!, MNQU2025, etc.) collapses
// to the same MT5 instrument.
// -----------------------------------------------------------------------------
const FUTURES_TO_MT5 = {
  // Nasdaq family → NAS100 CFD
  NQ:   "NAS100", MNQ:  "NAS100", "NQ1!": "NAS100", "MNQ1!": "NAS100",
  NDX:  "NAS100", NASDAQ: "NAS100",
  // S&P family → US500 CFD (ES multiplier matches CFD point value)
  ES:   "US500",  MES:  "US500",  "ES1!": "US500",  "MES1!": "US500",
  SPX:  "US500",  SP500: "US500",
  // Dow family → US30 CFD
  YM:   "US30",   MYM:  "US30",   "YM1!": "US30",   "MYM1!": "US30",
  DJI:  "US30",   DOW:  "US30",
  // Russell → not carried by many CFD brokers; skip mapping (returns null)
  // Gold → XAUUSD
  GC:   "XAUUSD", MGC:  "XAUUSD", "GC1!": "XAUUSD", "MGC1!": "XAUUSD",
  GOLD: "XAUUSD",
  // Silver → XAGUSD
  SI:   "XAGUSD", "SI1!": "XAGUSD", SILVER: "XAGUSD",
  // Crude oil → USOIL
  CL:   "USOIL",  MCL:  "USOIL",  "CL1!": "USOIL",  "MCL1!": "USOIL",
  WTI:  "USOIL",
  // Brent → UKOIL
  BRENT: "UKOIL", BZ: "UKOIL",
  // Nat gas → NGAS
  NG:   "NGAS",   MNG:  "NGAS",   "NG1!": "NGAS",
  // Bitcoin → BTCUSD CFD
  BTC:  "BTCUSD", MBT:  "BTCUSD", MBTC: "BTCUSD", "BTC1!": "BTCUSD",
  // Ether → ETHUSD CFD
  ETH:  "ETHUSD", MET:  "ETHUSD", "ETH1!": "ETHUSD",
  // German DAX
  FDAX: "GER40",  DAX: "GER40",
  // Nikkei
  NKD:  "JP225",
  // FTSE
  FTSE: "UK100",  Z: "UK100",
};

// Forex + CFD symbols that Pine can also fire natively (no futures leg)
// pass through with light normalization (strip .m / .cash / .pro suffixes).
const NATIVE_MT5 = new Set([
  ...Object.keys(MT5_INSTRUMENTS),
]);

// -----------------------------------------------------------------------------
// Strip common futures decorations to get a clean root symbol.
//   "MNQU2025"   → "MNQ"
//   "NQZ2024"    → "NQ"
//   "MNQ1!"      → "MNQ"
//   "MNQ2!"      → "MNQ"
//   "NAS100.cash"→ "NAS100"
//   "eurusd.pro" → "EURUSD"
// -----------------------------------------------------------------------------
export function stripSymbol(sym) {
  if (!sym) return "";
  let s = String(sym).trim().toUpperCase();
  // Chart continuous / expiry suffixes
  s = s.replace(/[12]!$/, "");                    // MNQ1! / MNQ2!
  s = s.replace(/[FGHJKMNQUVXZ]\d{2,4}$/, "");   // MNQU2025 / NQZ24
  // MT5 broker suffixes
  s = s.replace(/\.(CASH|PRO|M|R|A|B|MICRO|MINI|X)$/i, "");
  s = s.replace(/[._-]?(CASH|PRO)$/i, "");
  return s;
}

// -----------------------------------------------------------------------------
// Main translator. Returns { core, kind, spec, source, note } or null.
//   pineSymbol : whatever ticker Pine fired (MNQ1!, EURUSD.pro, XAUUSD, etc.)
//   suffix     : per-account broker suffix (e.g. ".cash", ".m", "") to append
// -----------------------------------------------------------------------------
export function resolveMt5Symbol(pineSymbol, suffix = "") {
  const root = stripSymbol(pineSymbol);
  if (!root) return null;

  // Futures → CFD mapping
  const mapped = FUTURES_TO_MT5[root];
  if (mapped && MT5_INSTRUMENTS[mapped]) {
    const spec = MT5_INSTRUMENTS[mapped];
    return {
      core:   spec.core,
      kind:   spec.kind,
      spec,
      source: "futures_mapped",
      target: spec.core + (suffix || ""),
      note:   `${root} → ${spec.core}${suffix ? " (broker suffix " + suffix + ")" : ""}`,
    };
  }

  // Native MT5 symbol Pine fired directly (unusual but supported)
  if (NATIVE_MT5.has(root) && MT5_INSTRUMENTS[root]) {
    const spec = MT5_INSTRUMENTS[root];
    return {
      core:   spec.core,
      kind:   spec.kind,
      spec,
      source: "native",
      target: spec.core + (suffix || ""),
      note:   `native MT5 symbol${suffix ? " (broker suffix " + suffix + ")" : ""}`,
    };
  }

  return null;
}

// Convenience: is this a symbol MT5 can trade?
export function hasMt5Support(pineSymbol) {
  return resolveMt5Symbol(pineSymbol) !== null;
}

// List every distinct MT5 target we can map to — for UI dropdowns.
export function listMt5Targets() {
  return Object.values(MT5_INSTRUMENTS).map(s => ({
    core: s.core,
    kind: s.kind,
    label: `${s.core} (${s.kind})`,
  }));
}
