import React, { useState, useEffect, useMemo } from "react";
import { Trade, Account, PositionControl, KillSwitch, Group } from "@/entities/all";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, TrendingDown, Radio, Activity, Shield, X,
  AlertTriangle, Users, Clock
} from "lucide-react";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { isObserveMode, OBSERVE_TOOLTIP, OBSERVE_BADGE_LABEL, isUnprotected, UNPROTECTED_MESSAGE } from "@/lib/broker_mode";

const REFRESH_MS = 15_000;
const TICK = { MNQ: 0.25, NQ: 0.25, MES: 0.25, ES: 0.25, M2K: 0.10, RTY: 0.10, MYM: 1, YM: 1, MGC: 0.10, GC: 0.10, CL: 0.01, MNG: 0.001, NG: 0.001 };
const PV   = { MNQ: 2,    NQ: 20,   MES: 5,    ES: 50,   M2K: 5,    RTY: 50,   MYM: 0.5, YM: 5, MGC: 10, GC: 100, CL: 1000, MNG: 1000, NG: 10000 };
function symKey(sym) {
  const u = (sym || "").toUpperCase();
  return Object.keys(TICK).find(k => u.startsWith(k)) || null;
}
function tickOf(sym) { return TICK[symKey(sym)] ?? 0.0001; }
function pvOf(sym)   { return PV[symKey(sym)] ?? null; }
function fmtMoney(n) {
  if (n == null || isNaN(n)) return "—";
  const s = n >= 0 ? "+$" : "-$";
  return `${s}${Math.abs(n).toFixed(2)}`;
}
function tvUrl(sym) {
  const s = (sym || "").replace(/1!$/, "");
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(s)}`;
}

// ────────────────────────────────────────────────────────────────
// Simple status pill — same restrained palette as Dashboard.
// ────────────────────────────────────────────────────────────────
function StatusPill({ text, tone }) {
  const cls =
    tone === "active" ? "text-slate-300 border-slate-600 bg-slate-800"
    : tone === "hit"  ? "text-emerald-300 border-emerald-700/50 bg-emerald-900/20"
    :                    "text-slate-500 border-slate-800";
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${cls} whitespace-nowrap`}>
      {text}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// Top stats row — reuses the Dashboard's big-number stat style
