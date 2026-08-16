import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Send, Plus, Trash2, Play, RefreshCw, ExternalLink,
  CheckCircle2, XCircle, ShieldCheck, Loader2, Webhook,
} from "lucide-react";
import {
  listHooks, upsertHook, deleteHook, toggleHook,
  getDeliveryLog, clearDeliveryLog, testFire,
  HOOK_EVENTS, HOOK_KINDS,
} from "@/lib/outgoing_webhooks";

// Webhooks — CRUD + test-fire + delivery log for outgoing hooks.
//
// Fires alongside MT5 mirror on Pine signals. Same fan-out shape:
//   Pine → observe → { MT5 mirror + outgoing hooks + Dashboard update }
//
// This page is where you configure them. Actual firing happens in the
// same poller that drives the mirror (wired in Mt5Mirror page for now;
// a shared /useObserveEvents hook is a future refactor).

export default function WebhooksPage() {
  const [hooks, setHooks] = useState(() => listHooks());
  const [log, setLog]     = useState(() => getDeliveryLog({ limit: 50 }));
  const [editing, setEditing] = useState(null);   // hook object or null (new)
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = () => {
    setHooks(listHooks());
    setLog(getDeliveryLog({ limit: 50 }));
  };

  useEffect(() => {
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const openNew  = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (h) => { setEditing(h); setDialogOpen(true); };
  const onSave = (h) => {
    upsertHook(h);
    setDialogOpen(false);
    refresh();
  };
  const onDelete = (id) => {
    if (!window.confirm("Delete this webhook?")) return;
    deleteHook(id);
    refresh();
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Webhook className="w-7 h-7 text-blue-400"/> Outgoing Webhooks
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl">
              Fan trade events out to Discord, Slack, Zapier, n8n, or any custom URL. Same signal that fires
              your Pine → PMT → Tradovate leg triggers these too, on the events you pick per hook.
            </p>
          </div>
          <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="w-4 h-4 mr-1.5"/>Add hook
          </Button>
        </header>

        {/* Safety / status banner */}
        <Card className="bg-emerald-500/5 border-emerald-500/40">
          <CardContent className="p-3 text-xs text-emerald-200/90 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5"/>
            <div>
              Notifications only — no orders sent. Discord + Slack fire in <code>no-cors</code> mode from the
              browser (response opaque but delivery works). Zapier / n8n / custom URLs return full status.
              Backend proxy for retries + full-fidelity delivery ships with auth (task #40).
            </div>
          </CardContent>
        </Card>

        {/* Hook list */}
        {hooks.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-8 text-center text-slate-500">
              No webhooks configured. Click <strong className="text-white">Add hook</strong> to send trade
              events to Discord, Slack, Zapier, n8n, or your own endpoint.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {hooks.map(h => (
              <HookRow key={h.id} hook={h}
                       onEdit={() => openEdit(h)}
                       onDelete={() => onDelete(h.id)}
                       onToggle={v => { toggleHook(h.id, v); refresh(); }}
                       onTestFired={refresh}/>
            ))}
          </div>
        )}

        {/* Delivery log */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center justify-between gap-2">
              <span>Delivery log ({log.length})</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={refresh}
                        className="h-7 text-slate-400 hover:text-white text-xs">
                  <RefreshCw className="w-3 h-3 mr-1"/>Refresh
                </Button>
                {log.length > 0 && (
                  <Button size="sm" variant="ghost"
                          onClick={() => { if (window.confirm("Clear log?")) { clearDeliveryLog(); refresh(); } }}
                          className="h-7 text-slate-400 hover:text-red-400 text-xs">
                    <Trash2 className="w-3 h-3 mr-1"/>Clear
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-3">
                No deliveries yet. Test-fire a hook above to see the log populate.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-1.5 px-1">Time</th>
                      <th className="text-left px-1">Hook</th>
                      <th className="text-left px-1">Kind</th>
                      <th className="text-left px-1">Event</th>
                      <th className="text-left px-1">Symbol</th>
                      <th className="text-left px-1">Result</th>
                      <th className="text-left px-1">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map(r => (
                      <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-950/50">
                        <td className="py-1.5 px-1 text-slate-400 whitespace-nowrap font-mono text-[10px]">
                          {new Date(r.ts).toLocaleTimeString()}
                        </td>
                        <td className="px-1 text-white">{r.hook_name}</td>
                        <td className="px-1 text-slate-300 font-mono uppercase text-[10px]">{r.hook_kind}</td>
                        <td className="px-1 text-slate-300">{r.event}</td>
                        <td className="px-1 text-slate-300 font-mono">{r.ticker || "—"}</td>
                        <td className="px-1">
                          <Badge className={`text-[9px] px-1.5 py-0 ${r.ok
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                            : "bg-red-500/15 text-red-300 border-red-500/40"}`}>
                            {r.ok ? "OK" : "FAIL"} {r.status || ""}
                          </Badge>
                        </td>
                        <td className="px-1 text-slate-500 text-[10px]">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <HookDialog open={dialogOpen} onOpenChange={setDialogOpen}
                    hook={editing} onSave={onSave}/>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function HookRow({ hook, onEdit, onDelete, onToggle, onTestFired }) {
  const [testing, setTesting] = useState(false);
  const [testKind, setTestKind] = useState("entry");
  const [lastResult, setLastResult] = useState(null);

  const kindLabel = HOOK_KINDS.find(k => k.key === hook.kind)?.label || hook.kind;
  const eventCount = Object.values(hook.events || {}).filter(Boolean).length;

  const doTest = async () => {
    setTesting(true); setLastResult(null);
    try {
      const r = await testFire(hook.id, testKind);
      setLastResult(r);
      onTestFired?.();
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-semibold truncate">{hook.name || "(unnamed)"}</span>
              <Badge className="bg-slate-800 text-slate-300 border-slate-700 text-[10px]">{kindLabel}</Badge>
              <Badge className="bg-slate-800 text-slate-400 border-slate-700 text-[10px]">
                {eventCount} event{eventCount === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500 font-mono truncate max-w-full" title={hook.url}>
              {hook.url || "(no URL)"}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch checked={!!hook.enabled} onCheckedChange={onToggle} aria-label="Enable hook"/>
            <Button size="sm" variant="ghost" onClick={onEdit}
                    className="h-8 text-slate-300 hover:text-white text-xs">Edit</Button>
            <Button size="sm" variant="ghost" onClick={onDelete}
                    className="h-8 text-slate-500 hover:text-red-400 text-xs">
              <Trash2 className="w-3.5 h-3.5"/>
            </Button>
          </div>
        </div>

        {/* Event badges */}
        <div className="flex flex-wrap items-center gap-1">
          {Object.entries(HOOK_EVENTS).map(([k, meta]) => {
            const on = !!hook.events?.[k];
            return (
              <span key={k}
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      on ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
                         : "bg-slate-800 text-slate-600 border-slate-700"}`}>
                {k}
              </span>
            );
          })}
        </div>

        {/* Test-fire */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <Select value={testKind} onValueChange={setTestKind}>
            <SelectTrigger className="h-8 w-40 bg-slate-950 border-slate-800 text-white text-xs">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white">
              {Object.entries(HOOK_EVENTS).map(([k, m]) => (
                <SelectItem key={k} value={k}>{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={doTest} disabled={testing || !hook.url}
                  className="h-8 bg-emerald-600 hover:bg-emerald-500 text-xs">
            {testing ? <><Loader2 className="w-3 h-3 mr-1 animate-spin"/>Sending…</>
                     : <><Send className="w-3 h-3 mr-1"/>Test fire</>}
          </Button>
          {lastResult && (
            <Badge className={`text-[10px] ${lastResult.ok
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              : "bg-red-500/15 text-red-300 border-red-500/40"}`}>
              {lastResult.ok
                ? <><CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5"/>{lastResult.note}</>
                : <><XCircle className="w-2.5 h-2.5 inline mr-0.5"/>{lastResult.note}</>}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
function HookDialog({ open, onOpenChange, hook, onSave }) {
  const [form, setForm] = useState(() => hook || defaultHook());
  useEffect(() => { setForm(hook || defaultHook()); }, [hook, open]);

  const kindMeta = HOOK_KINDS.find(k => k.key === form.kind) || HOOK_KINDS[0];

  const toggleEvent = (evKey) => setForm(f => ({
    ...f, events: { ...(f.events || {}), [evKey]: !f.events?.[evKey] }
  }));

  const save = () => {
    if (!form.url || !form.url.startsWith("http")) { alert("URL must start with http(s)://"); return; }
    if (!form.name?.trim()) { alert("Give it a name so you know what it is later."); return; }
    onSave({ ...form, name: form.name.trim(), url: form.url.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-blue-400"/>
            {hook ? "Edit webhook" : "New webhook"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                     placeholder="e.g. Discord — trade alerts"
                     className="h-9 bg-slate-950 border-slate-800 text-white text-sm"/>
            </Field>
            <Field label="Kind">
              <Select value={form.kind} onValueChange={v => setForm({...form, kind: v})}>
                <SelectTrigger className="h-9 bg-slate-950 border-slate-800 text-white text-sm">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {HOOK_KINDS.map(k => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Webhook URL">
            <Input value={form.url} onChange={e => setForm({...form, url: e.target.value})}
                   placeholder={kindMeta.placeholder}
                   className="h-9 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            <p className="text-[11px] text-slate-500 mt-1">{kindMeta.hint}</p>
          </Field>

          {(form.kind === "discord" || form.kind === "slack") && (
            <Field label="Mention on fire (optional)">
              <Input value={form.mention || ""}
                     onChange={e => setForm({...form, mention: e.target.value})}
                     placeholder={form.kind === "discord" ? "e.g. <@your_user_id> or @everyone" : "e.g. <@U0123456>"}
                     className="h-9 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
          )}

          <Field label="Fire on these events">
            <div className="grid grid-cols-2 gap-1 pt-1">
              {Object.entries(HOOK_EVENTS).map(([k, m]) => (
                <button key={k} type="button" onClick={() => toggleEvent(k)}
                        className={`text-left text-xs px-2 py-1.5 rounded border transition-colors ${
                          form.events?.[k]
                            ? "bg-blue-500/15 border-blue-500/40 text-blue-200"
                            : "bg-slate-950 border-slate-800 text-slate-500 hover:border-slate-700"}`}>
                  <span className="inline-block w-3 h-3 rounded-sm mr-1.5 align-middle"
                        style={{background: form.events?.[k] ? "#3b82f6" : "transparent",
                                border: "1px solid #475569"}}/>
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400 hover:text-white">Cancel</Button>
          </DialogClose>
          <Button onClick={save} className="bg-blue-600 hover:bg-blue-500">
            {hook ? "Save changes" : "Create hook"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultHook() {
  return {
    id: null,
    name: "",
    kind: "discord",
    url: "",
    mention: "",
    enabled: true,
    events: { entry: true, sl_update: false, tp: true, close: true, kill_switch: true, daily_summary: false },
    custom_template: null,
  };
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">{label}</Label>
      {children}
    </div>
  );
}
