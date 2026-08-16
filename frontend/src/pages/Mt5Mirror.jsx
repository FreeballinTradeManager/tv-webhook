import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Radio, ShieldCheck, Lock, Play, TrendingUp, RefreshCw, Trash2,
  ExternalLink, Zap,
} from "lucide-react";
import { Account } from "@/entities/all";
import {
  getMirrorCfg, getDryRunLog, clearDryRunLog, ingestObserveSignal, parseObserveEvent,
} from "@/lib/mt5_mirror";
import { computeMt5Order } from "@/lib/mt5_lot_math";
import Mt5SetupGuide from "@/components/Mt5SetupGuide";
import { fireEvent as fireOutgoingHooks } from "@/lib/outgoing_webhooks";

// Mt5Mirror — global page showing:
//   · Which accounts have the mirror enabled
//   · The combined dry-run log across all of them
//   · An observe-event poller that turns new Pine signals into dry-run entries
//   · A "one-off dry-run" sandbox for arbitrary Pine-shaped signals
//   · The Phase 1 → Phase 2 unlock explainer
//
// LOCKED: this page never sends orders. It only computes what a real MT5 leg
// would do IF it were armed. ARM stays disabled until Phase 2 lands.

const POLL_KEY = "tradecore_mt5_mirror_seen_ids_v1";

function loadSeen() { try { return new Set(JSON.parse(localStorage.getItem(POLL_KEY) || "[]")); } catch { return new Set(); } }
function saveSeen(set) { try { localStorage.setItem(POLL_KEY, JSON.stringify([...set].slice(-2000))); } catch {} }

