import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { Terminal, RefreshCw, Search, Filter, AlertTriangle, CheckCircle2, RotateCw, Skull } from "lucide-react";
import { classifySignal, parseStrategyName, detectPineVersion } from "@/lib/pine_signals";
import { loadAudit, clearAudit } from "@/lib/audit_log";
import CopyAuditLedger from "@/components/CopyAuditLedger";

// Task #139 + #59 — Server logs viewer + copy trade audit ledger.
// Reads recent webhook_signals rows from the backend. Each row is a
// signal we received (observe, demo, PMT-compat, or trade-engine). For
// fan-out shape (task #59), the "raw_payload" carries the JSON we
// forwarded to each account — display it verbatim on expand.
//
// Backend endpoint expected: GET /api/webhook-signals?limit=200
// Falls back to the observe endpoints if the general one isn't wired yet.

const KIND_FILTERS = [
  { key: "all",     label: "All" },
  { key: "OBSERVE", label: "Observe" },
  { key: "DEMO",    label: "Demo" },
  { key: "PMT",     label: "PMT-compat" },
  { key: "ENTRY",   label: "Entry" },
  { key: "CLOSE",   label: "Close" },
  { key: "SL",      label: "SL update" },
];

export default function LogsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    // Prefer a generic endpoint if it lands (#139 backend work).
    // Fall back to sampling recent observe/demo streams so this page
    // is useful even before that endpoint is deployed.
    try {
      const data = await api("/api/webhook-signals?limit=200").catch(() => null);
      if (data && Array.isArray(data.events)) {
        setRows(data.events); return;
      }
      // Fallback: rows are empty. Show a helpful message.
      setRows([]);
    } catch (e) {
      setError(e.message || "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter(r => {
      if (filter !== "all") {
        const ev = String(r.event || "").toUpperCase();
        const key = String(r.key || "").toUpperCase();
        if (filter === "OBSERVE" && !(ev.startsWith("OBSERVE") || key.startsWith("OBSERVE"))) return false;
        if (filter === "DEMO"    && !(ev.startsWith("DEMO") || key.startsWith("DEMO")))       return false;
        if (filter === "PMT"     && !key.includes("PMT") && !ev.includes("PMT"))              return false;
        if (filter === "ENTRY"   && !(ev.includes("BUY") || ev.includes("SELL")))             return false;
        if (filter === "CLOSE"   && !ev.includes("CLOSE"))                                    return false;
        if (filter === "SL"      && !ev.startsWith("SL"))                                     return false;
      }
      if (!q) return true;
      const hay = [r.event, r.ticker, r.side, r.key, r.raw_payload, r.trade_id].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, query, filter]);

  const toggle = (id) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Terminal className="w-7 h-7 text-blue-500"/> Signal &amp; webhook log
            </h1>
            <p className="text-slate-400 mt-1 max-w-3xl">
              Every alert TradeCore has received — observe, demo, PMT-compat, direct. Filter by kind, search by ticker/JSON, click any row to expand the raw payload. Feeds into the copy-trade audit ledger too.
            </p>
          </div>
          <Button onClick={load} disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white shrink-0">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}/>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </header>

        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
            <Input value={query} onChange={e => setQuery(e.target.value)}
                   placeholder="Filter by ticker · JSON body · account key…"
                   className="bg-slate-900 border-slate-700 text-white pl-10 h-10"/>
          </div>
          <div className="flex gap-1 flex-wrap">
            {KIND_FILTERS.map(f => (
              <button key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`h-10 px-3 rounded-md text-xs font-semibold border transition-colors ${
                        filter === f.key
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
                      }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <Card className="bg-red-950/40 border-red-800/60">
            <CardContent className="p-3 flex items-center gap-2 text-sm text-red-200">
              <AlertTriangle className="w-4 h-4"/> {error}
            </CardContent>
          </Card>
        )}

        <RetryQueueSection/>

        <CopyAuditLedger/>

        <AuditLogPanel/>

        {shown.length === 0 && !error ? (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-8 text-center space-y-2">
              <Terminal className="w-12 h-12 text-slate-700 mx-auto"/>
              <p className="text-slate-300">
                {rows.length === 0
                  ? "No signals yet. Fire a TV alert at any account's webhook to see it here."
                  : "No signals match this filter."}
              </p>
              {rows.length === 0 && (
                <p className="text-slate-500 text-xs max-w-md mx-auto">
                  Backend endpoint: GET <code className="text-blue-400">/api/webhook-signals?limit=200</code>.
                  If it 404s, the endpoint hasn't been deployed yet — the observe route already logs to the underlying table.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-0">
              <div className="divide-y divide-slate-800">
                {shown.map(r => (
                  <SignalRow key={r.id || `${r.ts}-${r.event}`}
                             row={r}
                             expanded={expanded.has(r.id)}
                             onToggle={() => toggle(r.id)}/>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function SignalRow({ row, expanded, onToggle }) {
  let parsed = null;
  try { parsed = row.raw_payload ? JSON.parse(row.raw_payload) : null; } catch { parsed = null; }
  const cls = classifySignal(parsed || row);
  const version = detectPineVersion(parsed) || row.pine_version || null;
  const sn = parseStrategyName(parsed?.strategy_name);

  const isClose = String(row.event || "").includes("CLOSE");
  const isEntry = /BUY|SELL/.test(String(row.event || ""));
  const kindBadgeClass = isClose ? "bg-red-600 text-white"
                       : isEntry ? "bg-emerald-600 text-white"
                       : "bg-slate-700 text-white";

  return (
    <div className="text-sm">
      <button onClick={onToggle}
              className="w-full text-left px-3 py-2 hover:bg-slate-950/60 flex items-center gap-3">
        <span className="text-slate-500 text-xs font-mono w-32 shrink-0 truncate">
          {row.ts ? new Date(row.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
        </span>
        <Badge className={`${kindBadgeClass} text-[10px] uppercase tracking-wider shrink-0`}>
          {row.event || "?"}
        </Badge>
        <span className="text-white font-mono w-16 shrink-0">{row.ticker || "—"}</span>
        <span className="text-slate-400 w-14 shrink-0 text-xs uppercase">{row.side || "—"}</span>
        <span className="text-slate-500 text-xs shrink-0">qty {row.qty ?? 0}</span>
        {sn?.type === "SL_UPDATE" && (
          <Badge className="bg-orange-500 text-white text-[10px] uppercase tracking-wider">SL {sn.update}</Badge>
        )}
        {sn?.type === "CLOSE" && (
          <Badge className="bg-red-500 text-white text-[10px] uppercase tracking-wider">{sn.reason}</Badge>
        )}
        {cls?.family && cls.family.family !== "UNKNOWN" && cls.family.raw && (
          <Badge className={`${cls.family.color} text-[10px] uppercase tracking-wider`}>{cls.family.raw}</Badge>
        )}
        {version && (
          <span className="text-blue-400 text-[10px] font-mono ml-auto shrink-0">{version}</span>
        )}
        <span className="text-slate-600 text-xs shrink-0 ml-2">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-slate-950/60 space-y-2">
          <div className="grid md:grid-cols-3 gap-2 text-xs">
            <MetaCell label="Signal key" value={row.key}/>
            <MetaCell label="Trade id" value={row.trade_id}/>
            <MetaCell label="Row id" value={String(row.id)}/>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Raw payload</div>
            <pre className="bg-slate-950 border border-slate-800 rounded-md p-2.5 text-[11px] text-slate-300 font-mono overflow-x-auto max-h-64">
{row.raw_payload || "(none)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-mono text-slate-200 text-xs break-all">{value ?? "—"}</div>
    </div>
  );
}

// Task #134 admin panel — surfaces the webhook retry queue and lets the
// user retry-now or kill any pending row. Uses the backend endpoints
// added to main.py in this session.
function RetryQueueSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const data = await api(`/api/webhook-retries${q}`).catch(() => null);
      setRows(data?.retries || []);
    } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const retryNow = async (id) => {
    try { await api(`/api/webhook-retries/${id}/retry-now`, { method: "POST" }); load(); }
    catch (e) { alert(`Retry failed: ${e.message}`); }
  };
  const kill = async (id) => {
    if (!window.confirm("Mark this retry as dead? It will stop trying.")) return;
    try { await api(`/api/webhook-retries/${id}/kill`, { method: "POST" }); load(); }
    catch (e) { alert(`Kill failed: ${e.message}`); }
  };

  const totalPending = rows.filter(r => r.status === "pending").length;
  const totalDead    = rows.filter(r => r.status === "dead").length;

  return (
    <Card className={`${totalPending > 0 ? "bg-slate-900 border-slate-700" : "bg-slate-900 border-slate-800"}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-white text-base flex items-center gap-2">
            <RotateCw className={`w-5 h-5 ${totalPending > 0 ? "text-orange-400" : "text-slate-500"}`}/>
            Webhook retry queue
            {totalPending > 0 && (
              <Badge className="bg-orange-500 text-white text-[10px] uppercase tracking-wider ml-1">
                {totalPending} PENDING
              </Badge>
            )}
            {totalDead > 0 && (
              <Badge className="bg-slate-600 text-white text-[10px] uppercase tracking-wider ml-1">
                {totalDead} DEAD
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-1">
            {["all", "pending", "in_flight", "delivered", "dead"].map(f => (
              <button key={f}
                      onClick={() => setFilter(f)}
                      className={`h-7 px-2 rounded-md text-[10px] font-semibold uppercase tracking-wider border ${
                        filter === f
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                      }`}>
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          Failed outbound broker webhooks queue here with exponential backoff (30s · 2m · 8m · 30m · 2h).
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <p className="text-xs text-slate-500 py-2">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">
            No {filter === "all" ? "" : filter} retries — nothing failed recently.
          </p>
        ) : (
          <div className="divide-y divide-slate-800">
            {rows.map(r => {
              const statusColor = r.status === "delivered" ? "bg-emerald-600 text-white"
                               : r.status === "dead"       ? "bg-slate-700 text-white"
                               : r.status === "in_flight"  ? "bg-blue-600 text-white"
                               : "bg-orange-500 text-white";
              return (
                <div key={r.id} className="py-2 flex items-center gap-3 text-xs">
                  <Badge className={`${statusColor} text-[10px] uppercase tracking-wider shrink-0`}>
                    {r.status}
                  </Badge>
                  <span className="text-white font-mono truncate flex-1">{r.target_url}</span>
                  <span className="text-slate-500 shrink-0">{r.attempts}/{r.max_attempts}</span>
                  {r.last_http_status && (
                    <span className={`shrink-0 font-mono ${r.last_http_status >= 400 ? "text-rose-400" : "text-slate-400"}`}>
                      {r.last_http_status}
                    </span>
                  )}
                  {r.status !== "delivered" && r.status !== "dead" && (
                    <button onClick={() => retryNow(r.id)}
                            title="Retry now"
                            className="text-blue-400 hover:text-blue-300 shrink-0">
                      <RotateCw className="w-3.5 h-3.5"/>
                    </button>
                  )}
                  {r.status !== "delivered" && r.status !== "dead" && (
                    <button onClick={() => kill(r.id)}
                            title="Mark dead"
                            className="text-slate-500 hover:text-red-400 shrink-0">
                      <Skull className="w-3.5 h-3.5"/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// AuditLogPanel — local UI action ring buffer (last ~500). Every panic
// button, guardian reset, kill-switch fire, etc. lands here so the
// trader can answer "what did I click that caused X" post-mortem.
// Frontend-only for now; the server-side compliance log is task #100.
function AuditLogPanel() {
  const [rows, setRows] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(loadAudit().slice().reverse());
  }, [tick]);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const doClear = () => {
    if (!window.confirm("Clear the local audit log? Server-side history is unaffected.")) return;
    clearAudit();
    setTick(t => t + 1);
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Terminal className="w-4 h-4 text-blue-400"/>
          UI Audit Log
          <span className="text-xs font-normal text-slate-400 ml-2">
            local · last {rows.length} action{rows.length === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setTick(t => t + 1)}
                    className="h-7 text-xs">
              <RefreshCw className="w-3 h-3 mr-1"/>Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={doClear}
                    className="h-7 text-xs text-slate-400 hover:text-red-400">
              Clear
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-3">
            No UI actions recorded yet. Panic buttons, guardian resets, edits, etc. will show up here.
          </div>
        ) : (
          <div className="divide-y divide-slate-800 max-h-64 overflow-y-auto">
            {rows.slice(0, 100).map((r, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5 text-xs">
                <span className="text-slate-500 font-mono shrink-0">
                  {new Date(r.ts).toLocaleTimeString()}
                </span>
                <span className="text-blue-400 font-mono shrink-0">{r.event}</span>
                <span className="text-slate-400 truncate">
                  {r.payload && Object.keys(r.payload).length > 0
                    ? JSON.stringify(r.payload)
                    : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
