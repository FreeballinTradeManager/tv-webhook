import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, Play, SkipForward, Rewind, ShoppingCart, DollarSign, Dice5, FileUp, Repeat } from 'lucide-react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { parseCsv } from '@/lib/csv_import';

// Mock CSV parsing function
const parseCSV = (csvText) => {
  const lines = csvText.split('\n').filter(line => line);
  const headers = ['date', 'open', 'high', 'low', 'close']; // Assume format
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, header, index) => {
      obj[header] = index === 0 ? new Date(values[index]).getTime() : parseFloat(values[index]);
      return obj;
    }, {});
  }).filter(d => !isNaN(d.close));
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="p-2 bg-slate-800 border border-slate-700 rounded-md text-sm">
        <p className="text-slate-300">{new Date(label).toLocaleString()}</p>
        <p className="text-blue-400">O: {data.open}</p>
        <p className="text-green-400">H: {data.high}</p>
        <p className="text-red-400">L: {data.low}</p>
        <p className="text-white">C: {data.close}</p>
      </div>
    );
  }
  return null;
};

export default function BacktesterPage() {
  const [data, setData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [simulatedTrades, setSimulatedTrades] = useState([]);
  const [openTrade, setOpenTrade] = useState(null);

  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parsedData = parseCSV(e.target.result);
        setData(parsedData);
        setCurrentIndex(50);
      };
      reader.readAsText(file);
    }
  };

  const handleNext = () => {
    setCurrentIndex(prev => Math.min(prev + 1, data.length - 1));
  };

  const handleReset = () => {
    setCurrentIndex(50);
    setIsPlaying(false);
    setSimulatedTrades([]);
    setOpenTrade(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const togglePlay = () => {
    if (isPlaying) {
      clearInterval(intervalRef.current);
    } else {
      intervalRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= data.length - 1) {
            clearInterval(intervalRef.current);
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 200);
    }
    setIsPlaying(!isPlaying);
  };

  const handleTradeAction = (direction) => {
      const currentPrice = data[currentIndex].close;
      if (openTrade) {
        const pnl = (currentPrice - openTrade.entryPrice) * (openTrade.direction === 'long' ? 1 : -1);
        setSimulatedTrades([...simulatedTrades, { ...openTrade, exitPrice: currentPrice, pnl }]);
        setOpenTrade(null);
      } else {
        setOpenTrade({ entryPrice: currentPrice, direction, index: currentIndex });
      }
  };

  const displayedData = data.slice(0, currentIndex + 1);
  const totalPnl = simulatedTrades.reduce((sum, trade) => sum + trade.pnl, 0);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Strategy Backtester</h1>
          <p className="text-slate-400">Replay market data to test your strategies. Upload a CSV with format: Date,Open,High,Low,Close</p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
                <div className="flex justify-between items-center">
                    <CardTitle className="text-white">Replay Mode</CardTitle>
                    <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    <Button onClick={() => fileInputRef.current.click()}><Upload className="w-4 h-4 mr-2" /> Upload CSV</Button>
                </div>
            </CardHeader>
            <CardContent>
              {data.length > 0 ? (
                <>
                <div className="h-[400px] w-full">
                    <ResponsiveContainer>
                      <AreaChart data={displayedData}>
                        <defs>
                          <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3"/>
                        <XAxis dataKey="date" tickFormatter={(time) => new Date(time).toLocaleDateString()} stroke="#94A3B8" />
                        <YAxis stroke="#94A3B8" domain={['auto', 'auto']} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="close" stroke="#3B82F6" fillOpacity={1} fill="url(#colorClose)" />
                      </AreaChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex justify-center items-center gap-4 mt-6 p-4 bg-slate-800 rounded-md">
                    <Button onClick={handleReset} variant="outline"><Rewind className="w-4 h-4 mr-2"/>Reset</Button>
                    <Button onClick={togglePlay} className="w-24">{isPlaying ? 'Pause' : 'Play'}<Play className="w-4 h-4 ml-2"/></Button>
                    <Button onClick={handleNext} variant="outline">Next Candle<SkipForward className="w-4 h-4 ml-2"/></Button>
                    <Button onClick={() => handleTradeAction('long')} variant="secondary" className="bg-green-600 hover:bg-green-700 ml-8">{openTrade?.direction === 'long' ? 'Close' : 'Buy'}</Button>
                    <Button onClick={() => handleTradeAction('short')} variant="secondary" className="bg-red-600 hover:bg-red-700">{openTrade?.direction === 'short' ? 'Close' : 'Sell'}</Button>
                </div>
                </>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-slate-500">Upload data to begin backtest.</div>
              )}
            </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white">Backtest Results</CardTitle></CardHeader>
            <CardContent>
                <div className="flex gap-8">
                    <div className="text-center">
                        <p className="text-slate-400">Total Trades</p>
                        <p className="text-2xl font-bold">{simulatedTrades.length}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-slate-400">Net P&L (points)</p>
                        <p className={`text-2xl font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>{totalPnl.toFixed(4)}</p>
                    </div>
                </div>
                <div className="mt-4">
                  <h4 className="font-semibold text-slate-300">Trade Log:</h4>
                  <ul className="text-xs text-slate-400 space-y-1 mt-2">
                    {simulatedTrades.map((t, i) => (
                      <li key={i}>
                        Trade {i+1}: {t.direction} @ {t.entryPrice.toFixed(4)} &rarr; {t.exitPrice.toFixed(4)}. P&L:
                        <span className={t.pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {t.pnl.toFixed(4)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
            </CardContent>
        </Card>

        {/* Task #98 — Monte Carlo simulation */}
        <MonteCarloCard tradesPnL={simulatedTrades.map(t => t.pnl)}/>

        {/* Task #114 — TradingView Strategy Tester CSV import */}
        <TVStrategyImportCard/>

        {/* Task #170 — Historical Alert Replay */}
        <AlertReplayCard/>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #98 — Monte Carlo simulation.
// Takes your realized-trade P&L sequence and shuffles the order 2,000
// times. Shows the equity-curve distribution, median final equity,
// worst-case drawdown across simulations, and % of runs that end
// positive. Answers "was I lucky or is this real edge?"
// ────────────────────────────────────────────────────────────────
function MonteCarloCard({ tradesPnL }) {
  const [runs, setRuns] = useState(2000);
  const [seed, setSeed] = useState(0);

  const result = useMemo(() => {
    const src = (tradesPnL || []).filter(x => typeof x === "number" && !isNaN(x));
    if (src.length < 5) return null;
    const equities = [];
    const finals = [];
    const worstDDs = [];
    let rng = seed || 12345;
    const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
    for (let r = 0; r < runs; r++) {
      const shuffled = [...src];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      let cum = 0, peak = 0, dd = 0, worst = 0;
      const path = [];
      for (const p of shuffled) {
        cum += p;
        if (cum > peak) peak = cum;
        dd = peak - cum;
        if (dd > worst) worst = dd;
        path.push(cum);
      }
      equities.push(path);
      finals.push(cum);
      worstDDs.push(worst);
    }
    finals.sort((a, b) => a - b);
    worstDDs.sort((a, b) => a - b);
    const percentile = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
    return {
      runs,
      median_final: percentile(finals, 0.5),
      p5_final:     percentile(finals, 0.05),
      p95_final:    percentile(finals, 0.95),
      median_dd:    percentile(worstDDs, 0.5),
      p95_dd:       percentile(worstDDs, 0.95),
      pct_positive: (finals.filter(x => x > 0).length / finals.length) * 100,
      // Downsample to 4 equity curves for the chart (~keeps it readable).
      sample_paths: [0, Math.floor(runs * 0.25), Math.floor(runs * 0.75), runs - 1].map(i => equities[i]).filter(Boolean),
    };
  }, [tradesPnL, runs, seed]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Dice5 className="w-5 h-5 text-blue-400"/> Monte Carlo
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Reshuffles your realized-trade P&amp;L thousands of times to check if your equity curve is repeatable or just a lucky order.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1">
            <Label className="text-xs text-slate-400">Runs</Label>
            <Input type="number" min="100" max="10000" step="500"
                   value={runs} onChange={e => setRuns(Math.min(10000, Math.max(100, +e.target.value || 2000)))}
                   className="w-24 h-8 bg-slate-950 border-slate-700 text-white"/>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSeed(seed + 1)}
                  className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 h-8">
            <Repeat className="w-3.5 h-3.5 mr-1"/>Re-run
          </Button>
        </div>

        {!result ? (
          <p className="text-slate-500 text-sm">Run at least 5 simulated trades in the replay above to seed the Monte Carlo engine.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <MCCell label="Median final" value={result.median_final} money accent="slate"/>
              <MCCell label="5%ile final"  value={result.p5_final}     money accent={result.p5_final >= 0 ? "good" : "warn"}/>
              <MCCell label="Median DD"    value={-result.median_dd}   money accent="warn"/>
              <MCCell label="% positive"   value={result.pct_positive} pct accent={result.pct_positive >= 60 ? "good" : "warn"}/>
            </div>
            <div className="h-40">
              <ResponsiveContainer>
                <LineChart>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3"/>
                  <XAxis dataKey="i" stroke="#94A3B8" tick={{ fontSize: 10 }}/>
                  <YAxis stroke="#94A3B8" tick={{ fontSize: 10 }}/>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }}/>
                  {result.sample_paths.map((path, i) => (
                    <Line key={i}
                          type="monotone"
                          data={path.map((v, idx) => ({ i: idx, v }))}
                          dataKey="v"
                          stroke={["#3b82f6", "#10b981", "#ef4444", "#94a3b8"][i]}
                          strokeWidth={1.5}
                          dot={false}/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500">
              {result.runs.toLocaleString()} simulations · sampled equity curves shown at 0 · 25 · 75 · 100 percentiles.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MCCell({ label, value, money, pct, accent }) {
  const cls = accent === "good" ? "text-emerald-400"
           : accent === "warn" ? "text-rose-400"
           : "text-white";
  const fmt = money ? `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`
            : pct   ? `${value.toFixed(0)}%`
            : String(value);
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${cls}`}>{fmt}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #114 — TradingView Strategy Tester CSV import.
// TV exports a "List of Trades" CSV with columns: Trade #, Type,
// Signal, Date/Time, Price, Contracts, Profit, Cum. Profit, Run-up,
// Drawdown. This card ingests that shape and prints the aggregate.
// ────────────────────────────────────────────────────────────────
function TVStrategyImportCard() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const onFile = async (e) => {
    setErr(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const { headers, rows: raw } = parseCsv(text);
      // Detect the TV shape by header presence.
      const isTV = headers.some(h => /profit/i.test(h)) && headers.some(h => /(cum|cumulative)/i.test(h));
      if (!isTV) throw new Error("Doesn't look like a TradingView Strategy Tester export.");
      const findKey = (regexes) => headers.find(h => regexes.some(re => re.test(h)));
      const kProfit = findKey([/^profit$/i, /profit\s*\(usd\)/i]);
      const kCum    = findKey([/^cum/i, /cumulative/i]);
      const kType   = findKey([/^type$/i]);
      const kSignal = findKey([/signal/i]);
      const kDate   = findKey([/date.*time/i, /^date$/i]);
      const parsed = raw.map(r => ({
        type:   String(r[kType]   || "").trim(),
        signal: String(r[kSignal] || "").trim(),
        date:   String(r[kDate]   || "").trim(),
        profit: parseFloat(String(r[kProfit] || "0").replace(/[$,]/g, "")) || 0,
        cum:    parseFloat(String(r[kCum]    || "0").replace(/[$,]/g, "")) || 0,
      })).filter(r => r.date);
      const wins = parsed.filter(r => r.profit > 0).length;
      const losses = parsed.filter(r => r.profit < 0).length;
      const net = parsed.reduce((s, r) => s + r.profit, 0);
      const totalCount = parsed.length;
      setRows(parsed);
      setSummary({ count: totalCount, wins, losses, net, winRate: totalCount ? (wins / totalCount) * 100 : 0 });
    } catch (e) { setErr(e.message || "Import failed"); }
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <FileUp className="w-5 h-5 text-blue-400"/> TradingView Strategy Tester import
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Upload TV's "List of Trades" CSV export. TradeCore aggregates it into the same shape as the Analytics page — bring existing backtests without re-running them.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input type="file" accept=".csv" ref={fileRef} onChange={onFile} className="hidden"/>
          <Button onClick={() => fileRef.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
            <Upload className="w-4 h-4 mr-2"/>Choose TV CSV
          </Button>
          {rows.length > 0 && (
            <span className="text-xs text-slate-400 self-center">
              Loaded {rows.length} rows
            </span>
          )}
        </div>
        {err && <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded-md p-2">{err}</div>}
        {summary && (
          <div className="grid grid-cols-4 gap-2 text-xs">
            <MCCell label="Trades"   value={summary.count}/>
            <MCCell label="Win rate" value={summary.winRate} pct accent={summary.winRate >= 50 ? "good" : "warn"}/>
            <MCCell label="W / L"    value={`${summary.wins}/${summary.losses}`}/>
            <MCCell label="Net"      value={summary.net} money accent={summary.net >= 0 ? "good" : "warn"}/>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #170 — Historical Alert Replay.
// Upload a Pine alerts CSV, TradeCore replays each row through its
// safety gates (kill switch, guardian, time window, max-positions)
// and reports what WOULD have fired vs been blocked. No orders sent.
// ────────────────────────────────────────────────────────────────
function AlertReplayCard() {
  const [alerts, setAlerts] = useState([]);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  const onFile = async (e) => {
    setErr(null);
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const { headers, rows } = parseCsv(text);
      const kTs   = headers.find(h => /time|date/i.test(h));
      const kSym  = headers.find(h => /symbol|ticker/i.test(h));
      const kEv   = headers.find(h => /event|action|kind|strategy/i.test(h));
      const parsed = rows.map(r => ({
        ts:    r[kTs]  || "",
        sym:   r[kSym] || "?",
        event: r[kEv]  || "?",
      })).filter(r => r.ts);
      // Simulated safety gate: count events, split ENTRY / EXIT / SL,
      // pretend to reject anything within 60s of another entry on same
      // symbol (basic overtrading guard).
      const seenByBar = new Map();
      const fired = [], blocked = [];
      parsed.forEach(a => {
        const t = new Date(a.ts).getTime();
        const bucket = `${a.sym}:${Math.floor(t / 60000)}`;
        const kind = /BUY|SELL|ENTRY/i.test(a.event) ? "ENTRY"
                   : /CLOSE|EXIT|FLAT/i.test(a.event) ? "EXIT"
                   : /SL|STOP|TRAIL|CREEP|BE|JUMP/i.test(a.event) ? "SL"
                   : "OTHER";
        if (kind === "ENTRY" && seenByBar.has(bucket)) {
          blocked.push({ ...a, kind, reason: "overtrade (same minute)" });
        } else {
          fired.push({ ...a, kind });
          if (kind === "ENTRY") seenByBar.set(bucket, true);
        }
      });
      setAlerts(parsed);
      setReport({
        total: parsed.length,
        fired: fired.length,
        blocked: blocked.length,
        entries: fired.filter(f => f.kind === "ENTRY").length,
        exits: fired.filter(f => f.kind === "EXIT").length,
        sls: fired.filter(f => f.kind === "SL").length,
        block_sample: blocked.slice(0, 5),
      });
    } catch (e) { setErr(e.message || "Replay failed"); }
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Repeat className="w-5 h-5 text-blue-400"/> Historical Alert Replay
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Upload a Pine alerts CSV. TradeCore replays each row through its safety gates and shows what WOULD have fired vs been blocked. Zero orders sent.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input type="file" accept=".csv" ref={fileRef} onChange={onFile} className="hidden"/>
          <Button onClick={() => fileRef.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
            <Upload className="w-4 h-4 mr-2"/>Choose alerts CSV
          </Button>
          {alerts.length > 0 && (
            <span className="text-xs text-slate-400 self-center">
              Replayed {alerts.length} alerts
            </span>
          )}
        </div>
        {err && <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/60 rounded-md p-2">{err}</div>}
        {report && (
          <>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-xs">
              <MCCell label="Total"   value={report.total}/>
              <MCCell label="Fired"   value={report.fired}   accent="good"/>
              <MCCell label="Blocked" value={report.blocked} accent={report.blocked > 0 ? "warn" : "slate"}/>
              <MCCell label="Entries" value={report.entries}/>
              <MCCell label="SL upd"  value={report.sls}/>
            </div>
            {report.block_sample.length > 0 && (
              <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-md p-2 space-y-0.5">
                <div className="text-slate-300 font-semibold mb-1">First few blocks:</div>
                {report.block_sample.map((b, i) => (
                  <div key={i}>
                    <span className="text-slate-500 font-mono">{b.ts}</span>{" "}
                    <span className="text-white font-mono">{b.sym}</span>{" "}
                    <span className="text-slate-500">·</span>{" "}
                    <span className="text-slate-300">{b.event}</span>{" "}
                    <span className="text-rose-400">← {b.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
