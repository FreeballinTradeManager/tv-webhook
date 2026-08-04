import React, { useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Sun, Moon, Globe2 } from "lucide-react";
import { SESSIONS } from "@/lib/pine_signals";

// SessionRollup — three-bucket performance card matching the Pine
// session tags emitted by Freeballin (R1 Pre-NY / R2 New York / R3 Asia).
//
// Every trade is bucketed by:
//   1. Its explicit `session` field ("london"/"new_york"/"asian"/"daily")
//   2. Or the ET hour of its entry_time (fallback for older / imported rows)
//
// Then each bucket shows PnL, count, win rate, avg $ / trade, best / worst.
// This is the card that answers "which session actually pays me?"

const BUCKETS = [
  { key: "R1_PRENY",   label: SESSIONS.find(s => s.key === "R1_PRENY").label,   hours: SESSIONS.find(s => s.key === "R1_PRENY").hours,   icon: Moon,   color: "text-blue-300",    ring: "ring-blue-500/40",    dot: "bg-blue-400" },
  { key: "R2_NEWYORK", label: SESSIONS.find(s => s.key === "R2_NEWYORK").label, hours: SESSIONS.find(s => s.key === "R2_NEWYORK").hours, icon: Sun,    color: "text-emerald-300", ring: "ring-emerald-500/40", dot: "bg-emerald-400" },
  { key: "R3_ASIA",    label: SESSIONS.find(s => s.key === "R3_ASIA").label,    hours: SESSIONS.find(s => s.key === "R3_ASIA").hours,    icon: Globe2, color: "text-purple-300",  ring: "ring-purple-500/40",  dot: "bg-purple-400" },
];

// Legacy session field → R-bucket. "daily" trades count in whichever
// bucket their entry_time falls into (via etHourBucket()).
function sessionFieldBucket(s) {
  if (!s) return null;
  const v = String(s).toLowerCase();
  if (v === "london")   return "R1_PRENY";
  if (v === "new_york" || v === "newyork" || v === "ny") return "R2_NEWYORK";
  if (v === "asian" || v === "asia") return "R3_ASIA";
  return null; // "daily" or unknown → fall through to hour mapping
}

// Rough ET-hour → bucket mapping (matches SESSIONS[].hours):
//   R2 New York : 10–15 ET
//   R3 Asia     : 18–21 ET
//   R1 Pre-NY   : everything else (evening → London → pre-open)
function etHourBucket(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  // Convert to ET the cheap way — offset from UTC (−4 or −5). For a
  // rollup card this rough conversion is good enough (crossings inside
  // an hour don't shift the story).
  const utcH = d.getUTCHours();
  const etH  = (utcH + 24 - 5) % 24;
  if (etH >= 10 && etH < 15) return "R2_NEWYORK";
  if (etH >= 18 && etH < 21) return "R3_ASIA";
  return "R1_PRENY";
}

function bucketTrade(t) {
  return sessionFieldBucket(t.session) || etHourBucket(t.entry_time) || "R1_PRENY";
}

function fmt$(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? "" : "−"}$${Math.abs(v).toFixed(2)}`;
}
function fmtPct(n) {
  return `${(Number(n) || 0).toFixed(1)}%`;
}

export default function SessionRollup({ trades = [] }) {
  const stats = useMemo(() => {
    const buckets = Object.fromEntries(BUCKETS.map(b => [b.key, {
      key: b.key, count: 0, wins: 0, losses: 0, pnl: 0, best: null, worst: null,
    }]));
    trades.forEach(t => {
      const k = bucketTrade(t);
      const b = buckets[k];
      if (!b) return;
      const pnl = Number(t.pnl) || 0;
      b.count += 1;
      b.pnl   += pnl;
      if (pnl > 0) b.wins   += 1;
      if (pnl < 0) b.losses += 1;
      if (b.best  == null || pnl > b.best)  b.best  = pnl;
      if (b.worst == null || pnl < b.worst) b.worst = pnl;
    });
    return buckets;
  }, [trades]);

  const totalTrades = trades.length || 1;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Globe2 className="w-5 h-5 text-blue-400"/>
          Session Performance
          <span className="text-xs font-normal text-slate-400 ml-2">R1 / R2 / R3 — matches Pine session tags</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-3 gap-3">
          {BUCKETS.map(b => {
            const s = stats[b.key];
            const winRate = s.count ? (s.wins / s.count) * 100 : 0;
            const avg     = s.count ? s.pnl / s.count : 0;
            const share   = (s.count / totalTrades) * 100;
            const Icon    = b.icon;
            return (
              <div key={b.key}
                   className={`bg-slate-950/60 border border-slate-800 rounded-lg p-4 ring-1 ${b.ring}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className={`flex items-center gap-2 ${b.color} font-semibold text-sm`}>
                      <Icon className="w-4 h-4"/>{b.label}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{b.hours}</div>
                  </div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {fmtPct(share)} of trades
                  </span>
                </div>

                <div className={`mt-3 text-2xl font-bold ${s.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {fmt$(s.pnl)}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                  <Stat label="Trades" value={s.count}/>
                  <Stat label="Win %"  value={fmtPct(winRate)}/>
                  <Stat label="Avg"    value={fmt$(avg)} tone={avg >= 0 ? "up" : "down"}/>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <Stat label="Best"  value={s.best  == null ? "—" : fmt$(s.best)}  tone="up"/>
                  <Stat label="Worst" value={s.worst == null ? "—" : fmt$(s.worst)} tone="down"/>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 text-[11px] text-slate-500 leading-relaxed">
          Bucket comes from the trade's explicit session field first; older rows without a session tag fall back to
          the entry_time hour (ET). Use this to spot which rotation actually pays — if R3 Asia is chronically red,
          gate it off in Rotation instead of overriding it with willpower.
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }) {
  const toneClass =
    tone === "up"   ? "text-emerald-400" :
    tone === "down" ? "text-red-400"     : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
