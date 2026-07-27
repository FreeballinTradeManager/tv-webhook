import React, { useState, useEffect, useMemo } from "react";
import { Trade } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { DollarSign, Percent, TrendingUp, TrendingDown, Divide } from "lucide-react";

const StatCard = ({ title, value, icon: Icon, color }) => (
  <Card className="bg-slate-900 border-slate-800">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-slate-400">{title}</CardTitle>
      <Icon className={`h-4 w-4 text-slate-500 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold text-white">{value}</div>
    </CardContent>
  </Card>
);

export default function AnalyticsPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTrades = async () => {
      setLoading(true);
      const tradesData = await Trade.list("-entry_time");
      setTrades(tradesData);
      setLoading(false);
    };
    loadTrades();
  }, []);

  const analyticsData = useMemo(() => {
    const closedTrades = trades.filter(t => t.status === "closed" && t.profit_loss != null).sort((a,b) => new Date(a.entry_time) - new Date(b.entry_time));
    if (closedTrades.length === 0) return null;

    let equity = 0;
    const equityCurve = closedTrades.map((trade, index) => {
      equity += trade.profit_loss;
      return { name: `Trade ${index + 1}`, equity };
    });

    const totalTrades = closedTrades.length;
    const winningTrades = closedTrades.filter(t => t.profit_loss > 0);
    const losingTrades = closedTrades.filter(t => t.profit_loss < 0);
    const winRate = (winningTrades.length / totalTrades) * 100;
    const totalProfit = winningTrades.reduce((sum, t) => sum + t.profit_loss, 0);
    const totalLoss = losingTrades.reduce((sum, t) => sum + t.profit_loss, 0);
    const netProfit = totalProfit + totalLoss;
    const profitFactor = totalLoss !== 0 ? Math.abs(totalProfit / totalLoss) : Infinity;
    const avgWin = winningTrades.length > 0 ? totalProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(totalLoss / losingTrades.length) : 0;
    const expectancy = (winRate / 100 * avgWin) - ((100 - winRate) / 100 * avgLoss);

    return { equityCurve, totalTrades, winRate, netProfit, profitFactor, avgWin, avgLoss, expectancy };
  }, [trades]);

  if (loading) {
    return (
      <div className="p-8"><Skeleton className="h-[500px] w-full bg-slate-800" /></div>
    );
  }

  if (!analyticsData) {
    return (
      <div className="p-8 text-center text-slate-400">
        <h1 className="text-3xl font-bold text-white mb-4">Analytics</h1>
        <p>Not enough trade data to generate analytics. Go log some trades!</p>
      </div>
    );
  }

  const { equityCurve, totalTrades, winRate, netProfit, profitFactor, avgWin, avgLoss, expectancy } = analyticsData;

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Performance Analytics</h1>
          <p className="text-slate-400">Deep dive into your trading performance.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Net Profit" value={`$${netProfit.toFixed(2)}`} icon={DollarSign} color={netProfit > 0 ? 'text-green-500' : 'text-red-500'} />
            <StatCard title="Win Rate" value={`${winRate.toFixed(2)}%`} icon={Percent} color="text-blue-500" />
            <StatCard title="Profit Factor" value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} icon={Divide} color="text-purple-500" />
            <StatCard title="Expectancy" value={`$${expectancy.toFixed(2)}`} icon={DollarSign} color="text-orange-500" />
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Equity Curve</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={equityCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94A3B8" />
                <YAxis stroke="#94A3B8" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: "#1E293B", border: "1px solid #334155", color: "#F8FAFC" }} formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Line type="monotone" dataKey="equity" stroke="#3B82F6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <StatCard title="Total Trades" value={totalTrades} icon={TrendingUp} />
          <StatCard title="Average Winning Trade" value={`$${avgWin.toFixed(2)}`} icon={TrendingUp} color="text-green-500" />
          <StatCard title="Average Losing Trade" value={`$${avgLoss.toFixed(2)}`} icon={TrendingDown} color="text-red-500" />
          <StatCard title="Avg. Reward/Risk (approx.)" value={`${(avgWin / avgLoss).toFixed(2)} : 1`} icon={Divide} />
        </div>
      </div>
    </div>
  );
}
