import React, { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { Copy, RefreshCw } from "lucide-react";

// CopyAuditLedger — one row per signal, showing where it fanned out.
// Reads /api/webhook-signals + groups by trade_id (same "base" trade
// gets multiple leg rows when fanned across a group), then displays
// each leg's account + status.
//
// Answers the question: "signal fired at 10:32 — which accounts got it
// and what happened to each leg?"

export default function CopyAuditLedger({ limit = 40 }) {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const data = await api(`/api/webhook-signals?limit=${limit * 3}`);
      const signals = Array.isArray(data) ? data : (data?.signals || []);
      // Group by base trade_id (strip #accN suffix)
      const grouped = {};
      for (const s of signals) {
        const base = String(s.trade_id || "").replace(/#acc\d+.*$/, "");
        if (!grouped[base]) grouped[base] = { base, first: s, legs: [] };
        if (String(s.trade_id || "").includes("#acc")) grouped[base].legs.push(s);
      }
      const list = Object.values(grouped)
        .filter(g => g.legs.length > 0 || g.first.trade_id)
        .sort((a, b) => new Date(b.first.created_at) - new Date(a.first.created_at))
        .slice(0, limit);
      setRows(list);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-blue-400"/>Copy Trade Audit
          </span>
          <Button size="sm" variant="ghost" onClick={load} className="h-7 text-xs">
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`}/>Refresh
          </Button>
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Every signal + per-account fan-out. Answers "signal X went to which accounts, and what did each leg do?"
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="text-xs text-red-400 mb-2">Error: {error}</div>}
        {loading && rows.length === 0 ? (
          <div className="text-sm text-slate-400 italic py-4">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-4">
            No fan-out signals recorded yet. Fire a signal at a group's webhook to see it here.
          </div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {rows.map(g => (
              <div key={g.base} className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white font-mono truncate flex-1 mr-2">{g.base || "(no id)"}</span>
                  <span className="text-slate-500 text-[10px] shrink-0">
                    {g.first.created_at ? new Date(g.first.created_at).toLocaleString() : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {g.legs.length === 0 ? (
                    <span className="text-slate-500 italic">no legs recorded</span>
                  ) : g.legs.map((leg, i) => (
                    <span key={i}
                          className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5">
                      <span className="text-slate-400">{leg.trade_id.match(/#acc(\d+)/)?.[1] || "?"}</span>
                      <span className={`uppercase ${leg.event?.includes("ERROR") ? "text-red-400" : "text-emerald-300"}`}>
                        {leg.event || "?"}
                      </span>
                      {leg.qty > 0 && <span className="text-slate-300">×{leg.qty}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
