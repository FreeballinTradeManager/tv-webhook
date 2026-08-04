import React, { useState, useEffect, useMemo } from "react";
import { Trade, Strategy } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Plus, Edit, Trash2, BookOpen, TrendingUp, TrendingDown,
  Image as ImageIcon, X as XIcon, Copy, Files,
} from "lucide-react";
import { useContextMenu } from "@/components/RightClickMenu";

// Task #188 — Daily Journal.
// One entry per calendar date. Captures the market context that
// per-trade rows can't: bias for the day, day type, structure image,
// setup notes. Wins/losses/net-P&L auto-summarized from Trade rows
// for the same date but user can override for days where trades
// weren't logged in TradeCore (e.g., broker-only executions).
// LocalStorage-backed for MVP; Journal table lands with backend #40.

const JOURNAL_KEY = "tradecore_daily_journal_v1";
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};

const BIAS_OPTIONS = [
  { value: "bullish",  label: "Bullish",  color: "bg-emerald-600 text-white" },
  { value: "bearish",  label: "Bearish",  color: "bg-red-600 text-white" },
  { value: "neutral",  label: "Neutral",  color: "bg-slate-600 text-white" },
];
const DAY_TYPE_OPTIONS = [
  { value: "impulsive",     label: "Impulsive",     color: "bg-blue-600 text-white" },
  { value: "consolidation", label: "Consolidation", color: "bg-slate-600 text-white" },
  { value: "mixed",         label: "Mixed",         color: "bg-purple-600 text-white" },
];

// Named image slots — user's per-trade workflow: market structure →
// higher TF → lower TF → setup annotation → final result screenshot.
// Order here IS the display order in both form and card.
const IMAGE_SLOTS = [
  { key: "market_structure", label: "Market Structure",   hint: "Where's price in the bigger picture?" },
  { key: "higher_tf",        label: "Higher Time Frame",  hint: "e.g. 4H / Daily context" },
  { key: "lower_tf",         label: "Lower Time Frame",   hint: "e.g. 5m / 15m execution" },
  { key: "setup",            label: "Setup",              hint: "The pattern / entry trigger" },
  { key: "final_trade",      label: "Final Trade Result", hint: "Screenshot after the trade closed" },
];

function loadEntries() {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveEntries(list) {
  localStorage.setItem(JOURNAL_KEY, JSON.stringify(list));
}

export default function DailyJournalPage() {
  const [entries, setEntries] = useState(loadEntries);
  const [trades, setTrades] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState("");

  useEffect(() => saveEntries(entries), [entries]);
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingTrades(true);
      try {
        // Fetch trades + strategies in parallel. Strategies power the
        // "which strategy/indicator did you use today?" multi-select
        // that the user asked for — kept in sync with the Strategy
        // library so MNQ Trade Manager / MGC Trade Manager show up.
        const [t, s] = await Promise.all([
          Trade.list("-entry_time", 500).catch(() => []),
          Strategy.list().catch(() => []),
        ]);
        if (alive) { setTrades(t || []); setStrategies(s || []); }
      } catch { if (alive) { setTrades([]); setStrategies([]); } }
      if (alive) setLoadingTrades(false);
    })();
    return () => { alive = false; };
  }, []);

  // Group closed trades by yyyy-mm-dd for auto-summaries.
  const tradesByDate = useMemo(() => {
    const map = new Map();
    trades.forEach(t => {
      if (t.status !== "closed" || t.profit_loss == null) return;
      const iso = t.exit_time || t.entry_time;
      if (!iso) return;
      const d = new Date(iso);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const arr = map.get(key) || [];
      arr.push(t);
      map.set(key, arr);
    });
    return map;
  }, [trades]);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [entries]
  );

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (e) => { setEditing(e); setDialogOpen(true); };
  const remove = (e) => {
    if (!window.confirm(`Delete journal entry for ${e.date}? This cannot be undone.`)) return;
    setEntries(prev => prev.filter(x => x.id !== e.id));
  };
  const duplicate = (src) => {
    setEntries(prev => {
      const nextId = (prev.reduce((m, x) => Math.max(m, x.id || 0), 0)) + 1;
      const { id, ...rest } = src;
      const clone = { ...rest, id: nextId, date: todayISO() };
      return [clone, ...prev];
    });
    setFlash("✓ Entry duplicated to today");
    setTimeout(() => setFlash(""), 1500);
  };
  const copyEntryJson = async (e) => {
    try { await navigator.clipboard.writeText(JSON.stringify(e, null, 2)); }
    catch { alert("Clipboard blocked"); }
  };
  const upsert = (data) => {
    setEntries(prev => {
      if (editing) return prev.map(x => x.id === editing.id ? { ...x, ...data } : x);
      const id = (prev.reduce((m, x) => Math.max(m, x.id || 0), 0)) + 1;
      return [{ id, ...data }, ...prev];
    });
    setDialogOpen(false);
    setEditing(null);
    setFlash(editing ? "✓ Journal entry updated" : "✓ Journal entry saved");
    setTimeout(() => setFlash(""), 1500);
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <BookOpen className="w-7 h-7 text-blue-500"/> Daily Journal
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl">
              One entry per day. Log market bias, day type, 4H structure image, setup notes.
              Trades from the same date auto-fill wins / losses / net P&L — override anything that isn't tracked in TradeCore.
            </p>
          </div>
          <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4 mr-2"/>New entry
          </Button>
        </div>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        {sorted.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-8 text-center">
              <BookOpen className="w-12 h-12 text-slate-700 mx-auto mb-3"/>
              <p className="text-slate-400 mb-4">No journal entries yet. Log today's market bias and day type — takes 30 seconds.</p>
              <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="w-4 h-4 mr-2"/>Log today
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sorted.map(entry => (
              <EntryCard
                key={entry.id}
                entry={entry}
                dayTrades={tradesByDate.get(entry.date) || []}
                strategies={strategies}
                loadingTrades={loadingTrades}
                onEdit={() => openEdit(entry)}
                onDelete={() => remove(entry)}
                onDuplicate={() => duplicate(entry)}
                onCopyJson={() => copyEntryJson(entry)}
              />
            ))}
          </div>
        )}

        <EntryForm
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          entry={editing}
          existingDates={entries.map(e => e.date)}
          strategies={strategies}
          onSave={upsert}
        />
      </div>
    </div>
  );
}

