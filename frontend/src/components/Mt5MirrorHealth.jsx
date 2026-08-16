import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Radio, ShieldCheck, Lock, ArrowUpRight, Circle } from "lucide-react";
import {
  listConfiguredAccounts, getDryRunLog,
} from "@/lib/mt5_mirror";

// Mt5MirrorHealth — Dashboard tile giving one-glance status of the MT5 mirror.
//
// Shows:
//   · N accounts with mirror enabled  (of M configured)
//   · Today's dry-run count           (entries + updates + closes)
//   · Real sends fired               (always 0 in Phase 1 — badge shows LOCK)
//   · Last mirror event age          ("just now" / "3m" / "45m" / "—")
//
// Silent when zero accounts are configured — no dead card by default.
// Refreshes every 8s from localStorage (no server call).

export default function Mt5MirrorHealth() {
  const [state, setState] = useState(() => snapshot());

  useEffect(() => {
    const t = setInterval(() => setState(snapshot()), 8000);
    return () => clearInterval(t);
  }, []);

  if (state.configured === 0) return null;   // hide if nobody has touched it

  const isoAgo = (iso) => {
    if (!iso) return "—";
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000)    return "just now";
    if (diffMs < 3600_000)  return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    return `${Math.floor(diffMs / 86400_000)}d ago`;
  };

  return (
    <Link to="/Mt5Mirror" className="block group">
      <Card className="bg-slate-900 border-slate-800 hover:border-blue-500/40 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Radio className={`w-4 h-4 ${state.enabled > 0 ? "text-blue-400" : "text-slate-600"}`}/>
              <span className="text-xs font-semibold text-white uppercase tracking-wider">MT5 mirror</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px]">
                <ShieldCheck className="w-2.5 h-2.5 mr-0.5"/>Phase 1
              </Badge>
              <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-blue-400 transition-colors"/>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <Stat label="Enabled" value={`${state.enabled}/${state.configured}`}
                  tint={state.enabled > 0 ? "text-white" : "text-slate-500"}/>
            <Stat label="Today" value={state.today_count}
                  tint={state.today_count > 0 ? "text-blue-400" : "text-slate-500"}/>
            <Stat label="Real sent"
                  value={<span className="inline-flex items-center gap-1"><Lock className="w-3 h-3"/>0</span>}
                  tint="text-amber-300"/>
            <Stat label="Last event" value={isoAgo(state.last_ts)}
                  tint={state.last_ts ? "text-slate-300" : "text-slate-500"}/>
          </div>

          {state.by_kind_today && (
            <div className="mt-3 pt-3 border-t border-slate-800 flex items-center gap-3 text-[10px] uppercase tracking-wider">
              <KindPip label="entry" count={state.by_kind_today.ENTRY_LIKE} color="text-blue-400"/>
              <KindPip label="sl"    count={state.by_kind_today.SL_UPDATE}  color="text-red-400"/>
              <KindPip label="tp"    count={state.by_kind_today.PARTIAL}    color="text-teal-400"/>
              <KindPip label="close" count={state.by_kind_today.FULL_CLOSE} color="text-slate-400"/>
              {state.by_kind_today.NOOP > 0 && (
                <KindPip label="noop" count={state.by_kind_today.NOOP} color="text-slate-600"/>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({ label, value, tint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-lg font-semibold font-mono ${tint || "text-white"}`}>{value}</div>
    </div>
  );
}

function KindPip({ label, count, color }) {
  return (
    <span className="flex items-center gap-1">
      <Circle className={`w-2 h-2 fill-current ${color}`}/>
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-mono">{count || 0}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Snapshot the localStorage state — pure read, no side effects.
function snapshot() {
  const cfgs = listConfiguredAccounts();
  const enabled = cfgs.filter(c => c.cfg.enabled).length;

  const log = getDryRunLog({ limit: 500 });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayLog = log.filter(r => new Date(r.ts) >= startOfToday);

  const by_kind_today = todayLog.reduce((acc, r) => {
    const k = r.classification || "ENTRY_LIKE";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return {
    configured:    cfgs.length,
    enabled,
    today_count:   todayLog.length,
    last_ts:       log[0]?.ts || null,   // getDryRunLog returns newest-first
    by_kind_today,
  };
}
