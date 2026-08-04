import React, { useState, useEffect, useMemo } from "react";
import { Trade } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileBarChart, ChevronLeft, ChevronRight, Printer, Download,
  TrendingUp, TrendingDown, Award, AlertTriangle,
} from "lucide-react";
import { EMOTION_TAGS, MISTAKE_TAGS, tagMeta, getTags } from "@/lib/trade_tags";
import ShareCard from "@/components/ShareCard";
import { User } from "@/entities/all";

// Trader Weekly & Monthly Report.
// Two side-by-side reports scoped to the selected week and month —
// net P&L, W/L, best/worst day, avg RR, tag rollup, per-day bars.
// Printable (browser Print → save-as-PDF) so #89 monthly-PDF export
// is a one-click flow while the server-side PDF layer catches up.

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0,0,0,0);
  // Week starts Monday to match a trader's Mon-Fri view.
  const day = x.getDay(); // 0=Sun … 6=Sat
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function prettyDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function prettyRange(startISO, endISO) {
  return `${prettyDate(startISO)} → ${prettyDate(endISO)}`;
}

// Aggregate an array of trades into a report bundle.
function summarize(trades, startISO, endISO) {
  const closed = trades.filter(t => {
    if (t.status !== "closed" || t.profit_loss == null) return false;
    const ts = t.exit_time || t.entry_time;
    if (!ts) return false;
    const d = new Date(ts);
    const iso = isoDate(d);
    return iso >= startISO && iso <= endISO;
  });

  if (closed.length === 0) {
    return { count: 0, wins: 0, losses: 0, net: 0, gross_win: 0, gross_loss: 0,
             winRate: 0, avgWin: 0, avgLoss: 0, avgRR: null, pf: 0,
             daily: new Map(), bestDay: null, worstDay: null, tags: [], mistakes: [] };
  }

  const daily = new Map();
  let wins = 0, losses = 0, net = 0, gross_win = 0, gross_loss = 0;
  const winsArr = [], lossesArr = [];
  const tagCount = new Map();
  const mistakeCount = new Map();

  closed.forEach(t => {
    const pnl = t.profit_loss;
    net += pnl;
    if (pnl > 0) { wins += 1; gross_win += pnl; winsArr.push(pnl); }
    else if (pnl < 0) { losses += 1; gross_loss += Math.abs(pnl); lossesArr.push(Math.abs(pnl)); }
    const ts = t.exit_time || t.entry_time;
    const iso = isoDate(new Date(ts));
    const row = daily.get(iso) || { iso, pnl: 0, wins: 0, losses: 0, count: 0 };
    row.pnl += pnl; row.count += 1;
    if (pnl > 0) row.wins += 1;
    else if (pnl < 0) row.losses += 1;
    daily.set(iso, row);

    (getTags(t.id) || []).forEach(slug => {
      const isMistake = MISTAKE_TAGS.some(m => m.slug === slug);
      const bucket = isMistake ? mistakeCount : tagCount;
      const prev = bucket.get(slug) || { slug, count: 0, wins: 0, losses: 0, netPnl: 0 };
      prev.count += 1; prev.netPnl += pnl;
      if (pnl > 0) prev.wins += 1;
      else if (pnl < 0) prev.losses += 1;
      bucket.set(slug, prev);
    });
  });

  const days = [...daily.values()];
  const bestDay  = days.reduce((a, b) => (a && a.pnl > b.pnl ? a : b), null);
  const worstDay = days.reduce((a, b) => (a && a.pnl < b.pnl ? a : b), null);
  const avgWin  = wins > 0 ? gross_win / wins : 0;
  const avgLoss = losses > 0 ? gross_loss / losses : 0;
  const avgRR   = avgLoss > 0 ? avgWin / avgLoss : null;
  const pf      = gross_loss > 0 ? gross_win / gross_loss : (gross_win > 0 ? Infinity : 0);
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  return {
    count: closed.length, wins, losses, net, gross_win, gross_loss,
    winRate, avgWin, avgLoss, avgRR, pf,
    daily, bestDay, worstDay,
    tags:     [...tagCount.values()].sort((a, b) => b.count - a.count),
    mistakes: [...mistakeCount.values()].sort((a, b) => b.count - a.count),
  };
}

