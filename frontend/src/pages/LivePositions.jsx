import React, { useState, useEffect, useMemo } from "react";
import { Trade, Account, PositionControl } from "@/entities/all";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, Zap, Clock, CheckCircle2, Circle,
  Radio, Activity, Target, Shield, X, Move, Edit3, Minus, Plus
} from "lucide-react";
import { Input } from "@/components/ui/input";
import TradingViewChart from "@/components/TradingViewChart";
import { useLiveEvents } from "@/hooks/useLiveEvents";

const REFRESH_MS = 15_000;  // fallback poll if websocket isn't delivering
const TP_PULSE_MS = 4000;   // how long the TP-hit celebration animation runs

function formatTimeInTrade(entryTime) {
  if (!entryTime) return "—";
  const ms = Date.now() - new Date(entryTime).getTime();
  if (ms < 0) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

/** One live position card — the star of the show. Pulses green when a TP hits.
    Task #107 adds inline SL editing + Close buttons — real-time via WebSocket. */
function LivePositionCard({ trade, accountName, onSelect, isSelected, tpJustHit, onModified }) {
  const [editingSL, setEditingSL] = useState(false);
  const [editSL, setEditSL] = useState(trade.stop_loss || "");
  const [busy, setBusy] = useState(false);

  const tickSize = trade.symbol?.startsWith("MNQ") || trade.symbol?.startsWith("NQ") ? 0.25 :
                   trade.symbol?.startsWith("MES") || trade.symbol?.startsWith("ES") ? 0.25 :
                   trade.symbol?.startsWith("GC") ? 0.1 :
                   trade.symbol?.startsWith("CL") ? 0.01 :
                   0.0001;  // forex default

  const nudgeSL = async (ticks) => {
    if (busy) return;
    setBusy(true);
    try {
      const cur = trade.stop_loss ?? trade.entry_price ?? 0;
      const newSL = +(cur + ticks * tickSize).toFixed(5);
      await PositionControl.modify(trade.id, { stop_price: newSL, stop_source: `MANUAL_UI:${ticks > 0 ? "+" : ""}${ticks}t` });
      if (onModified) onModified();
    } catch (e) { alert(`Move SL failed: ${e.message}`); }
    setBusy(false);
  };
  const moveSLToBE = async () => {
    if (busy || !trade.entry_price) return;
    setBusy(true);
    try {
      await PositionControl.modify(trade.id, { stop_price: trade.entry_price, stop_source: "MANUAL_UI:BE" });
      if (onModified) onModified();
    } catch (e) { alert(`Move to BE failed: ${e.message}`); }
    setBusy(false);
  };
  const saveEditedSL = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await PositionControl.modify(trade.id, { stop_price: +editSL, stop_source: "MANUAL_UI:INPUT" });
      setEditingSL(false);
      if (onModified) onModified();
    } catch (e) { alert(`Save SL failed: ${e.message}`); }
    setBusy(false);
  };
  const closePosition = async (qty = null, reason = "manual_close") => {
    if (busy) return;
    if (!window.confirm(qty ? `Close ${qty} contracts of ${trade.symbol}?` : `Close ALL ${trade.symbol}?`)) return;
    setBusy(true);
    try {
      await PositionControl.close(trade.id, qty, reason);
      if (onModified) onModified();
    } catch (e) { alert(`Close failed: ${e.message}`); }
    setBusy(false);
  };

  const isLong = (trade.direction || trade.side || "").toLowerCase() === "long";
  const pnl = trade.profit_loss ?? 0;
  const pnlColor = pnl > 0 ? "text-green-400" : pnl < 0 ? "text-red-400" : "text-slate-400";
  const pnlBg = pnl > 0 ? "bg-green-500/10" : pnl < 0 ? "bg-red-500/10" : "bg-slate-800";

  // TP progress — hit if exit_price crossed the tp level in the right direction
  const tpHit = (level) => {
    if (!level || !trade.entry_price) return false;
    // Best proxy: any TP <= current stop_loss means "we already locked past it"
    // For a real live check we'd need current price. Use stop_price as approximation.
    if (isLong) return trade.stop_loss && trade.stop_loss >= level;
    return trade.stop_loss && trade.stop_loss <= level;
  };
  const tps = [
    { n: 1, level: trade.take_profit_1, hit: tpHit(trade.take_profit_1) },
    { n: 2, level: trade.take_profit_2, hit: tpHit(trade.take_profit_2) },
    { n: 3, level: trade.take_profit_3, hit: tpHit(trade.take_profit_3) },
  ].filter(t => t.level);

  return (
    <Card
      onClick={onSelect}
      className={`bg-slate-900 border-slate-800 cursor-pointer transition-all hover:border-blue-500/50 ${
        isSelected ? "border-blue-500 shadow-lg shadow-blue-500/20" : ""
      } ${tpJustHit ? "animate-pulse ring-2 ring-green-500/70 shadow-lg shadow-green-500/50" : ""}`}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-lg">{trade.symbol}</span>
              <Badge variant="outline" className={
                isLong ? "bg-green-500/20 text-green-400 border-green-500/50"
                       : "bg-red-500/20 text-red-400 border-red-500/50"
              }>
                {isLong ? <TrendingUp className="w-3 h-3 mr-1"/> : <TrendingDown className="w-3 h-3 mr-1"/>}
                {isLong ? "LONG" : "SHORT"}
              </Badge>
              {trade.status === "open" && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{accountName || "—"}</div>
          </div>
          <div className={`text-right ${pnlBg} px-3 py-1.5 rounded-lg`}>
            <div className={`font-bold text-lg ${pnlColor}`}>
              {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 uppercase">P&L</div>
          </div>
        </div>

        <div className="flex gap-3 text-xs items-center">
          <div><span className="text-slate-500">Entry</span> <span className="text-slate-300 ml-1 font-mono">{trade.entry_price?.toFixed(2)}</span></div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">SL</span>
            {editingSL ? (
              <>
                <Input type="number" step={tickSize} value={editSL}
                       onChange={e => setEditSL(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter") saveEditedSL(); if (e.key === "Escape") setEditingSL(false); }}
                       onClick={e => e.stopPropagation()}
                       className="bg-slate-800 border-slate-700 text-white h-6 w-24 px-1.5 text-xs font-mono"/>
                <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy}
                        onClick={e => { e.stopPropagation(); saveEditedSL(); }}>
                  <CheckCircle2 className="w-3 h-3 text-green-500"/>
                </Button>
              </>
            ) : (
              <span onClick={e => { e.stopPropagation(); setEditingSL(true); setEditSL(trade.stop_loss || ""); }}
                    className="text-slate-300 ml-1 font-mono cursor-pointer hover:text-blue-400 hover:underline">
                {trade.stop_loss?.toFixed(2) || "—"}
                <Edit3 className="w-3 h-3 inline ml-0.5 opacity-50"/>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 ml-auto text-slate-400">
            <Clock className="w-3 h-3"/>{formatTimeInTrade(trade.entry_time)}
          </div>
        </div>

        {/* Task #107: quick-action buttons for TP/SL management */}
        <div className="flex flex-wrap gap-1 pt-1" onClick={e => e.stopPropagation()}>
          <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => nudgeSL(-5)}
                  className="h-6 text-xs px-2 border-slate-700">
            <Minus className="w-3 h-3"/>5t SL
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => nudgeSL(5)}
                  className="h-6 text-xs px-2 border-slate-700">
            <Plus className="w-3 h-3"/>5t SL
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !trade.entry_price}
                  onClick={moveSLToBE}
                  className="h-6 text-xs px-2 border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
            <Move className="w-3 h-3 mr-1"/>SL→BE
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !trade.qty_open || trade.qty_open < 2}
                  onClick={() => closePosition(Math.max(1, Math.floor((trade.qty_open || trade.qty_total || 1) / 2)), "manual_half")}
                  className="h-6 text-xs px-2 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10">
            Close ½
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => closePosition(null, "manual_close")}
                  className="h-6 text-xs px-2 border-red-500/30 text-red-400 hover:bg-red-500/10 ml-auto">
            <X className="w-3 h-3 mr-1"/>Close All
          </Button>
        </div>

        {tps.length > 0 && (
          <div className="flex gap-2 pt-1">
            {tps.map(tp => (
              <div key={tp.n}
                   className={`flex-1 flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
                     tp.hit
                       ? "bg-green-500/20 text-green-400 border border-green-500/50"
                       : "bg-slate-800 text-slate-400 border border-slate-700"
                   }`}>
                {tp.hit ? <CheckCircle2 className="w-3 h-3 shrink-0"/> : <Circle className="w-3 h-3 shrink-0"/>}
                <span className="text-[10px]">TP{tp.n}</span>
                <span className="font-mono ml-auto">{tp.level?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {(trade.group_name || trade.strategy_id) && (
          <div className="flex gap-1.5 pt-1">
            {trade.group_name && (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-[10px]">
                <Zap className="w-2.5 h-2.5 mr-1"/>{trade.group_name}
              </Badge>
            )}
            {trade.strategy_id && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-[10px]">
                Strategy #{trade.strategy_id}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LivePositions() {
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [tpHitFlash, setTpHitFlash] = useState({}); // { tradeId: expiresAt }
  const { events, connected } = useLiveEvents();

  const load = async () => {
    const [tradesData, accountsData] = await Promise.all([
      Trade.list("-entry_time", 100),
      Account.list(),
    ]);
    // Only "open" positions — case-insensitive since we lowercase in the API
    setTrades(tradesData.filter(t =>
      (t.status || "").toLowerCase() !== "closed" &&
      (t.status || "").toLowerCase() !== "cancelled"
    ));
    setAccounts(accountsData);
    // Pick a default chart symbol from the first open trade
    if (!selectedSymbol && tradesData[0]?.symbol) {
      setSelectedSymbol(tradesData[0].symbol);
    }
  };

  useEffect(() => { load(); }, []);

  // Poll every 15s as fallback (WebSocket handles between)
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Watch WebSocket events → refresh on state-changing events + flash TP hits
  useEffect(() => {
    const latest = events[0];
    if (!latest) return;
    const t = latest.type || latest.event;
    if (["position_update", "trade_update", "entry", "exit", "stop_update", "flat", "close"].includes(t?.toLowerCase?.())) {
      load();
    }
    if (t?.toLowerCase?.().includes("tp") || t?.toLowerCase?.().includes("take_profit")) {
      const tradeId = latest.trade_id || latest.id;
      if (tradeId) {
        setTpHitFlash(prev => ({...prev, [tradeId]: Date.now() + TP_PULSE_MS}));
        // Optional sound cue
        try {
          new Audio("data:audio/wav;base64,UklGRnoAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVYAAAA=").play().catch(() => {});
        } catch {}
      }
    }
  }, [events]);

  // Prune expired flashes
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTpHitFlash(prev => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) if (v > now) next[k] = v;
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const accountNameById = useMemo(() => {
    const m = new Map();
    accounts.forEach(a => m.set(a.id, a.name));
    return m;
  }, [accounts]);

  const totalPnl = trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
  const winning = trades.filter(t => (t.profit_loss || 0) > 0).length;

  return (
    <div className="p-4 md:p-6 bg-slate-950 min-h-screen">
      <div className="max-w-[1600px] mx-auto space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Activity className="w-8 h-8 text-green-500 animate-pulse"/>
              Live Positions
            </h1>
            <p className="text-slate-400">Every open trade across every account — updates in real time.</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Radio className={`w-4 h-4 ${connected ? "text-green-500" : "text-slate-500"}`}/>
              <span className={connected ? "text-green-400" : "text-slate-500"}>
                {connected ? "Live" : "Offline"}
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <div className="text-slate-400">Open: <span className="text-white font-bold">{trades.length}</span></div>
              <div className="text-slate-400">Winning: <span className="text-green-400 font-bold">{winning}</span></div>
              <div className="text-slate-400">Total P&L:
                <span className={`ml-1 font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main split — Chart on left, positions on right */}
        <div className="grid lg:grid-cols-3 gap-4 min-h-[70vh]">
          {/* Chart column — 2/3 width on desktop */}
          <div className="lg:col-span-2">
            <Card className="bg-slate-900 border-slate-800 h-full">
              <CardContent className="p-2 h-full min-h-[500px]">
                {selectedSymbol ? (
                  <TradingViewChart symbol={selectedSymbol} interval="5"/>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500">
                    <Target className="w-12 h-12 mb-4"/>
                    <p>Click any live position to load its chart here.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Positions column — 1/3 width on desktop */}
          <div className="space-y-3 overflow-y-auto lg:max-h-[calc(100vh-200px)] pr-1">
            <div className="text-xs uppercase text-slate-500 font-semibold tracking-wider px-1">
              🎯 Active Trades ({trades.length})
            </div>
            {trades.length === 0 ? (
              <Card className="bg-slate-900 border-slate-800 border-dashed">
                <CardContent className="p-8 text-center">
                  <Shield className="w-10 h-10 text-slate-600 mx-auto mb-3"/>
                  <p className="text-slate-400">No open positions right now.</p>
                  <p className="text-xs text-slate-500 mt-1">Signals from your Pine indicators will appear here as they fire.</p>
                </CardContent>
              </Card>
            ) : (
              trades.map(t => (
                <LivePositionCard
                  key={t.id}
                  trade={t}
                  accountName={accountNameById.get(t.account_id)}
                  isSelected={selectedSymbol === t.symbol}
                  tpJustHit={!!tpHitFlash[t.trade_id] || !!tpHitFlash[t.id]}
                  onSelect={() => setSelectedSymbol(t.symbol)}
                  onModified={load}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
