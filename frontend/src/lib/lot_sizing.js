// Task #58 · #141 — Auto lot-size + margin preview.
// One place that answers: given an account balance, a % risk, a stop
// distance, and an asset — how many contracts should I buy AND how
// much margin does that tie up?
//
// The Pine indicator does size math already via `riskUsd + stopTicks`
// but many prop-firm challenges want a % of balance instead of a flat
// $. This lib returns both flavours so the UI can toggle between them.

import { assetSpec, ticksToUsd } from "@/lib/asset_registry";

// Compute the max-safe contract count for a trade.
// mode "fixed_usd"    → risk $X per trade
// mode "pct_balance"  → risk %X of current balance
// mode "pct_dd"       → risk %X of DAILY loss limit (kinder on prop accts)
//
// Returns { qty, riskUsd, riskPerContract, marginRequired, marginPct }.
export function autoLotSize({
  symbol,
  balance,
  daily_loss_limit,
  stop_ticks,
  mode = "fixed_usd",
  fixed_usd = 100,
  pct = 1,
  session = "day",     // "day" | "overnight"
  qty_cap = null,       // hard ceiling regardless of math (safety)
}) {
  const spec = assetSpec(symbol);
  if (!spec) return null;
  if (!stop_ticks || stop_ticks < 1) return null;

  const perContract = ticksToUsd(symbol, stop_ticks, 1);
  if (perContract <= 0) return null;

  let riskUsd = 0;
  if (mode === "fixed_usd") {
    riskUsd = Math.max(0, +fixed_usd || 0);
  } else if (mode === "pct_balance") {
    riskUsd = Math.max(0, (+balance || 0) * (+pct || 0) / 100);
  } else if (mode === "pct_dd") {
    riskUsd = Math.max(0, (+daily_loss_limit || 0) * (+pct || 0) / 100);
  }

  let qty = Math.floor(riskUsd / perContract);
  if (qty < 0) qty = 0;
  if (qty_cap != null) qty = Math.min(qty, qty_cap);

  const marginEach = session === "overnight" ? spec.overnight_margin : spec.day_margin;
  const marginRequired = qty * marginEach;
  const marginPct = balance > 0 ? (marginRequired / balance) * 100 : null;

  return {
    qty,
    riskUsd: qty * perContract,       // actual risk given rounded qty
    riskPerContract: perContract,
    marginRequired,
    marginPct,
    marginEach,
    spec,
  };
}

// A ready-to-render "would you like some warnings?" tip list for a
// given plan. Feeds a small chip strip under the size result.
export function sizingWarnings({ qty, marginPct, riskUsd, balance, daily_loss_limit }) {
  const w = [];
  if (qty === 0) w.push({ level: "warn", msg: "Stop is too wide for your risk budget — 0 contracts computed." });
  if (marginPct != null && marginPct > 50) w.push({ level: "warn", msg: `Margin would tie up ${marginPct.toFixed(0)}% of the account.` });
  if (marginPct != null && marginPct > 90) w.push({ level: "danger", msg: `Margin exceeds 90% of balance — position would leave no headroom.` });
  if (balance > 0 && riskUsd > 0 && (riskUsd / balance) * 100 > 2) w.push({ level: "warn", msg: `Risking ${((riskUsd/balance)*100).toFixed(1)}% of balance in a single trade.` });
  if (daily_loss_limit > 0 && riskUsd > daily_loss_limit * 0.5) w.push({ level: "danger", msg: `Single trade risks over 50% of daily loss limit.` });
  return w;
}
