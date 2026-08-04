import React, { useState, useEffect, useMemo } from "react";
import { Trade, Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, CheckSquare, Square, Trash2, Plus, DollarSign,
  Clock, AlertTriangle, TrendingUp, Calendar,
} from "lucide-react";
import { firmByKey, PROP_FIRMS } from "@/lib/prop_firms";
import { assetStatus, upcomingHolidays, ASSET_HOURS } from "@/lib/market_hours";
import PayoutPlanner from "@/components/PayoutPlanner";
import { audit, AUDIT_EVENTS } from "@/lib/audit_log";

// Task #76 + #60 + #131 + #138 — Rules & Playbook.
// One page that unifies:
//   · Pre-entry checklist (task #76) — persistent, editable playbook rules
//   · Consistency rule tracker (task #60) — largest single-day % of period profit
//   · Trading hours + upcoming holidays (task #131) — CME session data
//   · Payout schedule per firm (task #138) — min-days / cadence / split
//
// LocalStorage-backed for the editable pieces so it works before backend
// #40 auth ships.

const PLAYBOOK_KEY = "tradecore_playbook_rules_v1";

const DEFAULT_PLAYBOOK = [
  "Check the 4H + Daily bias — never fight it",
  "Wait for a real setup (3-EMA stack + trigger candle)",
  "Confirm session is active (R1 · R2 · R3)",
  "Risk per trade ≤ $120 (max 3 micros @ 60t stop)",
  "No trades after 2 losses in the same session",
  "Skip if within 15m of red news",
  "Screenshot BEFORE entry — not after",
  "Journal the trade the moment it closes",
];