// ────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub, valueColor }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</div>
      <div className={`text-3xl font-bold font-mono tabular-nums ${valueColor || "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-2">{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// The main position card. Mirrors the Dashboard's LiveTradeBracketCard
// but shown for every open trade. Big-font + muted palette per user feedback.
// ────────────────────────────────────────────────────────────────
function PositionCard({ trade, account, group, allAccounts, strategy }) {
  const [busy, setBusy] = useState(false);
  const isLong = (trade.direction || trade.side || "").toLowerCase() === "long";
  const dir    = isLong ? "LONG" : "SHORT";
  const qty    = trade.qty_open ?? trade.qty_total ?? 0;
  const total  = trade.qty_total ?? qty;
  const stop   = trade.stop_loss ?? trade.stop_price ?? null;
  const entry  = trade.entry_price ?? null;
  const pnl    = trade.profit_loss ?? 0;
  const symbol = trade.symbol || trade.ticker || "?";
  const isManual = trade.broker === "manual" || (!strategy && !trade.strategy_id);
  const pending  = qty === 0 || (trade.status || "").toLowerCase() === "pending";
  const tickSz = tickOf(symbol);
  const pv     = pvOf(symbol);

  const tag = isManual
    ? (pending ? "Manual Trade Manager (pending)" : "Manual Trade Manager (live)")
    : (pending ? "Automation (pending)" : "Automation (live)");

  const tpHit = (lvl) => (lvl && entry && stop) ? (isLong ? stop >= lvl : stop <= lvl) : false;
  const tpGain = (lvl, q) => (lvl && entry && pv) ? Math.round(Math.abs(lvl - entry) * pv * (q || 1)) : null;

  const rows = [
    { role: "STOP",  price: stop,  qty: qty || total, kind: "stop" },
    { role: "ENTRY", price: entry, qty: total,        kind: "entry" },
    { role: "TP1",   price: trade.take_profit_1 ?? null, qty: trade.tp1_qty || 0, kind: "tp", hit: tpHit(trade.take_profit_1), gain: tpGain(trade.take_profit_1, trade.tp1_qty) },
    { role: "TP2",   price: trade.take_profit_2 ?? null, qty: trade.tp2_qty || 0, kind: "tp", hit: tpHit(trade.take_profit_2), gain: tpGain(trade.take_profit_2, trade.tp2_qty) },
    { role: "TP3",   price: trade.take_profit_3 ?? null, qty: trade.tp3_qty || 0, kind: "tp", hit: tpHit(trade.take_profit_3), gain: tpGain(trade.take_profit_3, trade.tp3_qty) },
    { role: "RUNNER", price: null, qty: trade.runner_qty || 0, kind: "runner", hit: false },
  ];

  const memberAccts = (group?.members || []).map(m => allAccounts.find(a => a.id === m.account_id)).filter(Boolean);
  const rotationRule = group ? [
    group.max_daily_wins ? `${group.max_daily_wins}W` : null,
    group.max_daily_losses ? `${group.max_daily_losses}L` : null,
    group.max_daily_profit ? `$${group.max_daily_profit}` : null,
    group.max_daily_loss ? `-$${group.max_daily_loss}` : null,
  ].filter(Boolean).join(" or ") : null;
  const timeWindow = (group?.time_windows?.length ? group.time_windows : account?.time_windows) || null;
  const timeText = timeWindow ? timeWindow.map(w => `${w.start}–${w.end}`).join(", ") : null;

  // Observe mode: the primary broker (PMT / TradersPost) owns execution.
  // TradeCore is a passive listener and cannot send orders. All writing
  // actions below are hard-gated so an accidental click can't route.
  const observe = isObserveMode(account);
  const gateGuard = () => {
    if (!observe) return false;
    alert(OBSERVE_TOOLTIP);
    return true;
  };

  const nudgeSL = async (t) => {
    if (busy || !stop || gateGuard()) return;
    setBusy(true);
    try { await PositionControl.modify(trade.id, { stop_price: +(stop + t * tickSz).toFixed(5), stop_source: `MANUAL_UI:${t > 0 ? "+" : ""}${t}t` }); }
    catch (e) { alert(`SL nudge failed: ${e.message}`); }
    setBusy(false);
  };
  const slToBE = async () => {
    if (busy || !entry || gateGuard()) return;
    setBusy(true);
    try { await PositionControl.modify(trade.id, { stop_price: entry, stop_source: "MANUAL_UI:BE" }); }
    catch (e) { alert(`SL→BE failed: ${e.message}`); }
    setBusy(false);
  };
  const closeAll = async () => {
    if (busy || gateGuard()) return;
    if (!window.confirm(`Close ALL of ${symbol}?`)) return;
    setBusy(true);
    try { await PositionControl.close(trade.id, null, "manual_close"); }
    catch (e) { alert(`Close failed: ${e.message}`); }
    setBusy(false);
  };
  const closeHalf = async () => {
    if (busy || qty < 2 || gateGuard()) return;
    setBusy(true);
    try { await PositionControl.close(trade.id, Math.max(1, Math.floor(qty / 2)), "manual_half"); }
    catch (e) { alert(`Close half failed: ${e.message}`); }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-baseline gap-2 flex-wrap">
        <span className="text-base font-semibold text-slate-100">
          {isManual ? "Manual" : "Automation"} · {symbol}
        </span>
        <span className="text-sm text-slate-500 italic">{tag}</span>
        <span className="ml-auto text-lg font-bold font-mono tabular-nums"
              style={{ color: pnl > 0 ? "rgb(110,231,183)" : pnl < 0 ? "rgb(252,165,165)" : "rgb(148,163,184)" }}>
          {fmtMoney(pnl)}
        </span>
      </div>

      {/* Side / Asset */}
      <div className="px-4 py-3 border-b border-slate-800/60 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <div><span className="text-slate-500 uppercase tracking-wider text-xs mr-2">SIDE:</span>
          <span className={`font-mono font-semibold ${isLong ? "text-emerald-300" : "text-rose-300"}`}>{dir}</span>
          <span className="text-slate-500 ml-2 font-mono">
            {qty}{total !== qty && <span className="text-slate-600">/{total}</span>}ct
          </span>
        </div>
        <div><span className="text-slate-500 uppercase tracking-wider text-xs mr-2">ASSET:</span>
          <span className="font-mono text-slate-300">{symKey(symbol) || symbol}</span>
        </div>
        {account && (
          <div><span className="text-slate-500 uppercase tracking-wider text-xs mr-2">ACCT:</span>
            <span className="font-mono text-slate-300">{account.name}</span>
          </div>
        )}
      </div>

      {/* Bracket ladder — larger, cleaner */}
      <div className="px-4 py-3 space-y-2 bg-slate-950/40 font-mono text-sm">
        {rows.map((r, i) => {
          const isStop  = r.kind === "stop";
          const isEntry = r.kind === "entry";
          const isTp    = r.kind === "tp";
          const isRun   = r.kind === "runner";
          const roleCls =
            isStop  ? "text-rose-400"
            : isEntry ? "text-slate-100"
            : isTp && r.hit ? "text-emerald-400"
            : isTp    ? "text-slate-400"
            : isRun && r.hit ? "text-emerald-400"
            :           "text-slate-400";
          const priceCls =
            isStop  ? "text-rose-200"
            : isEntry ? "text-slate-100 font-semibold"
            : isTp && r.hit ? "text-emerald-200"
            : isTp    ? "text-slate-300"
            :           "text-slate-500";
          let status, tone;
          if (isStop || isEntry)  { status = "ACTIVE"; tone = "active"; }
          else if (isTp && r.hit) { status = r.gain != null ? `✅ +$${r.gain}` : "✅ HIT"; tone = "hit"; }
          else if (isTp)          { status = "X Pending"; tone = "pending"; }
          else if (isRun && r.hit){ status = "HIT"; tone = "hit"; }
          else                    { status = "X Pending"; tone = "pending"; }
          return (
            <div key={i} className="grid grid-cols-[70px_1fr_60px_auto] items-center gap-3">
              <span className={`text-sm font-semibold ${roleCls}`}>{r.role}</span>
              <span className={`text-right tabular-nums text-base ${priceCls}`}>
                {r.price != null ? r.price.toFixed(2) : "—"}
              </span>
              <span className="text-slate-500 tabular-nums text-right text-sm">#{r.qty}</span>
              <StatusPill text={status} tone={tone}/>
            </div>
          );
        })}
      </div>

      {/* Accounts + rotation + times */}
      <div className="px-4 py-3 border-t border-slate-800/60 text-sm space-y-1.5">
        <div className="flex items-baseline gap-2">
          <Users className="w-4 h-4 text-slate-500 shrink-0"/>
          <span className="text-xs uppercase tracking-wider text-slate-500">Accounts</span>
          {rotationRule && <span className="text-slate-400 text-xs">rotation {rotationRule}</span>}
        </div>
        <div className="pl-6 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-slate-300 text-sm">
          {memberAccts.length > 0
            ? memberAccts.map(a => <span key={a.id}>{a.name}<span className="text-slate-600 ml-1">×{a.multiplier ?? 1}</span></span>)
            : account ? <span>{account.name}<span className="text-slate-600 ml-1">×{account.multiplier ?? 1}</span></span>
            : <span className="text-slate-500">—</span>}
        </div>
        {timeText && (
          <div className="flex items-baseline gap-2 pt-1">
            <Clock className="w-4 h-4 text-slate-500 shrink-0"/>
            <span className="text-xs uppercase tracking-wider text-slate-500">Times</span>
            <span className="font-mono text-slate-300 text-sm">{timeText}</span>
          </div>
        )}
      </div>

      {/* UNPROTECTED POSITION — red urgent banner (task #178). */}
      {isUnprotected(trade) && (
        <div className="border-t-2 border-red-500 bg-red-950/40 px-4 py-2 flex items-center gap-2 animate-pulse">
          <span className="text-lg shrink-0">🚨</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-red-200 uppercase tracking-wider">Unprotected position</div>
            <div className="text-xs text-red-300/90 leading-tight">
              {observe
                ? "No working stop at broker — set one in your primary broker's UI (PMT/TradersPost)."
                : UNPROTECTED_MESSAGE}
            </div>
          </div>
          {!observe && entry && (
            <button onClick={slToBE} disabled={busy}
                    className="shrink-0 h-8 px-3 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold border border-red-400">
              SL → BE now
            </button>
          )}
        </div>
      )}

      {/* Observe-mode notice — writing actions are gated when the underlying
          account is passive (PMT / TradersPost owns execution). */}
      {observe && (
        <div className="px-4 py-2 border-t border-emerald-800/40 bg-emerald-950/20 text-xs text-emerald-200 flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 shrink-0"/>
          <span className="font-semibold">{OBSERVE_BADGE_LABEL}.</span>
          <span className="text-emerald-300/80">Connect a Tradovate-direct account to enable Close/SL actions.</span>
        </div>
      )}

      {/* Action row — bigger buttons, less color */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex flex-wrap items-center gap-2">
        <button onClick={closeAll} disabled={busy || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                className="h-9 px-4 rounded-md bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-rose-200 border border-rose-800/60 text-sm font-semibold">
          Close All
        </button>
        <button onClick={closeHalf} disabled={busy || qty < 2 || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                className="h-9 px-4 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 text-sm">
          Close ½
        </button>
        <button onClick={slToBE} disabled={busy || !entry || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                className="h-9 px-4 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 text-sm">
          SL → BE
        </button>
        {[-5, 5].map(t => (
          <button key={t} onClick={() => nudgeSL(t)} disabled={busy || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                  className="h-9 px-3 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 border border-slate-700 text-sm">
            {t > 0 ? `+${t}t` : `${t}t`}
          </button>
        ))}
        <a href={tvUrl(symbol)} target="_blank" rel="noopener noreferrer"
           className="ml-auto text-sm text-slate-400 hover:text-slate-100">
          TradingView →
        </a>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// PAGE
// ────────────────────────────────────────────────────────────────
export default function LivePositions() {
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [killSwitch, setKillSwitch] = useState({ on: false, reason: null });
  const { connected } = useLiveEvents();

  const load = async () => {
    try {
      const [tr, ac, gr, an, ks] = await Promise.all([
        Trade.list("-entry_time", 100).catch(() => []),
        Account.list().catch(() => []),
        Group.list().catch(() => []),
        api("/api/analytics").catch(() => null),
        KillSwitch.status().catch(() => ({ on: false })),
      ]);
      setTrades((tr || []).filter(t => {
        const s = (t.status || "").toLowerCase();
        return s !== "closed" && s !== "cancelled";
      }));
      setAccounts(ac || []);
      setGroups(gr || []);
      setAnalytics(an);
      setKillSwitch({ on: !!ks?.on, reason: ks?.reason });
    } catch { /* silent — page still renders */ }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const acctById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const groupByName = useMemo(() => new Map(groups.map(g => [g.name, g])), [groups]);

  const a = analytics || {};
  const totalOpen = trades.reduce((s, t) => s + (t.profit_loss || 0), 0);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-[1400px] mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-3">
              <Activity className="w-8 h-8 text-emerald-500"/>
              Live Positions
            </h1>
            <p className="text-slate-400 mt-1 text-base">
              Every open trade across every account — updates every 15 seconds.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <Radio className={`w-5 h-5 ${connected ? "text-emerald-500" : "text-slate-500"}`}/>
              <span className={connected ? "text-emerald-400" : "text-slate-500"}>{connected ? "Live" : "Offline"}</span>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-slate-500">Open P&amp;L</div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${totalOpen > 0 ? "text-emerald-300" : totalOpen < 0 ? "text-rose-300" : "text-slate-300"}`}>
                {fmtMoney(totalOpen)}
              </div>
            </div>
          </div>
        </div>

        {/* Big stat tiles — same style as Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile
            label="Today"
            value={fmtMoney(a.today_pnl ?? 0)}
            sub={`${a.today_wins ?? 0}W / ${a.today_losses ?? 0}L · ${a.today_win_rate ?? 0}%`}
            valueColor={(a.today_pnl ?? 0) > 0 ? "text-emerald-300" : (a.today_pnl ?? 0) < 0 ? "text-rose-300" : "text-slate-100"}
          />
          <StatTile
            label="Week"
            value={fmtMoney(a.week_pnl ?? 0)}
            sub={`${a.week_wins ?? 0}W / ${a.week_losses ?? 0}L · ${a.week_win_rate ?? 0}%`}
            valueColor={(a.week_pnl ?? 0) > 0 ? "text-emerald-300" : (a.week_pnl ?? 0) < 0 ? "text-rose-300" : "text-slate-100"}
          />
          <StatTile
            label="All Time"
            value={fmtMoney(a.net_profit ?? 0)}
            sub={`${a.total_trades ?? 0} trades · ${a.win_rate ?? 0}% WR`}
            valueColor={(a.net_profit ?? 0) > 0 ? "text-emerald-300" : (a.net_profit ?? 0) < 0 ? "text-rose-300" : "text-slate-100"}
          />
          <StatTile
            label="Open"
            value={`${trades.length}`}
            sub={`Streak ${a.current_streak > 0 ? `${a.current_streak}W` : a.current_streak < 0 ? `${Math.abs(a.current_streak)}L` : "0"} · Max DD $${(a.max_drawdown ?? 0).toFixed(0)}`}
          />
        </div>

        {/* Kill switch banner */}
        {killSwitch.on && (
          <div className="bg-rose-950/30 border border-rose-800/60 rounded-xl px-5 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400"/>
            <span className="text-rose-200 font-semibold">Kill Switch engaged</span>
            {killSwitch.reason && <span className="text-rose-300/70">— {killSwitch.reason}</span>}
          </div>
        )}

        {/* Positions grid */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-100">Active Positions</h2>
            <span className="text-sm text-slate-500">{trades.length} open</span>
          </div>
          {trades.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800 border-dashed">
              <CardContent className="p-10 text-center">
                <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4"/>
                <p className="text-slate-300 text-base">No open positions right now.</p>
                <p className="text-sm text-slate-500 mt-2">
                  Trades from your Pine indicators will appear here as they fire.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {trades.map(t => (
                <PositionCard
                  key={t.id}
                  trade={t}
                  account={acctById.get(t.account_id)}
                  group={groupByName.get(t.group_name)}
                  allAccounts={accounts}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
