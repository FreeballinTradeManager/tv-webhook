import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, X, Pause, Trophy } from "lucide-react";
import { evaluateAll, ackToday } from "@/lib/payout_lock";
import { Account } from "@/entities/all";

// PayoutLockBanner — top-of-Dashboard advisory that pins when any enabled
// account has hit today's profit target. Two actions per hit:
//   · "Pause account" — fires Account.update({ is_active:false }) so the
//     backend executor stops fanning to this account for the rest of the
//     day. Wakes back up on midnight reset (task #39).
//   · "Acknowledge" — mutes the banner for this account today. Trader
//     stays open but has explicitly noted the target.
//
// Also shows a compact "approaching target" note at 75% (warn level).
//
// Silent when: no enabled locks, all under warn threshold, or all hit
// locks already acked.

export default function PayoutLockBanner({ accounts, onChange }) {
  const [tick, setTick] = useState(0);   // re-eval when acks change
  const [busy, setBusy] = useState(null);
  const forceReload = () => setTick(t => t + 1);

  // Poll every 30s in case pnl_today updates while we're mounted
  useEffect(() => {
    const t = setInterval(forceReload, 30_000);
    return () => clearInterval(t);
  }, []);

  const evals = evaluateAll(accounts || [])
    .filter(e => e.status.level === "hit" || e.status.level === "warn");

  if (evals.length === 0) return null;

  const hits  = evals.filter(e => e.status.level === "hit");
  const warns = evals.filter(e => e.status.level === "warn");

  const pauseAccount = async (acct) => {
    if (!window.confirm(`Pause ${acct.name}? Executor will skip this account until midnight reset.`)) return;
    setBusy(acct.id);
    try {
      await Account.update(acct.id, { is_active: false });
      ackToday(acct.id);
      forceReload();
      onChange?.();
    } catch (e) {
      alert(`Pause failed: ${e.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  const acknowledge = (acct) => {
    ackToday(acct.id);
    forceReload();
    onChange?.();
  };

  return (
    <div className="space-y-2">
      {/* Hit rows — amber, actionable */}
      {hits.map(({ account, status }) => (
        <Card key={account.id} className="bg-amber-500/10 border-amber-500/50">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <Trophy className="w-5 h-5 text-amber-400 shrink-0"/>
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-semibold text-amber-100">
                🎯 {account.name} — up ${fmtInt(status.pnl_today)} on ${fmtInt(status.target)} target
              </div>
              <div className="text-[11px] text-amber-200/80 mt-0.5">
                Take the win. Pause for the day or acknowledge to stay open at your own risk.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => pauseAccount(account)} disabled={busy === account.id}
                      className="h-8 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-xs">
                <Pause className="w-3 h-3 mr-1"/>{busy === account.id ? "Pausing…" : "Pause account"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => acknowledge(account)}
                      className="h-8 text-amber-200 hover:text-white hover:bg-amber-500/20 text-xs">
                <X className="w-3 h-3 mr-1"/>Acknowledge
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Warn rows — compact, non-blocking */}
      {warns.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-amber-300/80 pl-1">
          <Target className="w-3 h-3"/>
          <span>Approaching payout target:</span>
          {warns.map(({ account, status }) => (
            <Badge key={account.id}
                   className="bg-amber-500/10 text-amber-200 border-amber-500/40 text-[10px]">
              {account.name} · {Math.round(status.progress * 100)}%
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}
