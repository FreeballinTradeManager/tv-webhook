import React, { useState, useEffect, useMemo } from "react";
import { Trade, Account, TradeJournal } from "@/entities/all";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Plus, Filter, ArrowUpDown, Download, Upload, Trash2, X as XIcon, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, StickyNote } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import TradeTagsCell from "@/components/TradeTagsCell";
import TradeNotesRow from "@/components/TradeNotesRow";
import { getNotes } from "@/lib/trade_notes";
import { useContextMenu } from "@/components/RightClickMenu";
import { audit, AUDIT_EVENTS } from "@/lib/audit_log";
import { detectPineVersion, parseStrategyName } from "@/lib/pine_signals";
import { Copy, Pencil, StickyNote as StickyNoteIcon, Tag as TagIcon, ExternalLink } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  parseCsv, detectBroker, COLUMN_PRESETS, autoMap, normalizeRow,
} from "@/lib/csv_import";

export default function TradesPage() {
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ symbol: "", accountId: "all", session: "all", direction: "all" });
  const [sort, setSort] = useState({ key: "entry_time", order: "desc" });
  // Set of expanded trade IDs. Rendered as a second row under each expanded
  // trade with notes + screenshot gallery. Task #49.
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpanded = (id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [tradesData, accountsData] = await Promise.all([
      Trade.list("-entry_time"),
      Account.list()
    ]);
    setTrades(tradesData);
    setAccounts(accountsData);
    setLoading(false);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSort = (key) => {
    setSort(prev => ({
      key,
      order: prev.key === key && prev.order === "desc" ? "asc" : "desc"
    }));
  };

  const filteredAndSortedTrades = useMemo(() => {
    let filtered = trades.filter(trade => {
      const symbolMatch = !filters.symbol || trade.symbol.toLowerCase().includes(filters.symbol.toLowerCase());
      const accountMatch = filters.accountId === "all" || trade.account_id === filters.accountId;
      const sessionMatch = filters.session === "all" || trade.session === filters.session;
      const directionMatch = filters.direction === "all" || trade.direction === filters.direction;
      return symbolMatch && accountMatch && sessionMatch && directionMatch;
    });

    return filtered.sort((a, b) => {
      const aVal = a[sort.key] || 0;
      const bVal = b[sort.key] || 0;
      if (aVal < bVal) return sort.order === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.order === "asc" ? 1 : -1;
      return 0;
    });
  }, [trades, filters, sort]);

  const getAccountName = (accountId) => {
    return accounts.find(acc => acc.id === accountId)?.name || "N/A";
  };

  const TradeRow = ({ trade }) => {
    const isOpen = expanded.has(trade.id);
    // Cheap notes-badge — show a StickyNote icon if this trade already
    // has notes/images so users can spot annotated trades at a glance.
    const savedNotes = getNotes(trade.id);
    const hasAnnotations = (savedNotes.notes && savedNotes.notes.trim().length > 0) || (savedNotes.images || []).length > 0;

    // Right-click quick actions — "PC feel". Task #189.
    const contextItems = [
      { header: `${trade.symbol} · ${trade.direction?.toUpperCase() || ""}` },
      { label: isOpen ? "Hide notes" : "Edit notes",
        icon: <StickyNoteIcon className="w-4 h-4"/>,
        onClick: () => toggleExpanded(trade.id) },
      { label: "Open in TradingView",
        icon: <ExternalLink className="w-4 h-4"/>,
        onClick: () => window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent((trade.symbol||"").replace(/1!$/,""))}`, "_blank") },
      { separator: true },
      { label: "Copy P&L",
        icon: <Copy className="w-4 h-4"/>,
        onClick: () => navigator.clipboard?.writeText(`$${(trade.profit_loss || 0).toFixed(2)}`) },
      { label: "Copy row as JSON",
        icon: <Copy className="w-4 h-4"/>,
        onClick: () => navigator.clipboard?.writeText(JSON.stringify(trade, null, 2)) },
      { separator: true },
      { label: "Delete trade",
        icon: <Trash2 className="w-4 h-4"/>,
        danger: true,
        onClick: async () => {
          if (!window.confirm(`Delete ${trade.symbol} trade? This cannot be undone.`)) return;
          try {
            await Trade.delete(trade.id);
            audit(AUDIT_EVENTS.TRADE_DELETE, { tradeId: trade.id, symbol: trade.symbol, pnl: trade.pnl });
            loadData();
          }
          catch (e) { alert(`Delete failed: ${e.message}`); }
        } },
    ];

    const { menuProps, menu } = useContextMenu(contextItems);

    return (
      <>
        <TableRow {...menuProps}
                  className={`hover:bg-slate-800/50 transition-colors ${isOpen ? "bg-slate-800/40" : ""}`}
                  onDoubleClick={() => toggleExpanded(trade.id)}
                  title="Right-click for actions · Double-click to expand notes">
          <TableCell className="w-8 p-0">
            <button onClick={() => toggleExpanded(trade.id)}
                    title={isOpen ? "Hide notes" : "Show notes"}
                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white">
              {isOpen ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
              {hasAnnotations && !isOpen && (
                <StickyNote className="w-2.5 h-2.5 text-blue-400 -ml-0.5 -mt-2"/>
              )}
            </button>
          </TableCell>
          <TableCell className="font-semibold text-white">{trade.symbol}</TableCell>
          <TableCell className="text-slate-300">{getAccountName(trade.account_id)}</TableCell>
          <TableCell>
            <Badge
              variant="outline"
              className={trade.direction === "long" ? "bg-green-500/20 text-green-400 border-green-500/50" : "bg-red-500/20 text-red-400 border-red-500/50"}
            >
              {trade.direction === "long" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {trade.direction.toUpperCase()}
            </Badge>
          </TableCell>
          <TableCell className="text-slate-300">{format(new Date(trade.entry_time), "MMM d, yyyy HH:mm")}</TableCell>
          <TableCell className="text-slate-300">{trade.entry_price?.toFixed(5)}</TableCell>
          <TableCell className="text-slate-300">{trade.exit_price?.toFixed(5) || '-'}</TableCell>
          <TableCell className={`font-semibold ${(trade.profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
            ${(trade.profit_loss || 0).toFixed(2)}
          </TableCell>
          <TableCell className="text-slate-400 capitalize">{trade.session}</TableCell>
          <TableCell><SourceBadge trade={trade}/></TableCell>
          <TableCell><TradeTagsCell tradeId={trade.id}/></TableCell>
        </TableRow>
        {isOpen && (
          <TradeNotesRow tradeId={trade.id} columnCount={11} onClose={() => toggleExpanded(trade.id)}/>
        )}
        {menu}
      </>
    );
  };

  // Source badge — reads strategy_name / notes / entry_signal fields and
  // reports which Pine indicator + version fingerprint we detected. Falls
  // back to a plain "manual" chip when no signal marker exists.
  const SourceBadge = ({ trade }) => {
    const raw = trade.strategy_name || trade.entry_signal || trade.source || "";
    const parsed = parseStrategyName(raw);
    const version = detectPineVersion(raw);
    const isAuto = !!raw && (parsed.type === "SL_UPDATE" || parsed.type === "ENTRY" || parsed.type === "CLOSE" || parsed.type === "SESSION_TAG" || /pmt|tpost|webhook|freeball|pro auto|trade manager|tm v/i.test(raw));
    const label = version || (isAuto ? "Auto" : "Manual");
    const cls = version
      ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
      : isAuto
        ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
        : "bg-slate-500/20 text-slate-300 border-slate-500/40";
    return (
      <span title={raw || "Manual entry — no strategy signal detected"}
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${cls}`}>
        {label}
      </span>
    );
  };

  const SortableHeader = ({ tkey, label }) => (
    <TableHead onClick={() => handleSort(tkey)} className="cursor-pointer hover:bg-slate-700">
      <div className="flex items-center gap-1">
        {label}
        {sort.key === tkey && <ArrowUpDown className="w-3 h-3" />}
      </div>
    </TableHead>
  );

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Trade Journal</h1>
            <p className="text-slate-400">A complete log of all your trades.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ClearJournalButton
              closedCount={trades.filter(t => (t.status || "").toLowerCase() === "closed").length}
              onCleared={loadData}
            />
            <ImportCsvButton onImported={loadData}/>
            <a href={TradeJournal.csvUrl()} download>
              <Button className="bg-green-600 hover:bg-green-700 text-white border-0 font-semibold">
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </a>
            <Link to={createPageUrl("NewTrade")}>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
                <Plus className="w-5 h-5 mr-2" />
                Log New Trade
              </Button>
            </Link>
          </div>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 p-4 flex flex-row items-center gap-4">
            <Filter className="w-5 h-5 text-slate-400" />
            <Input
              placeholder="Filter by Symbol..."
              value={filters.symbol}
              onChange={(e) => handleFilterChange("symbol", e.target.value)}
              className="max-w-xs bg-slate-800 border-slate-700 text-white"
            />
            <Select value={filters.accountId} onValueChange={(val) => handleFilterChange("accountId", val)}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
              </SelectContent>
            </Select>
             <Select value={filters.session} onValueChange={(val) => handleFilterChange("session", val)}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="All Sessions" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="london">London</SelectItem>
                <SelectItem value="new_york">New York</SelectItem>
                <SelectItem value="asian">Asian</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-800/50 text-xs text-slate-400 uppercase tracking-wider">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <SortableHeader tkey="symbol" label="Symbol" />
                    <TableHead>Account</TableHead>
                    <TableHead>Direction</TableHead>
                    <SortableHeader tkey="entry_time" label="Entry Time" />
                    <SortableHeader tkey="entry_price" label="Entry Price" />
                    <SortableHeader tkey="exit_price" label="Exit Price" />
                    <SortableHeader tkey="profit_loss" label="P&L" />
                    <SortableHeader tkey="session" label="Session" />
                    <TableHead>Source</TableHead>
                    <TableHead>Tags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-800">
                  {loading ? (
                    Array(10).fill(0).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={11}><Skeleton className="h-5 w-full bg-slate-800"/></TableCell>
                      </TableRow>
                    ))
                  ) : filteredAndSortedTrades.length > 0 ? (
                    filteredAndSortedTrades.map(trade => <TradeRow key={trade.id} trade={trade} />)
                  ) : (
                    <TableRow><TableCell colSpan={11} className="text-center py-10 text-slate-400">No trades match your criteria.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Task #173 — Clear Journal button (export-first, two-step confirm)
// ────────────────────────────────────────────────────────────────
function ClearJournalButton({ closedCount, onCleared }) {
  const [step, setStep] = useState(0);            // 0 idle, 1 confirm-shown
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  if (step === 0) {
    return (
      <Button
        className="bg-red-600 hover:bg-red-700 text-white border-0 font-semibold"
        onClick={() => { setStep(1); setTyped(""); }}
        disabled={closedCount === 0}
      >
        <Trash2 className="w-4 h-4 mr-2" />
        Clear Journal ({closedCount})
      </Button>
    );
  }

  const confirmToken = "CLEAR";
  const canDelete = typed.trim().toUpperCase() === confirmToken && !busy;

  const doDelete = async () => {
    setBusy(true);
    try {
      const res = await TradeJournal.clear({ scope: "closed_only" });
      setStep(0); setTyped("");
      onCleared?.();
      alert(`Deleted ${res.deleted ?? "?"} closed trades. Live positions untouched.`);
    } catch (e) {
      alert(`Clear failed: ${e.message}`);
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap p-2 rounded-md border border-red-500/40 bg-red-500/10">
      <a href={TradeJournal.csvUrl()} download
         className="text-xs text-slate-300 underline hover:text-white flex items-center gap-1">
        <Download className="w-3 h-3" /> Export CSV first
      </a>
      <span className="text-xs text-slate-400">then type</span>
      <code className="text-xs font-mono px-1.5 py-0.5 bg-slate-800 text-red-300 rounded">CLEAR</code>
      <Input
        value={typed}
        onChange={e => setTyped(e.target.value)}
        placeholder="type CLEAR"
        autoFocus
        className="h-7 w-24 bg-slate-900 border-slate-700 text-white font-mono text-xs"
        onKeyDown={e => { if (e.key === "Enter" && canDelete) doDelete(); if (e.key === "Escape") setStep(0); }}
      />
      <Button
        size="sm" variant="destructive"
        disabled={!canDelete}
        onClick={doDelete}
        className="h-7 text-xs"
      >
        Delete {closedCount}
      </Button>
      <Button
        size="sm" variant="ghost"
        onClick={() => { setStep(0); setTyped(""); }}
        className="h-7 text-xs text-slate-400 hover:text-white"
      >
        Cancel
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Task #74 — Import CSV button + multi-step dialog.
// The single biggest gap between TradeCore and Tradezella. Users
// migrating from Tradezella / TopStep / Tradovate have years of
// history in a CSV they need to bring over. Auto-detects broker
// format, maps columns, previews rows, imports via Trade.create.
// ─────────────────────────────────────────────────────────────
function ImportCsvButton({ onImported }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}
              className="bg-slate-800 border border-slate-700 text-white hover:bg-slate-700 font-semibold">
        <Upload className="w-4 h-4 mr-2"/>
        Import CSV
      </Button>
      {open && <ImportCsvDialog onClose={() => setOpen(false)} onImported={onImported}/>}
    </>
  );
}

function ImportCsvDialog({ onClose, onImported }) {
  // step: choose → preview → importing → done
  const [step, setStep] = useState("choose");
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);       // { headers, rows }
  const [broker, setBroker] = useState(null);        // detected broker meta
  const [mapping, setMapping] = useState({});        // field → header idx
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: [] });

  const onFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    const p = parseCsv(text);
    setParsed(p);
    const b = detectBroker(p.headers);
    setBroker(b);
    setMapping(autoMap(p.headers, COLUMN_PRESETS[b.key] || COLUMN_PRESETS.generic));
    setStep("preview");
  };

  const runImport = async () => {
    if (!parsed) return;
    setStep("importing");
    const errors = [];
    let done = 0;
    setProgress({ done: 0, total: parsed.rows.length, errors: [] });
    for (let i = 0; i < parsed.rows.length; i++) {
      const raw = parsed.rows[i];
      const result = normalizeRow(raw, mapping, broker?.key || "generic");
      if (result.error) {
        errors.push({ row: i + 2, msg: result.error });    // +2: header row + 1-index
      } else {
        try {
          await Trade.create(result.trade);
        } catch (e) {
          errors.push({ row: i + 2, msg: e.message || "server error" });
        }
      }
      done++;
      // Progress update every ~10 rows (or last) to keep UI smooth.
      if (done % 10 === 0 || done === parsed.rows.length) {
        setProgress({ done, total: parsed.rows.length, errors });
      }
    }
    setProgress({ done, total: parsed.rows.length, errors });
    setStep("done");
    onImported?.();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-500"/>
            Import trades from CSV
          </DialogTitle>
          <p className="text-sm text-slate-400">
            Bring your history from Tradovate / MT4-5 / Tradezella / IBKR / NinjaTrader.
            Anything else — pick columns manually.
          </p>
        </DialogHeader>

        {step === "choose" && (
          <div className="py-4">
            <label className="flex flex-col items-center justify-center gap-3 h-40 rounded-lg border-2 border-dashed border-slate-700 hover:border-blue-500 hover:bg-slate-950 cursor-pointer text-slate-500 hover:text-slate-300 transition-colors">
              <Upload className="w-8 h-8"/>
              <span className="text-sm font-semibold">Choose a CSV file</span>
              <span className="text-xs text-slate-500">.csv from your broker or journal export</span>
              <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="hidden"/>
            </label>
          </div>
        )}

        {step === "preview" && parsed && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
              <div className="text-sm">
                <span className="text-slate-500">Detected: </span>
                <span className="text-white font-semibold">{broker?.name || "Unknown"}</span>
                <span className="text-slate-500 ml-2">· {parsed.rows.length} rows · {parsed.headers.length} columns</span>
              </div>
              <button onClick={() => setStep("choose")}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
                ← Different file
              </button>
            </div>

            {/* Column mapping */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">
                Column mapping {broker?.key === "generic" && <span className="text-red-400">· pick each field</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {["symbol","direction","qty_total","entry_price","exit_price","entry_time","exit_time","profit_loss"].map(field => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-24 shrink-0">{field}</span>
                    <select
                      value={mapping[field] ?? -1}
                      onChange={e => setMapping(m => ({ ...m, [field]: Number(e.target.value) }))}
                      className="flex-1 h-8 bg-slate-900 border border-slate-700 rounded text-xs text-white px-2"
                    >
                      <option value={-1}>— skip —</option>
                      {parsed.headers.map((h, i) => (
                        <option key={i} value={i}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview first 5 rows */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-400 font-semibold">
                Preview (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-900">
                    <tr>
                      {["symbol","direction","qty","entry","exit","P&L","entry time"].map(h => (
                        <th key={h} className="text-left px-2 py-1.5 text-slate-500 font-semibold uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((r, i) => {
                      const { trade, error } = normalizeRow(r, mapping, broker?.key || "generic");
                      if (error) return (
                        <tr key={i}><td colSpan={7} className="px-2 py-1 text-red-400">Row {i+2}: {error}</td></tr>
                      );
                      return (
                        <tr key={i} className="border-t border-slate-800">
                          <td className="px-2 py-1 text-white font-semibold">{trade.symbol}</td>
                          <td className="px-2 py-1 uppercase text-slate-300">{trade.direction}</td>
                          <td className="px-2 py-1 text-slate-300">{trade.qty_total ?? "—"}</td>
                          <td className="px-2 py-1 text-slate-300">{trade.entry_price ?? "—"}</td>
                          <td className="px-2 py-1 text-slate-300">{trade.exit_price  ?? "—"}</td>
                          <td className={`px-2 py-1 font-semibold ${trade.profit_loss > 0 ? "text-emerald-400" : trade.profit_loss < 0 ? "text-rose-400" : "text-slate-400"}`}>
                            {trade.profit_loss != null ? `${trade.profit_loss >= 0 ? "+" : ""}$${trade.profit_loss.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-2 py-1 text-slate-500 truncate max-w-40">{trade.entry_time || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")}
                      className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                Back
              </Button>
              <Button onClick={runImport} disabled={mapping.symbol == null || mapping.symbol === -1}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                <Upload className="w-4 h-4 mr-2"/>
                Import {parsed.rows.length} rows
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "importing" && (
          <div className="py-8 space-y-3">
            <div className="text-center text-slate-300 text-sm">
              Importing... {progress.done} / {progress.total}
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all"
                   style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}/>
            </div>
            {progress.errors.length > 0 && (
              <div className="text-xs text-red-300">
                {progress.errors.length} error{progress.errors.length > 1 ? "s" : ""} so far
              </div>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3 text-emerald-300">
              <CheckCircle2 className="w-6 h-6"/>
              <div>
                <div className="text-lg font-semibold text-white">Import complete</div>
                <div className="text-sm text-slate-400">
                  {progress.done - progress.errors.length} / {progress.done} rows imported successfully
                  {progress.errors.length > 0 && ` · ${progress.errors.length} skipped`}
                </div>
              </div>
            </div>
            {progress.errors.length > 0 && (
              <div className="rounded-lg border border-red-800/40 bg-red-950/30 p-3 text-xs max-h-40 overflow-y-auto">
                <div className="text-red-200 font-semibold mb-1 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4"/> Skipped rows
                </div>
                {progress.errors.slice(0, 20).map((e, i) => (
                  <div key={i} className="text-red-300">Row {e.row}: {e.msg}</div>
                ))}
                {progress.errors.length > 20 && (
                  <div className="text-red-400 mt-1">…and {progress.errors.length - 20} more</div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button onClick={onClose} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
