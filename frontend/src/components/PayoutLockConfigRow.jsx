import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Target, Trophy } from "lucide-react";
import { getPayoutCfg, setPayoutCfg, evaluatePayoutLock } from "@/lib/payout_lock";

// PayoutLockConfigRow — mounts inside AccountCard on Accounts page.
// Compact inline row for setting daily win target + auto-pause preference.
// Silent when disabled; expands to show current progress when enabled.

export default function PayoutLockConfigRow({ account }) {
  const [cfg, setCfg] = useState(() => getPayoutCfg(account.id));
  const persist = (patch) => { const next = setPayoutCfg(account.id, patch); setCfg(next); };
  const evl = evaluatePayoutLock({ ...account, pnl_today: Number(account.pnl_today) || 0 });

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Target className={`w-4 h-4 ${cfg.enabled ? "text-amber-400" : "text-slate-600"}`}/>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">Payout lock</span>
          {evl.level === "hit" && (
            <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/40 text-[10px]">
              <Trophy className="w-2.5 h-2.5 mr-0.5"/>Target hit
            </Badge>
          )}
          {evl.level === "warn" && (
            <Badge className="bg-amber-500/10 text-amber-200 border-amber-500/30 text-[10px]">
              {Math.round(evl.progress * 100)}%
            </Badge>
          )}
        </div>
        <Switch checked={!!cfg.enabled} onCheckedChange={v => persist({ enabled: v })}/>
      </div>

      {cfg.enabled && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Daily target $">
              <Input type="number" min="0" step="10" value={cfg.target_usd}
                     onChange={e => persist({ target_usd: Number(e.target.value) || 0 })}
                     className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
            <Field label="Warn at %">
              <Input type="number" min="0" max="100" step="5"
                     value={Math.round((cfg.warn_at_pct || 0.75) * 100)}
                     onChange={e => persist({ warn_at_pct: Math.max(0, Math.min(1, Number(e.target.value) / 100)) })}
                     className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
            <Field label="Auto-pause?">
              <button type="button" onClick={() => persist({ auto_pause: !cfg.auto_pause })}
                      className={`h-8 w-full rounded border text-xs font-mono ${cfg.auto_pause
                        ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                        : "bg-slate-950 text-slate-500 border-slate-800"}`}>
                {cfg.auto_pause ? "Yes — pause on hit" : "No — advisory only"}
              </button>
            </Field>
          </div>

          {/* Live progress bar */}
          <div className="mt-2">
            <div className="flex items-baseline justify-between text-[10px] font-mono mb-1">
              <span className="text-slate-500 uppercase tracking-wider">Today's progress</span>
              <span className={evl.pnl_today >= evl.target ? "text-amber-300 font-semibold"
                              : evl.pnl_today > 0 ? "text-emerald-400" : "text-slate-400"}>
                ${fmtInt(evl.pnl_today)} / ${fmtInt(evl.target)}
              </span>
            </div>
            <div className="h-2 bg-slate-950 rounded overflow-hidden">
              <div className={`h-full transition-all ${evl.level === "hit"
                ? "bg-amber-400" : evl.level === "warn" ? "bg-amber-500/60" : "bg-emerald-500/60"}`}
                   style={{ width: `${Math.max(0, Math.min(100, evl.progress * 100))}%` }}/>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">{label}</Label>
      {children}
    </div>
  );
}

function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString();
}
