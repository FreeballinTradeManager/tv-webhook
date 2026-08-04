import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Trade, User } from "@/entities/all";
import { Skeleton } from "@/components/ui/skeleton";
import ShareCard from "@/components/ShareCard";

// Task #117 — Per-trade share URL.
// Public read-only page — no auth wall. URL:
//   /trade/:id/share   or   /t/:id
// Renders the ShareCard with just this one trade's P&L. Same privacy
// posture as PublicStats: no positions, no broker details, only what's
// on the card itself.
//
// If the trade id can't be found the page renders an "unavailable"
// state rather than leaking existence.

export default function TradeSharePage() {
  const { id } = useParams();
  const [trade, setTrade] = useState(null);
  const [user, setUser]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [t, u] = await Promise.all([
        Trade.get(id).catch(() => null),
        User.me().catch(() => ({})),
      ]);
      if (alive) { setTrade(t); setUser(u || {}); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8">
        <Skeleton className="h-96 w-full max-w-md bg-slate-800"/>
      </div>
    );
  }

  if (!trade || trade.status !== "closed" || trade.profit_loss == null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-8 text-center">
        <div>
          <div className="text-3xl font-bold text-white mb-2">Trade unavailable</div>
          <p className="text-slate-400 text-sm max-w-md">
            This share URL either doesn't exist or points to a trade that hasn't closed. Shared trades are opt-in and read-only.
          </p>
        </div>
      </div>
    );
  }

  const iso = (() => {
    const ts = trade.exit_time || trade.entry_time;
    if (!ts) return null;
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  const summary = {
    count: 1,
    wins:   trade.profit_loss > 0 ? 1 : 0,
    losses: trade.profit_loss < 0 ? 1 : 0,
    net:    trade.profit_loss,
    winRate: trade.profit_loss > 0 ? 100 : 0,
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="text-center pt-6 pb-3 border-b border-slate-800">
          <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 font-semibold">
            TradeCore · single trade
          </div>
          <div className="text-3xl font-bold text-white">
            {trade.symbol || trade.ticker || "?"} · {(trade.direction || trade.side || "").toUpperCase()}
          </div>
          <div className="text-slate-500 text-xs mt-1">{iso}</div>
        </header>

        <ShareCard
          trader_name={user?.trader_name || "Trader"}
          date_iso={iso}
          summary={summary}
          variant="square"
        />

        <div className="text-center text-[10px] uppercase tracking-widest text-slate-600 pt-3 border-t border-slate-800">
          shared via <span className="text-slate-400">TradeCore</span>
        </div>
      </div>
    </div>
  );
}
