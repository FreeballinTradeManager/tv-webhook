import React, { useMemo, useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Target, TrendingUp, Calendar as CalIcon } from "lucide-react";

// Payout Planner — "what daily P&L do I need to hit my monthly target?"
//
// Given today's date + a monthly payout goal + how much I've already made
// this month + optional per-trade risk, tell me:
//   · $ left to earn
//   · trading days left in the month
//   · required $/day
//   · that as an R multiple given my risk
//   · pace tag (ahead / on-track / behind / at-risk)
//
// Zero backend. All inputs persist in localStorage per trader.

const KEY = "tradecore_payout_planner_v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const save = (o) => localStorage.setItem(KEY, JSON.stringify(o));

function isTradingDay(d) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6; // no Sat/Sun; US holidays not accounted for (Playbook shows them separately)
}
function tradingDaysBetween(from, to) {
  let n = 0;
  const d = new Date(from);
  while (d <= to) {
    if (isTradingDay(d)) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function fmt$(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? "" : "−"}$${Math.abs(v).toFixed(2)}`;
}

export default function PayoutPlanner({ trades = [] }) {
  const persisted = load();
  const [target, setTarget]     = useState(persisted.target ?? 2000);
  const [risk, setRisk]         = useState(persisted.risk ?? 120);
  const [manualMTD, setManualMTD] = useState(persisted.manualMTD ?? "");

  useEffect(() => save({ target, risk, manualMTD }), [target, risk, manualMTD]);

  const now       = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // Sum trades this month unless the user typed a manual override.
  const autoMTD = useMemo(() => {
    return trades
      .filter(t => {
        const ts = t.exit_time || t.entry_time;
        if (!ts) return false;
        const d = new Date(ts);
        return d >= monthStart && d <= monthEnd;
      })
      .reduce((acc, t) => acc + (Number(t.pnl) || 0), 0);
  }, [trades, monthStart, monthEnd]);
  const mtd = manualMTD === "" ? autoMTD : Number(manualMTD);

  const totalDays  = tradingDaysBetween(monthStart, monthEnd);
  const usedDays   = tradingDaysBetween(monthStart, now);
  const remaining  = Math.max(0, tradingDaysBetween(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), monthEnd));
  const daysToUse  = Math.max(1, remaining); // avoid div/0 on last day of month

  const toGo       = target - mtd;
  const perDay     = toGo / daysToUse;
  const asR        = risk > 0 ? perDay / risk : 0;

  // Expected pace = target * (usedDays / totalDays). Compare mtd vs expected.
  const expected = totalDays > 0 ? (usedDays / totalDays) * target : 0;
  const paceGap  = mtd - expected;

  let pace = "on-track", paceClass = "text-slate-300";
  if (paceGap >= target * 0.15)      { pace = "ahead";    paceClass = "text-emerald-400"; }
  else if (paceGap >= 0)             { pace = "on-track"; paceClass = "text-emerald-300"; }
  else if (paceGap >= -target * 0.15){ pace = "behind";   paceClass = "text-amber-400"; }
  else                               { pace = "at-risk";  paceClass = "text-red-400"; }

  const done       = target > 0 ? Math.max(0, Math.min(100, (mtd / target) * 100)) : 0;

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-400"/> Payout Planner
          <span className="text-xs font-normal text-slate-400 ml-2">
            What do I need per day to hit this month's payout?
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Monthly target ($)</Label>
            <Input type="number" value={target}
                   onChange={e => setTarget(Number(e.target.value) || 0)}
                   className="bg-slate-950 border-slate-800 text-white"/>
          </div>
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Risk per trade ($)</Label>
            <Input type="number" value={risk}
                   onChange={e => setRisk(Number(e.target.value) || 0)}
                   className="bg-slate-950 border-slate-800 text-white"/>
          </div>
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">
              MTD P&L override (blank = auto)
            </Label>
            <Input type="number" value={manualMTD} placeholder={fmt$(autoMTD)}
                   onChange={e => setManualMTD(e.target.value)}
                   className="bg-slate-950 border-slate-800 text-white"/>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              {fmt$(mtd)} of {fmt$(target)}
            </span>
            <span className={paceClass + " font-semibold uppercase tracking-wider"}>{pace}</span>
          </div>
          <div className="mt-1 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full ${mtd >= 0 ? "bg-blue-500" : "bg-red-500"}`}
                 style={{ width: `${done}%` }}/>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
            <span>{done.toFixed(0)}% of target</span>
            <span>{paceGap >= 0 ? "+" : "−"}{fmt$(Math.abs(paceGap))} vs pace</span>
          </div>
        </div>

        {/* Headline math */}
        <div className="grid md:grid-cols-4 gap-3">
          <BigStat label="To go"          value={fmt$(Math.max(0, toGo))}    tone={toGo <= 0 ? "up" : "flat"}/>
          <BigStat label="Trading days left" value={remaining}
                   icon={<CalIcon className="w-3 h-3"/>}/>
          <BigStat label="Required $/day" value={fmt$(Math.max(0, perDay))}
                   tone={perDay <= risk * 3 ? "flat" : "warn"}/>
          <BigStat label="≈ R needed/day" value={risk > 0 ? `${asR.toFixed(2)}R` : "—"}
                   icon={<TrendingUp className="w-3 h-3"/>}
                   tone={asR <= 3 ? "up" : asR <= 5 ? "warn" : "down"}/>
        </div>

        {/* Interpretation strip */}
        <div className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
          {toGo <= 0
            ? <>Target hit — anything more this month is a bonus. Guard against giving it back before payout.</>
            : perDay > risk * 5
              ? <>Required {fmt$(perDay)}/day is roughly {asR.toFixed(1)}R — that's steep. Either widen the window (multiple months) or shrink the target so you're not chasing hero trades.</>
              : perDay > risk * 3
                ? <>Doable but tight — needs a clean sequence of good sessions. Skip a bad day if the setup isn't there; don't force it.</>
                : <>Comfortable pace — a couple of 1–2R days a week clears it. Stay boring.</>}
        </div>
      </CardContent>
    </Card>
  );
}

function BigStat({ label, value, tone = "flat", icon = null }) {
  const toneClass =
    tone === "up"   ? "text-emerald-400" :
    tone === "warn" ? "text-amber-400"   :
    tone === "down" ? "text-red-400"     : "text-white";
  return (
    <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
        {icon}{label}
      </div>
      <div className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}
