import React from "react";
import { bracketBreakdown, fmtPnl, getCommissionPerContract } from "@/lib/bracket_pnl";

// BracketPnLBreakdown — expanded per-leg P&L strip for a trade.
// Mounts inline inside a table row (colSpan the full row) or a card body.
// Renders a compact grid of legs, each with role/price/qty/gross/fee/net.
//
// Uses per-account commission (from localStorage or broker default) — the
// account row must be passed in when known, otherwise falls back to broker
// default via trade.broker.

const roleColor = {
  TP1:  "text-emerald-300",  TP2: "text-emerald-300", TP3: "text-emerald-300",
  SL:   "text-red-300",
  EXIT: "text-slate-300",
};
const roleBg = {
  TP1:  "bg-emerald-500/10 border-emerald-500/30",
  TP2:  "bg-emerald-500/10 border-emerald-500/30",
  TP3:  "bg-emerald-500/10 border-emerald-500/30",
  SL:   "bg-red-500/10 border-red-500/30",
  EXIT: "bg-slate-800 border-slate-700",
};

export default function BracketPnLBreakdown({ trade, account }) {
  const commPerCt = getCommissionPerContract(
    account?.id ?? trade.account_id,
    account?.broker ?? trade.broker ?? "tradovate"
  );
  const bd = bracketBreakdown(trade, commPerCt);

  if (!bd.legs.length) {
    return (
      <div className="text-[11px] text-slate-500 italic py-2 px-3">
        No leg breakdown — entry/qty/exit price missing.
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-950/50 border-t border-slate-800 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        Bracket breakdown · inferred from exit price · commission ${commPerCt}/ct
      </div>

      {/* Per-leg grid */}
      <div className="grid gap-1">
        {bd.legs.map((leg, i) => (
          <div key={i}
               className={`grid grid-cols-6 gap-2 items-center text-[11px] px-2 py-1.5 rounded border ${roleBg[leg.role]}`}>
            <span className={`font-mono font-semibold ${roleColor[leg.role]}`}>{leg.role}</span>
            <span className="font-mono text-slate-300 tabular-nums">
              @ {leg.price?.toFixed(2)}
            </span>
            <span className="font-mono text-slate-400">
              {leg.qty}ct
            </span>
            <span className={`font-mono tabular-nums text-right ${leg.gross_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {fmtPnl(leg.gross_pnl)}
            </span>
            <span className="font-mono tabular-nums text-right text-slate-500">
              {fmtPnl(leg.commission)}
            </span>
            <span className={`font-mono font-semibold tabular-nums text-right ${leg.net_pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
              {fmtPnl(leg.net_pnl)} net
            </span>
          </div>
        ))}
      </div>

      {/* Totals footer */}
      <div className="grid grid-cols-6 gap-2 items-center text-[11px] px-2 py-1.5 border-t border-slate-800 pt-2">
        <span className="font-mono font-semibold text-white uppercase tracking-wider col-span-3">
          Total · {bd.summary.qty_total}ct {bd.summary.side}
        </span>
        <span className={`font-mono tabular-nums text-right ${bd.summary.gross_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {fmtPnl(bd.summary.gross_pnl)}
        </span>
        <span className="font-mono tabular-nums text-right text-slate-500">
          {fmtPnl(bd.summary.commission)}
        </span>
        <span className={`font-mono font-bold tabular-nums text-right text-base ${bd.summary.net_pnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
          {fmtPnl(bd.summary.net_pnl)}
        </span>
      </div>
    </div>
  );
}