export default function Mt5MirrorPage() {
  const [accounts, setAccounts]   = useState([]);
  const [log, setLog]             = useState(() => getDryRunLog({ limit: 100 }));
  const [pollingAt, setPollingAt] = useState(null);

  useEffect(() => {
    Account.list("-created_date").then(a => setAccounts(a || [])).catch(() => setAccounts([]));
  }, []);

  const enabledAccounts = accounts
    .map(a => ({ acct: a, cfg: getMirrorCfg(a.id) }))
    .filter(x => x.cfg.enabled);

  // Poll observe events for each enabled account. When we see an event id we
  // haven't yet processed, ingest it into the dry-run log. Cheap — the server
  // endpoint is a Postgres SELECT LIMIT 50 per account, and we cap poll to
  // enabled accounts only.
  useEffect(() => {
    if (enabledAccounts.length === 0) return;

    const seen = loadSeen();

    const tick = async () => {
      setPollingAt(new Date());
      for (const { acct, cfg } of enabledAccounts) {
        const accountKey = acct.observe_key || acct.id;
        try {
          const resp = await fetch(`/api/webhook/observe/${encodeURIComponent(accountKey)}/events?limit=25`);
          if (!resp.ok) continue;
          const data = await resp.json();
          for (const evt of (data?.events || []).slice().reverse()) {
            const evKey = `${acct.id}:${evt.id}`;
            if (seen.has(evKey)) continue;
            seen.add(evKey);

            const pine = parseObserveEvent(evt);
            if (!pine) continue;
            const ev = (pine.event_type || "").toUpperCase();
            // Full lifecycle (task #215) — ingestObserveSignal classifies the
            // event internally and logs the right shape (ENTRY / SL_UPDATE /
            // PARTIAL / FULL_CLOSE / NOOP). No pre-filter.
            ingestObserveSignal(pine, acct, { event_id: evt.id, event_type: ev });

            // Task #92 — fan-out to outgoing hooks (Discord/Slack/etc.)
            // Map Pine event type → hook event kind. Fire and forget.
            const hookKind =
              ["BUY","SELL","ENTRY"].includes(ev)                                       ? "entry"     :
              ["BE","JUMP","CREEP_UPDATE","TRAIL_UPDATE","STOP_UPDATE"].includes(ev)     ? "sl_update" :
              ["TP1","TP2"].includes(ev)                                                  ? "tp"        :
              ["TP3","CLOSE","STOP_HIT","EMA_EXIT","ALL_TPS_FILLED","MASTER_CLOSE"].includes(ev) ? "close" :
              null;
            if (hookKind) {
              fireOutgoingHooks({
                event: hookKind,
                event_sub: ev,
                account_name: acct.name,
                ticker: pine.ticker, side: pine.side, qty: pine.qty,
                entry: pine.entry, stop: pine.stop,
                tp1: pine.tp1, tp2: pine.tp2, tp3: pine.tp3,
              });
            }
          }
        } catch { /* silent - retried next tick */ }
      }
      saveSeen(seen);
      setLog(getDryRunLog({ limit: 100 }));
    };

    tick();                              // initial run
    const t = setInterval(tick, 12000);  // then every 12s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledAccounts.length]);

  const refresh = () => setLog(getDryRunLog({ limit: 100 }));
  const clearAll = () => {
    if (!window.confirm("Clear the ENTIRE mirror dry-run log?")) return;
    clearDryRunLog();
    setLog([]);
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Radio className="w-7 h-7 text-blue-400"/> MT5 Mirror — CFDs + Forex
          </h1>
          <p className="text-slate-400 mt-1 max-w-3xl">
            Every enabled account gets a shadow MT5 leg. When your Pine indicator fires, TradeCore
            computes the equivalent CFD or Forex order and logs it here. <strong className="text-white">No orders are sent</strong> — this
            is the review lane before we flip the ARM switch.
          </p>
        </header>

        {/* Phase 1 → Phase 2 gate — the locked bit right up top */}
        <Card className="bg-emerald-500/5 border-emerald-500/40">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
              <ShieldCheck className="w-5 h-5"/>Phase 1 lock — dry-run only
            </div>
            <ul className="text-xs text-emerald-200/90 space-y-1 pl-6 list-disc">
              <li>TradeCore does not talk to MT5, FTMO, Funded Next, or any CFD broker yet.</li>
              <li>Everything on this page is math computed in your browser from the observe signals.</li>
              <li>ARM stays disabled until you review a few sessions of output and explicitly unlock Phase 2.</li>
              <li>MT5 login/password NEVER stored in browser. In Phase 2 they land in the encrypted Vault.</li>
            </ul>
          </CardContent>
        </Card>

        {/* Accounts overview */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400"/>
                Enabled accounts ({enabledAccounts.length} of {accounts.length})
              </span>
              <a href="/Accounts" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
                Configure on Accounts <ExternalLink className="w-3 h-3"/>
              </a>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {enabledAccounts.length === 0 ? (
              <div className="text-sm text-slate-400 italic py-4">
                No accounts have MT5 mirror enabled yet. Head to <a href="/Accounts" className="text-blue-400 hover:underline">Accounts</a> and
                flip the "MT5 mirror" switch on the account(s) you want mirrored.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
                {enabledAccounts.map(({ acct, cfg }) => (
                  <div key={acct.id} className="bg-slate-950 border border-slate-800 rounded p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-white font-semibold">{acct.name}</span>
                      <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/40 text-[10px]">
                        {cfg.broker}·{cfg.platform}
                      </Badge>
                    </div>
                    <div className="text-slate-500 space-y-0.5">
                      {cfg.login && <div>Login: <span className="text-slate-300 font-mono">{cfg.login}</span></div>}
                      {cfg.server && <div>Server: <span className="text-slate-300 font-mono">{cfg.server}</span></div>}
                      <div>Sizing: <span className="text-slate-300">{cfg.sizingMode}</span></div>
                      <div>Cap: <span className="text-slate-300">${cfg.riskCapUsd}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-2">
              <RefreshCw className="w-3 h-3"/>
              {pollingAt ? `Poll ran ${pollingAt.toLocaleTimeString()}` : "Waiting on first poll…"}
              {enabledAccounts.length === 0 ? " (poll idle — no enabled accounts)" : " · every 12s"}
            </div>
          </CardContent>
        </Card>

        {/* Phase 2 setup guide — shows on the first enabled account (or the
            first configured one, so it's discoverable even before enable). */}
        {enabledAccounts.length > 0 && (
          <Mt5SetupGuide account={enabledAccounts[0].acct}/>
        )}

        {/* Sandbox — fire an arbitrary dry-run without waiting for Pine */}
        <SandboxCard/>

        {/* Global dry-run log */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400"/>
                Dry-run log ({log.length})
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={refresh}
                        className="text-slate-400 hover:text-white text-xs h-7">
                  <RefreshCw className="w-3 h-3 mr-1"/>Refresh
                </Button>
                {log.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={clearAll}
                          className="text-slate-400 hover:text-red-400 text-xs h-7">
                    <Trash2 className="w-3 h-3 mr-1"/>Clear all
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-4">
                No dry-run entries yet. Fire a signal from the sandbox above, or wait for a Pine alert
                on an enabled account.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-1.5 px-1">Time</th>
                      <th className="text-left px-1">Account</th>
                      <th className="text-left px-1">Kind</th>
                      <th className="text-left px-1">Pine ev</th>
                      <th className="text-left px-1">Pine sym</th>
                      <th className="text-left px-1">→ MT5</th>
                      <th className="text-right px-1">Lots / Δ</th>
                      <th className="text-left px-1">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map(r => <LogRow key={r.id} r={r}/>)}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Roadmap block — what Phase 2 will add */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400"/>Phase 2 — what unlocking ARM adds
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-300 space-y-2">
            <ul className="list-disc pl-5 space-y-1">
              <li>Backend MetaAPI adapter (works with FTMO / Funded Next / The5%ers / most MT4/MT5 brokers).</li>
              <li>MT5 login + password + server stored in the encrypted Vault, not localStorage.</li>
              <li>DEMO-first workflow — you connect a FREE demo account and mirror runs against it for 3–5 sessions.</li>
              <li>ARM button only becomes clickable AFTER a successful DEMO fill lands.</li>
              <li>Bidirectional reconciliation — MT5 fills back-populate the Trades table.</li>
            </ul>
            <p className="text-amber-300 pt-1">
              Cost note: MetaAPI is a paid third-party bridge ($20–50/month depending on account count).
              You approve the subscription before ARM unlocks.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Per-classification badge palette (Pine-locked colors, no yellow/brown):
//   ENTRY_LIKE  → blue LONG / purple SHORT (matches ENTRY pill)
//   SL_UPDATE   → red (matches STOP pill)
//   PARTIAL     → teal (matches TP pill)
//   FULL_CLOSE  → slate (neutral close)
//   NOOP        → dim slate
function kindClass(k, side) {
  if (k === "ENTRY_LIKE") {
    return side === "SELL"
      ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
      : "bg-blue-500/15 text-blue-300 border-blue-500/40";
  }
  if (k === "SL_UPDATE")  return "bg-red-500/15 text-red-300 border-red-500/40";
  if (k === "PARTIAL")    return "bg-teal-500/15 text-teal-300 border-teal-500/40";
  if (k === "FULL_CLOSE") return "bg-slate-500/15 text-slate-300 border-slate-500/40";
  return "bg-slate-800 text-slate-500 border-slate-700";
}

function kindLabel(k) {
  return {
    ENTRY_LIKE: "ENTRY",
    SL_UPDATE:  "SL",
    PARTIAL:    "TP",
    FULL_CLOSE: "CLOSE",
    NOOP:       "—",
  }[k] || (k || "?");
}

function LogRow({ r }) {
  const w   = r.would_send || {};
  const ok  = w.ok;
  const k   = r.classification || "ENTRY_LIKE";
  const evShort = String(r.source?.event_type || r.pine_signal?.event_type || "").toUpperCase();

  // "Δ / lots" column varies by classification
  let magnitude = "—";
  if (ok) {
    if (k === "ENTRY_LIKE") magnitude = `${w.lots}`;
    else if (k === "SL_UPDATE") magnitude = `SL→${w.new_stop}`;
    else if (k === "PARTIAL")   magnitude = `-${w.partial_lot}`;
    else if (k === "FULL_CLOSE") magnitude = "flat";
  }

  // Detail cell reads the most useful thing per classification
  let detail = w.note || w.sizing_note || "";
  if (ok && k === "ENTRY_LIKE" && w.estimated_risk_usd != null) {
    detail = `${w.sizing_note}  ·  risk ~$${w.estimated_risk_usd.toFixed(0)}`;
  }

  // Price conversion snippet (task #217) — show delta from Pine to CFD price
  const conv = w.converted;
  if (ok && k === "ENTRY_LIKE" && conv) {
    if (conv.mode === "market" && conv.stop_distance != null) {
      detail += `  ·  MKT · SL ${conv.stop_distance.toFixed(1)}pt from fill`;
    } else if (conv.mode === "fixed_offset" && conv.entry_ref != null) {
      const off = conv.offset >= 0 ? `+${conv.offset}` : conv.offset;
      detail += `  ·  ${w.entry} → ${conv.entry_ref} (offset ${off})`;
    } else if (conv.mode === "live_reanchor") {
      detail += `  ·  reanchor pending (Phase 2B)`;
    }
  }

  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-950/50">
      <td className="py-1.5 px-1 text-slate-400 whitespace-nowrap font-mono text-[10px]">
        {new Date(r.ts).toLocaleTimeString()}
      </td>
      <td className="px-1 text-white">{r.account_name}</td>
      <td className="px-1">
        <Badge className={`text-[9px] px-1.5 py-0 ${kindClass(k, w.side)}`}>{kindLabel(k)}</Badge>
      </td>
      <td className="px-1 text-slate-400 font-mono text-[10px]">{evShort || "—"}</td>
      <td className="px-1 text-slate-300 font-mono">{r.pine_signal?.ticker || "?"}</td>
      <td className="px-1 text-white font-mono">{w.target || "—"}</td>
      <td className="px-1 text-right font-mono text-emerald-400">{magnitude}</td>
      <td className="px-1 text-slate-500 text-[10px]">{detail}</td>
    </tr>
  );
}

// -----------------------------------------------------------------------------
// Sandbox — fire an ad-hoc Pine-shape signal to see what the mirror would do
// without waiting for a real observe event. Uses computeMt5Order directly (no
// account write) so you can experiment freely.
function SandboxCard() {
  const [sig, setSig] = useState({
    ticker: "MNQ1!", side: "BUY", qty: 3,
    entry: 24500, stop: 24480, tp1: 24510, tp2: 24520, tp3: 24530,
  });
  const [cfg, setCfg] = useState({ sizingMode: "match_risk", fixedLot: 0.10, riskCapUsd: 100, suffix: "" });
  const [out, setOut] = useState(null);

  const run = () => setOut(computeMt5Order(sig, cfg));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Play className="w-4 h-4 text-blue-400"/>Sandbox — fire a one-off dry-run
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
          <Cell label="Ticker">
            <input value={sig.ticker} onChange={e => setSig({ ...sig, ticker: e.target.value })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="Side">
            <select value={sig.side} onChange={e => setSig({ ...sig, side: e.target.value })}
                    className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white">
              <option>BUY</option><option>SELL</option>
            </select>
          </Cell>
          <Cell label="Qty">
            <input type="number" value={sig.qty} onChange={e => setSig({ ...sig, qty: Number(e.target.value) })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="Entry">
            <input type="number" step="any" value={sig.entry} onChange={e => setSig({ ...sig, entry: Number(e.target.value) })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="Stop">
            <input type="number" step="any" value={sig.stop} onChange={e => setSig({ ...sig, stop: Number(e.target.value) })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="Sizing">
            <select value={cfg.sizingMode} onChange={e => setCfg({ ...cfg, sizingMode: e.target.value })}
                    className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white">
              <option value="match_risk">match risk</option>
              <option value="fixed_lot">fixed lot</option>
              <option value="match_qty">qty × lot</option>
            </select>
          </Cell>
          <Cell label="Fixed lot">
            <input type="number" step="0.01" value={cfg.fixedLot} onChange={e => setCfg({ ...cfg, fixedLot: Number(e.target.value) })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="$ cap">
            <input type="number" step="1" value={cfg.riskCapUsd} onChange={e => setCfg({ ...cfg, riskCapUsd: Number(e.target.value) })}
                   className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
          <Cell label="Suffix">
            <input value={cfg.suffix} onChange={e => setCfg({ ...cfg, suffix: e.target.value })}
                   placeholder='"" or ".cash"' className="w-full h-8 px-2 rounded bg-slate-950 border border-slate-800 text-white font-mono"/>
          </Cell>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={run} className="bg-blue-600 hover:bg-blue-500">
            <Play className="w-3.5 h-3.5 mr-1.5"/>Compute
          </Button>
          {out && !out.ok && <span className="text-xs text-red-300">{out.note}</span>}
          {out && out.ok && (
            <span className="text-xs text-emerald-300">
              would fire <strong>{out.side}</strong> <strong className="font-mono">{out.lots} lot</strong> on <strong className="font-mono">{out.target}</strong>
              {out.estimated_risk_usd != null && ` · ~$${out.estimated_risk_usd.toFixed(0)} at risk`}
            </span>
          )}
        </div>
        {out && out.ok && (
          <div className="text-[11px] text-slate-500 border-t border-slate-800 pt-2">
            {out.map_note}
            {"  ·  "}{out.sizing_note}
            {out.stop_pips != null && `  ·  ${out.stop_pips.toFixed(1)} pip stop`}
            {out.stop_points != null && `  ·  ${out.stop_points.toFixed(1)} pt stop`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Cell({ label, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
      {children}
    </div>
  );
}
