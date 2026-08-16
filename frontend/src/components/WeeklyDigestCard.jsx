import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarDays, TrendingUp, TrendingDown, Flame, Snowflake, Zap,
  ArrowRight, ArrowLeft,
} from "lucide-react";
import { digest } from "@/lib/trade_digest";

// WeeklyDigestCard — rolling last-N-days performance snapshot.
// Mounts on Dashboard. Silent when there are zero closed trades in the window.
//
// Window selector: 7d (default) / 30d / MTD via three toggle buttons.
// Every number is derived from the trades prop — no server call.

const WINDOWS = [
  { key: 7,   label: "7d"  },
  { key: 30,  label: "30d" },
  { key: 90,  label: "90d" },
];

export default function WeeklyDigestCard({ trades }) {
  const [days, setDays] = useState(7);
  const d = useMemo(() => digest(trades || [], days), [trades, days]);

  if (d.empty) return null;   // don't show a dead card

  const pnlColor = d.total_pnl > 0 ? "text-emerald-400"
                 : d.total_pnl < 0 ? "text-red-400"
                 : "text-slate-400";

  const prev = d.previous_period;
  const pnlDelta = prev ? d.total_pnl - prev.total_pnl : null;
  const wrDelta  = prev ? d.win_rate - prev.win_rate  : null;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-400"/>
            Digest — last {days}d
          </span>
          <div className="flex items-center gap-1">
            {WINDOWS.map(w => (
              <button key={w.key} onClick={() => setDays(w.key)}
                      className={`text-[10px] px-2 py-0.5 rounded border ${
                        days === w.key
                          ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
                          : "bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600"}`}>
                {w.label}
              </button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Top row — headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="P&L"
                value={<span className={pnlColor}>{fmtUsd(d.total_pnl)}</span>}
                delta={pnlDelta != null
                  ? { value: `${pnlDelta >= 0 ? "+" : ""}${fmtUsd(pnlDelta)} vs prior`, positive: pnlDelta >= 0 }
                  : null}/>
          <Stat label="Trades" value={<span className="text-white">{d.count}</span>}
                delta={prev ? { value: `${d.count - prev.count >= 0 ? "+" : ""}${d.count - prev.count} vs prior`,
                                positive: d.count - prev.count >= 0 } : null}/>
          <Stat label="Win rate"
                value={<span className="text-white">{fmtPct(d.win_rate)}</span>}
                delta={wrDelta != null
                  ? { value: `${wrDelta >= 0 ? "+" : ""}${fmtPct(wrDelta)} vs prior`, positive: wrDelta >= 0 }
                  : null}/>
          <Stat label="Avg R"
                value={<span className="text-white">{d.avg_r != null ? d.avg_r.toFixed(2) + "R" : "—"}</span>}/>
        </div>

        {/* Bar chart — session P&L */}
        <div className="pt-2 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">By session</div>
          <SessionBars data={d.session_pnl}/>
        </div>

        {/* Row — profit factor + expectancy + streak */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
          <MiniStat label="Profit factor"
                    value={d.profit_factor == null ? "—"
                          : d.profit_factor === Infinity ? "∞"
                          : d.profit_factor.toFixed(2)}
                    tint={d.profit_factor && d.profit_factor >= 1.5 ? "text-emerald-400"
                        : d.profit_factor && d.profit_factor >= 1 ? "text-amber-400"
                        : "text-red-400"}/>
          <MiniStat label="Expectancy"
                    value={d.expectancy != null ? fmtUsd(d.expectancy) : "—"}
                    tint={d.expectancy > 0 ? "text-emerald-400" : d.expectancy < 0 ? "text-red-400" : "text-slate-400"}/>
          <MiniStat label="Current streak"
                    value={
                      d.streak.count === 0 ? "—" :
                      d.streak.kind === "W"
                        ? <span className="text-emerald-400 flex items-center gap-1"><Flame className="w-3 h-3"/>{d.streak.count}W</span>
                        : d.streak.kind === "L"
                        ? <span className="text-red-400 flex items-center gap-1"><Snowflake className="w-3 h-3"/>{d.streak.count}L</span>
                        : <span className="text-slate-400">scratch</span>
                    }/>
        </div>

        {/* Row — best / worst / top symbol */}
        <div className="grid md:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
          <TradeLine label="Best" trade={d.best}   tint="text-emerald-400" icon={<TrendingUp className="w-3 h-3"/>}/>
          <TradeLine label="Worst" trade={d.worst}  tint="text-red-400"     icon={<TrendingDown className="w-3 h-3"/>}/>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Top symbol</div>
            <div className="text-sm font-mono text-white">
              {d.top_symbol || "—"}
              {d.top_symbol && <span className="text-slate-500 ml-1">×{d.top_symbol_count}</span>}
            </div>
            {d.top_symbol && d.symbol_pnl[d.top_symbol] != null && (
              <div className={`text-[11px] font-mono ${d.symbol_pnl[d.top_symbol] >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fmtUsd(d.symbol_pnl[d.top_symbol])} total
              </div>
            )}
          </div>
        </div>

        {/* Row — top emotion tag (if any) */}
        {d.top_tag && (
          <div className="pt-2 border-t border-slate-800 flex items-center gap-2 text-[11px]">
            <Zap className="w-3 h-3 text-slate-500"/>
            <span className="text-slate-500 uppercase tracking-wider">Top tag:</span>
            <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px]">
              {d.top_tag} × {d.top_tag_count}
            </Badge>
            {topTagWarning(d.top_tag) && (
              <span className="text-amber-400 text-[10px] italic">
                {topTagWarning(d.top_tag)}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function Stat({ label, value, delta }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-semibold font-mono">{value}</div>
      {delta && (
        <div className={`text-[10px] font-mono ${delta.positive ? "text-emerald-400" : "text-red-400"}`}>
          {delta.value}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-semibold font-mono ${tint || "text-white"}`}>{value}</div>
    </div>
  );
}

function TradeLine({ label, trade, tint, icon }) {
  if (!trade) return (
    <div><div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
         <div className="text-sm text-slate-500 italic">—</div></div>
  );
  const p = Number(trade.pnl ?? trade.realized_pnl ?? 0);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
        {icon}{label}
      </div>
      <div className="text-sm font-mono text-white flex items-center gap-1">
        <span className="text-[10px] text-slate-400">{trade.symbol || trade.ticker}</span>
        <span className={`${tint} font-semibold`}>{fmtUsd(p)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SessionBars({ data }) {
  const entries = Object.entries(data);
  const max = Math.max(...entries.map(([, v]) => Math.abs(v))) || 1;
  return (
    <div className="space-y-1.5">
      {entries.map(([sess, val]) => {
        const w = Math.abs(val) / max * 100;
        const pos = val >= 0;
        return (
          <div key={sess} className="flex items-center gap-2 text-[11px]">
            <span className="w-16 text-slate-400 font-mono uppercase">{sess}</span>
            <div className="flex-1 h-4 bg-slate-950 rounded overflow-hidden relative">
              <div className={`h-full ${pos ? "bg-emerald-500/60" : "bg-red-500/60"}`}
                   style={{ width: val === 0 ? "0" : `${Math.max(2, w)}%` }}/>
            </div>
            <span className={`w-20 text-right font-mono ${pos ? "text-emerald-400" : val < 0 ? "text-red-400" : "text-slate-500"}`}>
              {fmtUsd(val)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function topTagWarning(tag) {
  const t = String(tag || "").toLowerCase();
  if (["revenge", "fomo", "chase", "tilt"].includes(t)) return "watch the discipline";
  if (["fear", "hesitation"].includes(t))               return "smaller size next week?";
  return null;
}

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return "$0";
  const s = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${s}$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}
function fmtPct(n) {
  if (n == null || !isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}
