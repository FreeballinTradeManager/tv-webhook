import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  CreditCard, Plus, Edit, Trash2, CheckCircle2, AlertTriangle,
  Files, DollarSign, Calendar,
} from "lucide-react";
import { useContextMenu } from "@/components/RightClickMenu";

// Trading subscriptions tracker.
// Tracks every tool / service you pay for (TradingView, PMT, prop-firm
// resets, indicator licences, journals, data feeds, coaching) with cost,
// cadence, next-due date. Shows monthly + annual spend at the top, and
// an "alert bar" for anything due within 7 days or overdue.
//
// LocalStorage-backed (portable to backend when auth #40 lands).

const SUB_KEY = "tradecore_subscriptions_v1";

const CATEGORIES = [
  { key: "broker",      label: "Broker",       color: "bg-blue-600 text-white" },
  { key: "prop_firm",   label: "Prop firm",    color: "bg-purple-600 text-white" },
  { key: "platform",    label: "Platform",     color: "bg-teal-600 text-white" },
  { key: "indicator",   label: "Indicator",    color: "bg-emerald-600 text-white" },
  { key: "journal",     label: "Journal",      color: "bg-sky-600 text-white" },
  { key: "data",        label: "Data / news",  color: "bg-slate-700 text-white" },
  { key: "coaching",    label: "Coaching",     color: "bg-lime-600 text-black" },
  { key: "other",       label: "Other",        color: "bg-slate-600 text-white" },
];

const CADENCES = [
  { key: "monthly",   label: "Monthly",    perMonth: 1,     perYear: 12 },
  { key: "annual",    label: "Yearly",     perMonth: 1/12,  perYear: 1 },
  { key: "quarterly", label: "Quarterly",  perMonth: 1/3,   perYear: 4 },
  { key: "weekly",    label: "Weekly",     perMonth: 52/12, perYear: 52 },
  { key: "one_time",  label: "One-time",   perMonth: 0,     perYear: 0 },
];

const SEED_SUBSCRIPTIONS = [
  { id: 1, name: "TradingView Premium", category: "platform", amount: 59.95, cadence: "monthly",
    next_due: nextThisMonth(15), notes: "Charts + alerts. Annual saves ~15%.", active: true },
  { id: 2, name: "PickMyTrade", category: "platform", amount: 30, cadence: "monthly",
    next_due: nextThisMonth(5), notes: "TV → Tradovate routing. Multi-account tier.", active: true },
  { id: 3, name: "Freeballin Pro indicator", category: "indicator", amount: 149, cadence: "monthly",
    next_due: nextThisMonth(10), notes: "6.24 base + trade manager. Lifetime option available.", active: true },
  { id: 4, name: "Apex 100K reset", category: "prop_firm", amount: 20, cadence: "one_time",
    next_due: null, notes: "One-time reset if the account blows.", active: true },
];

