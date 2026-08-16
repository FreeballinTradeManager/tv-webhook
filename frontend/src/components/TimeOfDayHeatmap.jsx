import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Award, AlertTriangle } from "lucide-react";
import {
  heatmap, cellIntensity, topCells,
  WEEKDAY_LABELS, HOUR_LABELS_ET,
} from "@/lib/tod_heatmap";

// TimeOfDayHeatmap — 7-day × 24-hour grid of P&L density.
// Emerald cells = winning windows. Red cells = bleeding windows.
// Empty cells stay dim slate.
//
// Hover tooltip on each cell shows count / W-L / net $. Best/worst callouts
// under the grid highlight the top 3 winning and losing (day, hour) combos.

const WINDOWS = [
  { key: 7,   label: "7d"  },
  { key: 30,  label: "30d" },
  { key: 90,  label: "90d" },
  { key: 365, label: "1yr" },
];

export default function TimeOfDayHeatmap({ trades }) {
  const [days, setDays] = useState(30);
  const data = useMemo(() => heatmap(trades || [], days), [trades, days]);
  const tops = useMemo(() => topCells(data.cells, 3), [data]);

  if (data.total.count === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400"/> Time-of-Day Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500 italic py-4">
          No closed trades in the last {days} days.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-400"/> Time-of-Day Heatmap
            <span className="text-xs font-normal text-slate-500">
              {data.total.count} trades · net {fmt(data.total.net_pnl)}
            </span>
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

      <CardContent className="space-y-3">
        {/* Grid */}
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Column headers (hours 00–23) */}
            <div className="flex items-center gap-0.5 pl-10">
              {HOUR_LABELS_ET.map(h => (
                <div key={h}
                     className={`w-6 text-center text-[9px] font-mono ${
                       h === "09" || h === "18" ? "text-blue-400 font-bold" : "text-slate-600"}`}>
                  {h}
                </div>
              ))}
            </div>

            {/* Rows: one per weekday */}
            {WEEKDAY_LABELS.map((dayLbl, d) => (
              <div key={d} className="flex items-center gap-0.5 mt-0.5">
                <div className="w-8 text-[10px] text-slate-400 font-mono uppercase text-right pr-1">
                  {dayLbl}
                </div>
                <div className={`w-2 text-[10px] font-mono tabular-nums text-right ${
                    data.day_totals[d].net_pnl > 0 ? "text-emerald-500"
                  : data.day_totals[d].net_pnl < 0 ? "text-red-500" : "text-slate-600"}`}>
                  {data.day_totals[d].count > 0 ? "·" : ""}
                </div>
                {HOUR_LABELS_ET.map((_, h) => {
                  const cell = data.cells[d][h];
                  const { intensity, kind } = cellIntensity(cell, data.max_abs);
                  const bg = kind === "win"
                    ? `rgba(52, 211, 153, ${0.15 + 0.75 * intensity})`
                    : kind === "loss"
                    ? `rgba(239, 68, 68, ${0.15 + 0.75 * intensity})`
                    : kind === "flat"
                    ? "rgba(148, 163, 184, 0.15)"
                    : "transparent";
                  const border = kind === "empty"
                    ? "border-slate-800/50" : "border-transparent";
                  return (
                    <div key={h}
                         title={cell.count === 0 ? `${dayLbl} ${h}:00 — no trades`
                                : `${dayLbl} ${h}:00 ET · ${cell.count}t · ${cell.wins}W/${cell.losses}L · ${fmt(cell.net_pnl)}${cell.best != null ? ` · best ${fmt(cell.best)}` : ""}${cell.worst != null ? ` · worst ${fmt(cell.worst)}` : ""}`}
                         className={`w-6 h-6 rounded-sm border ${border} transition-transform hover:scale-110 hover:z-10 hover:ring-1 hover:ring-blue-400 cursor-help flex items-center justify-center`}
                         style={{ background: bg }}>
                      {cell.count > 0 && (
                        <span className={`text-[9px] font-mono ${
                            intensity > 0.5 ? "text-white" : "text-slate-300/70"}`}>
                          {cell.count}
                        </span>
                      )}
                    </div>
                  );
                })}
                {/* Row total */}
                <div className={`ml-1 w-14 text-[10px] font-mono tabular-nums text-right ${
                    data.day_totals[d].net_pnl > 0 ? "text-emerald-400"
                  : data.day_totals[d].net_pnl < 0 ? "text-red-400" : "text-slate-600"}`}>
                  {data.day_totals[d].count > 0 ? fmt(data.day_totals[d].net_pnl) : "—"}
                </div>
              </div>
            ))}

            {/* Column totals row */}
            <div className="flex items-center gap-0.5 pl-10 mt-1 border-t border-slate-800 pt-1">
              {HOUR_LABELS_ET.map((_, h) => {
                const t = data.hour_totals[h];
                if (t.count === 0) return <div key={h} className="w-6 text-center text-[9px] text-slate-800">—</div>;
                return (
                  <div key={h}
                       title={`Hour ${h}:00 ET · ${t.count}t · ${t.wins}W/${t.losses}L · ${fmt(t.net_pnl)}`}
                       className={`w-6 text-center text-[9px] font-mono tabular-nums ${
                          t.net_pnl > 0 ? "text-emerald-400"
                        : t.net_pnl < 0 ? "text-red-400" : "text-slate-500"}`}>
                    {compact(t.net_pnl)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Best / worst callouts */}
        <div className="grid md:grid-cols-2 gap-3 pt-3 border-t border-slate-800">
          <CalloutList title="Best cells" icon={<Award className="w-3.5 h-3.5 text-emerald-400"/>}
                       cells={tops.best} tone="win"/>
          <CalloutList title="Worst cells" icon={<AlertTriangle className="w-3.5 h-3.5 text-red-400"/>}
                       cells={tops.worst} tone="loss"/>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 pt-2 border-t border-slate-800 text-[10px] font-mono">
          <span className="text-slate-500 uppercase tracking-wider">Legend:</span>
          <span className="flex items-center gap-1"><Sw c="rgba(239, 68, 68, 0.75)"/> loss</span>
          <span className="flex items-center gap-1"><Sw c="rgba(239, 68, 68, 0.25)"/> mild loss</span>
          <span className="flex items-center gap-1"><Sw c="rgba(148, 163, 184, 0.15)"/> scratch</span>
          <span className="flex items-center gap-1"><Sw c="rgba(52, 211, 153, 0.25)"/> mild win</span>
          <span className="flex items-center gap-1"><Sw c="rgba(52, 211, 153, 0.75)"/> win</span>
          <span className="ml-auto text-slate-500">Hours ET · number = trade count · row total on right</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CalloutList({ title, icon, cells, tone }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1.5">
        {icon}{title}
      </div>
      {cells.length === 0
        ? <div className="text-[11px] text-slate-500 italic">—</div>
        : <div className="space-y-1">
            {cells.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 text-xs px-2 py-1 rounded border ${
                  tone === "win"
                    ? "bg-emerald-500/5 border-emerald-500/30"
                    : "bg-red-500/5 border-red-500/30"}`}>
                <span className="font-mono text-slate-400 w-16">
                  {WEEKDAY_LABELS[c.weekday]} {String(c.hour).padStart(2, "0")}:00
                </span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-slate-300">{c.count}t</span>
                <span className="text-slate-500">·</span>
                <span className="font-mono text-slate-300">{c.wins}W/{c.losses}L</span>
                <span className={`ml-auto font-mono font-semibold ${
                    c.net_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmt(c.net_pnl)}
                </span>
              </div>
            ))}
          </div>}
    </div>
  );
}

function Sw({ c }) {
  return <span className="inline-block w-3 h-3 rounded-sm border border-slate-700" style={{ background: c }}/>;
}

function fmt(n) {
  if (n == null || !isFinite(n)) return "$0";
  const s = n < 0 ? "-" : n > 0 ? "+" : "";
  const v = Math.abs(n);
  return `${s}$${v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}

function compact(n) {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const v = Math.abs(n);
  const s = n < 0 ? "-" : "+";
  if (v >= 1000) return `${s}${(v / 1000).toFixed(1)}k`;
  return `${s}${v.toFixed(0)}`;
}
