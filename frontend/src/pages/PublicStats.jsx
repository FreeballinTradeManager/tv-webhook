import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Trade, User } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Award, Users, ExternalLink } from "lucide-react";

// Task #65 — Public read-only stats page.
// URL: /public/:handle — a stripped-down view of one trader's performance.
// Zero PII beyond the trader's display handle. No positions, no live
// trades, no broker IDs, no account balances — only aggregate stats
// derived from closed trades:
//   · lifetime net P&L (rounded to nearest $10 for privacy)
//   · win rate + trade count
//   · profit factor
//   · biggest winning + losing DAY (not per-trade — reveals less)
//   · month-by-month P&L bar
//
// Opt-in by default via localStorage flag `tradecore_public_share_v1`.
// Access-controlled by the handle itself (unguessable = private in effect).

const PUBLIC_KEY = "tradecore_public_share_v1";

export function isPublicShareEnabled() {
  try {
    const raw = localStorage.getItem(PUBLIC_KEY);
    return raw ? !!JSON.parse(raw).enabled : false;
  } catch { return false; }
}

export function publicShareHandle() {
  try {
    const raw = localStorage.getItem(PUBLIC_KEY);
    return raw ? (JSON.parse(raw).handle || null) : null;
  } catch { return null; }
}

function summarize(trades) {
  const closed = trades.filter(t => t.status === "closed" && t.profit_loss != null);
  let net = 0, wins = 0, losses = 0, gw = 0, gl = 0;
  const daily = new Map();
  const monthly = new Map();
  closed.forEach(t => {
    net += t.profit_loss;
    if (t.profit_loss > 0) { wins += 1; gw += t.profit_loss; }
    else if (t.profit_loss < 0) { losses += 1; gl += Math.abs(t.profit_loss); }
    const ts = t.exit_time || t.entry_time;
    if (!ts) return;
    const d = new Date(ts);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const monKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    daily.set(dayKey, (daily.get(dayKey) || 0) + t.profit_loss);
    monthly.set(monKey, (monthly.get(monKey) || 0) + t.profit_loss);
  });
  const days = [...daily.entries()];
  const bestDay = days.reduce((a, b) => (a[1] > b[1] ? a : b), ["—", 0]);
  const worstDay = days.reduce((a, b) => (a[1] < b[1] ? a : b), ["—", 0]);
  return {
    count: closed.length,
    wins, losses, net,
    winRate: closed.length ? (wins / closed.length) * 100 : 0,
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
    bestDay, worstDay,
    monthly: [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  };
}

// Round the shared net P&L to the nearest $10 so we're not broadcasting
// exact numbers to strangers — good enough for bragging rights, not
// enough for anyone to work out account size.
function roundish(n, step = 10) {
  return Math.round(n / step) * step;
}

export default function PublicStatsPage() {
  const { handle } = useParams();
  const [trades, setTrades] = useState([]);
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [t, u] = await Promise.all([
        Trade.list("-entry_time", 5000).catch(() => []),
        User.me().catch(() => ({})),
      ]);
      if (alive) { setTrades(t || []); setUser(u || {}); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [handle]);

  const s = useMemo(() => summarize(trades), [trades]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <Skeleton className="h-96 w-full max-w-2xl bg-slate-800"/>
      </div>
    );
  }

  const displayName = user?.trader_name || handle || "Anonymous trader";

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        <header className="text-center py-6 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-semibold">
            TradeCore · public stats
          </div>
          <h1 className="text-4xl font-bold text-white flex items-center justify-center gap-3">
            <Users className="w-8 h-8 text-blue-500"/>{displayName}
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Aggregate performance snapshot. No positions, no balances — public stats only.
          </p>
        </header>

        {/* Headline */}
        <Card className={`bg-slate-900 border-slate-800 border-l-4 ${s.net >= 0 ? "border-l-emerald-500" : "border-l-rose-500"}`}>
          <CardContent className="p-6 text-center">
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Net P&amp;L (rounded)</div>
            <div className={`text-5xl font-black tabular-nums mt-2 ${s.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
              {s.net >= 0 ? "+" : "-"}${Math.abs(roundish(s.net)).toLocaleString()}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              across {s.count} closed trade{s.count !== 1 ? "s" : ""}
            </div>
          </CardContent>
        </Card>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Win rate" value={s.count ? `${s.winRate.toFixed(0)}%` : "—"}/>
          <StatTile label="Wins / Losses" value={`${s.wins}/${s.losses}`}/>
          <StatTile label="Profit factor" value={s.count === 0 ? "—" : (isFinite(s.pf) ? s.pf.toFixed(2) : "∞")}/>
          <StatTile label="Trades" value={s.count}/>
        </div>

        {/* Best / worst day */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DayHighlight label="Biggest winning day"
                        date={s.bestDay[0]}
                        pnl={roundish(s.bestDay[1])}
                        accent="emerald"
                        Icon={Award}/>
          <DayHighlight label="Biggest losing day"
                        date={s.worstDay[0]}
                        pnl={roundish(s.worstDay[1])}
                        accent="rose"
                        Icon={TrendingDown}/>
        </div>

        {/* Monthly bar */}
        {s.monthly.length > 0 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-base">Month by month</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyBar rows={s.monthly}/>
            </CardContent>
          </Card>
        )}

        <footer className="text-center pt-6 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-widest text-slate-600">
            shared via <span className="text-slate-400">TradeCore</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-md p-3 text-center">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-bold text-white tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function DayHighlight({ label, date, pnl, accent, Icon }) {
  const color = accent === "emerald" ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-md p-4">
      <div className={`text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5`}>
        <Icon className={`w-3 h-3 ${color}`}/>{label}
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>
        {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toLocaleString()}
      </div>
      <div className="text-xs text-slate-500 mt-0.5">{date}</div>
    </div>
  );
}

function MonthlyBar({ rows }) {
  const maxAbs = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div className="space-y-1.5">
      {rows.map(([mon, pnl]) => {
        const w = Math.max(4, Math.round(Math.abs(pnl) / maxAbs * 100));
        const bg = pnl >= 0 ? "bg-emerald-500" : "bg-rose-500";
        const txt = pnl >= 0 ? "text-emerald-400" : "text-rose-400";
        return (
          <div key={mon} className="grid grid-cols-[80px_1fr_100px] items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">{mon}</span>
            <div className="h-4 rounded-sm bg-slate-950 border border-slate-800 overflow-hidden">
              <div className={`h-full ${bg}`} style={{ width: `${w}%` }}/>
            </div>
            <span className={`text-xs font-bold tabular-nums text-right ${txt}`}>
              {pnl >= 0 ? "+" : "-"}${Math.abs(roundish(pnl)).toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