function nextThisMonth(day) {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const nd = new Date(y, m, day);
  if (nd < d) nd.setMonth(m + 1);
  return nd.toISOString().slice(0, 10);
}
function loadSubs() {
  try {
    const raw = localStorage.getItem(SUB_KEY);
    return raw ? JSON.parse(raw) : SEED_SUBSCRIPTIONS;
  } catch { return SEED_SUBSCRIPTIONS; }
}
function saveSubs(list) {
  localStorage.setItem(SUB_KEY, JSON.stringify(list));
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
function advanceDue(iso, cadence) {
  if (!iso) return iso;
  const d = new Date(iso + "T00:00:00");
  if (cadence === "monthly")   d.setMonth(d.getMonth() + 1);
  else if (cadence === "annual")    d.setFullYear(d.getFullYear() + 1);
  else if (cadence === "quarterly") d.setMonth(d.getMonth() + 3);
  else if (cadence === "weekly")    d.setDate(d.getDate() + 7);
  else return null; // one_time — clears on pay
  return d.toISOString().slice(0, 10);
}

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState(loadSubs);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState("");

  useEffect(() => saveSubs(subs), [subs]);

  // Fire a notify() for anything due in ≤3 days — once per subscription
  // per day, tracked in localStorage so re-mounts don't spam.
  useEffect(() => {
    (async () => {
      try {
        const { notify } = await import("@/lib/notify");
        const seenKey = "tradecore_sub_alert_seen_v1";
        const seen = JSON.parse(localStorage.getItem(seenKey) || "{}");
        const today = todayISO();
        subs.filter(s => s.active !== false && s.next_due).forEach(s => {
          const days = daysBetween(today, s.next_due);
          if (days < 0 || days > 3) return;
          const sig = `${s.id}:${s.next_due}:${today}`;
          if (seen[sig]) return;
          seen[sig] = 1;
          notify("subscription_due", {
            title: `${s.name} due ${days === 0 ? "today" : `in ${days}d`}`,
            body: `$${(s.amount || 0).toFixed(2)} — ${s.cadence}${s.notes ? " · " + s.notes : ""}`,
          });
        });
        localStorage.setItem(seenKey, JSON.stringify(seen));
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subs.length]);

  const active = subs.filter(s => s.active !== false);

  const totals = useMemo(() => {
    let monthly = 0, annual = 0;
    active.forEach(s => {
      const cad = CADENCES.find(c => c.key === s.cadence);
      if (!cad) return;
      monthly += (s.amount || 0) * cad.perMonth;
      annual  += (s.amount || 0) * cad.perYear;
    });
    return { monthly, annual };
  }, [active]);

  const today = todayISO();
  const enriched = useMemo(() => active.map(s => {
    const days = s.next_due ? daysBetween(today, s.next_due) : null;
    let state = "future";
    if (days == null) state = "none";
    else if (days < 0) state = "overdue";
    else if (days <= 7) state = "due_soon";
    return { ...s, days_until_due: days, state };
  }).sort((a, b) => {
    const order = { overdue: 0, due_soon: 1, future: 2, none: 3 };
    if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
    if (a.days_until_due == null) return 1;
    if (b.days_until_due == null) return -1;
    return a.days_until_due - b.days_until_due;
  }), [active, today]);

  const overdue = enriched.filter(s => s.state === "overdue");
  const dueSoon = enriched.filter(s => s.state === "due_soon");

  const upsert = (data) => {
    setSubs(prev => {
      if (editing) return prev.map(s => s.id === editing.id ? { ...s, ...data } : s);
      const id = (prev.reduce((m, s) => Math.max(m, s.id || 0), 0)) + 1;
      return [...prev, { id, active: true, ...data }];
    });
    setDialogOpen(false); setEditing(null);
    setFlash(editing ? "✓ Subscription updated" : "✓ Subscription added");
    setTimeout(() => setFlash(""), 1500);
  };
  const remove = (s) => {
    if (!window.confirm(`Delete "${s.name}"?`)) return;
    setSubs(prev => prev.filter(x => x.id !== s.id));
  };
  const duplicate = (s) => {
    setSubs(prev => {
      const id = (prev.reduce((m, x) => Math.max(m, x.id || 0), 0)) + 1;
      return [...prev, { ...s, id, name: `${s.name} (copy)` }];
    });
  };
  const markPaid = (s) => {
    const nd = advanceDue(s.next_due, s.cadence);
    setSubs(prev => prev.map(x => x.id === s.id ? { ...x, next_due: nd, last_paid: todayISO() } : x));
    setFlash(nd ? `✓ Marked paid — next due ${nd}` : `✓ Marked paid — one-time, cleared`);
    setTimeout(() => setFlash(""), 1800);
  };
  const toggleActive = (s) => {
    setSubs(prev => prev.map(x => x.id === s.id ? { ...x, active: x.active === false ? true : false } : x));
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <CreditCard className="w-7 h-7 text-blue-500"/> Subscriptions
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl">
              Track every tool + service you pay for to trade. Monthly + annual spend up top, due-soon alerts inline. Right-click a row to mark paid, edit, or pause.
            </p>
          </div>
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}
                  className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4 mr-2"/>New subscription
          </Button>
        </header>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        {/* Alert banner — overdue + due-soon */}
        {(overdue.length > 0 || dueSoon.length > 0) && (
          <Card className={`${overdue.length > 0 ? "bg-red-950/40 border-red-800/60" : "bg-slate-900 border-slate-700"}`}>
            <CardContent className="p-3 flex items-center gap-3 text-sm">
              <AlertTriangle className={`w-5 h-5 shrink-0 ${overdue.length > 0 ? "text-red-400" : "text-slate-300"}`}/>
              <div className="flex-1 text-white">
                {overdue.length > 0 && <span className="text-red-200 font-semibold">{overdue.length} overdue</span>}
                {overdue.length > 0 && dueSoon.length > 0 && <span className="text-slate-500 mx-2">·</span>}
                {dueSoon.length > 0 && <span className="text-slate-200">{dueSoon.length} due in the next 7 days</span>}
              </div>
              <div className="text-xs text-slate-400">Right-click any row to mark paid.</div>
            </CardContent>
          </Card>
        )}

        {/* Spend summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Monthly spend"   value={`$${totals.monthly.toFixed(2)}`} accent="blue"/>
          <StatTile label="Annual spend"    value={`$${totals.annual.toFixed(0)}`}  accent="blue"/>
          <StatTile label="Active"          value={active.length}                    accent="emerald"/>
          <StatTile label="Overdue"         value={overdue.length}                   accent={overdue.length > 0 ? "red" : "slate"}/>
        </div>

        {/* Rows */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-0">
            {enriched.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No active subscriptions yet — add your first with the button above.
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {enriched.map(s => (
                  <SubRow key={s.id}
                          sub={s}
                          onEdit={() => { setEditing(s); setDialogOpen(true); }}
                          onDelete={() => remove(s)}
                          onDuplicate={() => duplicate(s)}
                          onMarkPaid={() => markPaid(s)}
                          onToggleActive={() => toggleActive(s)}/>
                ))}
              </div>
            )}
            {/* Paused / inactive list */}
            {subs.some(s => s.active === false) && (
              <div className="border-t border-slate-800 p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Paused</div>
                {subs.filter(s => s.active === false).map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="flex-1 truncate">{s.name} · ${s.amount} / {s.cadence}</span>
                    <button onClick={() => toggleActive(s)} className="text-blue-400 hover:text-blue-300">Resume</button>
                    <button onClick={() => remove(s)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3"/></button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <SubscriptionForm
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          subscription={editing}
          onSave={upsert}
        />
      </div>
    </div>
  );
}

function StatTile({ label, value, accent }) {
  const border = accent === "red" ? "border-l-red-500"
              : accent === "blue" ? "border-l-blue-500"
              : accent === "emerald" ? "border-l-emerald-500"
              : "border-l-slate-500";
  const text = accent === "red" ? "text-red-300" : "text-white";
  return (
    <Card className={`bg-slate-900 border-slate-800 border-l-4 ${border}`}>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
        <div className={`text-2xl font-bold tabular-nums ${text}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function SubRow({ sub, onEdit, onDelete, onDuplicate, onMarkPaid, onToggleActive }) {
  const cat = CATEGORIES.find(c => c.key === sub.category) || CATEGORIES[CATEGORIES.length - 1];
  const cad = CADENCES.find(c => c.key === sub.cadence) || CADENCES[0];

  const dueBadge = sub.state === "overdue"
    ? { text: `${Math.abs(sub.days_until_due)}d OVERDUE`, cls: "bg-red-600 text-white" }
    : sub.state === "due_soon"
    ? { text: `Due in ${sub.days_until_due}d`, cls: "bg-slate-600 text-white" }
    : sub.state === "future"
    ? { text: `In ${sub.days_until_due}d`, cls: "bg-slate-800 text-slate-300 border border-slate-700" }
    : { text: "No due date", cls: "bg-slate-800 text-slate-400 border border-slate-700" };

  const { menuProps, menu } = useContextMenu([
    { header: sub.name },
    { label: "Mark paid",       icon: <CheckCircle2 className="w-4 h-4"/>, onClick: onMarkPaid },
    { label: "Edit",            icon: <Edit className="w-4 h-4"/>,          onClick: onEdit, kbd: "dbl-click" },
    { label: "Duplicate",       icon: <Files className="w-4 h-4"/>,         onClick: onDuplicate },
    { label: sub.active === false ? "Resume" : "Pause",
      onClick: onToggleActive },
    { separator: true },
    { label: "Delete",          icon: <Trash2 className="w-4 h-4"/>,        onClick: onDelete, danger: true },
  ]);

  const bg = sub.state === "overdue" ? "bg-red-950/30" : "";

  return (
    <>
    <div {...menuProps}
         onDoubleClick={onEdit}
         title="Right-click for actions · Double-click to edit"
         className={`px-3 py-3 hover:bg-slate-950/60 flex items-center gap-3 text-sm ${bg}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-white font-semibold truncate">{sub.name}</span>
          <Badge className={`${cat.color} text-[10px] uppercase tracking-wider shrink-0`}>{cat.label}</Badge>
        </div>
        <div className="text-xs text-slate-400 truncate">
          ${sub.amount?.toFixed(2) ?? "?"} / {cad.label.toLowerCase()}
          {sub.next_due && <span className="text-slate-500"> · next due {sub.next_due}</span>}
          {sub.last_paid && <span className="text-slate-500"> · last paid {sub.last_paid}</span>}
          {sub.notes && <span className="text-slate-500"> · {sub.notes.slice(0, 60)}</span>}
        </div>
      </div>
      <Badge className={`${dueBadge.cls} text-[10px] uppercase tracking-wider shrink-0`}>
        {dueBadge.text}
      </Badge>
      <button onClick={onMarkPaid} title="Mark paid"
              className="p-1.5 rounded-md text-slate-400 hover:text-emerald-400 hover:bg-slate-800 shrink-0">
        <CheckCircle2 className="w-4 h-4"/>
      </button>
      <button onClick={onEdit} title="Edit"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 shrink-0">
        <Edit className="w-4 h-4"/>
      </button>
    </div>
    {menu}
    </>
  );
}

function SubscriptionForm({ open, onOpenChange, subscription, onSave }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("platform");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState("monthly");
  const [nextDue, setNextDue] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    setName(subscription?.name || "");
    setCategory(subscription?.category || "platform");
    setAmount(subscription?.amount != null ? String(subscription.amount) : "");
    setCadence(subscription?.cadence || "monthly");
    setNextDue(subscription?.next_due || "");
    setNotes(subscription?.notes || "");
    setErr(null);
  }, [subscription, open]);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Name required");
    const num = parseFloat(amount);
    if (isNaN(num) || num < 0) return setErr("Amount must be a positive number");
    onSave({
      name: name.trim(),
      category,
      amount: num,
      cadence,
      next_due: nextDue || null,
      notes: notes.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{subscription ? "Edit" : "Add"} subscription</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-white text-sm">Service name</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
                   placeholder="e.g. TradingView Premium"
                   className="bg-slate-950 border-slate-700 text-white" autoFocus required/>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white text-sm">Category</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map(c => (
                <button type="button" key={c.key}
                        onClick={() => setCategory(c.key)}
                        className={`text-left px-2.5 py-1.5 rounded-md border text-xs ${
                          category === c.key
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "bg-slate-950 border-slate-700 text-slate-300 hover:text-white"
                        }`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-white text-sm">Amount ($)</Label>
              <Input type="number" step="0.01" min="0"
                     value={amount} onChange={e => setAmount(e.target.value)}
                     placeholder="59.95"
                     className="bg-slate-950 border-slate-700 text-white" required/>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white text-sm">Cadence</Label>
              <select value={cadence} onChange={e => setCadence(e.target.value)}
                      className="w-full h-9 bg-slate-950 border border-slate-700 text-white rounded-md px-2 text-sm">
                {CADENCES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white text-sm flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5"/>Next due date
              {cadence === "one_time" && <span className="text-slate-500 text-xs">(optional for one-time)</span>}
            </Label>
            <Input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)}
                   className="bg-slate-950 border-slate-700 text-white"/>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white text-sm">Notes</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Optional — plan tier, card used, annual-vs-monthly savings…"
                      rows={2}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md p-2 text-white text-sm resize-y"/>
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
              {subscription ? "Save changes" : "Add subscription"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
