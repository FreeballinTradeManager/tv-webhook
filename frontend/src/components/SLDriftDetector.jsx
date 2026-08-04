import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

// Task #163 — SL-drift detector.
// Flags any live trade where the broker's actual stop_price differs
// from the Pine indicator's expected stop. Common causes: Pine trailed
// but the broker webhook didn't fire, PMT reconnect ate an SL update,
// or a manual nudge on the broker side that Pine doesn't know about.
//
// Data shape:
//   trades[] with fields:
//     stop_price          — what the broker holds now
//     pine_expected_stop  — what Pine thinks it should be
//     symbol · qty_open · direction
//   OR:
//     stop_price + broker_stop_price
//
// tolerance_ticks — max acceptable divergence (defaults to 2t).

export default function SLDriftDetector({ trades, tick_size = 0.25, tolerance_ticks = 2 }) {
  const drifted = useMemo(() => {
    return (trades || [])
      .filter(t => {
        const s = (t.status || "").toLowerCase();
        return s !== "closed" && s !== "cancelled";
      })
      .map(t => {
        const pine = t.pine_expected_stop ?? t.expected_stop ?? null;
        const broker = t.stop_price ?? t.stop_loss ?? t.broker_stop_price ?? null;
        if (pine == null || broker == null) return null;
        const diff = broker - pine;
        const diffTicks = Math.round(diff / tick_size);
        return {
          id: t.id,
          symbol: t.symbol || t.ticker || "?",
          side: (t.direction || t.side || "").toLowerCase(),
          qty: t.qty_open || t.qty_total || 0,
          pine, broker,
          diff, diffTicks,
        };
      })
      .filter(Boolean)
      .filter(r => Math.abs(r.diffTicks) > tolerance_ticks);
  }, [trades, tick_size, tolerance_ticks]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            {drifted.length > 0
              ? <AlertTriangle className="w-5 h-5 text-red-400"/>
              : <ShieldCheck className="w-5 h-5 text-emerald-400"/>}
            SL-drift monitor
          </span>
          <Badge className={drifted.length > 0
              ? "bg-red-600 text-white text-[10px] uppercase tracking-wider"
              : "bg-emerald-600 text-white text-[10px] uppercase tracking-wider"}>
            {drifted.length > 0 ? `${drifted.length} DRIFTED` : "IN SYNC"}
          </Badge>
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Compares broker stop_price against Pine's expected stop (from webhook payload). Flags divergence &gt; {tolerance_ticks}t.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {drifted.length === 0 ? (
          <p className="text-slate-500 text-xs">All open positions have broker stops matching Pine's expected level.</p>
        ) : (
          <div className="space-y-1.5">
            {drifted.map(r => (
              <div key={r.id} className="rounded-md border border-red-800/60 bg-red-950/30 px-3 py-2 grid grid-cols-[80px_1fr_auto] items-center gap-3 text-sm">
                <div>
                  <div className="font-mono font-bold text-white">{r.symbol}</div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">{r.side} · {r.qty}ct</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Pine expects</div>
                    <div className="text-white font-mono">{r.pine.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider text-slate-500">Broker has</div>
                    <div className="text-white font-mono">{r.broker.toFixed(2)}</div>
                  </div>
                </div>
                <Badge className="bg-red-600 text-white text-[10px] font-mono">
                  {r.diffTicks > 0 ? "+" : ""}{r.diffTicks}t
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
