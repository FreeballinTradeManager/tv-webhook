import React, { useState, useEffect, useMemo } from "react";
import { Trade } from "@/entities/all";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { DollarSign, Percent, TrendingUp, TrendingDown, Divide, Calendar, Brain, AlertTriangle, Package, GitBranch, Gauge } from "lucide-react";
import { EMOTION_TAGS, MISTAKE_TAGS, tagMeta, getTags, allUsedTags } from "@/lib/trade_tags";
import { detectPineVersion, parseStrategyName } from "@/lib/pine_signals";
import SessionRollup from "@/components/SessionRollup";
import TimeOfDayHeatmap from "@/components/TimeOfDayHeatmap";

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

  // Even with no client-side closed trades, keep rendering — the MonthlyPivot
  // hits the server directly and shows its own empty state when there's no data.
  const noClosed = !analyticsData;
  const { equityCurve, totalTrades, winRate, netProfit, profitFactor, avgWin, avgLoss, expectancy } = analyticsData || {
    equityCurve: [], totalTrades: 0, winRate: 0, netProfit: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0,
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Performance Analytics</h1>
          <p className="text-slate-400">Deep dive into your trading performance.</p>
          {noClosed && (
            <p className="mt-2 text-xs text-slate-300">
              No closed trades yet — top-line stats are zeroed. Monthly matrix below still runs against server data.
            </p>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Net Profit" value={`$${netProfit.toFixed(2)}`} icon={DollarSign} color={netProfit > 0 ? 'text-green-500' : 'text-red-500'} />
            <StatCard title="Win Rate" value={`${winRate.toFixed(2)}%`} icon={Percent} color="text-blue-500" />
            <StatCard title="Profit Factor" value={profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)} icon={Divide} color="text-purple-500" />
            <StatCard title="Expectancy" value={`$${expectancy.toFixed(2)}`} icon={DollarSign} color="text-emerald-400" />
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

        {/* Task #77 — GitHub-style P&L calendar heatmap */}
        <CalendarHeatmap trades={trades} />

        {/* Trader Review — day tally + emotion perf + mistake frequency */}
        <TraderReview trades={trades} />

        {/* Task #191 — Session performance rollup (R1 Pre-NY / R2 NY / R3 Asia) */}
        <SessionRollup trades={trades} />

        {/* Task #227 — Time-of-day heatmap (7×24 P&L grid, ET-based buckets) */}
        <TimeOfDayHeatmap trades={trades} />

        {/* Task #125 — Per-asset P&L breakdown ("which instrument to focus on") */}
        <PerAssetBreakdown trades={trades} />

        {/* Task #126 — Detected Pine version rollup across observed alerts */}
        <PineVersionRollup trades={trades} />

        {/* Task #135 · #136 — Slippage + Commission tracker */}
        <SlippageCommissionCard trades={trades} />

        {/* Task #143 — Timeframe-aware trade grouping */}
        <TimeframeGrouping trades={trades} />

        {/* Task #81 — Correlated exposure + heat monitor */}
        <HeatMonitor trades={trades} />

        {/* Task #103 — Broker execution quality (fill time + reject rate). */}
        <BrokerExecutionQuality trades={trades} />

        {/* Task #174 — Monthly performance pivot (Lucid-style stats) */}
        <MonthlyPivot />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #77 — P&L calendar heatmap. GitHub-contribution style:
// rows = weekdays (Mon-Sun), columns = weeks, cells shaded by that
// day's realized P&L. Emerald for winning days, rose for losing days,
// slate for flat/no-trade. Hover reveals date + $ + trade count.
// ────────────────────────────────────────────────────────────────
function CalendarHeatmap({ trades }) {
  const [windowWeeks, setWindowWeeks] = useState(26);   // 6 months default
  const [hover, setHover] = useState(null);

  // Aggregate closed trades by yyyy-mm-dd.
  const daily = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      // Prefer exit_time, fall back to entry_time. Date-only key.
      const iso = t.exit_time || t.entry_time;
      if (!iso) return;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const cur = map.get(key) || { pnl: 0, count: 0 };
      cur.pnl += t.profit_loss;
      cur.count += 1;
      map.set(key, cur);
    });
    return map;
  }, [trades]);

  // Build the grid — anchor on today, walk back windowWeeks.
  const grid = useMemo(() => {
    const cells = [];
    const now = new Date();
    now.setHours(0,0,0,0);
    // Snap "today" back to Saturday so the last column is a complete week.
    // Actually simpler: use the current week as the rightmost column.
    const daysBack = windowWeeks * 7;
    const start = new Date(now);
    start.setDate(now.getDate() - daysBack + 1);
    // Align start to Monday so rows read Mon-Sun.
    const dow = (start.getDay() + 6) % 7; // 0=Mon
    start.setDate(start.getDate() - dow);
    for (let i = 0; i < windowWeeks * 7 + dow; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const stats = daily.get(key);
      cells.push({ date: d, key, pnl: stats?.pnl ?? null, count: stats?.count ?? 0, isFuture: d > now });
    }
    return cells;
  }, [daily, windowWeeks]);

  // Bucket P&L into 5 intensity levels for color scaling.
  const maxAbs = useMemo(() => {
    let m = 0;
    grid.forEach(c => { if (c.pnl != null) m = Math.max(m, Math.abs(c.pnl)); });
    return m || 1;
  }, [grid]);

  const cellClass = (c) => {
    if (c.isFuture) return "bg-slate-900 border border-slate-800";
    if (c.pnl == null || c.count === 0) return "bg-slate-800/60";
    const intensity = Math.min(4, Math.floor((Math.abs(c.pnl) / maxAbs) * 4)); // 0..4
    if (c.pnl > 0) return ["bg-emerald-900","bg-emerald-800","bg-emerald-700","bg-emerald-600","bg-emerald-500"][intensity];
    return ["bg-rose-900","bg-rose-800","bg-rose-700","bg-rose-600","bg-rose-500"][intensity];
  };

  const monthLabels = useMemo(() => {
    // For each week column, if the Monday of that week starts a new month, note it.
    const labels = [];
    const weeks = Math.ceil(grid.length / 7);
    let prevMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const monday = grid[w * 7];
      if (!monday) continue;
      if (monday.date.getMonth() !== prevMonth) {
        labels.push({ w, label: monday.date.toLocaleString("en-US", { month: "short" }) });
        prevMonth = monday.date.getMonth();
      }
    }
    return labels;
  }, [grid]);

  const weeks = Math.ceil(grid.length / 7);
  const totalPnl = useMemo(() => grid.reduce((s, c) => s + (c.pnl || 0), 0), [grid]);
  const winDays  = useMemo(() => grid.filter(c => c.pnl > 0).length, [grid]);
  const lossDays = useMemo(() => grid.filter(c => c.pnl < 0).length, [grid]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <div className="flex justify-between items-baseline flex-wrap gap-2">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500"/>
              P&L Calendar
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Each cell is one day. Emerald = winning day, rose = losing day. Hover for detail.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[13, 26, 52].map(w => (
              <button key={w} onClick={() => setWindowWeeks(w)}
                      className={`h-7 px-2.5 rounded text-xs font-semibold ${
                        windowWeeks === w ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}>
                {w === 13 ? "3M" : w === 26 ? "6M" : "1Y"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-4 text-xs mt-2">
          <span className="text-slate-500">Total: <span className={totalPnl >= 0 ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>${totalPnl.toFixed(2)}</span></span>
          <span className="text-slate-500">Win days: <span className="text-emerald-400 font-semibold">{winDays}</span></span>
          <span className="text-slate-500">Loss days: <span className="text-rose-400 font-semibold">{lossDays}</span></span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="inline-flex flex-col gap-1">
            {/* Month labels */}
            <div className="flex gap-1 pl-8 relative h-4">
              {monthLabels.map(m => (
                <span key={m.w} className="absolute text-[10px] text-slate-500 uppercase tracking-wider"
                      style={{ left: `${32 + m.w * 16}px` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              {/* Weekday labels */}
              <div className="flex flex-col gap-1 pr-1 pt-0">
                {["Mon","","Wed","","Fri","",""].map((d, i) => (
                  <span key={i} className="text-[10px] text-slate-500 h-3 leading-3 w-6 text-right">{d}</span>
                ))}
              </div>
              {/* Grid */}
              {Array.from({length: weeks}, (_, w) => (
                <div key={w} className="flex flex-col gap-1">
                  {Array.from({length: 7}, (_, dow) => {
                    const c = grid[w * 7 + dow];
                    if (!c) return <div key={dow} className="w-3 h-3"/>;
                    return (
                      <div key={dow}
                           onMouseEnter={() => setHover(c)}
                           onMouseLeave={() => setHover(null)}
                           className={`w-3 h-3 rounded-sm cursor-pointer transition-transform hover:scale-125 ${cellClass(c)}`}/>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* Legend + tooltip */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800 text-xs">
              <div className="text-slate-500">
                {hover
                  ? (
                    <>
                      <span className="text-white font-semibold">
                        {hover.date.toLocaleDateString("en-US", {weekday:"short", month:"short", day:"numeric", year:"numeric"})}
                      </span>
                      {" · "}
                      <span className={hover.pnl > 0 ? "text-emerald-400" : hover.pnl < 0 ? "text-rose-400" : "text-slate-500"}>
                        {hover.pnl != null ? `${hover.pnl >= 0 ? "+" : ""}$${hover.pnl.toFixed(2)}` : "No trades"}
                      </span>
                      {hover.count > 0 && <span className="text-slate-500 ml-2">· {hover.count} trade{hover.count > 1 ? "s" : ""}</span>}
                    </>
                  )
                  : "Hover a cell for detail"}
              </div>
              <div className="flex items-center gap-1 text-slate-500">
                <span>Less</span>
                {["bg-slate-800/60","bg-emerald-900","bg-emerald-700","bg-emerald-500"].map((c,i) => (
                  <span key={i} className={`w-3 h-3 rounded-sm ${c}`}/>
                ))}
                <span>More</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #174 — Monthly P&L pivot table. Rows = groups (strategy/asset/
// account/session), cols = months, cells = $ + win%. Toggleable dim.
// ────────────────────────────────────────────────────────────────
function MonthlyPivot() {
  const [groupBy, setGroupBy] = useState("strategy");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    api(`/api/analytics/monthly?group_by=${groupBy}`)
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(e => { if (alive) { setErr(e.message || String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [groupBy]);

  const cellCls = (pnl) =>
    pnl > 0 ? "text-green-400"
    : pnl < 0 ? "text-red-400"
    : "text-slate-500";
  const fmt$ = (n) => n == null || isNaN(n)
    ? "—"
    : (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const monthLabel = (m) => {
    if (!m || m === "unknown") return "?";
    const [y, mo] = m.split("-");
    const d = new Date(parseInt(y), parseInt(mo) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-500"/>
          <CardTitle className="text-white">Monthly Performance</CardTitle>
        </div>
        <div className="inline-flex rounded-md border border-slate-700 bg-slate-950 p-0.5 text-xs">
          {[
            { k: "strategy", label: "By Strategy" },
            { k: "asset",    label: "By Asset" },
            { k: "account",  label: "By Account" },
            { k: "session",  label: "By Session" },
          ].map(o => (
            <button
              key={o.k}
              onClick={() => setGroupBy(o.k)}
              className={`px-3 py-1 rounded-sm font-semibold transition-colors ${
                groupBy === o.k
                  ? "bg-blue-500 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading && <div className="p-6 text-sm text-slate-400 font-mono">Loading pivot…</div>}
        {err && <div className="p-6 text-sm text-red-400 font-mono">Error: {err}</div>}
        {!loading && !err && data && data.periods.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-sm">
            No closed trades yet. Once trades close, the pivot fills in.
          </div>
        )}
        {!loading && !err && data && data.periods.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-slate-900 z-10">
                    {groupBy === "strategy" ? "Strategy"
                      : groupBy === "asset" ? "Asset"
                      : groupBy === "account" ? "Account"
                      : "Session"}
                  </th>
                  {data.periods.map(m => (
                    <th key={m} className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-semibold bg-slate-950/40 whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g, i) => (
                  <tr key={g.key} className={`border-b border-slate-800/60 hover:bg-slate-800/30 ${i % 2 === 0 ? "" : "bg-slate-800/10"}`}>
                    <td className="px-3 py-2 text-slate-200 font-sans font-semibold sticky left-0 bg-slate-900 group-hover:bg-slate-800/30 z-10">
                      {g.label}
                    </td>
                    {data.periods.map(m => {
                      const cell = g.months[m];
                      if (!cell) return <td key={m} className="px-3 py-2 text-right text-slate-700">—</td>;
                      return (
                        <td key={m} className="px-3 py-2 text-right">
                          <div className={cellCls(cell.pnl)}>{fmt$(cell.pnl)}</div>
                          <div className="text-[10px] text-slate-500">{cell.win_rate}% · {cell.trades}t</div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right bg-slate-950/40">
                      <div className={cellCls(g.totals.pnl) + " font-bold"}>{fmt$(g.totals.pnl)}</div>
                      <div className="text-[10px] text-slate-500">{g.totals.win_rate}% · {g.totals.trades}t</div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700 bg-slate-950/50">
                  <td className="px-3 py-2 text-slate-300 font-sans font-bold sticky left-0 bg-slate-950/80 z-10 text-[11px] uppercase tracking-wider">
                    Total
                  </td>
                  {data.periods.map(m => {
                    const cell = data.totals_by_month[m] || { pnl: 0, win_rate: 0, trades: 0 };
                    return (
                      <td key={m} className="px-3 py-2 text-right">
                        <div className={cellCls(cell.pnl) + " font-bold"}>{fmt$(cell.pnl)}</div>
                        <div className="text-[10px] text-slate-500">{cell.win_rate}% · {cell.trades}t</div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right bg-slate-900">
                    <div className={cellCls(data.grand_total.pnl) + " font-bold text-sm"}>
                      {fmt$(data.grand_total.pnl)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {data.grand_total.win_rate}% · {data.grand_total.trades}t
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Trader Review — day tally + emotion perf + mistake frequency.
// Answers: how many days I actually won vs lost, which mental
// states pay me, which mistakes cost me most.
// ────────────────────────────────────────────────────────────────
function TraderReview({ trades }) {
  // ── Day tally ────────────────────────────────────────────────
  // Aggregate closed trades by date; classify each day.
  const dayStats = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      const iso = t.exit_time || t.entry_time;
      if (!iso) return;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const cur = map.get(key) || { pnl: 0, count: 0 };
      cur.pnl += t.profit_loss;
      cur.count += 1;
      map.set(key, cur);
    });
    let wins = 0, losses = 0, be = 0;
    map.forEach(({ pnl }) => {
      if (pnl > 0.01)  wins++;
      else if (pnl < -0.01) losses++;
      else be++;
    });
    const total = wins + losses + be;
    return { wins, losses, be, total };
  }, [trades]);

  // ── Tag rollups ──────────────────────────────────────────────
  // For each known emotion/mistake tag, aggregate the trades that
  // carry that tag: count, wins, losses, net P&L.
  const tagRollup = useMemo(() => {
    const closed = (trades || []).filter(t => t.status === "closed" && t.profit_loss != null);
    const totalTagged = new Set();
    const bucket = new Map(); // slug → { count, wins, losses, netPnl }

    closed.forEach(t => {
      const tags = getTags(t.id);
      if (!tags.length) return;
      totalTagged.add(t.id);
      tags.forEach(slug => {
        const cur = bucket.get(slug) || { count: 0, wins: 0, losses: 0, netPnl: 0 };
        cur.count++;
        if (t.profit_loss > 0)      cur.wins++;
        else if (t.profit_loss < 0) cur.losses++;
        cur.netPnl += t.profit_loss;
        bucket.set(slug, cur);
      });
    });

    const roll = (list) => list.map(t => {
      const b = bucket.get(t.slug);
      if (!b) return { ...t, count: 0, wins: 0, losses: 0, netPnl: 0, winRate: null };
      return { ...t, ...b, winRate: b.count > 0 ? (b.wins / b.count) * 100 : null };
    });

    const emotions = roll(EMOTION_TAGS);
    const mistakes = roll(MISTAKE_TAGS).filter(m => m.count > 0)  // hide zero-count clutter
                                        .sort((a,b) => b.count - a.count);

    const knownSlugs = new Set([...EMOTION_TAGS, ...MISTAKE_TAGS].map(t => t.slug));
    const freeform = allUsedTags()
      .filter(s => !knownSlugs.has(s))
      .map(s => ({ slug: s, ...(bucket.get(s) || { count: 0, wins: 0, losses: 0, netPnl: 0 }) }))
      .filter(t => t.count > 0)
      .sort((a,b) => b.count - a.count);

    return { emotions, mistakes, freeform, totalTagged: totalTagged.size, closedCount: closed.length };
  }, [trades]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-500"/>
          Trader Review
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          Which days paid, which mental states paid, which mistakes cost.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ── Day tally ── */}
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Day tally</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <DayTile label="Win days"       value={dayStats.wins}   total={dayStats.total} valueColor="text-emerald-400"/>
            <DayTile label="Loss days"      value={dayStats.losses} total={dayStats.total} valueColor="text-rose-400"/>
            <DayTile label="Break-even"     value={dayStats.be}     total={dayStats.total} valueColor="text-slate-300"/>
            <DayTile label="Total"          value={dayStats.total}  total={null}           valueColor="text-white"/>
          </div>
        </div>

        {/* ── Emotion performance ── */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Emotion performance</div>
            <div className="text-xs text-slate-500">
              {tagRollup.totalTagged} of {tagRollup.closedCount} closed trades tagged
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tagRollup.emotions.map(t => (
              <TagRollupRow key={t.slug} tag={t} totalTagged={tagRollup.totalTagged}/>
            ))}
          </div>
          {tagRollup.totalTagged === 0 && (
            <p className="text-xs text-slate-500 italic mt-2">
              No trades tagged yet — add Prepared / Confident / Guessing / Impulsive on the Trades page to see this fill in.
            </p>
          )}
        </div>

        {/* ── Mistake frequency ── */}
        {tagRollup.mistakes.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400"/>
              Mistake frequency
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {tagRollup.mistakes.map(t => (
                <TagRollupRow key={t.slug} tag={t} totalTagged={tagRollup.totalTagged}/>
              ))}
            </div>
          </div>
        )}

        {/* ── Freeform hashtags ── */}
        {tagRollup.freeform.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Your hashtags</div>
            <div className="flex flex-wrap gap-1.5">
              {tagRollup.freeform.map(t => (
                <span key={t.slug}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-blue-600/20 text-blue-300 border border-blue-500/30">
                  #{t.slug}
                  <span className="text-blue-300/70">×{t.count}</span>
                  <span className={t.netPnl >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {t.netPnl >= 0 ? "+" : ""}${t.netPnl.toFixed(0)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}

function DayTile({ label, value, total, valueColor }) {
  const pct = total ? Math.round((value / total) * 100) : null;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
      {pct != null && total > 0 && (
        <div className="text-xs text-slate-500 mt-0.5">{pct}% of days</div>
      )}
    </div>
  );
}

function TagRollupRow({ tag, totalTagged }) {
  const meta = tagMeta(tag.slug);
  const pct = totalTagged > 0 ? (tag.count / totalTagged) * 100 : 0;
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${meta.color}`}>
          {meta.label}
        </span>
        <span className="text-xs text-slate-500 tabular-nums">
          ×{tag.count} · {pct.toFixed(0)}%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Win rate</div>
          <div className={`font-bold tabular-nums ${tag.winRate == null ? "text-slate-500" : tag.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
            {tag.winRate == null ? "—" : `${tag.winRate.toFixed(0)}%`}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">W / L</div>
          <div className="font-semibold text-slate-200 tabular-nums">
            {tag.wins}<span className="text-slate-500">/</span>{tag.losses}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Net P&L</div>
          <div className={`font-bold tabular-nums ${tag.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {tag.netPnl >= 0 ? "+" : ""}${tag.netPnl.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #125 — Per-asset P&L breakdown. Answers "which instrument
// should I focus on / stop trading?" — sorted by net $.
// ────────────────────────────────────────────────────────────────
function PerAssetBreakdown({ trades }) {
  const rows = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      const sym = (t.symbol || t.ticker || "?").toString().toUpperCase().replace(/[!1]+$/, "");
      const row = map.get(sym) || { sym, wins: 0, losses: 0, net: 0, gross_win: 0, gross_loss: 0, count: 0 };
      row.count += 1;
      if (t.profit_loss > 0) { row.wins += 1; row.gross_win += t.profit_loss; }
      else if (t.profit_loss < 0) { row.losses += 1; row.gross_loss += Math.abs(t.profit_loss); }
      row.net += t.profit_loss;
      map.set(sym, row);
    });
    return [...map.values()].sort((a, b) => b.net - a.net);
  }, [trades]);

  if (rows.length === 0) return null;
  const maxAbsNet = Math.max(...rows.map(r => Math.abs(r.net)), 1);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-400"/> Per-asset breakdown
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Where your P&amp;L actually comes from. Sorted by net $. Green = keep trading, red = review or cut.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => {
          const winRate = r.count ? (r.wins / r.count) * 100 : 0;
          const pf = r.gross_loss > 0 ? r.gross_win / r.gross_loss : (r.gross_win > 0 ? Infinity : 0);
          const barPct = Math.min(100, (Math.abs(r.net) / maxAbsNet) * 100);
          return (
            <div key={r.sym} className="rounded-md border border-slate-800 bg-slate-950 p-2.5">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono font-bold text-white">{r.sym}</span>
                  <span className="text-slate-500 text-xs">{r.count} trade{r.count !== 1 ? "s" : ""}</span>
                </div>
                <div className={`font-mono font-bold tabular-nums ${r.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.net >= 0 ? "+" : ""}${r.net.toFixed(2)}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-2">
                <div className={`h-full ${r.net >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                     style={{ width: `${barPct}%` }}/>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                <div><span className="text-slate-500">Win rate:</span> <span className="text-slate-200 font-mono">{winRate.toFixed(0)}%</span></div>
                <div><span className="text-slate-500">W/L:</span> <span className="text-slate-200 font-mono">{r.wins}/{r.losses}</span></div>
                <div><span className="text-slate-500">PF:</span> <span className="text-slate-200 font-mono">{isFinite(pf) ? pf.toFixed(2) : "∞"}</span></div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #126 — Pine version detection rollup. Auto-detects which
// Freeballin Pro version emitted each observed alert from the
// strategy_name fingerprints, then counts + shows share.
// ────────────────────────────────────────────────────────────────
function PineVersionRollup({ trades }) {
  const rows = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      // Detect from any payload field we might have stored.
      const version = detectPineVersion(t) || "Unknown";
      const entry = map.get(version) || { version, count: 0, net: 0, wins: 0, losses: 0 };
      entry.count += 1;
      if (t.status === "closed" && t.profit_loss != null) {
        entry.net += t.profit_loss;
        if (t.profit_loss > 0) entry.wins += 1;
        else if (t.profit_loss < 0) entry.losses += 1;
      }
      map.set(version, entry);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [trades]);

  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-blue-400"/> Detected Pine versions
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Auto-inferred from each alert's strategy_name fingerprint. Handy after a Pine upgrade to prove signals came from the new version.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-slate-500 text-sm">No trades yet. Once alerts arrive, TradeCore will detect which Pine version fired each one.</p>
        ) : rows.map(r => {
          const share = total > 0 ? (r.count / total) * 100 : 0;
          const known = r.version !== "Unknown";
          return (
            <div key={r.version} className="rounded-md border border-slate-800 bg-slate-950 p-2.5">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono font-bold ${known ? "text-white" : "text-slate-500"}`}>{r.version}</span>
                  <span className="text-slate-500 text-xs">{r.count} alert{r.count !== 1 ? "s" : ""} · {share.toFixed(0)}%</span>
                </div>
                <div className={`font-mono font-bold tabular-nums ${r.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.net >= 0 ? "+" : ""}${r.net.toFixed(2)}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-1">
                <div className="h-full bg-blue-500" style={{ width: `${share}%` }}/>
              </div>
              <div className="text-[11px] text-slate-500">
                {r.wins}W · {r.losses}L
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #135 · #136 — Slippage + commission tracker.
// Slippage = (fill_price − expected_entry) × direction × qty × pv.
// Commission = commission field on the trade (if broker delivered it)
// or Trade.commission_amount. Falls back to a per-broker default table
// so the numbers aren't blank on day one.
// ────────────────────────────────────────────────────────────────
function SlippageCommissionCard({ trades }) {
  const rows = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      const broker = String(t.broker || "unknown").toLowerCase();
      const row = map.get(broker) || { broker, count: 0, slip_total: 0, slip_ticks: 0, comm: 0 };
      row.count += 1;
      const expected = t.expected_entry ?? t.pine_entry ?? null;
      const filled   = t.entry_price ?? null;
      if (expected != null && filled != null) {
        const isLong = (t.direction || t.side || "").toLowerCase() === "long";
        // Slippage in dollars: negative = you paid worse than expected.
        row.slip_total += (isLong ? -(filled - expected) : (filled - expected)) * (t.qty_total || 1);
        row.slip_ticks += Math.abs(filled - expected) / (t.tick_size || 0.25);
      }
      const c = t.commission ?? t.commission_amount ?? null;
      if (c != null) row.comm += Math.abs(c);
      map.set(broker, row);
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [trades]);

  if (rows.length === 0) return null;
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-400"/> Slippage &amp; commissions
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Per-broker: average slippage vs expected entry, avg ticks lost, total commission paid. Missing data means the trade didn't carry an expected_entry field.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => {
          const avgSlip = r.count ? r.slip_total / r.count : 0;
          const avgTicks = r.count ? r.slip_ticks / r.count : 0;
          const avgComm = r.count ? r.comm / r.count : 0;
          return (
            <div key={r.broker} className="rounded-md border border-slate-800 bg-slate-950 p-2.5">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-white font-mono font-bold capitalize">{r.broker}</span>
                <span className="text-slate-500 text-xs">{r.count} closed</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Avg slippage</div>
                  <div className={`font-mono ${avgSlip >= 0 ? "text-emerald-400" : "text-rose-400"} font-semibold`}>
                    {avgSlip >= 0 ? "+" : "-"}${Math.abs(avgSlip).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Avg ticks lost</div>
                  <div className="font-mono text-white font-semibold">{avgTicks.toFixed(1)}t</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Total comm</div>
                  <div className="font-mono text-white font-semibold">${r.comm.toFixed(2)}</div>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Avg comm/trade: ${avgComm.toFixed(2)}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #143 — Timeframe-aware trade grouping.
// Bucket closed trades by their tagged timeframe ("1m" / "5m" /
// "15m" / "1h" / "4h" / "D") — pulled from strategy.timeframe or
// trade.timeframe. Answers "which TF am I actually best at?"
// ────────────────────────────────────────────────────────────────
function TimeframeGrouping({ trades }) {
  const rows = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      const tf = (t.timeframe || t.strategy_timeframe || "?").toString();
      const row = map.get(tf) || { tf, count: 0, wins: 0, losses: 0, net: 0 };
      row.count += 1;
      row.net += t.profit_loss;
      if (t.profit_loss > 0) row.wins += 1;
      else if (t.profit_loss < 0) row.losses += 1;
      map.set(tf, row);
    });
    return [...map.values()].sort((a, b) => b.net - a.net);
  }, [trades]);

  if (rows.length === 0) return null;
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-400"/> Timeframe breakdown
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Where your P&amp;L comes from by chart timeframe. Tagged from the strategy or trade payload.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => {
          const wr = r.count ? (r.wins / r.count) * 100 : 0;
          return (
            <div key={r.tf} className="grid grid-cols-[70px_1fr_100px] items-center gap-3 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
              <span className="font-mono font-bold text-white">{r.tf}</span>
              <div className="text-xs text-slate-400">
                <span className="text-slate-200 font-mono">{r.count}</span> trades ·{" "}
                <span className="text-slate-200 font-mono">{wr.toFixed(0)}%</span> WR ·{" "}
                <span className="font-mono">{r.wins}/{r.losses}</span>
              </div>
              <span className={`text-right tabular-nums font-bold ${r.net >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {r.net >= 0 ? "+" : "-"}${Math.abs(r.net).toFixed(2)}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #81 — Correlated exposure + heat monitor.
// Right now = current heat: sum of RISK on all open trades, grouped
// by asset class. Warns when a single class > 60% of total heat.
// When #17 market data lands we'll layer real-time correlation on.
// ────────────────────────────────────────────────────────────────
function HeatMonitor({ trades }) {
  const openHeat = useMemo(() => {
    const open = (trades || []).filter(t => {
      const s = (t.status || "").toLowerCase();
      return s !== "closed" && s !== "cancelled";
    });
    if (open.length === 0) return null;
    const byClass = new Map();
    let totalRisk = 0;
    open.forEach(t => {
      const risk = t.risk_amount ?? t.risk ?? Math.abs((t.entry_price - t.stop_loss) * (t.qty_open || t.qty_total || 1)) ?? 0;
      totalRisk += risk;
      const sym = (t.symbol || t.ticker || "?").toUpperCase().replace(/[!1]+$/, "");
      const klass = sym.startsWith("MNQ") || sym.startsWith("NQ") || sym.startsWith("MES") || sym.startsWith("ES") || sym.startsWith("YM") || sym.startsWith("MYM") || sym.startsWith("RTY") || sym.startsWith("M2K")
        ? "Equity Index"
        : sym.startsWith("GC") || sym.startsWith("MGC") || sym.startsWith("SI") || sym.startsWith("HG")
        ? "Metals"
        : sym.startsWith("CL") || sym.startsWith("NG") || sym.startsWith("MNG") || sym.startsWith("RB") || sym.startsWith("HO")
        ? "Energy"
        : "FX / Other";
      const row = byClass.get(klass) || { klass, risk: 0, count: 0, symbols: new Set() };
      row.risk += risk; row.count += 1; row.symbols.add(sym);
      byClass.set(klass, row);
    });
    return {
      totalRisk,
      openCount: open.length,
      rows: [...byClass.values()].sort((a, b) => b.risk - a.risk),
    };
  }, [trades]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-blue-400"/> Heat &amp; correlated exposure
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Live risk on the table, grouped by asset class. Correlated pairs (e.g. NQ + ES) get counted separately today — full correlation matrix ships with #17 market data.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {!openHeat ? (
          <p className="text-slate-500 text-sm">No open positions. Heat: <span className="text-emerald-400 font-mono">$0</span>.</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Total heat</div>
                <div className="text-2xl font-bold text-white tabular-nums">${openHeat.totalRisk.toFixed(0)}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Open positions</div>
                <div className="text-2xl font-bold text-white tabular-nums">{openHeat.openCount}</div>
              </div>
            </div>
            <div className="space-y-2">
              {openHeat.rows.map(r => {
                const pct = openHeat.totalRisk ? (r.risk / openHeat.totalRisk) * 100 : 0;
                const isHot = pct > 60;
                return (
                  <div key={r.klass} className={`rounded-md border p-2.5 ${isHot ? "border-red-800/60 bg-red-950/30" : "border-slate-800 bg-slate-950"}`}>
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <span className="text-white font-semibold text-sm">{r.klass}</span>
                      <span className={`text-xs font-bold tabular-nums ${isHot ? "text-red-300" : "text-slate-200"}`}>
                        ${r.risk.toFixed(0)} <span className="text-slate-500">· {pct.toFixed(0)}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mb-1">
                      <div className={`h-full ${isHot ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }}/>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      {[...r.symbols].join(" · ")} · {r.count} pos
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #103 — Broker execution quality report.
// Fill time (signal → fill latency), reject rate, avg latency.
// When any trade carries `signal_time` and `fill_time` fields the
// numbers are real; otherwise we render an empty-state that names
// what data would populate the panel.
// ────────────────────────────────────────────────────────────────
function BrokerExecutionQuality({ trades }) {
  const rows = useMemo(() => {
    const map = new Map();
    (trades || []).forEach(t => {
      const broker = String(t.broker || "unknown").toLowerCase();
      const r = map.get(broker) || { broker, sent: 0, filled: 0, rejected: 0, latencies: [] };
      r.sent += 1;
      if (t.status === "rejected" || t.reject_reason) r.rejected += 1;
      const st = t.signal_time || t.alert_time || null;
      const ft = t.fill_time   || t.entry_time || null;
      if (st && ft) {
        const ms = new Date(ft).getTime() - new Date(st).getTime();
        if (ms >= 0 && ms < 60_000) r.latencies.push(ms);
      }
      if (t.status !== "rejected" && !t.reject_reason && (t.entry_price || t.status === "closed")) r.filled += 1;
      map.set(broker, r);
    });
    return [...map.values()].map(r => {
      const rejectRate = r.sent > 0 ? (r.rejected / r.sent) * 100 : 0;
      const avgLatency = r.latencies.length > 0 ? r.latencies.reduce((s, x) => s + x, 0) / r.latencies.length : null;
      const p95Latency = r.latencies.length > 0 ? [...r.latencies].sort((a, b) => a - b)[Math.floor(r.latencies.length * 0.95)] : null;
      return { ...r, rejectRate, avgLatency, p95Latency };
    }).sort((a, b) => b.sent - a.sent);
  }, [trades]);

  if (rows.length === 0) return null;
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Gauge className="w-5 h-5 text-blue-400"/> Broker execution quality
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Fill latency, reject rate, and P95 latency per broker. Populated once trades carry <code>signal_time</code> + <code>fill_time</code> fields (Tradovate direct + PMT+observe when the observe endpoint stamps arrival time).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(r => {
          const gotLatency = r.latencies.length > 0;
          return (
            <div key={r.broker} className="rounded-md border border-slate-800 bg-slate-950 p-2.5">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-white font-mono font-bold capitalize">{r.broker}</span>
                <span className="text-slate-500 text-xs">{r.sent} signal{r.sent !== 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Filled</div>
                  <div className="text-emerald-400 font-mono font-semibold">{r.filled}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Rejected</div>
                  <div className={`font-mono font-semibold ${r.rejectRate >= 5 ? "text-rose-400" : "text-slate-200"}`}>
                    {r.rejected} <span className="text-slate-500 text-[10px]">· {r.rejectRate.toFixed(1)}%</span>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">Avg latency</div>
                  <div className="text-white font-mono font-semibold">
                    {gotLatency ? `${Math.round(r.avgLatency)}ms` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-slate-500">P95 latency</div>
                  <div className={`font-mono font-semibold ${r.p95Latency > 1000 ? "text-rose-400" : "text-white"}`}>
                    {gotLatency ? `${Math.round(r.p95Latency)}ms` : "—"}
                  </div>
                </div>
              </div>
              {!gotLatency && (
                <div className="text-[10px] text-slate-500 mt-1">
                  Latency needs both <code>signal_time</code> and <code>fill_time</code> on the trade row.
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
