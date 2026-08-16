import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown } from "lucide-react";
import { bracketBreakdown, fmtPnl, getCommissionPerContract } from "@/lib/bracket_pnl";
import { ASSET_REGISTRY } from "@/lib/asset_registry";

// CompactTradeRow — Natalia's one-liner format:
//   Trade 1 | 18:05 | Mnq | 80 ticks | $160 | #4 | Win + 350
//
// Row is scannable in one glance:
//   · left border strip: green for win, red for loss, slate for scratch
//   · time · symbol · risk · qty · P&L (color-coded)
//   · three TP dots (● ○ ○ = TP1 hit, TP2/TP3 miss)
//
// Click ▸ to expand: per-TP action (BE / jump 85% / trail) + $ breakdown.
// Pine's standard bracket: TP1→BE, TP2→jump85%, TP3→jump85%, then runner trails.

export default function CompactTradeRow({ trade, index, account }) {
  const [open, setOpen] = useState(false);
  const long   = String(trade.direction || trade.side || "").toLowerCase();
  const isLong = long === "long" || long === "buy";
  const pnl    = Number(trade.profit_loss ?? trade.pnl ?? trade.realized_pnl ?? 0);
  const win    = pnl > 0, loss = pnl < 0;

  // "80 ticks" from entry-stop distance × tick-count
  const symRoot = stripSym(trade.symbol || trade.ticker || "");
  const spec    = ASSET_REGISTRY[symRoot];
  const stopTicks = spec && trade.entry_price != null && trade.stop_loss != null
    ? Math.round(Math.abs(trade.entry_price - trade.stop_loss) / spec.tick)
    : null;

  // "$160" risked = qty × stopTicks × tick-value ($) per contract
  const tickValue = spec ? spec.pv * spec.tick : null;
  const riskUsd   = tickValue && stopTicks && trade.quantity
    ? Math.round(stopTicks * tickValue * trade.quantity)
    : null;

  // Time HH:MM from entry_time
  const t = trade.entry_time || trade.created_date || trade.date;
  const time = t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

  // TP hit inference (same logic as bracket_pnl.js)
  const exit = trade.exit_price ?? trade.avg_fill_price;
  const tpHit = (px) => px != null && exit != null && (isLong ? exit >= px : exit <= px);
  const hits = {
    TP1: tpHit(trade.take_profit_1),
    TP2: tpHit(trade.take_profit_2),
    TP3: tpHit(trade.take_profit_3),
  };
  const stopped = exit != null && trade.stop_loss != null &&
                  (isLong ? exit <= trade.stop_loss * 1.0005 : exit >= trade.stop_loss * 0.9995);

  const outcome = stopped ? "STOP" :
                  hits.TP3 ? "TP3+RUNNER" :
                  hits.TP2 ? "TP2" :
                  hits.TP1 ? "TP1" :
                  win     ? "WIN"  :
                  loss    ? "LOSS" : "—";

  const rowBg = win  ? "bg-emerald-500/5 border-emerald-500/30 hover:bg-emerald-500/10" :
                loss ? "bg-red-500/5 border-red-500/30 hover:bg-red-500/10"           :
                       "bg-slate-900 border-slate-800 hover:bg-slate-800";

  const stripe = win ? "bg-emerald-500" : loss ? "bg-red-500" : "bg-slate-600";

  return (
    <div className={`border rounded flex flex-col ${rowBg} transition-colors overflow-hidden`}>
      {/* One-liner — click to expand */}
      <button onClick={() => setOpen(v => !v)}
              className="text-left w-full flex items-center gap-2 px-3 py-2 text-xs">
        <div className={`w-1 self-stretch ${stripe} rounded-sm shrink-0 -my-2`}/>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400"/> : <ChevronRight className="w-3.5 h-3.5 text-slate-500"/>}

        <span className="font-mono text-slate-400 shrink-0">Trade {index}</span>
        <span className="text-slate-500">|</span>
        <span className="font-mono text-slate-300 shrink-0">{time}</span>
        <span className="text-slate-500">|</span>
        <span className="font-mono text-white shrink-0">{fmtSymbol(symRoot)}</span>
        <span className="text-slate-500">|</span>
        <span className="font-mono text-slate-400">{stopTicks ? `${stopTicks}t` : "—"}</span>
        <span className="text-slate-500">|</span>
        <span className="font-mono text-slate-400">{riskUsd != null ? `$${riskUsd}` : "—"}</span>
        <span className="text-slate-500">|</span>
        <span className="font-mono text-slate-400">#{trade.quantity ?? "?"}</span>
        <span className="text-slate-500">|</span>
        <span className={`font-mono font-semibold ${win ? "text-emerald-400" : loss ? "text-red-400" : "text-slate-400"}`}>
          {win ? "Win" : loss ? "Loss" : "—"} {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(pnl >= 100 || pnl <= -100 ? 0 : 2)}
        </span>

        {/* TP dot indicators — ● hit / ○ miss */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <TpDot label="TP1" hit={hits.TP1} present={trade.take_profit_1 != null}/>
          <TpDot label="TP2" hit={hits.TP2} present={trade.take_profit_2 != null}/>
          <TpDot label="TP3" hit={hits.TP3} present={trade.take_profit_3 != null}/>
          <Badge className={`text-[9px] px-1.5 py-0 ml-1 ${outcomeBadge(outcome)}`}>{outcome}</Badge>
        </div>
      </button>

      {open && <CompactTradeDetail trade={trade} account={account} isLong={isLong}
                                    stopTicks={stopTicks} riskUsd={riskUsd} symRoot={symRoot}
                                    hits={hits} stopped={stopped}/>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function CompactTradeDetail({ trade, account, isLong, stopTicks, riskUsd, symRoot, hits, stopped }) {
  const commPerCt = getCommissionPerContract(
    account?.id ?? trade.account_id,
    account?.broker ?? trade.broker ?? "tradovate"
  );
  const bd  = bracketBreakdown(trade, commPerCt);
  const pnl = Number(trade.profit_loss ?? trade.pnl ?? bd.summary.net_pnl ?? 0);
  const targetR = riskUsd && pnl > 0 ? (pnl / riskUsd).toFixed(1) : null;
  const pctOfMax = pnl > 0 && bd.summary.gross_pnl > 0
    ? Math.round((pnl / bd.summary.gross_pnl) * 100) : null;

  // Pine's standard bracket engine: what fires at each TP
  // Match Natalia's format exactly: "= jump - Breakeven", "= jump - 85% stop updates"
  const ACTION_AT = {
    TP1: "jump — Breakeven",
    TP2: "jump — 85% stop updates",
    TP3: "jump — 85% stop updates",
  };

  return (
    <div className="border-t border-slate-800 bg-slate-950/60 px-3 py-2.5 space-y-2 text-xs">
      {/* Header — matches "Trade 1 Mnq 80 ticks $160 # 4 contracts" */}
      <div className="font-mono text-slate-300 pb-1 border-b border-slate-800">
        <span className="text-white font-semibold">{fmtSymbol(symRoot)}</span>
        {stopTicks && <span className="text-slate-400 ml-2">{stopTicks} ticks</span>}
        {riskUsd && <span className="text-slate-400 ml-2">${riskUsd}</span>}
        {trade.quantity && <span className="text-slate-400 ml-2"># {trade.quantity} contracts</span>}
      </div>

      {/* Per-line matches her exact template: Entry / TP1 / TP2 / TP3 / Runner */}
      <div className="grid gap-1 font-mono">
        <DetailLine label="Date"  value={trade.entry_time ? new Date(trade.entry_time).toLocaleDateString() : "—"}/>
        <DetailLine label="Entry" value={trade.entry_price != null ? trade.entry_price.toFixed(2) : "—"}
                    tint="text-blue-300"/>
        <DetailLine label="TP 1" value={trade.take_profit_1 != null ? trade.take_profit_1.toFixed(2) : "—"}
                    action={hits.TP1 ? ACTION_AT.TP1 : trade.take_profit_1 ? "miss" : null}
                    hit={hits.TP1} tint={hits.TP1 ? "text-emerald-300" : "text-slate-500"}/>
        <DetailLine label="TP 2" value={trade.take_profit_2 != null ? trade.take_profit_2.toFixed(2) : "—"}
                    action={hits.TP2 ? ACTION_AT.TP2 : trade.take_profit_2 ? "miss" : null}
                    hit={hits.TP2} tint={hits.TP2 ? "text-emerald-300" : "text-slate-500"}/>
        <DetailLine label="TP 3" value={trade.take_profit_3 != null ? trade.take_profit_3.toFixed(2) : "—"}
                    action={hits.TP3 ? ACTION_AT.TP3 : trade.take_profit_3 ? "miss" : null}
                    hit={hits.TP3} tint={hits.TP3 ? "text-emerald-300" : "text-slate-500"}/>
        <DetailLine label="Runner"
                    value={hits.TP3 ? "trailing" : hits.TP2 ? "closed at TP2" : hits.TP1 ? "closed at TP1" : stopped ? "stopped" : "—"}
                    tint="text-slate-300"/>
      </div>

      {/* Bottom summary — matches "Win: 100% $350" */}
      <div className={`pt-2 border-t border-slate-800 flex items-baseline justify-between font-mono ${
          pnl > 0 ? "text-emerald-300" : pnl < 0 ? "text-red-300" : "text-slate-400"}`}>
        <span className="font-semibold">
          {pnl > 0 ? "Win" : pnl < 0 ? "Loss" : "Scratch"}:
          {pctOfMax != null && <span className="text-slate-400 ml-2">{pctOfMax}% of max</span>}
          {targetR && <span className="text-slate-400 ml-2">{targetR}R</span>}
        </span>
        <span className="text-lg font-bold">{fmtPnl(pnl)}</span>
      </div>

      {/* Fee breakdown line (folded, small) */}
      {bd.legs.length > 0 && (
        <div className="text-[10px] text-slate-500 flex items-center gap-3 pt-1 border-t border-slate-800">
          <span>Gross {fmtPnl(bd.summary.gross_pnl)}</span>
          <span>·</span>
          <span>Fees {fmtPnl(bd.summary.commission)} ({bd.summary.qty_total}ct × ${commPerCt})</span>
          <span>·</span>
          <span className={bd.summary.net_pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
            Net {fmtPnl(bd.summary.net_pnl)}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TpDot({ label, hit, present }) {
  if (!present) return (
    <span className="w-1.5 h-1.5 rounded-full bg-slate-800 border border-slate-700" title={`${label} not set`}/>
  );
  return (
    <span className={`w-2 h-2 rounded-full ${hit ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]" : "bg-slate-700 border border-slate-600"}`}
          title={`${label} ${hit ? "HIT" : "miss"}`}/>
  );
}

function DetailLine({ label, value, action, hit, tint }) {
  return (
    <div className="flex items-baseline gap-2 pl-1">
      <span className="text-slate-500 w-14 shrink-0">{label}:</span>
      <span className={`${tint || "text-slate-300"} tabular-nums`}>{value}</span>
      {action && (
        <>
          <span className="text-slate-600 shrink-0">=</span>
          <span className={hit ? "text-emerald-300" : "text-slate-500"}>{action}</span>
        </>
      )}
    </div>
  );
}

function outcomeBadge(o) {
  switch (o) {
    case "TP3+RUNNER": return "bg-emerald-500/20 text-emerald-300 border-emerald-500/50";
    case "TP2":        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "TP1":        return "bg-blue-500/15 text-blue-300 border-blue-500/40";
    case "WIN":        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "STOP":       return "bg-red-500/20 text-red-300 border-red-500/50";
    case "LOSS":       return "bg-red-500/15 text-red-300 border-red-500/40";
    default:           return "bg-slate-700 text-slate-300 border-slate-600";
  }
}

// ---------------------------------------------------------------------------
function stripSym(s) {
  if (!s) return "";
  return String(s).toUpperCase().replace(/[12]!$/, "").replace(/[FGHJKMNQUVXZ]\d{2,4}$/, "");
}
function fmtSymbol(s) {
  // Natalia writes "Mnq" — title-case the root
  if (!s) return "?";
  return s.charAt(0) + s.slice(1).toLowerCase();
}
