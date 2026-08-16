import React, { useEffect, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { Trade, Account } from "@/entities/all";
import SessionTradeGroup from "@/components/SessionTradeGroup";

// TradeJournal — compact session-grouped view of every trade.
//
// One-liner per trade (Trade N | HH:MM | Sym | ticks | $risk | #ct | Win ±$)
// with TP dot indicators and click-to-expand per-TP action.
//
// Distinct from DailyJournal (that's for daily bias notes + structure
// screenshots). This is a pure trade log optimized for scanning.

export default function TradeJournalPage() {
  const [trades, setTrades]   = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showOpen, setShowOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        Trade.list("-entry_time", 500).catch(() => []),
        Account.list("-created_date").catch(() => []),
      ]);
      setTrades(t || []);
      setAccounts(a || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let out = trades;
    if (!showOpen) {
      out = out.filter(t => t.status === "closed" || t.exit_time || t.close_time);
    }
    const s = q.trim().toLowerCase();
    if (s) {
      out = out.filter(t =>
        String(t.symbol || t.ticker || "").toLowerCase().includes(s) ||
        String(t.notes  || "").toLowerCase().includes(s) ||
        (t.tags || []).some(tag => String(tag).toLowerCase().includes(s))
      );
    }
    return out;
  }, [trades, q, showOpen]);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-7 h-7 text-blue-400"/> Trade Journal
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl">
              Every trade in compact form — grouped by day + session. Click any row to see per-TP action
              (BE / jump 85% / trail) and the full leg breakdown.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"/>
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="filter symbol/notes/tag"
                     className="h-9 pl-7 w-56 bg-slate-950 border-slate-800 text-white text-xs"/>
            </div>
            <Button size="sm" variant="ghost"
                    onClick={() => setShowOpen(v => !v)}
                    className="h-9 text-xs text-slate-400 hover:text-white">
              {showOpen ? "Show closed only" : "Include open"}
            </Button>
            <Button size="sm" variant="ghost" onClick={load}
                    className="h-9 text-xs text-slate-400 hover:text-white">
              <RefreshCw className="w-3.5 h-3.5 mr-1"/>Refresh
            </Button>
          </div>
        </header>

        {/* Legend */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-3 flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
            <span className="font-semibold text-slate-300 uppercase tracking-wider">Legend:</span>
            <LegendChip color="emerald" label="Win"/>
            <LegendChip color="red"     label="Loss / Stopped"/>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]"/>
              <span>TP hit</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-700 border border-slate-600"/>
              <span>TP miss</span>
            </span>
            <span className="text-slate-500 ml-auto">Left stripe = W/L color · click row to expand</span>
          </CardContent>
        </Card>

        {loading ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-8 text-center text-slate-500">Loading trades…</CardContent>
          </Card>
        ) : (
          <SessionTradeGroup trades={filtered} accounts={accounts}/>
        )}
      </div>
    </div>
  );
}

function LegendChip({ color, label }) {
  const cls = color === "emerald" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
            : color === "red"     ? "bg-red-500/15 text-red-300 border-red-500/40"
            :                       "bg-slate-800 text-slate-300 border-slate-700";
  return <span className={`text-[10px] px-1.5 py-0.5 border rounded font-mono ${cls}`}>{label}</span>;
}
