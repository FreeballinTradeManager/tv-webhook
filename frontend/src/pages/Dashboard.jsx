import React, { useState, useEffect } from "react";
import { Account, Trade, Strategy, User } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Sparkles
} from "lucide-react";
import StatsCard from "../components/dashboard/StatsCard";
import RecentTrades from "../components/dashboard/RecentTrades";
import SessionPerformance from "../components/dashboard/SessionPerformance";
import AccountOverview from "../components/dashboard/AccountOverview";
import KillSwitchButton from "../components/KillSwitchButton";

// Rules checklist stores today's checked state in localStorage keyed by
// date, so ticks reset naturally at midnight (new day, new key, empty set).
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
  return [checked, toggle];
}

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, toggleRule] = useRulesChecklist();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [accountsData, tradesData, strategiesData, userData] = await Promise.all([
      Account.list("-created_date"),
      Trade.list("-entry_time", 50),
      Strategy.list("-created_date"),
      User.me().catch(() => null),  // graceful if endpoint fails
    ]);
    setAccounts(accountsData);
    setTrades(tradesData);
    setStrategies(strategiesData);
    setUser(userData);
    setLoading(false);
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
                <Button variant="outline" size="sm" className="text-slate-300 border-slate-700">Configure Rules</Button>
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

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <RecentTrades trades={trades.slice(0, 10)} loading={loading} />
            <SessionPerformance trades={trades} />
          </div>
          <div className="space-y-6">
            <AccountOverview accounts={accounts} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