export default function ReportsPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekAnchor,  setWeekAnchor]  = useState(() => startOfWeek(new Date()));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [traderName, setTraderName] = useState("");
  // Day the share card is scoped to. Defaults to today; user can pick
  // any day inside the current-month range via the date input.
  const [shareDay, setShareDay] = useState(isoDate(new Date()));
  const [shareVariant, setShareVariant] = useState("square");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const [t, user] = await Promise.all([
        Trade.list("-entry_time", 1000).catch(() => []),
        User.me().catch(() => ({})),
      ]);
      if (alive) {
        setTrades(t || []);
        setTraderName((user && user.trader_name) || "");
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const weekStart = isoDate(weekAnchor);
  const weekEnd   = isoDate(addDays(weekAnchor, 6));
  const monthStart = isoDate(monthAnchor);
  const monthEnd   = isoDate(endOfMonth(monthAnchor));

  const week  = useMemo(() => summarize(trades, weekStart,  weekEnd),  [trades, weekStart, weekEnd]);
  const month = useMemo(() => summarize(trades, monthStart, monthEnd), [trades, monthStart, monthEnd]);
  // Single-day summary for the ShareCard (reuse the same aggregator with
  // start === end so the numbers match the daily bar exactly).
  const dailyShare = useMemo(() => summarize(trades, shareDay, shareDay), [trades, shareDay]);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen print:bg-white print:text-black">
      <div className="max-w-6xl mx-auto space-y-6">

        <header className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4 print:flex-col print:items-start">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2 print:text-black">
              <FileBarChart className="w-7 h-7 text-blue-500 print:text-black"/> Trader Reports
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl print:text-gray-700">
              Your week and month, side by side. Net P&amp;L, W/L, best + worst day, tag rollup. Use Print to save either as a PDF.
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <Button onClick={() => window.print()}
                    className="bg-blue-600 hover:bg-blue-700 text-white">
              <Printer className="w-4 h-4 mr-2"/>Print / Save as PDF
            </Button>
          </div>
        </header>

        {loading ? (
          <Skeleton className="h-96 bg-slate-800 print:hidden"/>
        ) : (
          <div className="grid lg:grid-cols-2 gap-6 print:grid-cols-1">

            <ReportPanel
              title="This week"
              range={prettyRange(weekStart, weekEnd)}
              summary={week}
              onPrev={() => setWeekAnchor(addDays(weekAnchor, -7))}
              onNext={() => setWeekAnchor(addDays(weekAnchor, 7))}
              onToday={() => setWeekAnchor(startOfWeek(new Date()))}
              daySlots={7}
              periodStart={weekAnchor}
            />

            <ReportPanel
              title="This month"
              range={`${monthAnchor.toLocaleDateString([], { month: "long", year: "numeric" })}`}
              summary={month}
              onPrev={() => setMonthAnchor(startOfMonth(addDays(monthAnchor, -1)))}
              onNext={() => setMonthAnchor(startOfMonth(addDays(endOfMonth(monthAnchor), 1)))}
              onToday={() => setMonthAnchor(startOfMonth(new Date()))}
              daySlots={endOfMonth(monthAnchor).getDate()}
              periodStart={monthAnchor}
            />
          </div>
        )}

        {/* Shareable daily card — SVG → PNG download, socials-ready. */}
        {!loading && (
          <div className="print:hidden space-y-3">
            <div className="flex items-baseline justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-white text-xl font-bold">Daily share card</h2>
                <p className="text-slate-400 text-xs">
                  Pick a day, choose square or story, download the PNG. Numbers pulled straight from your closed trades for that date.
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-xs text-slate-400">Day</label>
                <input type="date"
                       value={shareDay}
                       onChange={e => setShareDay(e.target.value)}
                       className="bg-slate-950 border border-slate-700 text-white rounded-md px-2 h-9 text-sm"/>
                <div className="flex rounded-md bg-slate-950 border border-slate-700 p-0.5">
                  {[
                    { k: "square", label: "1:1" },
                    { k: "story",  label: "9:16" },
                  ].map(v => (
                    <button key={v.k} type="button"
                            onClick={() => setShareVariant(v.k)}
                            className={`h-8 px-3 text-xs font-semibold rounded-md ${
                              shareVariant === v.k
                                ? "bg-blue-600 text-white"
                                : "text-slate-400 hover:text-white"
                            }`}>
                      {v.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <ShareCard
              trader_name={traderName}
              date_iso={shareDay}
              summary={dailyShare}
              variant={shareVariant}
            />
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { margin: 12mm; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: #fff !important; }
          .print\\:text-black { color: #000 !important; }
          .print\\:text-gray-700 { color: #333 !important; }
          .print\\:grid-cols-1 { grid-template-columns: 1fr !important; }
          .print\\:break-before { break-before: page; }
        }
      `}</style>
    </div>
  );
}

function ReportPanel({ title, range, summary, onPrev, onNext, onToday, daySlots, periodStart }) {
  const s = summary;
  const dayCells = [];
  for (let i = 0; i < daySlots; i++) {
    const d = addDays(periodStart, i);
    const iso = isoDate(d);
    const row = s.daily.get(iso);
    dayCells.push({ iso, row });
  }
  const maxAbs = Math.max(1, ...dayCells.map(c => c.row ? Math.abs(c.row.pnl) : 0));

  return (
    <Card className="bg-slate-900 border-slate-800 print:border-gray-300 print:bg-white print:break-before">
      <CardHeader className="pb-3 border-b border-slate-800">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-white text-lg print:text-black">{title}</CardTitle>
            <div className="text-xs text-slate-400 print:text-gray-600">{range}</div>
          </div>
          <div className="flex gap-1 print:hidden">
            <button onClick={onPrev} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <button onClick={onToday} className="px-2 h-8 rounded-md text-xs text-slate-300 hover:text-white hover:bg-slate-800">Today</button>
            <button onClick={onNext} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Big number row */}
        <div className="grid grid-cols-2 gap-3">
          <BigStat label="Net P&L"
                   value={`${s.net >= 0 ? "+" : "-"}$${Math.abs(s.net).toFixed(2)}`}
                   accent={s.net >= 0 ? "emerald" : "rose"}/>
          <BigStat label="Trades"
                   value={s.count}
                   accent="slate"/>
        </div>

        {/* Secondary stats */}
        <div className="grid grid-cols-4 gap-2">
          <MiniStat label="Win rate" value={s.count > 0 ? `${s.winRate.toFixed(0)}%` : "—"}/>
          <MiniStat label="W / L" value={`${s.wins}/${s.losses}`}/>
          <MiniStat label="Avg RR" value={s.avgRR == null ? "—" : `${s.avgRR.toFixed(2)}`}/>
          <MiniStat label="PF" value={s.pf === 0 ? "—" : (isFinite(s.pf) ? s.pf.toFixed(2) : "∞")}/>
        </div>

        {/* Best / worst day */}
        <div className="grid grid-cols-2 gap-3">
          <DayHighlight label="Best day"  day={s.bestDay}  accent="emerald"/>
          <DayHighlight label="Worst day" day={s.worstDay} accent="rose"/>
        </div>

        {/* Per-day bars */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 print:text-gray-600">
            Daily P&L
          </div>
          <div className={`grid gap-1 ${daySlots === 7 ? "grid-cols-7" : "grid-cols-7 sm:grid-cols-8 md:grid-cols-10"}`}>
            {dayCells.map(({ iso, row }) => {
              const d = new Date(iso + "T12:00:00");
              const label = d.getDate();
              const pnl = row ? row.pnl : 0;
              const barH = row ? Math.max(4, Math.round((Math.abs(pnl) / maxAbs) * 32)) : 2;
              const bg = pnl > 0 ? "bg-emerald-500" : pnl < 0 ? "bg-rose-500" : "bg-slate-700";
              const bgLite = pnl > 0 ? "bg-emerald-900/30" : pnl < 0 ? "bg-rose-900/30" : "bg-slate-950";
              return (
                <div key={iso}
                     title={`${iso} · ${row ? `$${pnl.toFixed(2)} · ${row.wins}W/${row.losses}L` : "no trades"}`}
                     className={`rounded border border-slate-800 print:border-gray-300 p-1 flex flex-col items-center ${bgLite}`}>
                  <div className="text-[9px] text-slate-500 print:text-gray-500">{label}</div>
                  <div className="flex-1 flex items-end justify-center w-full">
                    <div className={`${bg} rounded-sm w-full`} style={{ height: `${barH}px` }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tag rollup (emotions + mistakes) */}
        {(s.tags.length > 0 || s.mistakes.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 print:grid-cols-2">
            <TagList title="Top emotions" list={s.tags.slice(0, 5)}/>
            <TagList title="Top mistakes" list={s.mistakes.slice(0, 5)}/>
          </div>
        )}

        {s.count === 0 && (
          <div className="text-center text-slate-500 py-6 text-sm print:text-gray-600">
            No closed trades in this range yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BigStat({ label, value, accent }) {
  const color = accent === "emerald" ? "text-emerald-400"
             : accent === "rose"    ? "text-rose-400"
             : "text-white";
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-3 print:border-gray-300 print:bg-white">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold print:text-gray-600">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color} print:text-black`}>{value}</div>
    </div>
  );
}
function MiniStat({ label, value }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-2 text-center print:border-gray-300 print:bg-white">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 print:text-gray-600">{label}</div>
      <div className="text-sm font-bold text-white tabular-nums print:text-black">{value}</div>
    </div>
  );
}
function DayHighlight({ label, day, accent }) {
  const color = accent === "emerald" ? "text-emerald-300" : "text-rose-300";
  const Icon  = accent === "emerald" ? Award : AlertTriangle;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-2.5 print:border-gray-300 print:bg-white">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1 print:text-gray-600">
        <Icon className={`w-3 h-3 ${color} print:text-black`}/>{label}
      </div>
      {day ? (
        <>
          <div className={`text-lg font-bold tabular-nums ${color} print:text-black`}>
            {day.pnl >= 0 ? "+" : "-"}${Math.abs(day.pnl).toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-500 print:text-gray-600">
            {prettyDate(day.iso)} · {day.wins}W/{day.losses}L
          </div>
        </>
      ) : (
        <div className="text-slate-500 text-sm">—</div>
      )}
    </div>
  );
}
function TagList({ title, list }) {
  if (list.length === 0) return null;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md p-2.5 print:border-gray-300 print:bg-white">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 print:text-gray-600">
        {title}
      </div>
      <div className="space-y-1">
        {list.map(t => {
          const meta = tagMeta(t.slug);
          if (!meta) return null;
          return (
            <div key={t.slug} className="flex items-baseline gap-2 text-xs">
              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${meta.color} print:bg-gray-200 print:text-black`}>
                {meta.label}
              </span>
              <span className="text-slate-400 print:text-gray-700">×{t.count}</span>
              <span className={`ml-auto tabular-nums font-semibold ${t.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"} print:text-black`}>
                {t.netPnl >= 0 ? "+" : ""}${t.netPnl.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
