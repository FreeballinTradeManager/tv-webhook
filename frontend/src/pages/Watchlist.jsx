import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Plus, Trash2, ExternalLink, TrendingUp, TrendingDown, Search } from "lucide-react";
import { assetStatus } from "@/lib/market_hours";
import { useContextMenu } from "@/components/RightClickMenu";

// Task #112 + #113 + #111 — Watchlist + ticker tape + symbol search.
// LocalStorage-backed for MVP. The symbol search is a curated list of
// the CME futures + FX pairs we already know from prop_firms + assets
// — no external TV Search API needed for this pass.

const WATCHLIST_KEY = "tradecore_watchlist_v1";

// Curated symbol registry — same set that market_hours + assets know about.
const SYMBOL_REGISTRY = [
  { root: "MNQ",  name: "Micro E-mini NASDAQ 100",  class: "Equity Index" },
  { root: "NQ",   name: "E-mini NASDAQ 100",        class: "Equity Index" },
  { root: "MES",  name: "Micro E-mini S&P 500",     class: "Equity Index" },
  { root: "ES",   name: "E-mini S&P 500",           class: "Equity Index" },
  { root: "MYM",  name: "Micro E-mini Dow",         class: "Equity Index" },
  { root: "YM",   name: "E-mini Dow",               class: "Equity Index" },
  { root: "M2K",  name: "Micro E-mini Russell 2000",class: "Equity Index" },
  { root: "RTY",  name: "E-mini Russell 2000",      class: "Equity Index" },
  { root: "MGC",  name: "Micro Gold",               class: "Metals" },
  { root: "GC",   name: "Gold",                     class: "Metals" },
  { root: "SI",   name: "Silver",                   class: "Metals" },
  { root: "HG",   name: "Copper",                   class: "Metals" },
  { root: "CL",   name: "WTI Crude Oil",            class: "Energy" },
  { root: "MNG",  name: "Micro Natural Gas",        class: "Energy" },
  { root: "NG",   name: "Natural Gas",              class: "Energy" },
  { root: "RB",   name: "RBOB Gasoline",            class: "Energy" },
  { root: "HO",   name: "Heating Oil",              class: "Energy" },
  { root: "EURUSD", name: "Euro / USD",             class: "FX" },
  { root: "6E",   name: "Euro FX",                  class: "FX" },
  { root: "GBPUSD",name: "Pound / USD",             class: "FX" },
  { root: "6B",   name: "British Pound",            class: "FX" },
  { root: "AUDUSD",name: "Aussie / USD",            class: "FX" },
  { root: "6A",   name: "Australian Dollar",        class: "FX" },
  { root: "USDJPY",name: "USD / Yen",               class: "FX" },
  { root: "6J",   name: "Japanese Yen",             class: "FX" },
];

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? JSON.parse(raw) : ["MNQ", "MGC", "EURUSD"];
  } catch { return ["MNQ", "MGC", "EURUSD"]; }
}
function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [query, setQuery] = useState("");

  useEffect(() => saveWatchlist(watchlist), [watchlist]);

  const suggestions = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    return SYMBOL_REGISTRY
      .filter(s => (s.root + " " + s.name).toUpperCase().includes(q))
      .filter(s => !watchlist.includes(s.root))
      .slice(0, 10);
  }, [query, watchlist]);

  const add = (root) => {
    setWatchlist(prev => prev.includes(root) ? prev : [...prev, root]);
    setQuery("");
  };
  const remove = (root) => setWatchlist(prev => prev.filter(r => r !== root));
  const move = (root, delta) => {
    setWatchlist(prev => {
      const idx = prev.indexOf(root);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + delta;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

  const rows = watchlist.map(root => {
    const meta = SYMBOL_REGISTRY.find(s => s.root === root) || { root, name: root, class: "Unknown" };
    const st = assetStatus(root);
    return { ...meta, status: st };
  });

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Eye className="w-7 h-7 text-blue-500"/> Watchlist
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Your favourite symbols. Session status shows live from the CME hours calendar. The ticker tape scrolls this list across the top of the dashboard.
          </p>
        </header>

        {/* Task #111 — Symbol search autocomplete */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-400"/> Add a symbol
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Input value={query}
                     onChange={e => setQuery(e.target.value)}
                     placeholder="Type MNQ, ES, GC, EURUSD…"
                     className="bg-slate-950 border-slate-700 text-white uppercase"/>
              {suggestions.length > 0 && (
                <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-slate-950 border border-slate-700 rounded-md shadow-xl max-h-72 overflow-y-auto">
                  {suggestions.map(s => (
                    <button key={s.root}
                            onClick={() => add(s.root)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-baseline gap-2 border-t border-slate-800 first:border-t-0">
                      <span className="font-mono font-bold text-white w-16">{s.root}</span>
                      <span className="text-slate-300 text-sm flex-1">{s.name}</span>
                      <Badge className="bg-slate-700 text-slate-200 text-[10px] uppercase tracking-wider">{s.class}</Badge>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Watchlist rows */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-baseline gap-2">
              Symbols <span className="text-slate-500 text-xs font-normal">· {rows.length} tracked</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="text-slate-500 text-sm px-4 py-6">Watchlist empty — search above to add your first.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {rows.map((r, i) => (
                  <WatchlistRow key={r.root} row={r} idx={i} total={rows.length}
                                onRemove={() => remove(r.root)}
                                onMove={(d) => move(r.root, d)}/>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ticker tape preview */}
        {rows.length > 0 && <TickerTape rows={rows}/>}
      </div>
    </div>
  );
}

function WatchlistRow({ row, idx, total, onRemove, onMove }) {
  const { menuProps, menu } = useContextMenu([
    { header: `${row.root} · ${row.name}` },
    idx > 0 && { label: "Move up",     onClick: () => onMove(-1) },
    idx < total - 1 && { label: "Move down", onClick: () => onMove(1) },
    { label: "Open in TradingView",
      icon: <ExternalLink className="w-4 h-4"/>,
      onClick: () => window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(row.root)}`, "_blank", "noopener,noreferrer") },
    { separator: true },
    { label: "Remove from watchlist", icon: <Trash2 className="w-4 h-4"/>, onClick: onRemove, danger: true },
  ].filter(Boolean));

  const st = row.status;
  const stateBadge = st.state === "open" ? "bg-emerald-600 text-white"
                   : st.state === "break" ? "bg-slate-600 text-white"
                   : st.state === "weekend" ? "bg-slate-600 text-white"
                   : st.state === "holiday" ? "bg-red-600 text-white"
                   : "bg-slate-700 text-white";

  return (
    <>
    <div {...menuProps} className="px-3 py-2.5 hover:bg-slate-950/60 flex items-center gap-3 text-sm">
      <span className="font-mono font-bold text-white w-16 shrink-0">{row.root}</span>
      <span className="text-slate-300 flex-1 truncate">{row.name}</span>
      <Badge className="bg-slate-700 text-slate-200 text-[10px] uppercase tracking-wider hidden md:inline-flex">{row.class}</Badge>
      <Badge className={`${stateBadge} text-[10px] uppercase tracking-wider`}>{st.state}</Badge>
      <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(row.root)}`}
         target="_blank" rel="noopener noreferrer"
         className="text-slate-400 hover:text-white shrink-0">
        <ExternalLink className="w-4 h-4"/>
      </a>
      <button onClick={onRemove} className="text-slate-500 hover:text-red-400 shrink-0">
        <Trash2 className="w-4 h-4"/>
      </button>
    </div>
    {menu}
    </>
  );
}

// Task #113 — Ticker tape scroll. Static per-symbol tiles, marquee via
// CSS. When market data lands (#17) each tile gets live last / change.
function TickerTape({ rows }) {
  return (
    <Card className="bg-slate-900 border-slate-800 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-sm flex items-center gap-2">
          Ticker tape preview
          <span className="text-slate-500 text-xs font-normal">· goes above the dashboard once market data (#17) is wired</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 border-t border-slate-800 bg-slate-950">
        <div className="whitespace-nowrap overflow-hidden py-2">
          <div className="inline-flex gap-6 animate-[ttscroll_45s_linear_infinite]" style={{ paddingLeft: "100%" }}>
            {[...rows, ...rows].map((r, i) => (
              <span key={i} className="inline-flex items-baseline gap-2 text-sm">
                <span className="font-mono font-bold text-white">{r.root}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-300 text-xs">last —</span>
                <span className="text-slate-500 text-xs">chg —</span>
              </span>
            ))}
          </div>
        </div>
        <style>{`
          @keyframes ttscroll {
            0%   { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      </CardContent>
    </Card>
  );
}
