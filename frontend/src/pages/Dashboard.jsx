import React, { useState, useEffect, useMemo } from "react";
import { Account, Trade, Strategy, User, Group, PositionControl } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Plus,
  Activity,
  CheckSquare,
  Square,
  ListChecks,
  Sparkles,
  Zap,
  Clock,
  Users,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
  Files,
  X as XIcon
} from "lucide-react";
import { useContextMenu } from "@/components/RightClickMenu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import StatsCard from "../components/dashboard/StatsCard";
import RecentTrades from "../components/dashboard/RecentTrades";
import { isObserveMode, OBSERVE_TOOLTIP, OBSERVE_BADGE_LABEL, isUnprotected, UNPROTECTED_MESSAGE } from "@/lib/broker_mode";
import SessionPerformance from "../components/dashboard/SessionPerformance";
import AccountOverview from "../components/dashboard/AccountOverview";
import KillSwitchButton from "../components/KillSwitchButton";
import SLDriftDetector from "../components/SLDriftDetector";

// Rules checklist stores checked state per DAY in localStorage. Auto-resets
// at midnight (new day, new key, empty set). User can ALSO manually reset
// mid-day via the "Reset for new session" button — useful for morning /
// London / NY / evening sessions on the same date.
function useRulesChecklist() {
  const dateKey = new Date().toISOString().slice(0, 10);
  const storageKey = `tradecore:rules:${dateKey}`;
  const [checked, setChecked] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]')); }
    catch { return new Set(); }
  });
  const toggle = (idx) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };
  const reset = () => {
    setChecked(new Set());
    localStorage.setItem(storageKey, "[]");
  };
  return [checked, toggle, reset];
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, toggleRule, resetRules] = useRulesChecklist();

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // Refresh open trade data every 15s so the home page reflects live state
    const id = setInterval(() => loadData({ silent: true }), 15_000);
    return () => clearInterval(id);
  }, []);

  const loadData = async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    const [accountsData, tradesData, strategiesData, groupsData, userData] = await Promise.all([
      Account.list("-created_date"),
      Trade.list("-entry_time", 50),
      Strategy.list("-created_date"),
      Group.list().catch(() => []),
      User.me().catch(() => null),  // graceful if endpoint fails
    ]);
    setAccounts(accountsData);
    setTrades(tradesData);
    setStrategies(strategiesData);
    setGroups(groupsData || []);
    setUser(userData);
    if (!silent) setLoading(false);
  };

  const calculateStats = () => {
    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.current_balance || 0), 0);
    const totalStarting = accounts.reduce((sum, acc) => sum + (acc.starting_balance || 0), 0);
    const totalProfit = totalBalance - totalStarting;

    const closedTrades = trades.filter(t => t.status === "closed");
    const winningTrades = closedTrades.filter(t => (t.profit_loss || 0) > 0);
    const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

    const todayTrades = closedTrades.filter(t => {
      const tradeDate = new Date(t.exit_time || t.entry_time);
      const today = new Date();
      return tradeDate.toDateString() === today.toDateString();
    });
    const todayProfit = todayTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);

    const sessionStats = {};
    closedTrades.forEach(t => {
      if (!sessionStats[t.session]) {
        sessionStats[t.session] = { profit: 0, count: 0 };
      }
      sessionStats[t.session].profit += t.profit_loss || 0;
      sessionStats[t.session].count += 1;
    });

    const bestSession = Object.entries(sessionStats)
      .sort((a, b) => b[1].profit - a[1].profit)[0];

    return {
      totalBalance,
      totalProfit,
      profitPercentage: totalStarting > 0 ? (totalProfit / totalStarting) * 100 : 0,
      winRate,
      totalTrades: closedTrades.length,
      todayProfit,
      bestSession: bestSession ? bestSession[0] : "N/A",
      bestSessionProfit: bestSession ? bestSession[1].profit : 0
    };
  };

  const stats = calculateStats();

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-7 h-7 text-blue-400" />
              {user?.welcome_message || `Let's bank some coin ${user?.trader_name || 'Trader'}!! Stick to your rules`}
            </h1>
            <p className="text-slate-400">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — Here's your trading overview
            </p>
          </div>
          <div className="flex items-center gap-2">
            <KillSwitchButton />
            <Link to={createPageUrl("NewTrade")}>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
                <Plus className="w-5 h-5 mr-2" />
                New Trade
              </Button>
            </Link>
          </div>
        </div>

        {/* Rules checklist — daily commitment. Ticks reset at midnight
            via date-scoped localStorage key. */}
        {(user?.trading_rules?.length > 0) && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="border-b border-slate-800 py-4">
              <CardTitle className="text-lg text-white flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-blue-500" />
                Today's Rules
                <span className="text-sm font-normal text-slate-400 ml-auto">
                  {checked.size} / {user.trading_rules.length} committed
                </span>
                <button
                  onClick={resetRules}
                  disabled={checked.size === 0}
                  title="Reset for new session (London / NY / evening)"
                  className="ml-3 text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold disabled:opacity-40"
                >
                  Reset for new session
                </button>
                <Link to={createPageUrl("Settings")}
                      className="text-xs px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold">
                  Edit rules
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid md:grid-cols-2 gap-2">
                {user.trading_rules.map((rule, idx) => {
                  const isChecked = checked.has(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleRule(idx)}
                      className={`flex items-start gap-2 text-left p-3 rounded-lg transition-all ${
                        isChecked
                          ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                          : 'bg-slate-800 border border-slate-700 text-slate-300 hover:border-blue-500/50'
                      }`}
                    >
                      {isChecked
                        ? <CheckSquare className="w-4 h-4 mt-0.5 shrink-0"/>
                        : <Square className="w-4 h-4 mt-0.5 shrink-0"/>}
                      <span className={isChecked ? 'line-through opacity-70' : ''}>{rule}</span>
                    </button>
                  );
                })}
              </div>
              {checked.size === user.trading_rules.length && (
                <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded-lg text-center text-green-400 text-sm font-medium">
                  ✨ All rules committed — go make it happen!
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {/* If no rules yet, show a friendly prompt to add some in Settings */}
        {user && (!user.trading_rules || user.trading_rules.length === 0) && (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3 text-slate-400">
                <ListChecks className="w-5 h-5 text-slate-500" />
                <span className="text-sm">Add your personal trading rules in Settings — they'll show here as a daily checklist.</span>
              </div>
              <Link to={createPageUrl("Settings")}>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">Configure Rules</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Total Balance"
            value={`$${stats.totalBalance.toFixed(2)}`}
            icon={DollarSign}
            trend={`${stats.profitPercentage >= 0 ? '+' : ''}${stats.profitPercentage.toFixed(2)}%`}
            trendUp={stats.profitPercentage >= 0}
            bgGradient="from-blue-500 to-blue-600"
          />
          <StatsCard
            title="Total P&L"
            value={`$${stats.totalProfit.toFixed(2)}`}
            icon={stats.totalProfit >= 0 ? TrendingUp : TrendingDown}
            trend={`${stats.totalTrades} trades`}
            trendUp={stats.totalProfit >= 0}
            bgGradient={stats.totalProfit >= 0 ? "from-green-500 to-green-600" : "from-red-500 to-red-600"}
          />
          <StatsCard
            title="Win Rate"
            value={`${stats.winRate.toFixed(1)}%`}
            icon={Target}
            trend={`${stats.totalTrades} total`}
            trendUp={stats.winRate >= 50}
            bgGradient="from-purple-500 to-purple-600"
          />
          <StatsCard
            title="Today's P&L"
            value={`$${stats.todayProfit.toFixed(2)}`}
            icon={Activity}
            trend={stats.bestSession !== "N/A" ? `Best: ${stats.bestSession}` : "No data"}
            trendUp={stats.todayProfit >= 0}
            bgGradient="from-orange-500 to-orange-600"
          />
        </div>

        {/* Live Trades LEFT · Accounts RIGHT — both half-page, top row */}
        <div className="grid lg:grid-cols-2 gap-4">
          <LiveTradesSection
            trades={trades}
            accounts={accounts}
            groups={groups}
            strategies={strategies}
          />
          <AccountOverview accounts={accounts} loading={loading} />
        </div>

        {/* Recent Trades + Session Performance below, full width */}
        <div className="space-y-6">
          {/* Task #163 — SL-drift monitor: only mount when there are open
              trades so the dashboard doesn't grow a card that says
              "nothing to see" out of the box. */}
          {trades.some(t => t.status !== "closed" && t.status !== "cancelled") && (
            <SLDriftDetector trades={trades} />
          )}
          <RecentTrades trades={trades.slice(0, 10)} loading={loading} />
          <SessionPerformance trades={trades} />
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #180 — Live Trades on Dashboard
// Per-position bracket ladder cards (SIDE / STOP / ENTRY / TP1 / TP2 / TP3 /
// RUNNER) with account+group+rotation-rule+time-window meta. Refreshed
// every 15s by the Dashboard's polling loop.
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// Dashboard slots — user-managed list of trade cards.
// Persisted in localStorage. Defaults to 1 auto + 1 manual slot.
// Each slot has a title + wiring metadata the user can edit; when a
// live trade matches (by strategy binding or manual tag), that data
// populates the bracket ladder.
// ────────────────────────────────────────────────────────────────
const SLOTS_KEY = "tradecore_dashboard_slots_v2";
const BROKER_OPTIONS = [
  { value: "tradovate", label: "Tradovate" },
  { value: "rithmic",   label: "Rithmic" },
  { value: "ibkr",      label: "Interactive Brokers" },
  { value: "pmt",       label: "PickMyTrade" },
  { value: "tradersport", label: "TradersPost" },
  { value: "ctrader",   label: "cTrader" },
  { value: "mt5",       label: "MetaTrader 5" },
  { value: "simulated", label: "Simulated (paper)" },
];
const TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Tokyo",
  "UTC",
];
function blankSlot(overrides = {}) {
  return {
    id: `slot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: "New Trade Card",
    type: "automation",
    broker: "tradovate",
    side: "long",
    symbol: "MNQ1!",
    strategy_id: null,
    webhook_path: "",
    broker_account_id: "",
    token: "",
    // Editable bracket levels — used as planned targets on the card when no
    // real trade is bound. Real trade data overrides on the fly.
    bracket: {
      stop:   { enabled: true, price: 20141.00, qty: 2 },
      entry:  { enabled: true, price: 20120.50, qty: 2 },
      tp1:    { enabled: true, price: 20099.00, qty: 2 },
      tp2:    { enabled: true, price: 20079.00, qty: 2 },
      tp3:    { enabled: false, price: 20059.00, qty: 1 },
      runner: { enabled: true, qty: 1 },
    },
    accounts: [],  // list of { name, multiplier }
    rotation: { wins: 2, losses: 2, profit: 500, loss: 500 },
    time_windows: [
      { start: "18:00", end: "01:00" },
      { start: "11:45", end: "15:00" },
    ],
    timezone: "America/New_York",
    ...overrides,
  };
}
const DEFAULT_SLOTS = [
  blankSlot({ id: "auto-1",   title: "Automation (live)",   type: "automation" }),
  blankSlot({ id: "manual-1", title: "Manual Trade Manager", type: "manual", side: "long",
              bracket: {
                stop:   { enabled: true, price: 2648.20, qty: 3 },
                entry:  { enabled: true, price: 2650.40, qty: 3 },
                tp1:    { enabled: true, price: 2652.60, qty: 2 },
                tp2:    { enabled: true, price: 2654.80, qty: 1 },
                tp3:    { enabled: false, price: 0, qty: 0 },
                runner: { enabled: true, qty: 1 },
              }, symbol: "MGC1!" }),
];
function loadSlots() {
  try {
    const raw = localStorage.getItem(SLOTS_KEY);
    if (!raw) return DEFAULT_SLOTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_SLOTS;
  } catch { return DEFAULT_SLOTS; }
}
function saveSlots(slots) {
  localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
}

function useDashboardSlots() {
  const [slots, setSlots] = useState(loadSlots);
  const add = () => setSlots(prev => {
    const next = [...prev, {
      id: `slot-${Date.now()}`,
      title: "New Trade Card",
      type: "automation",
      symbol: "MNQ1!",
      webhook_path: "",
      broker_account_id: "",
      token: "",
      strategy_id: null,
    }];
    saveSlots(next); return next;
  });
  const update = (id, patch) => setSlots(prev => {
    const next = prev.map(s => s.id === id ? { ...s, ...patch } : s);
    saveSlots(next); return next;
  });
  const remove = (id) => setSlots(prev => {
    const next = prev.filter(s => s.id !== id);
    saveSlots(next); return next;
  });
  const duplicate = (id) => setSlots(prev => {
    const src = prev.find(s => s.id === id);
    if (!src) return prev;
    const { id: _drop, ...rest } = src;
    const clone = {
      ...rest,
      id: `slot-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: `${src.title || "Card"} (copy)`,
    };
    const next = [...prev, clone];
    saveSlots(next); return next;
  });
  return { slots, add, update, remove, duplicate };
}

// Sample trade built from the slot's own bracket config so the card ALWAYS
// reflects what the user set. When a real live trade matches, it overrides.
function sampleTradeForSlot(slot) {
  const b = slot.bracket || {};
  const isLong = slot.side === "long";
  return {
    __sample: true, id: slot.id,
    symbol: slot.symbol || "MNQ1!",
    ticker: slot.symbol || "MNQ1!",
    side: isLong ? "LONG" : "SHORT",
    direction: slot.side || "long",
    qty_open: b.entry?.qty || 0,
    qty_total: b.entry?.qty || 0,
    entry_price: b.entry?.enabled ? b.entry?.price : null,
    stop_loss:   b.stop?.enabled  ? b.stop?.price  : null,
    take_profit_1: b.tp1?.enabled ? b.tp1?.price   : null,
    take_profit_2: b.tp2?.enabled ? b.tp2?.price   : null,
    take_profit_3: b.tp3?.enabled ? b.tp3?.price   : null,
    tp1_qty: b.tp1?.enabled ? (b.tp1?.qty || 0) : 0,
    tp2_qty: b.tp2?.enabled ? (b.tp2?.qty || 0) : 0,
    tp3_qty: b.tp3?.enabled ? (b.tp3?.qty || 0) : 0,
    runner_qty: b.runner?.enabled ? (b.runner?.qty || 0) : 0,
    profit_loss: 0,
    strategy_id: slot.strategy_id,
    broker: slot.type === "manual" ? "manual" : slot.broker,
  };
}

function LiveTradesSection({ trades, accounts, groups, strategies }) {
  const acctById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
  const stratById = useMemo(() => new Map(strategies.map(s => [s.id, s])), [strategies]);
  const groupByName = useMemo(() => new Map(groups.map(g => [g.name, g])), [groups]);
  const { slots, add, update, remove, duplicate } = useDashboardSlots();
  const [editingSlot, setEditingSlot] = useState(null);

  // Bind each slot to a live trade if one matches the slot's criteria
  // (automation → any non-manual open trade; manual → any manual open trade).
  // Users can later refine this to match by strategy_id or account_id.
  const openTrades = useMemo(() => {
    const open = trades.filter(t => {
      const s = (t.status || "").toLowerCase();
      return s !== "closed" && s !== "cancelled";
    });
    const isManual = (t) => (t.broker === "manual") || (!t.strategy_id && !stratById.get(t.strategy_id));
    return open;
  }, [trades, stratById]);

  const matchTradeToSlot = (slot) => {
    // Prefer trades that match the slot's strategy binding when set.
    if (slot.strategy_id) {
      const s = openTrades.find(t => t.strategy_id === slot.strategy_id);
      if (s) return s;
    }
    if (slot.type === "automation") return openTrades.find(t => t.broker !== "manual" && (t.strategy_id || !!stratById.get(t.strategy_id))) || null;
    return openTrades.find(t => t.broker === "manual") || null;
  };

  return (
    <>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="border-b border-slate-800 py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-500 animate-pulse" />
            Live Trades
            <span className="text-sm font-normal text-slate-400 ml-1">({slots.length})</span>
          </CardTitle>
          <Link to={createPageUrl("LivePositions")} className="text-xs text-blue-400 hover:text-blue-300">
            Open ops panel →
          </Link>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {slots.map((slot) => {
              const realTrade = matchTradeToSlot(slot);
              const trade = realTrade || sampleTradeForSlot(slot);
              return (
                <LiveTradeBracketCard
                  key={slot.id}
                  slot={slot}
                  trade={trade}
                  account={acctById.get(trade.account_id)}
                  strategy={stratById.get(trade.strategy_id)}
                  group={groupByName.get(trade.group_name)}
                  allAccounts={accounts}
                  onEdit={() => setEditingSlot(slot)}
                  onDuplicate={() => duplicate(slot.id)}
                  onDelete={() => {
                    if (window.confirm(`Delete card "${slot.title}"?`)) remove(slot.id);
                  }}
                />
              );
            })}
            <AddSlotCard onAdd={add} />
          </div>
        </CardContent>
      </Card>

      {editingSlot && (
        <EditSlotModal
          slot={editingSlot}
          strategies={strategies}
          accounts={accounts}
          onSave={(patch) => { update(editingSlot.id, patch); setEditingSlot(null); }}
          onClose={() => setEditingSlot(null)}
        />
      )}
    </>
  );
}

function AddSlotCard({ onAdd }) {
  return (
    <button
      onClick={onAdd}
      className="rounded-2xl border-2 border-dashed border-slate-700 hover:border-blue-500/60 hover:bg-slate-900/60 min-h-[220px] flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-white transition-colors"
    >
      <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
        <Plus className="w-6 h-6"/>
      </div>
      <span className="font-semibold">Add trade card</span>
      <span className="text-xs text-slate-500">Bind a Pine strategy or manual TM</span>
    </button>
  );
}

function EditSlotModal({ slot, strategies, accounts, onSave, onClose }) {
  const [form, setForm] = useState(() => ({
    ...blankSlot(),   // provides all default fields (bracket, accounts, times, timezone, etc)
    ...slot,          // override with the slot's actual current values
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setBracket = (row, k, v) =>
    setForm(f => ({ ...f, bracket: { ...f.bracket, [row]: { ...f.bracket[row], [k]: v } } }));
  const setTimeWin = (idx, k, v) =>
    setForm(f => {
      const tw = [...(f.time_windows || [])];
      tw[idx] = { ...(tw[idx] || {}), [k]: v };
      return { ...f, time_windows: tw };
    });
  const setRotation = (k, v) =>
    setForm(f => ({ ...f, rotation: { ...(f.rotation || {}), [k]: v ? +v : "" } }));
  const addAccount = () =>
    setForm(f => ({ ...f, accounts: [...(f.accounts || []), { name: "", multiplier: 1 }] }));
  const removeAccount = (i) =>
    setForm(f => ({ ...f, accounts: f.accounts.filter((_, idx) => idx !== i) }));
  const updateAccount = (i, k, v) =>
    setForm(f => {
      const list = [...(f.accounts || [])];
      list[i] = { ...list[i], [k]: k === "multiplier" ? (+v || 1) : v };
      return { ...f, accounts: list };
    });

  // Task #147 — pull the strategy's saved bracket defaults into this
  // slot's bracket section. Called on-demand ("Sync from strategy"
  // button) and on strategy selection change (with a confirm prompt if
  // the user has already customised the bracket).
  const applyStrategyDefaults = (strategy) => {
    if (!strategy) return;
    const ct = strategy.default_contracts ?? null;
    setForm(f => {
      const b = { ...(f.bracket || {}) };
      const setRow = (key, patch) => { b[key] = { ...(b[key] || {}), ...patch }; };
      if (ct != null) {
        setRow("entry",  { qty: ct, enabled: true });
        setRow("stop",   { qty: ct, enabled: true });
      }
      if (strategy.default_tp1_ticks != null) setRow("tp1",    { qty: strategy.default_tp1_ticks });
      if (strategy.default_tp2_ticks != null) setRow("tp2",    { qty: strategy.default_tp2_ticks });
      if (strategy.default_tp3_ticks != null) setRow("tp3",    { qty: strategy.default_tp3_ticks });
      if (strategy.default_runner_qty != null) setRow("runner", { qty: strategy.default_runner_qty });
      return {
        ...f,
        bracket: b,
        // Adopt the strategy's first preferred asset as the slot symbol
        // when the slot doesn't already have one set.
        symbol: (f.symbol && f.symbol.trim())
          ? f.symbol
          : (Array.isArray(strategy.preferred_pairs) && strategy.preferred_pairs[0]) || f.symbol,
      };
    });
  };
  const currentStrategy = () => strategies?.find(s => s.id === form.strategy_id) || null;
  const syncFromStrategy = () => {
    const s = currentStrategy();
    if (!s) return;
    const hasDefaults = s.default_contracts != null || s.default_tp1_ticks != null;
    if (!hasDefaults) {
      alert(`"${s.name}" has no bracket defaults saved yet. Edit the strategy first (Strategies → ${s.name}) to set contracts / TP ticks.`);
      return;
    }
    if (window.confirm(`Overwrite this slot's brackets with "${s.name}" defaults?\nContracts, stop/TP ticks and runner qty will be updated.`)) {
      applyStrategyDefaults(s);
    }
  };
  // Auto-apply when the user PICKS a strategy in the dropdown (not when
  // it was already the value). We special-case: if the slot already has
  // custom bracket values, ask before overwriting.
  const onStrategyPicked = (newId) => {
    const previousId = form.strategy_id;
    set("strategy_id", newId);
    if (!newId || newId === previousId) return;
    const s = strategies.find(x => x.id === newId);
    if (!s) return;
    const hasDefaults = s.default_contracts != null || s.default_tp1_ticks != null;
    if (!hasDefaults) return;
    const hasCustom = form.bracket?.entry?.qty > 0 || form.bracket?.tp1?.qty > 0;
    if (!hasCustom || window.confirm(`Apply "${s.name}" bracket defaults to this slot?`)) {
      applyStrategyDefaults(s);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Edit trade card</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            Configure title, broker, brackets, accounts, times, and wiring. Real trades matching this binding populate the ladder automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">

          {/* Section 1 — Connect broker + basics */}
          <section className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Connect</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-white">Broker</Label>
                <select
                  value={form.broker || "tradovate"}
                  onChange={e => set("broker", e.target.value)}
                  className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-white px-3 text-sm"
                >
                  {BROKER_OPTIONS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-white">Symbol</Label>
                <Input value={form.symbol} onChange={e => set("symbol", e.target.value)}
                       placeholder="MNQ1!" className="bg-slate-950 border-slate-700 text-white font-mono"/>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white">Title</Label>
              <Input value={form.title} onChange={e => set("title", e.target.value)}
                     placeholder="e.g. Freeballin Pro 2.72" className="bg-slate-950 border-slate-700 text-white"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-white">Type</Label>
                <div className="grid grid-cols-2 rounded-lg bg-slate-950 border border-slate-800 p-0.5">
                  {["automation", "manual"].map(t => (
                    <button key={t} type="button" onClick={() => set("type", t)}
                            className={`h-9 text-sm font-semibold rounded-md capitalize ${
                              form.type === t ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-white">Side</Label>
                <div className="grid grid-cols-2 rounded-lg bg-slate-950 border border-slate-800 p-0.5">
                  {["long", "short"].map(s => (
                    <button key={s} type="button" onClick={() => set("side", s)}
                            className={`h-9 text-sm font-semibold rounded-md capitalize ${
                              form.side === s
                                ? (s === "long" ? "bg-blue-600 text-white" : "bg-purple-600 text-white")
                                : "text-slate-400 hover:text-white"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {form.type === "automation" && strategies?.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-white">Strategy (optional)</Label>
                <select value={form.strategy_id || ""}
                        onChange={e => onStrategyPicked(e.target.value ? +e.target.value : null)}
                        className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-white px-3 text-sm">
                  <option value="">— Any automation trade —</option>
                  {strategies.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {Array.isArray(s.preferred_pairs) && s.preferred_pairs.length > 0 ? ` · ${s.preferred_pairs.join("/")}` : ""}
                      {s.default_contracts != null ? ` · ${s.default_contracts}ct` : ""}
                    </option>
                  ))}
                </select>
                {currentStrategy() && (
                  <p className="text-xs text-slate-500">
                    Picking a strategy pulls its bracket defaults. Use <span className="text-blue-300">Sync from strategy</span> below to re-pull after editing the strategy.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Section 2 — Brackets */}
          <section className="space-y-2 border-t border-slate-800 pt-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Brackets</div>
              {currentStrategy() && (
                <button type="button" onClick={syncFromStrategy}
                        className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
                  ↻ Sync from strategy
                </button>
              )}
            </div>
            {[
              { key: "stop",   label: "STOP",   locked: true  },
              { key: "entry",  label: "ENTRY",  locked: true  },
              { key: "tp1",    label: "TP1",    locked: false },
              { key: "tp2",    label: "TP2",    locked: false },
              { key: "tp3",    label: "TP3",    locked: false },
              { key: "runner", label: "RUNNER", locked: false, noPrice: true },
            ].map(row => {
              const b = form.bracket?.[row.key] || {};
              return (
                <div key={row.key} className="grid grid-cols-[64px_1fr_80px_100px] items-center gap-2">
                  <span className="text-sm font-bold text-white">{row.label}</span>
                  {row.noPrice
                    ? <span className="text-xs text-slate-500 italic">rides on top TP</span>
                    : <Input type="number" step="0.01" value={b.price ?? ""}
                             onChange={e => setBracket(row.key, "price", parseFloat(e.target.value))}
                             placeholder="price"
                             className="bg-slate-950 border-slate-700 text-white font-mono h-8 text-sm"/>}
                  <Input type="number" min="0" value={b.qty ?? 0}
                         onChange={e => setBracket(row.key, "qty", parseInt(e.target.value || 0))}
                         placeholder="#qty"
                         className="bg-slate-950 border-slate-700 text-white font-mono h-8 text-sm"/>
                  <div className="grid grid-cols-2 rounded-md bg-slate-950 border border-slate-800 p-0.5">
                    <button type="button" disabled={row.locked}
                            onClick={() => setBracket(row.key, "enabled", true)}
                            className={`h-7 text-xs font-semibold rounded-sm ${
                              b.enabled ? "bg-emerald-600 text-white" : "text-slate-500"} ${row.locked ? "opacity-60 cursor-not-allowed" : ""}`}>
                      ON
                    </button>
                    <button type="button" disabled={row.locked}
                            onClick={() => setBracket(row.key, "enabled", false)}
                            className={`h-7 text-xs font-semibold rounded-sm ${
                              !b.enabled ? "bg-slate-600 text-white" : "text-slate-500"} ${row.locked ? "opacity-60 cursor-not-allowed" : ""}`}>
                      OFF
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

          {/* Section 3 — Accounts + rotation */}
          <section className="space-y-3 border-t border-slate-800 pt-4">
            <div className="flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Accounts + Rotation</div>
              <button type="button" onClick={addAccount}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
                + Add account
              </button>
            </div>
            {(form.accounts || []).length === 0 && (
              <div className="text-xs text-slate-500 italic">No accounts yet — click "Add account" to add one.</div>
            )}
            {(form.accounts || []).map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_36px] gap-2 items-center">
                <Input value={a.name} onChange={e => updateAccount(i, "name", e.target.value)}
                       placeholder="e.g. Lucid 50K, Apex #01, MFFU #02"
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm"/>
                <Input type="number" min="0.1" step="0.1" value={a.multiplier ?? 1}
                       onChange={e => updateAccount(i, "multiplier", e.target.value)}
                       placeholder="×"
                       className="bg-slate-950 border-slate-700 text-white font-mono h-9 text-sm"/>
                <button type="button" onClick={() => removeAccount(i)}
                        className="h-9 rounded-md bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800/60 flex items-center justify-center">
                  <Trash2 className="w-4 h-4"/>
                </button>
              </div>
            ))}
            <div className="grid grid-cols-4 gap-2 pt-2">
              <div className="space-y-1">
                <Label className="text-slate-500 text-[10px] uppercase">Rotate: Wins</Label>
                <Input type="number" min="0" value={form.rotation?.wins ?? ""}
                       onChange={e => setRotation("wins", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-500 text-[10px] uppercase">Losses</Label>
                <Input type="number" min="0" value={form.rotation?.losses ?? ""}
                       onChange={e => setRotation("losses", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-500 text-[10px] uppercase">Win $</Label>
                <Input type="number" min="0" value={form.rotation?.profit ?? ""}
                       onChange={e => setRotation("profit", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-500 text-[10px] uppercase">Loss $</Label>
                <Input type="number" min="0" value={form.rotation?.loss ?? ""}
                       onChange={e => setRotation("loss", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
              </div>
            </div>
          </section>

          {/* Section 4 — Time windows + timezone */}
          <section className="space-y-3 border-t border-slate-800 pt-4">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Times</div>
            {[0, 1].map(i => (
              <div key={i} className="grid grid-cols-[70px_1fr_1fr] items-center gap-2">
                <span className="text-xs text-slate-500 font-mono">Window {i + 1}</span>
                <Input type="time" value={form.time_windows?.[i]?.start || ""}
                       onChange={e => setTimeWin(i, "start", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
                <Input type="time" value={form.time_windows?.[i]?.end || ""}
                       onChange={e => setTimeWin(i, "end", e.target.value)}
                       className="bg-slate-950 border-slate-700 text-white h-9 text-sm font-mono"/>
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-white">Timezone</Label>
              <select value={form.timezone || "America/New_York"}
                      onChange={e => set("timezone", e.target.value)}
                      className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-white px-3 text-sm">
                {TIMEZONE_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </section>

          {/* Section 5 — Wiring */}
          <section className="space-y-3 border-t border-slate-800 pt-4">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Wiring</div>
            <div className="space-y-1.5">
              <Label className="text-white">Webhook URL</Label>
              <Input value={form.webhook_path} onChange={e => set("webhook_path", e.target.value)}
                     placeholder="/api/webhook/strategy/my-slug"
                     className="bg-slate-950 border-slate-700 text-white font-mono text-sm"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-white">Account</Label>
                <Input value={form.broker_account_id} onChange={e => set("broker_account_id", e.target.value)}
                       placeholder="APEX3049…"
                       className="bg-slate-950 border-slate-700 text-white font-mono text-sm"/>
              </div>
              <div className="space-y-1.5">
                <Label className="text-white">Token</Label>
                <Input type="password" value={form.token} onChange={e => set("token", e.target.value)}
                       placeholder="••••••"
                       className="bg-slate-950 border-slate-700 text-white font-mono text-sm"/>
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-slate-800 pt-3">
          <Button variant="outline" onClick={onClose}
                  className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
            Cancel
          </Button>
          <Button onClick={() => onSave(form)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ────────────────────────────────────────────────────────────────
// LiveTradeBracketCard — Dashboard card matching user's exact spec.
// Muted palette: slate ground, red for STOP only, green for hit TPs
// only. Status labels: ACTIVE / ✅ +$XXX / X Pending / HIT.
// ────────────────────────────────────────────────────────────────
const FUTURES_TICK = { MNQ: 0.25, NQ: 0.25, MES: 0.25, ES: 0.25, M2K: 0.10, RTY: 0.10, MYM: 1, YM: 1, MGC: 0.10, GC: 0.10, CL: 0.01, MNG: 0.001, NG: 0.001 };
const FUTURES_PV   = { MNQ: 2,    NQ: 20,   MES: 5,    ES: 50,   M2K: 5,    RTY: 50,   MYM: 0.5, YM: 5, MGC: 10, GC: 100, CL: 1000, MNG: 1000, NG: 10000 };

function symKey(sym) {
  const u = (sym || "").toUpperCase();
  return Object.keys(FUTURES_TICK).find(k => u.startsWith(k)) || null;
}
function tickOf(sym) { return FUTURES_TICK[symKey(sym)] ?? 0.0001; }
function pvOf(sym)   { return FUTURES_PV[symKey(sym)] ?? null; }

function StatusPill({ text, kind }) {
  const cls =
    kind === "active" ? "text-white bg-slate-700"
    : kind === "hit"  ? "text-white bg-emerald-600"
    : kind === "pending" ? "text-slate-300 bg-slate-800"
    :                     "text-slate-300 bg-slate-800";
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full ${cls} whitespace-nowrap`}>
      {text}
    </span>
  );
}

function MetaLine({ label, value, mono = true }) {
  return (
    <div className="flex items-baseline gap-2 text-sm py-0.5">
      <span className="text-slate-400 uppercase tracking-wider text-xs min-w-[80px]">{label}</span>
      <span className={`${mono ? "font-mono" : ""} text-white truncate`}>{value ?? "—"}</span>
    </div>
  );
}

// Collapsible "Account details" dropdown — hidden by default, arrow rotates on open.
function AccountDetailsToggle({ strategyName, webhookPath, brokerAccountId, tokenMask }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-800/60 bg-slate-950/40">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm text-white hover:bg-slate-900/60 transition-colors"
      >
        <span className="font-semibold">Account details</span>
        <span className={`text-slate-400 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>▸</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-0.5">
          <MetaLine label="Strategy" value={strategyName} mono={false}/>
          <MetaLine label="Webhook"  value={webhookPath}/>
          <MetaLine label="Account"  value={brokerAccountId}/>
          <MetaLine label="Token"    value={tokenMask}/>
        </div>
      )}
    </div>
  );
}

function LiveTradeBracketCard({ slot, trade, account, strategy, group, allAccounts, onEdit, onDuplicate, onDelete }) {
  const [busy, setBusy] = useState(false);
  const isLong  = (trade.direction || trade.side || "").toLowerCase() === "long";
  const dir     = isLong ? "LONG" : "SHORT";
  const qty     = trade.qty_open ?? trade.qty_total ?? 0;
  const total   = trade.qty_total ?? qty;
  const stop    = trade.stop_loss ?? trade.stop_price ?? null;
  const entry   = trade.entry_price ?? null;
  const pnl     = trade.profit_loss ?? 0;
  const symbol  = trade.symbol || trade.ticker || "?";
  const isManual = slot?.type === "manual" || trade.broker === "manual" || (!strategy && !trade.strategy_id);
  const pending  = qty === 0 || (trade.status || "").toLowerCase() === "pending";
  const tickSz  = tickOf(symbol);
  const pv      = pvOf(symbol);

  // Slot title (user-editable) wins over derived tag; else fall back to derived.
  const derivedTag = isManual
    ? (pending ? "Manual Trade Manager (pending)" : "Manual Trade Manager (live)")
    : (pending ? "Automation (pending)" : "Automation (live)");
  const title = slot?.title || derivedTag;
  const tag = slot?.title ? derivedTag : "";

  // Detect TP hit — if we don't know exit price, use current stop as a proxy
  // (Pine typically ratchets SL past TP after hit).
  const tpHit = (level) => {
    if (!level || !entry || !stop) return false;
    return isLong ? stop >= level : stop <= level;
  };
  const tpGain = (level, tpQty) => {
    if (!level || !entry || !pv) return null;
    return Math.round(Math.abs(level - entry) * pv * (tpQty || 1));
  };

  // ALWAYS show the full planned bracket (STOP · ENTRY · TP1 · TP2 · TP3 ·
  // RUNNER). Missing prices render as "—" so the layout stays consistent
  // and the trader always sees the intended structure.
  const rows = [
    { role: "STOP",  price: stop,  qty: qty || total, kind: "stop" },
    { role: "ENTRY", price: entry, qty: total,        kind: "entry" },
    { role: "TP1",   price: trade.take_profit_1 ?? null, qty: trade.tp1_qty || 0,
      kind: "tp", hit: tpHit(trade.take_profit_1), gain: tpGain(trade.take_profit_1, trade.tp1_qty) },
    { role: "TP2",   price: trade.take_profit_2 ?? null, qty: trade.tp2_qty || 0,
      kind: "tp", hit: tpHit(trade.take_profit_2), gain: tpGain(trade.take_profit_2, trade.tp2_qty) },
    { role: "TP3",   price: trade.take_profit_3 ?? null, qty: trade.tp3_qty || 0,
      kind: "tp", hit: tpHit(trade.take_profit_3), gain: tpGain(trade.take_profit_3, trade.tp3_qty) },
    { role: "RUNNER", price: null, qty: trade.runner_qty || 0, kind: "runner", hit: false },
  ];

  // Group members + rotation rule text ("2W or $500")
  const memberAccts = (group?.members || []).map(m => allAccounts.find(a => a.id === m.account_id)).filter(Boolean);
  const rotationRule = group
    ? [
        group.max_daily_wins ? `${group.max_daily_wins}W` : null,
        group.max_daily_losses ? `${group.max_daily_losses}L` : null,
        group.max_daily_profit ? `$${group.max_daily_profit}` : null,
        group.max_daily_loss ? `-$${group.max_daily_loss}` : null,
      ].filter(Boolean).join(" or ")
    : null;
  const timeWindow = (group?.time_windows && group.time_windows.length)
    ? group.time_windows.map(w => `${w.start}–${w.end}`).join(", ")
    : (account?.time_windows && account.time_windows.length
       ? account.time_windows.map(w => `${w.start}–${w.end}`).join(", ")
       : null);

  // Wiring details — slot user input takes precedence, else derive from bound strategy/account
  const strategyName = strategy?.name || (isManual ? "TM v20.87 STOPS" : null);
  const webhookPath  = slot?.webhook_path
    || (strategy?.webhook_slug ? `/api/webhook/strategy/${strategy.webhook_slug}` : null);
  const brokerAccountId = slot?.broker_account_id || account?.account_id || account?.name || null;
  const rawToken = slot?.token || strategy?.webhook_key || null;
  const tokenMask = rawToken ? `${rawToken.slice(0, 4)}${"•".repeat(Math.max(4, rawToken.length - 4))}` : null;

  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol.replace(/1!$/, ""))}`;

  // Observe mode: PMT / TradersPost own execution. All broker-write UI is
  // hard-disabled + short-circuited so a race can't route.
  const observe = isObserveMode(account);

  const copyToClip = async (text, msg) => {
    try {
      await navigator.clipboard.writeText(text);
      if (msg) console.log(msg);
    } catch { alert("Clipboard blocked"); }
  };
  const fullWebhookUrl = webhookPath
    ? `${window.location.origin}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`
    : null;

  const { menuProps: cardMenuProps, menu: cardMenu } = useContextMenu([
    { header: slot?.title || title },
    onEdit && { label: "Edit slot",       icon: <Pencil className="w-4 h-4"/>,       onClick: onEdit,       kbd: "dbl-click" },
    onDuplicate && { label: "Duplicate slot", icon: <Files className="w-4 h-4"/>,   onClick: onDuplicate },
    fullWebhookUrl && { label: "Copy webhook URL", icon: <Copy className="w-4 h-4"/>, onClick: () => copyToClip(fullWebhookUrl, "webhook copied") },
    { label: "Copy row as JSON", icon: <Copy className="w-4 h-4"/>, onClick: () => copyToClip(JSON.stringify(trade, null, 2), "trade json copied") },
    { label: "Open in TradingView", icon: <ExternalLink className="w-4 h-4"/>, onClick: () => window.open(tvUrl, "_blank", "noopener,noreferrer") },
    { separator: true },
    onDelete && { label: "Delete card", icon: <Trash2 className="w-4 h-4"/>, onClick: onDelete, danger: true },
  ].filter(Boolean));
  const gateGuard = () => {
    if (!observe) return false;
    alert(OBSERVE_TOOLTIP);
    return true;
  };

  const nudgeSL = async (ticks) => {
    if (busy || !stop || gateGuard()) return;
    setBusy(true);
    try {
      const newSL = +(stop + ticks * tickSz).toFixed(5);
      await PositionControl.modify(trade.id, { stop_price: newSL, stop_source: `MANUAL_UI:${ticks > 0 ? "+" : ""}${ticks}t` });
    } catch (e) { alert(`SL nudge failed: ${e.message}`); }
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
    <>
    <div {...cardMenuProps}
         onDoubleClick={onEdit}
         title="Right-click for actions · Double-click to edit"
         className={`rounded-2xl border-2 border-l-[6px] shadow-lg overflow-hidden ${
      isManual
        ? "border-purple-500/60 border-l-purple-500 bg-slate-900 shadow-purple-500/10"
        : "border-blue-500/60 border-l-blue-500 bg-slate-900 shadow-blue-500/10"
    }`}>
      {/* HEADER — editable title, edit + delete controls */}
      <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-base font-bold text-white">{title}</span>
        {tag && <span className="text-xs text-slate-400 italic">· {tag}</span>}
        <span className="text-xs text-slate-500">·</span>
        <span className="text-sm text-white">{symbol}</span>
        <span className="ml-auto text-base font-bold tabular-nums"
              style={{ color: pnl > 0 ? "rgb(110,231,183)" : pnl < 0 ? "rgb(252,165,165)" : "rgb(148,163,184)" }}>
          {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(2)}
        </span>
        {onEdit && (
          <button onClick={onEdit} title="Edit card"
                  className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
            <Pencil className="w-4 h-4"/>
          </button>
        )}
        {onDelete && (
          <button onClick={onDelete} title="Delete card"
                  className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10">
            <Trash2 className="w-4 h-4"/>
          </button>
        )}
      </div>

      {/* Info block on top, actions row at bottom — cleaner at half-page width */}
      <div>
        <div className="min-w-0">

          {/* SIDE + Asset row */}
          <div className="px-3 py-2 border-b border-slate-800/60 grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">SIDE:</span>
              <span className={`font-mono font-semibold ${isLong ? "text-emerald-300" : "text-rose-300"}`}>{dir}</span>
              <span className="text-slate-500 font-mono">
                {qty}{total !== qty && <span className="text-slate-600">/{total}</span>}ct
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Asset:</span>
              <span className="font-mono text-slate-300">{symKey(symbol) || symbol}</span>
              <span className="text-slate-500 uppercase tracking-wider text-[10px] ml-2">Total:</span>
              <span className="font-mono text-white font-semibold">#{total}</span>
            </div>
          </div>

          {/* BRACKET LADDER — role & price all WHITE, colored bubbles per
              Pine palette (STOP=red · ENTRY blue/purple by side · TP=teal ·
              RUNNER=lime · hit=grey done). */}
          <div className="px-4 py-3 space-y-2 text-sm">
            {rows.map((r, i) => {
              const isStop  = r.kind === "stop";
              const isEntry = r.kind === "entry";
              const isTp    = r.kind === "tp";
              const isRun   = r.kind === "runner";

              // Pill color mirrors Pine indicator colors:
              // stop_col=red, entry_buy_col=blue, entry_sell_col=purple,
              // tp_col=teal, runner_label_col=lime, done_col=grey.
              let pillBg = "bg-slate-700", pillText = "text-white";
              if (isStop)               { pillBg = "bg-red-600"; }
              else if (isEntry)         { pillBg = isLong ? "bg-blue-600" : "bg-purple-600"; }
              else if (isTp && r.hit)   { pillBg = "bg-slate-500"; }
              else if (isTp)            { pillBg = "bg-teal-600"; }
              else if (isRun && r.hit)  { pillBg = "bg-lime-500"; pillText = "text-black"; }
              else if (isRun)           { pillBg = "bg-lime-600/60"; }

              // Status text
              let status;
              if (isStop || isEntry)   status = "ACTIVE";
              else if (isTp && r.hit)  status = r.gain != null ? `✅ +$${r.gain}` : "✅ HIT";
              else if (isTp)           status = "X Pending";
              else if (isRun && r.hit) status = "HIT";
              else                     status = "X Pending";

              return (
                <div key={i} className="grid grid-cols-[72px_1fr_54px_auto] items-center gap-2">
                  <span className="text-sm font-bold text-white">{r.role}</span>
                  <span className={`text-right tabular-nums text-base text-white ${isEntry ? "font-bold" : "font-semibold"}`}>
                    {r.price != null ? r.price.toFixed(2) : "—"}
                  </span>
                  {/* Per-row qty only for partial exits — STOP/ENTRY apply to
                      the full position; total contracts shown up top. */}
                  {(isStop || isEntry)
                    ? <span/>
                    : <span className="text-white tabular-nums text-right text-sm font-semibold">#{r.qty}</span>}
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap ${pillBg} ${pillText}`}>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ACCOUNTS block */}
          <div className="px-3 py-2 border-t border-slate-800/60 space-y-1 text-[11px]">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500 uppercase tracking-wider text-[10px]">Accounts:</span>
              {rotationRule && <span className="text-slate-400">rotation {rotationRule}</span>}
            </div>
            <div className="pl-2 space-y-0.5 font-mono text-slate-300">
              {memberAccts.length > 0
                ? memberAccts.map(a => (
                    <div key={a.id}>{a.name} <span className="text-slate-600">×{a.multiplier ?? 1}</span></div>
                  ))
                : account
                  ? <div>{account.name} <span className="text-slate-600">×{account.multiplier ?? 1}</span></div>
                  : <div className="text-slate-500">—</div>}
            </div>
            {timeWindow && (
              <div className="pt-1 flex items-baseline gap-2">
                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Times:</span>
                <span className="font-mono text-slate-300">{timeWindow}</span>
              </div>
            )}
          </div>

          {/* ACCOUNT DETAILS — collapsible dropdown */}
          <AccountDetailsToggle
            strategyName={strategyName}
            webhookPath={webhookPath}
            brokerAccountId={brokerAccountId}
            tokenMask={tokenMask}
          />
        </div>

        {/* UNPROTECTED POSITION — red urgent banner. Task #178.
            Shown when a live trade has qty at broker but no working SL.
            Direct-broker accounts get a one-click "SL → BE" quick fix;
            observe-mode accounts get "Set in your broker" copy since we
            can't route the order on their behalf. */}
        {isUnprotected(trade) && (
          <div className="border-t-2 border-red-500 bg-red-950/40 px-3 py-2 flex items-center gap-2 animate-pulse">
            <span className="text-lg">🚨</span>
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
                      className="shrink-0 h-7 px-3 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold border border-red-400">
                SL → BE now
              </button>
            )}
          </div>
        )}

        {/* OBSERVE STRIP — writing actions gated when broker owns execution */}
        {observe && (
          <div className="border-t border-emerald-800/40 bg-emerald-950/20 px-3 py-1.5 text-[11px] text-emerald-200 flex items-center gap-2">
            <Activity className="w-3 h-3 shrink-0"/>
            <span className="font-semibold">{OBSERVE_BADGE_LABEL}.</span>
            <span className="text-emerald-300/80">Broker actions gated — connect Tradovate-direct to enable.</span>
          </div>
        )}

        {/* ACTIONS ROW — horizontal, spans full card width */}
        <div className="border-t border-slate-800 p-2 bg-slate-950/40 flex flex-wrap items-center gap-1.5">
          <button onClick={closeAll} disabled={busy || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                  className="h-7 px-3 rounded bg-rose-950/40 hover:bg-rose-900/50 disabled:opacity-40 disabled:cursor-not-allowed text-rose-200 border border-rose-800/60 text-xs font-semibold">
            Close All
          </button>
          <button onClick={closeHalf} disabled={busy || qty < 2 || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                  className="h-7 px-3 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 text-xs">
            Close ½
          </button>
          <button onClick={slToBE} disabled={busy || !entry || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                  className="h-7 px-3 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 border border-slate-700 text-xs">
            SL → BE
          </button>
          {[-10, -5, 5, 10].map(t => (
            <button key={t} onClick={() => nudgeSL(t)} disabled={busy || observe} title={observe ? OBSERVE_TOOLTIP : undefined}
                    className="h-7 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-[11px] border border-slate-700">
              {t > 0 ? `+${t}t` : `${t}t`}
            </button>
          ))}
          <a href={tvUrl} target="_blank" rel="noopener noreferrer"
             className="ml-auto h-7 px-2 rounded text-slate-400 hover:text-slate-100 text-[11px] flex items-center">
            TradingView →
          </a>
          <Link to={createPageUrl("LivePositions")}
                className="h-7 px-2 rounded text-slate-400 hover:text-slate-100 text-[11px] flex items-center">
            More →
          </Link>
        </div>
      </div>
    </div>
    {cardMenu}
    </>
  );
}