function EntryCard({ entry, dayTrades, strategies, loadingTrades, onEdit, onDelete, onDuplicate, onCopyJson }) {
  const { menuProps, menu } = useContextMenu([
    { header: entry.date || "Journal entry" },
    { label: "Edit entry",       icon: <Edit className="w-4 h-4"/>,   onClick: onEdit, kbd: "dbl-click" },
    onDuplicate && { label: "Duplicate to today", icon: <Files className="w-4 h-4"/>, onClick: onDuplicate },
    onCopyJson && { label: "Copy row as JSON",    icon: <Copy className="w-4 h-4"/>,  onClick: onCopyJson },
    { separator: true },
    { label: "Delete entry",     icon: <Trash2 className="w-4 h-4"/>, onClick: onDelete, danger: true },
  ].filter(Boolean));
  const bias    = BIAS_OPTIONS.find(o => o.value === entry.bias);
  const dayType = DAY_TYPE_OPTIONS.find(o => o.value === entry.day_type);
  // Resolve strategy IDs → strategy objects so we can show the name
  // even after the underlying strategy was renamed / re-tagged.
  const usedStrategies = useMemo(() => {
    const ids = entry.strategies_used || [];
    return ids.map(id => strategies.find(s => s.id === id)).filter(Boolean);
  }, [entry.strategies_used, strategies]);
  const customIndicators = (entry.custom_indicators || "").trim();

  // Auto-computed stats from the actual Trade rows for this date.
  const autoStats = useMemo(() => {
    let wins = 0, losses = 0, net = 0, risk = 0;
    dayTrades.forEach(t => {
      const pnl = t.profit_loss || 0;
      net += pnl;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      if (t.risk_amount || t.risk) risk += (t.risk_amount || t.risk || 0);
    });
    return { wins, losses, net, risk };
  }, [dayTrades]);

  // User override wins if present, else auto.
  const wins    = entry.wins    != null ? entry.wins    : autoStats.wins;
  const losses  = entry.losses  != null ? entry.losses  : autoStats.losses;
  const risk    = entry.risk    != null ? entry.risk    : autoStats.risk;
  const net     = entry.net_pnl != null ? entry.net_pnl : autoStats.net;

  const prettyDate = (() => {
    if (!entry.date) return "—";
    const d = new Date(entry.date + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  })();

  return (
    <>
    <Card {...menuProps} onDoubleClick={onEdit}
          title="Right-click for actions · Double-click to edit"
          className="bg-slate-900 border-slate-800 overflow-hidden">
      <CardHeader className="border-b border-slate-800 pb-3">
        <div className="flex justify-between items-start gap-2 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-white text-lg">{prettyDate}</CardTitle>
            <div className="flex flex-wrap gap-2 mt-2">
              {bias && <Badge className={`${bias.color} text-xs uppercase tracking-wider`}>{bias.label}</Badge>}
              {dayType && <Badge className={`${dayType.color} text-xs uppercase tracking-wider`}>{dayType.label}</Badge>}
              {usedStrategies.map(s => {
                const assets = Array.isArray(s.preferred_pairs) && s.preferred_pairs.length > 0
                  ? ` · ${s.preferred_pairs.join("/")}`
                  : "";
                return (
                  <Badge key={s.id} className="bg-blue-600 text-white text-xs">
                    {s.name}{assets}
                  </Badge>
                );
              })}
              {customIndicators && (
                <Badge className="bg-slate-700 text-white text-xs" title="Custom / one-off indicators">
                  + {customIndicators}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button onClick={onEdit} title="Edit"
                    className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800">
              <Edit className="w-4 h-4"/>
            </button>
            <button onClick={onDelete} title="Delete"
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-900/40">
              <Trash2 className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Day stats row */}
        <div className="grid grid-cols-4 gap-2">
          <StatMini label="Wins"    value={wins}    valueColor="text-emerald-400"/>
          <StatMini label="Losses"  value={losses}  valueColor="text-rose-400"/>
          <StatMini label="Risk"    value={`$${(risk || 0).toFixed(2)}`}    valueColor="text-slate-200"/>
          <StatMini label="Net P&L" value={`${net >= 0 ? "+" : ""}$${(net || 0).toFixed(2)}`}
                    valueColor={net >= 0 ? "text-emerald-400" : "text-rose-400"}/>
        </div>

        {/* Image gallery — five named slots, only render slots with images.
            Legacy entries with just `structure_image` still show under
            Market Structure via the fallback. */}
        {(() => {
          const gallery = entry.images && typeof entry.images === "object"
            ? entry.images
            : (entry.structure_image ? { market_structure: entry.structure_image } : {});
          const filled = IMAGE_SLOTS.filter(s => gallery[s.key]);
          if (filled.length === 0) return null;
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filled.map(slot => (
                <div key={slot.key} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    {slot.label}
                  </div>
                  <div className="rounded-md border border-slate-800 overflow-hidden bg-slate-950">
                    <img src={gallery[slot.key]} alt={slot.label}
                         className="w-full max-h-64 object-contain"/>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Setup + notes */}
        {(entry.setup_notes || entry.day_notes) && (
          <div className="space-y-3">
            {entry.setup_notes && (
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Setup</div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.setup_notes}</p>
              </div>
            )}
            {entry.day_notes && (
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Day notes</div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">{entry.day_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Auto-linked trades summary */}
        {!loadingTrades && dayTrades.length > 0 && (
          <div className="pt-3 border-t border-slate-800">
            <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-2">
              Trades from this date ({dayTrades.length})
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {dayTrades.map(t => (
                <div key={t.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-slate-950 border border-slate-800">
                  {t.profit_loss >= 0
                    ? <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0"/>
                    : <TrendingDown className="w-3 h-3 text-rose-400 shrink-0"/>}
                  <span className="text-white font-semibold">{t.symbol || t.ticker}</span>
                  <span className="text-slate-500 uppercase">{t.direction || t.side}</span>
                  <span className="ml-auto tabular-nums font-semibold"
                        style={{ color: t.profit_loss >= 0 ? "#4ade80" : "#f87171" }}>
                    {t.profit_loss >= 0 ? "+" : ""}${(t.profit_loss || 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    {menu}
    </>
  );
}

function StatMini({ label, value, valueColor }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-md px-2 py-1.5 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}

function EntryForm({ open, onOpenChange, entry, existingDates, strategies, onSave }) {
  const [date, setDate] = useState(todayISO());
  const [bias, setBias] = useState("neutral");
  const [dayType, setDayType] = useState("consolidation");
  const [strategiesUsed, setStrategiesUsed] = useState([]);
  const [customIndicators, setCustomIndicators] = useState("");
  const [setupNotes, setSetupNotes] = useState("");
  const [dayNotes, setDayNotes] = useState("");
  // images is now a keyed object — one slot per stage of the trade
  // review workflow (market structure → HTF → LTF → setup → final).
  // Legacy entries with just `structure_image` get migrated into the
  // `market_structure` slot on load below.
  const [images, setImages] = useState({});
  const setImage = (slotKey, dataUrl) => setImages(prev => ({ ...prev, [slotKey]: dataUrl }));
  const clearImage = (slotKey) => setImages(prev => { const n = {...prev}; delete n[slotKey]; return n; });
  const [wins, setWins] = useState("");
  const [losses, setLosses] = useState("");
  const [risk, setRisk] = useState("");
  const [netPnl, setNetPnl] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    setDate(entry?.date || todayISO());
    setBias(entry?.bias || "neutral");
    setDayType(entry?.day_type || "consolidation");
    setStrategiesUsed(Array.isArray(entry?.strategies_used) ? entry.strategies_used : []);
    setCustomIndicators(entry?.custom_indicators || "");
    setSetupNotes(entry?.setup_notes || "");
    setDayNotes(entry?.day_notes || "");
    // Migrate legacy single-image entries into the market_structure slot
    // so old journal rows don't lose their image after the refactor.
    if (entry?.images && typeof entry.images === "object") {
      setImages(entry.images);
    } else if (entry?.structure_image) {
      setImages({ market_structure: entry.structure_image });
    } else {
      setImages({});
    }
    setWins(entry?.wins != null ? String(entry.wins) : "");
    setLosses(entry?.losses != null ? String(entry.losses) : "");
    setRisk(entry?.risk != null ? String(entry.risk) : "");
    setNetPnl(entry?.net_pnl != null ? String(entry.net_pnl) : "");
    setErr(null);
  }, [entry, open]);

  const toggleStrategy = (id) => {
    setStrategiesUsed(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Slot-parameterized upload / paste — same UX for all five image slots.
  const onImageChangeFor = (slotKey) => (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      return setErr("Image too large — keep under 2MB (localStorage MVP).");
    }
    const reader = new FileReader();
    reader.onload = () => setImage(slotKey, reader.result);
    reader.readAsDataURL(file);
  };
  const onPasteFor = (slotKey) => (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type?.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setImage(slotKey, reader.result);
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!date) return setErr("Date required");
    // Duplicate-date guard: only when creating a new entry.
    if (!entry && existingDates.includes(date)) {
      return setErr(`You already have an entry for ${date}. Edit that one instead.`);
    }
    const payload = {
      date,
      bias,
      day_type: dayType,
      strategies_used: strategiesUsed,
      custom_indicators: customIndicators.trim(),
      setup_notes: setupNotes.trim(),
      day_notes: dayNotes.trim(),
      images,
      wins:    wins    === "" ? null : Number(wins),
      losses:  losses  === "" ? null : Number(losses),
      risk:    risk    === "" ? null : Number(risk),
      net_pnl: netPnl  === "" ? null : Number(netPnl),
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit" : "New"} Journal Entry</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {/* Date */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)}
                   className="bg-slate-950 border-slate-700 text-white" required
                   disabled={!!entry}/>
            {entry && (
              <p className="text-xs text-slate-500">Date can't change on an existing entry — delete and re-create if needed.</p>
            )}
          </div>

          {/* Bias */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Market Bias</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-950 border border-slate-800 p-1">
              {BIAS_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setBias(o.value)}
                        className={`h-9 text-sm font-semibold rounded-md capitalize ${
                          bias === o.value ? o.color : "text-slate-400 hover:text-white"
                        }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Day type */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Day Type (4H · 5 candles)</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-950 border border-slate-800 p-1">
              {DAY_TYPE_OPTIONS.map(o => (
                <button key={o.value} type="button" onClick={() => setDayType(o.value)}
                        className={`h-9 text-sm font-semibold rounded-md ${
                          dayType === o.value ? o.color : "text-slate-400 hover:text-white"
                        }`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Strategies / indicators used — pulls from Strategy library */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Strategies / indicators used</Label>
            {strategies?.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 rounded-lg bg-slate-950 border border-slate-800 p-2">
                {strategies.map(s => {
                  const on = strategiesUsed.includes(s.id);
                  const assets = Array.isArray(s.preferred_pairs) && s.preferred_pairs.length > 0
                    ? ` · ${s.preferred_pairs.join("/")}`
                    : "";
                  return (
                    <button key={s.id} type="button" onClick={() => toggleStrategy(s.id)}
                            className={`h-8 px-3 rounded-md text-xs font-semibold border transition-colors ${
                              on
                                ? "bg-blue-600 text-white border-blue-500"
                                : "bg-slate-900 text-slate-300 border-slate-700 hover:border-blue-500/60"
                            }`}>
                      {on ? "✓ " : ""}{s.name}<span className="text-blue-200/80">{assets}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-slate-500 bg-slate-950 border border-slate-800 rounded-md p-3">
                No strategies yet — create one on <span className="text-blue-400">Strategies</span> to pick it here, or type into the "Other indicators" field below.
              </div>
            )}
            <div className="pt-1">
              <Label className="text-slate-400 text-xs">Other indicators (comma-separated)</Label>
              <Input value={customIndicators} onChange={e => setCustomIndicators(e.target.value)}
                     placeholder="e.g. 4H CRT, VWAP, Milana Bias"
                     className="bg-slate-950 border-slate-700 text-white h-9 mt-1"/>
            </div>
          </div>

          {/* Image slots — five stages of the trade review workflow.
              Each accepts click-upload OR paste. Empty slots stay
              collapsed so the form doesn't feel overwhelming. */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div>
              <Label className="text-white text-sm">Trade Review Images</Label>
              <p className="text-xs text-slate-500 mt-0.5">
                Walk through your setup: market structure → higher TF → lower TF → the setup → final result.
              </p>
            </div>
            {IMAGE_SLOTS.map(slot => {
              const img = images[slot.key];
              return (
                <div key={slot.key} className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <Label className="text-slate-300 text-xs uppercase tracking-wider">{slot.label}</Label>
                    <span className="text-[10px] text-slate-500">{slot.hint}</span>
                  </div>
                  {img ? (
                    <div className="relative rounded-md border border-slate-700 overflow-hidden bg-slate-950">
                      <img src={img} alt={slot.label} className="w-full max-h-64 object-contain"/>
                      <button type="button" onClick={() => clearImage(slot.key)}
                              className="absolute top-1 right-1 bg-slate-950/80 hover:bg-red-900/60 text-white rounded-full p-1"
                              title="Remove image">
                        <XIcon className="w-4 h-4"/>
                      </button>
                    </div>
                  ) : (
                    <label onPaste={onPasteFor(slot.key)}
                           className="flex items-center justify-center gap-2 h-14 rounded-md border-2 border-dashed border-slate-700 hover:border-blue-500 hover:bg-slate-950 cursor-pointer text-slate-500 hover:text-slate-300 transition-colors">
                      <ImageIcon className="w-4 h-4"/>
                      <span className="text-xs">Click to upload · or paste image (max 2MB)</span>
                      <input type="file" accept="image/*" onChange={onImageChangeFor(slot.key)} className="hidden"/>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          {/* Setup */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Setup / Trade Plan</Label>
            <textarea value={setupNotes} onChange={e => setSetupNotes(e.target.value)}
                      placeholder={"What are you watching?\n- Bias source (HTF trend + 4H structure)\n- Levels of interest\n- Trigger conditions"}
                      rows={4}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md p-2.5 text-white text-sm resize-y"/>
          </div>

          {/* Day notes */}
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Day Notes / Reflection</Label>
            <textarea value={dayNotes} onChange={e => setDayNotes(e.target.value)}
                      placeholder="What actually happened? What did you learn?"
                      rows={3}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md p-2.5 text-white text-sm resize-y"/>
          </div>

          {/* Manual result overrides */}
          <div className="space-y-1.5 pt-3 border-t border-slate-800">
            <div>
              <Label className="text-white text-sm">Results (override)</Label>
              <p className="text-xs text-slate-500 mt-0.5">
                Leave blank to auto-count from TradeCore trade rows for this date. Fill in only if you traded off-platform.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Wins</Label>
                <Input type="number" min="0" step="1" value={wins} onChange={e => setWins(e.target.value)}
                       placeholder="auto" className="bg-slate-950 border-slate-700 text-white h-9"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Losses</Label>
                <Input type="number" min="0" step="1" value={losses} onChange={e => setLosses(e.target.value)}
                       placeholder="auto" className="bg-slate-950 border-slate-700 text-white h-9"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Risk $</Label>
                <Input type="number" step="0.01" value={risk} onChange={e => setRisk(e.target.value)}
                       placeholder="auto" className="bg-slate-950 border-slate-700 text-white h-9"/>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-400 text-xs">Net P&L $</Label>
                <Input type="number" step="0.01" value={netPnl} onChange={e => setNetPnl(e.target.value)}
                       placeholder="auto" className="bg-slate-950 border-slate-700 text-white h-9"/>
              </div>
            </div>
          </div>

          {err && (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline"
                      className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
              {entry ? "Save changes" : "Add entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
