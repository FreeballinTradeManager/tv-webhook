import React, { useState, useEffect } from "react";
import { Account, Trade, Strategy } from "@/entities/all";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Plus,
  Activity
} from "lucide-react";
import StatsCard from "../components/dashboard/StatsCard";
import RecentTrades from "../components/dashboard/RecentTrades";
import SessionPerformance from "../components/dashboard/SessionPerformance";
import AccountOverview from "../components/dashboard/AccountOverview";

export default function Dashboard() {
  const [accounts, setAccounts] = useState([]);
  const [trades, setTrades] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [accountsData, tradesData, strategiesData] = await Promise.all([
      Account.list("-created_date"),
      Trade.list("-entry_time", 50),
      Strategy.list("-created_date")
    ]);
    setAccounts(accountsData);
    setTrades(tradesData);
    setStrategies(strategiesData);
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
            <h1 className="text-3xl font-bold text-white mb-2">Trading Dashboard</h1>
            <p className="text-slate-400">Welcome back! Here's your trading overview</p>
          </div>
          <Link to={createPageUrl("NewTrade")}>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
              <Plus className="w-5 h-5 mr-2" />
              New Trade
            </Button>
          </Link>
        </div>

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
