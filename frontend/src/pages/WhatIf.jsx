import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, RefreshCw, ArrowRight, TrendingUp, TrendingDown, RotateCcw } from "lucide-react";
import { Trade } from "@/entities/all";
import { runWhatIf, discoverFacets } from "@/lib/whatif";

// WhatIf — filter trades by tag / session / symbol / day and see how the
// P&L changes vs actual. Reveals which habits cost the most.
//
// Two modes per facet:
//   · EXCLUDE — drop trades matching, keep everything else
//   · ONLY    — keep trades matching, drop everything else
//
// Presets provided: "no revenge trades", "NY only", "MNQ only", "weekdays only"

const PRESETS = [
  { key: "no_revenge", label: "Skip revenge/FOMO tags",
    filter: { exclude_tags: ["revenge", "fomo", "chase", "tilt"] } },
  { key: "ny_only",    label: "NY session only",
    filter: { only_sessions: ["NY"] } },
  { key: "mnq_only",   label: "MNQ only",
    filter: { only_symbols: ["MNQ"] } },
  { key: "weekdays",   label: "No Sunday trades",
    filter: { exclude_days: ["Sun"] } },
  { key: "disciplined", label: "Only 'disciplined' tag",
    filter: { only_tags: ["disciplined"] } },
];

export default function WhatIfPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays]   = useState(30);
  const [filter, setFilter] = useState({});

  const load = async () => {
    setLoading(true);
    try { setTrades(await Trade.list("-entry_time", 1000).catch(() => [])); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const facets = useMemo(() => discoverFacets(trades), [trades]);
  const result = useMemo(() => runWhatIf(trades, filter, days), [trades, filter, days]);

  const clear = () => setFilter({});
  const applyPreset = (key) => {
    const p = PRESETS.find(x => x.key === key);
    if (p) setFilter(p.filter);
  };

  const toggleInSet = (field, value) => {
    const cur = new Set(filter[field] || []);
    if (cur.has(value)) cur.delete(value); else cur.add(value);
    setFilter({ ...filter, [field]: [...cur] });
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <FlaskConical className="w-7 h-7 text-blue-400"/> What-If Analyzer
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Filter your trades by tag, session, symbol, or day of week. See the P&L delta if you had
            skipped (or only taken) that subset. Reveals which habits cost you the most.
          </p>
        </header>

        {/* Presets + window */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Quick presets:</span>
              {PRESETS.map(p => (
                <Button key={p.key} size="sm" onClick={() => applyPreset(p.key)}
                        className="h-7 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs">
                  {p.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={clear}
                      className="h-7 text-slate-400 hover:text-white text-xs">
                <RotateCcw className="w-3 h-3 mr-1"/>Clear
              </Button>
            </div>
            <div className="flex items-center gap-3 pt-2 border-t border-slate-800">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Window:</span>
              <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                <SelectTrigger className="h-8 w-32 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" onClick={load}
                      className="h-8 text-slate-400 hover:text-white text-xs">
                <RefreshCw className="w-3 h-3 mr-1"/>Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Delta comparison */}
        <DeltaComparison result={result}/>

        {/* Facet pickers */}
        <div className="grid md:grid-cols-2 gap-3">
          <FacetPicker title="Exclude tags"      field="exclude_tags"     values={facets.tags}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Only these tags"   field="only_tags"        values={facets.tags}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Exclude sessions"  field="exclude_sessions" values={facets.sessions}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Only these sessions" field="only_sessions"  values={facets.sessions}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Exclude symbols"   field="exclude_symbols"  values={facets.symbols}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Only these symbols" field="only_symbols"    values={facets.symbols}
                       filter={filter} onToggle={toggleInSet}/>
          <FacetPicker title="Exclude days"      field="exclude_days"     values={facets.days}
                       filter={filter} onToggle={toggleInSet}/>
        </div>

        {/* Dropped list — what's being removed */}
        {result.dropped_count > 0 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-white text-base flex items-center gap-2">
                Dropped <span className="text-slate-500 text-sm font-normal">({result.dropped_count})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {result.dropped.slice(0, 100).map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-slate-400 px-2 py-1 border border-slate-800 rounded">
                    <span className="text-white w-16">{d.symbol}</span>
                    <span className={d.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                      {d.pnl >= 0 ? "+" : "-"}${Math.abs(d.pnl).toFixed(0)}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="text-amber-400 text-[10px]">{d.reason}</span>
                    <span className="ml-auto text-slate-500 text-[10px]">
                      {d.entry_time ? new Date(d.entry_time).toLocaleDateString() : ""}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function DeltaComparison({ result }) {
  const a = result.actual, f = result.filtered, d = result.delta;
  const better = d.total_pnl > 0;
  const worse  = d.total_pnl < 0;

  return (
    <Card className={`${better ? "bg-emerald-500/5 border-emerald-500/30"
                     : worse   ? "bg-red-500/5 border-red-500/30"
                     :           "bg-slate-900 border-slate-800"}`}>
      <CardContent className="p-4 space-y-3">
        <div className="grid grid-cols-3 gap-4 items-center">
          <StatCol label="Actual" summary={a} tint="text-slate-300"/>
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Delta</div>
            <div className="flex items-center justify-center gap-2">
              <ArrowRight className="w-4 h-4 text-slate-500"/>
              <span className={`text-3xl font-bold font-mono ${
                  better ? "text-emerald-400" : worse ? "text-red-400" : "text-slate-400"}`}>
                {d.total_pnl >= 0 ? "+" : "-"}${Math.abs(d.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}
              </span>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              {result.kept_count} kept · {result.dropped_count} dropped
            </div>
          </div>
          <StatCol label="If filtered" summary={f}
                   tint={f.total_pnl > 0 ? "text-emerald-400" : f.total_pnl < 0 ? "text-red-400" : "text-slate-400"}/>
        </div>

        {(better || worse) && (
          <div className={`text-center text-sm border-t pt-3 ${
              better ? "border-emerald-500/30 text-emerald-200"
                     : "border-red-500/30 text-red-200"}`}>
            {better
              ? <><TrendingUp className="w-4 h-4 inline mr-1"/>You'd be up <strong>${Math.abs(d.total_pnl).toFixed(0)}</strong> more without these trades.</>
              : <><TrendingDown className="w-4 h-4 inline mr-1"/>You'd be down <strong>${Math.abs(d.total_pnl).toFixed(0)}</strong> — your filter drops winners.</>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCol({ label, summary, tint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${tint}`}>
        {summary.total_pnl >= 0 ? "+" : "-"}${Math.abs(summary.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}
      </div>
      <div className="text-[11px] text-slate-500 mt-0.5 space-x-1.5">
        <span>{summary.count}t</span>
        <span>·</span>
        <span>{(summary.win_rate * 100).toFixed(0)}%WR</span>
        <span>·</span>
        <span>PF {summary.profit_factor === Infinity ? "∞" : summary.profit_factor.toFixed(1)}</span>
      </div>
    </div>
  );
}

function FacetPicker({ title, field, values, filter, onToggle }) {
  const active = new Set(filter[field] || []);
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-sm flex items-center gap-2">
          {title}
          {active.size > 0 && (
            <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/40 text-[10px]">
              {active.size} active
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {values.length === 0 ? (
          <div className="text-[11px] text-slate-500 italic">No {title.toLowerCase().split(" ").pop()} in your trades.</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {values.map(v => {
              const isOn = active.has(v);
              return (
                <button key={v} onClick={() => onToggle(field, v)}
                        className={`text-[11px] px-2 py-1 rounded border transition-colors font-mono ${
                          isOn ? "bg-blue-500/15 text-blue-300 border-blue-500/50"
                               : "bg-slate-950 text-slate-500 border-slate-800 hover:border-slate-700"}`}>
                  {v}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
