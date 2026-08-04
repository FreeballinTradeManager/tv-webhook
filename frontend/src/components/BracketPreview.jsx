import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, X } from "lucide-react";

// Task #137 — Bracket order preview before fire.
// Pops on Dashboard slot cards when a user clicks "Fire" (or any equivalent
// action). Shows the planned ENTRY / STOP / TP1 / TP2 / TP3 / RUNNER stack
// so nothing goes out the door untriaged. Pine-palette pills only —
// STOP red, ENTRY blue (long) / purple (short), TP teal, RUNNER lime.

export default function BracketPreview({
  open, onOpenChange, symbol, side, bracket, riskUsd, onConfirm, busy,
}) {
  if (!bracket) return null;
  const isLong = (side || "").toLowerCase() === "long";
  const rows = [
    { role: "STOP",   price: bracket.stop?.price,   qty: bracket.stop?.qty,   kind: "stop"  },
    { role: "ENTRY",  price: bracket.entry?.price,  qty: bracket.entry?.qty,  kind: "entry" },
    { role: "TP1",    price: bracket.tp1?.price,    qty: bracket.tp1?.qty,    kind: "tp"    },
    { role: "TP2",    price: bracket.tp2?.price,    qty: bracket.tp2?.qty,    kind: "tp"    },
    { role: "TP3",    price: bracket.tp3?.price,    qty: bracket.tp3?.qty,    kind: "tp"    },
    { role: "RUNNER", price: null,                  qty: bracket.runner?.qty, kind: "runner" },
  ];
  const totalQty = rows.reduce((s, r) => s + (r.qty || 0), 0) - (bracket.entry?.qty || 0);
  // Reward preview: distance from entry to TP3 (or TP2 / TP1) vs stop.
  const stopDist = bracket.entry?.price && bracket.stop?.price
    ? Math.abs(bracket.entry.price - bracket.stop.price) : null;
  const bestTP = bracket.tp3?.price || bracket.tp2?.price || bracket.tp1?.price;
  const rewardDist = bracket.entry?.price && bestTP ? Math.abs(bestTP - bracket.entry.price) : null;
  const rr = stopDist && rewardDist ? rewardDist / stopDist : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2 text-lg">
            Confirm bracket order
          </DialogTitle>
          <div className="flex flex-wrap items-baseline gap-2 mt-1">
            <Badge className={`${isLong ? "bg-blue-600" : "bg-purple-600"} text-white text-[10px] uppercase tracking-wider`}>
              {isLong ? "LONG" : "SHORT"}
            </Badge>
            <span className="font-mono font-bold text-white text-base">{symbol || "?"}</span>
            <span className="text-slate-500 text-xs">·</span>
            <span className="text-slate-400 text-xs">{bracket.entry?.qty || 0} contracts</span>
            {riskUsd != null && (
              <>
                <span className="text-slate-500 text-xs">·</span>
                <span className="text-slate-400 text-xs">${riskUsd} risk</span>
              </>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-1.5 py-2">
          {rows.map(r => {
            const isStop  = r.kind === "stop";
            const isEntry = r.kind === "entry";
            const isTp    = r.kind === "tp";
            const isRun   = r.kind === "runner";
            let pill = "bg-slate-700 text-white";
            if (isStop)              pill = "bg-red-600 text-white";
            else if (isEntry)        pill = isLong ? "bg-blue-600 text-white" : "bg-purple-600 text-white";
            else if (isTp)           pill = "bg-teal-600 text-white";
            else if (isRun)          pill = "bg-lime-600 text-black";
            return (
              <div key={r.role} className="grid grid-cols-[72px_1fr_54px_auto] items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
                <span className="text-sm font-bold text-white">{r.role}</span>
                <span className="text-right tabular-nums text-base text-white font-semibold">
                  {r.price != null ? r.price.toFixed(2) : "—"}
                </span>
                {isStop || isEntry
                  ? <span/>
                  : <span className="text-white tabular-nums text-right text-sm font-semibold">#{r.qty || 0}</span>}
                <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${pill}`}>
                  {r.role}
                </span>
              </div>
            );
          })}
        </div>

        {/* Safety row — R:R + total qty math */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
          <SafetyCell label="Stop dist"   value={stopDist   != null ? stopDist.toFixed(2)   : "—"}/>
          <SafetyCell label="Reward dist" value={rewardDist != null ? rewardDist.toFixed(2) : "—"}/>
          <SafetyCell label="R : R"       value={rr         != null ? `${rr.toFixed(2)} : 1` : "—"}
                      accent={rr != null && rr < 1 ? "warn" : rr != null && rr >= 2 ? "good" : null}/>
        </div>

        <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-md p-3 space-y-1">
          <div className="text-white font-semibold text-sm">Confirm before fire</div>
          <div>
            Contracts on TPs total <strong className="text-white">{totalQty}</strong>. If this doesn't match your intended
            close ladder, cancel + fix the slot before firing.
          </div>
          <div className="text-slate-500 text-[11px]">
            Observe-mode accounts route through PMT/TradersPost; TradeCore only records the signal.
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
            <X className="w-4 h-4 mr-2"/>Cancel
          </Button>
          <Button type="button"
                  onClick={onConfirm}
                  disabled={busy}
                  className={`${isLong ? "bg-blue-600 hover:bg-blue-700" : "bg-purple-600 hover:bg-purple-700"} text-white font-semibold`}>
            <CheckCircle2 className="w-4 h-4 mr-2"/>{busy ? "Firing…" : `Fire ${isLong ? "LONG" : "SHORT"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SafetyCell({ label, value, accent }) {
  const cls = accent === "warn" ? "text-red-300"
           : accent === "good" ? "text-emerald-300"
           : "text-white";
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