function loadPlaybook() {
  try {
    const raw = localStorage.getItem(PLAYBOOK_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_PLAYBOOK;
  } catch { return DEFAULT_PLAYBOOK; }
}
function savePlaybook(rules) {
  localStorage.setItem(PLAYBOOK_KEY, JSON.stringify(rules));
}

export default function PlaybookPage() {
  const [rules, setRules] = useState(loadPlaybook);
  const [checked, setChecked] = useState(new Set());
  const [newRule, setNewRule] = useState("");
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => savePlaybook(rules), [rules]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, a] = await Promise.all([
          Trade.list("-entry_time", 500).catch(() => []),
          Account.list().catch(() => []),
        ]);
        if (alive) { setTrades(t || []); setAccounts(a || []); }
      } catch { if (alive) { setTrades([]); setAccounts([]); } }
    })();
    return () => { alive = false; };
  }, []);

  const toggleCheck = (i) => {
    setChecked(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      audit(AUDIT_EVENTS.RULES_TICK, { index: i, on: !prev.has(i), rule: rules[i] });
      return next;
    });
  };
  const addRule = () => {
    const r = newRule.trim();
    if (!r) return;
    setRules(prev => [...prev, r]);
    setNewRule("");
  };
  const removeRule = (i) => {
    setRules(prev => prev.filter((_, idx) => idx !== i));
    setChecked(prev => {
      const next = new Set();
      prev.forEach(x => { if (x < i) next.add(x); else if (x > i) next.add(x - 1); });
      return next;
    });
  };
  const resetChecks = () => setChecked(new Set());

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-blue-500"/> Playbook &amp; Rules
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Your pre-entry checklist, prop-firm compliance state, current market hours, and payout schedule — all in one place. Tick your rules before every trading session.
          </p>
        </header>

        {/* Pre-entry checklist (task #76) */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><CheckSquare className="w-5 h-5 text-emerald-400"/> Pre-entry checklist</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={resetChecks}
                        className="bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700 text-xs h-7">
                  Reset ticks
                </Button>
              </div>
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              {checked.size}/{rules.length} checked. Click each rule to tick it — reset before a new session.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rules.map((r, i) => {
              const on = checked.has(i);
              return (
                <div key={i}
                     className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                       on
                         ? "bg-emerald-950/30 border-emerald-800 text-emerald-100"
                         : "bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700"
                     }`}>
                  <button onClick={() => toggleCheck(i)} className="shrink-0">
                    {on
                      ? <CheckSquare className="w-4 h-4 text-emerald-400"/>
                      : <Square className="w-4 h-4 text-slate-500"/>}
                  </button>
                  <span className="flex-1">{r}</span>
                  <button onClick={() => removeRule(i)}
                          className="text-slate-500 hover:text-red-400 shrink-0">
                    <Trash2 className="w-3.5 h-3.5"/>
                  </button>
                </div>
              );
            })}
            <div className="flex gap-2 pt-2">
              <Input value={newRule}
                     onChange={e => setNewRule(e.target.value)}
                     onKeyDown={e => e.key === "Enter" && addRule()}
                     placeholder="Add a rule — e.g. 'No overnight positions'"
                     className="bg-slate-950 border-slate-700 text-white"/>
              <Button onClick={addRule} className="bg-blue-600 hover:bg-blue-700 text-white shrink-0">
                <Plus className="w-4 h-4 mr-1"/>Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Consistency rule tracker (task #60) */}
        <ConsistencyCard trades={trades} accounts={accounts}/>

        {/* Trading hours + upcoming holidays (task #131) */}
        <MarketHoursCard/>

        {/* Task #192 — Payout planner (daily target math) */}
        <PayoutPlanner trades={trades}/>

        {/* Payout schedule per firm (task #138) */}
        <PayoutScheduleCard accounts={accounts}/>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task #60 — Consistency rule tracker.
// FTMO/MFF/Apex-style rule: "no single day may make up more than X% of the
// account's total profit over the evaluation period." We compute the
// largest single-day $ vs total period $ per firm-attached account.
// ---------------------------------------------------------------------------

function ConsistencyCard({ trades, accounts }) {
  const propAccounts = accounts.filter(a => a.firm && firmByKey(a.firm));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-400"/> Consistency rule
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Live check against each firm's max-single-day rule (largest winning day as % of total period profit). Yellow when within 5 pts, red when exceeded.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {propAccounts.length === 0 ? (
          <p className="text-slate-500 text-sm">No prop-firm accounts connected yet. Add one on the Accounts page to see the live consistency check.</p>
        ) : propAccounts.map(acc => (
          <ConsistencyRow key={acc.id} acc={acc} trades={trades}/>
        ))}
      </CardContent>
    </Card>
  );
}

function ConsistencyRow({ acc, trades }) {
  const firm = firmByKey(acc.firm);
  const limit = firm?.consistency_pct ?? null;

  // Group closed trades for this account by date, sum PnL per day.
  const { byDay, largestDay, totalProfit } = useMemo(() => {
    const map = new Map();
    let total = 0;
    trades.forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      if (t.account_id !== acc.id) return;
      const ts = t.exit_time || t.entry_time;
      if (!ts) return;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      map.set(key, (map.get(key) || 0) + t.profit_loss);
      total += t.profit_loss;
    });
    let largest = { date: null, pnl: 0 };
    map.forEach((pnl, date) => {
      if (pnl > largest.pnl) largest = { date, pnl };
    });
    return { byDay: map, largestDay: largest, totalProfit: total };
  }, [trades, acc.id]);

  if (!limit) {
    return (
      <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm">
        <span className="text-white font-semibold">{acc.name}</span>{" "}
        <span className="text-slate-500">· {firm.name} — no consistency rule</span>
      </div>
    );
  }

  const actualPct = totalProfit > 0 ? (largestDay.pnl / totalProfit) * 100 : 0;
  const state = actualPct > limit ? "over" : actualPct > (limit - 5) ? "near" : "ok";
  const bg = state === "over" ? "bg-red-950/40 border-red-800/60"
          : state === "near" ? "bg-slate-800 border-slate-700"
          : "bg-emerald-950/30 border-emerald-800/60";
  const dot = state === "over" ? "bg-red-500" : state === "near" ? "bg-slate-400" : "bg-emerald-500";
  const label = state === "over" ? "OVER" : state === "near" ? "NEAR" : "OK";

  return (
    <div className={`rounded-md border px-3 py-2.5 text-sm ${bg}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div>
          <span className="text-white font-semibold">{acc.name}</span>
          <span className="text-slate-400 ml-2 text-xs">{firm.name} · max {limit}% single-day</span>
        </div>
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white ${state === "over" ? "bg-red-600" : state === "near" ? "bg-slate-600" : "bg-emerald-600"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`}/>{label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-slate-500 uppercase tracking-wider text-[10px]">Total profit</div>
          <div className="text-white font-mono">${totalProfit.toFixed(0)}</div>
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-wider text-[10px]">Biggest day</div>
          <div className="text-white font-mono">${largestDay.pnl.toFixed(0)} <span className="text-slate-500">· {largestDay.date || "—"}</span></div>
        </div>
        <div>
          <div className="text-slate-500 uppercase tracking-wider text-[10px]">Concentration</div>
          <div className={`${state === "over" ? "text-red-300" : state === "near" ? "text-slate-200" : "text-emerald-300"} font-mono font-semibold`}>{actualPct.toFixed(1)}% / {limit}%</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task #131 — Trading hours + upcoming holidays.
// ---------------------------------------------------------------------------

function MarketHoursCard() {
  const now = new Date();
  const nowStr = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false });

  const holidays = upcomingHolidays(null, 6);
  const classes = Object.entries(ASSET_HOURS);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-400"/> Trading hours &amp; holidays
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Now: {nowStr} ET. CME weekly halt Fri 17:00 → Sun 18:00. Daily maintenance break 17:00–18:00 ET.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          {classes.map(([key, spec]) => {
            const sample = spec.contracts[0];
            const st = assetStatus(sample);
            const bg = st.state === "open" ? "border-emerald-800/60 bg-emerald-950/20"
                    : st.state === "break" ? "border-slate-700 bg-slate-800/40"
                    : st.state === "weekend" ? "border-slate-700 bg-slate-800/40"
                    : st.state === "holiday" ? "border-red-800/60 bg-red-950/20"
                    : "border-slate-800 bg-slate-950";
            return (
              <div key={key} className={`rounded-md border p-3 ${bg}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-white font-semibold text-sm">{spec.label}</div>
                  <Badge className={`text-[10px] uppercase tracking-wider ${st.state === "open" ? "bg-emerald-600 text-white" : st.state === "holiday" ? "bg-red-600 text-white" : "bg-slate-600 text-white"}`}>
                    {st.state}
                  </Badge>
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{spec.contracts.join(" · ")}</div>
                <div className="text-xs text-slate-300 mt-1">{st.note}</div>
                {spec.rth && <div className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">RTH {spec.rth.open}–{spec.rth.close} ET</div>}
              </div>
            );
          })}
        </div>

        <div>
          <div className="text-slate-500 uppercase tracking-wider text-[10px] font-semibold mb-2">Upcoming holidays</div>
          <div className="space-y-1">
            {holidays.length === 0
              ? <p className="text-slate-500 text-xs">No upcoming holidays in the next window.</p>
              : holidays.map(h => (
                  <div key={h.date} className="flex items-baseline gap-3 text-xs rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5">
                    <Calendar className="w-3 h-3 text-slate-500 shrink-0"/>
                    <span className="font-mono text-slate-400 w-24 shrink-0">{h.date}</span>
                    <span className="text-white font-semibold">{h.name}</span>
                    <Badge className={`text-[9px] uppercase tracking-wider ml-1 ${h.kind === "closed" ? "bg-red-600 text-white" : h.kind === "early_close" ? "bg-slate-600 text-white" : "bg-slate-700 text-white"}`}>
                      {h.kind.replace("_", " ")}
                    </Badge>
                    <span className="text-slate-500 text-[10px] ml-auto truncate">{h.details}</span>
                  </div>
                ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Task #138 — Payout schedule per firm/account.
// ---------------------------------------------------------------------------

function PayoutScheduleCard({ accounts }) {
  const propAccounts = accounts.filter(a => a.firm && firmByKey(a.firm));
  const distinctFirms = [...new Set(propAccounts.map(a => a.firm))];

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-blue-400"/> Payout schedule
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Min trading days · first payout eligibility · cadence · profit split — per firm you're active with. Verify with the firm before requesting.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {propAccounts.length === 0 ? (
          <p className="text-slate-500 text-sm">Attach a prop-firm preset to any account on the Accounts page to see its payout terms here.</p>
        ) : distinctFirms.map(firmKey => {
          const firm = firmByKey(firmKey);
          const accountsForFirm = propAccounts.filter(a => a.firm === firmKey);
          const p = firm?.payout || {};
          return (
            <div key={firmKey} className="rounded-md border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div>
                  <div className="text-white font-bold">{firm.name}</div>
                  <div className="text-xs text-slate-400">{accountsForFirm.length} account{accountsForFirm.length !== 1 ? "s" : ""} · {accountsForFirm.map(a => a.name).join(", ")}</div>
                </div>
                <Badge className="bg-blue-600 text-white text-[10px] uppercase tracking-wider">{p.split_pct ?? "?"}% split</Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">Min trading days</div>
                  <div className="text-white font-mono text-sm">{p.min_days ?? "?"}</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">First payout in</div>
                  <div className="text-white font-mono text-sm">{p.first_payout_days ?? "?"} days</div>
                </div>
                <div>
                  <div className="text-slate-500 uppercase tracking-wider text-[10px]">Cadence</div>
                  <div className="text-white text-sm">{p.cadence || "—"}</div>
                </div>
              </div>
              {firm.approved_tools_link && (
                <div className="text-[10px] text-slate-500 mt-2">
                  Confirm current rules: <a href={firm.approved_tools_link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{firm.approved_tools_link}</a>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
