import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  Plug, ExternalLink, CheckCircle2, XCircle, Circle, Loader2,
  Play, ShieldCheck, KeyRound, Trash2,
} from "lucide-react";
import {
  INTEGRATIONS, integrationsByCategory, integrationStatus,
  getIntegration, setIntegration, clearIntegration, testConnection,
} from "@/lib/integrations";
import { Link } from "react-router-dom";

// Integrations — the catalog of every third-party service TradeCore can
// connect to. Each card = one service. User signs up externally, pastes
// creds into the card, hits Test. Backend stubs return "Phase 2A pending"
// until the corresponding Railway env is wired.
//
// Same pattern as MT5 Mirror + Webhooks — build the shape first, plug in
// real API calls as creds land.

export default function IntegrationsPage() {
  const [openSlug, setOpenSlug] = useState(null);
  const [tick, setTick] = useState(0);   // force re-render after edits
  const grouped = integrationsByCategory();

  const summary = INTEGRATIONS.reduce((acc, i) => {
    const s = integrationStatus(i.slug).level;
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Plug className="w-7 h-7 text-blue-400"/> Integrations
          </h1>
          <p className="text-slate-400 mt-1 max-w-3xl">
            Every third-party service TradeCore can talk to. Each card links to the signup page and
            walks you through where to find the credential. Paste, test, done. Sign up in any order —
            they enable independently.
          </p>
        </header>

        {/* Summary badges */}
        <div className="flex flex-wrap items-center gap-2">
          <SummaryBadge count={summary.verified || 0}       color="emerald" label="verified"/>
          <SummaryBadge count={summary.configured || 0}     color="blue"    label="configured (untested)"/>
          <SummaryBadge count={summary.partial || 0}        color="amber"   label="partial"/>
          <SummaryBadge count={summary.failed || 0}         color="red"     label="failed"/>
          <SummaryBadge count={summary.not_configured || 0} color="slate"   label="not configured"/>
          <SummaryBadge count={summary.wired || 0}          color="teal"    label="wired elsewhere"/>
        </div>

        {/* One section per category */}
        {Object.entries(grouped).map(([cat, list]) => (
          <section key={cat} className="space-y-3">
            <h2 className="text-white text-lg font-semibold flex items-center gap-2">
              {cat}
              <span className="text-xs text-slate-500 font-normal">({list.length})</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-3">
              {list.map(i => (
                <IntegrationCard key={i.slug} spec={i} onEdit={() => setOpenSlug(i.slug)}
                                 onChanged={() => setTick(t => t + 1)}/>
              ))}
            </div>
          </section>
        ))}

        {openSlug && (
          <IntegrationDialog slug={openSlug}
                             open={!!openSlug}
                             onClose={() => setOpenSlug(null)}
                             onSaved={() => setTick(t => t + 1)}/>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function SummaryBadge({ count, color, label }) {
  if (count === 0) return null;
  const map = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    blue:    "bg-blue-500/15 text-blue-300 border-blue-500/40",
    amber:   "bg-amber-500/15 text-amber-300 border-amber-500/40",
    red:     "bg-red-500/15 text-red-300 border-red-500/40",
    slate:   "bg-slate-500/15 text-slate-300 border-slate-500/40",
    teal:    "bg-teal-500/15 text-teal-300 border-teal-500/40",
  };
  return (
    <Badge className={`${map[color]} text-[11px]`}>{count} {label}</Badge>
  );
}

// ---------------------------------------------------------------------------
function IntegrationCard({ spec, onEdit, onChanged }) {
  const status = integrationStatus(spec.slug);
  const cfg = getIntegration(spec.slug);
  const [testing, setTesting] = useState(false);

  const badge = {
    verified:       { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40", icon: <CheckCircle2 className="w-3 h-3"/> },
    configured:     { cls: "bg-blue-500/15 text-blue-300 border-blue-500/40",           icon: <Circle className="w-3 h-3"/> },
    partial:        { cls: "bg-amber-500/15 text-amber-300 border-amber-500/40",         icon: <Circle className="w-3 h-3"/> },
    failed:         { cls: "bg-red-500/15 text-red-300 border-red-500/40",               icon: <XCircle className="w-3 h-3"/> },
    not_configured: { cls: "bg-slate-500/15 text-slate-400 border-slate-500/40",         icon: <Circle className="w-3 h-3"/> },
    wired:          { cls: "bg-teal-500/15 text-teal-300 border-teal-500/40",            icon: <CheckCircle2 className="w-3 h-3"/> },
  }[status.level] || { cls: "bg-slate-800 text-slate-500 border-slate-700", icon: null };

  const runTest = async () => {
    setTesting(true);
    try {
      await testConnection(spec.slug);
    } finally {
      setTesting(false);
      onChanged?.();
    }
  };

  return (
    <Card className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl shrink-0">{spec.icon}</span>
            <div className="min-w-0">
              <div className="text-white font-semibold truncate">{spec.name}</div>
              <div className="text-[11px] text-slate-500">{spec.monthly_cost}</div>
            </div>
          </div>
          <Badge className={`${badge.cls} text-[10px] shrink-0`}>
            {badge.icon}<span className="ml-1">{status.label}</span>
          </Badge>
        </div>

        <ul className="text-[11px] text-slate-400 space-y-0.5 pl-4 list-disc">
          {spec.what_it_unlocks.slice(0, 2).map((s, i) => <li key={i}>{s}</li>)}
        </ul>

        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-800">
          {spec.signup_url && (
            <a href={spec.signup_url} target="_blank" rel="noopener noreferrer"
               className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
              Sign up <ExternalLink className="w-3 h-3"/>
            </a>
          )}
          {spec.external_setup_page ? (
            <Link to={spec.external_setup_page}
                  className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
              Configure on {spec.external_setup_page} <ExternalLink className="w-3 h-3"/>
            </Link>
          ) : spec.cred_fields.length > 0 && (
            <Button size="sm" onClick={onEdit}
                    className="h-7 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs">
              <KeyRound className="w-3 h-3 mr-1"/>
              {status.level === "not_configured" ? "Paste creds" : "Edit"}
            </Button>
          )}
          {spec.backend_route && !spec.already_wired && status.level !== "not_configured" && (
            <Button size="sm" onClick={runTest} disabled={testing}
                    className="h-7 bg-emerald-600 hover:bg-emerald-500 text-xs">
              {testing
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin"/>Testing…</>
                : <><Play className="w-3 h-3 mr-1"/>Test</>}
            </Button>
          )}
        </div>

        {cfg.last_test_error && (
          <div className="text-[10px] text-red-300 pt-1 border-t border-slate-800 truncate" title={cfg.last_test_error}>
            Last test: {cfg.last_test_error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function IntegrationDialog({ slug, open, onClose, onSaved }) {
  const spec = INTEGRATIONS.find(i => i.slug === slug);
  const [form, setForm] = useState(() => ({ ...getIntegration(slug) }));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    // Reset form when a different integration is opened
    setForm({ ...getIntegration(slug) });
    setStatus(null);
  }, [slug]);

  if (!spec) return null;

  const save = () => {
    setIntegration(spec.slug, form);
    onSaved?.();
    onClose();
  };

  const clearAll = () => {
    if (!window.confirm(`Clear all credentials for ${spec.name}?`)) return;
    clearIntegration(spec.slug);
    setForm({});
    onSaved?.();
    onClose();
  };

  const testNow = async () => {
    setIntegration(spec.slug, form);   // save before test
    setBusy(true); setStatus(null);
    try {
      const r = await testConnection(spec.slug);
      setStatus(r);
      onSaved?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">{spec.icon}</span>{spec.name}
          </DialogTitle>
        </DialogHeader>

        <div className="text-xs text-slate-400 space-y-2 border-b border-slate-800 pb-3">
          <div><strong className="text-slate-300">Where to find the credentials:</strong> {spec.where_to_find}</div>
          <div><strong className="text-slate-300">Cost:</strong> {spec.monthly_cost}</div>
          {spec.signup_url && (
            <a href={spec.signup_url} target="_blank" rel="noopener noreferrer"
               className="text-blue-400 hover:underline inline-flex items-center gap-1">
              Open signup page <ExternalLink className="w-3 h-3"/>
            </a>
          )}
        </div>

        <div className="space-y-2">
          {spec.cred_fields.map(f => (
            <div key={f.key}>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">
                {f.label}{f.secret && <span className="ml-1 text-amber-500">🔒</span>}
              </Label>
              {f.type === "toggle" ? (
                <Button size="sm" variant="ghost"
                        onClick={() => setForm({ ...form, [f.key]: !form[f.key] })}
                        className={form[f.key]
                          ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 border h-8"
                          : "bg-slate-800 text-slate-500 border-slate-700 border h-8"}>
                  {form[f.key] ? "Enabled" : "Disabled"}
                </Button>
              ) : (
                <Input value={form[f.key] ?? f.default ?? ""}
                       type={f.secret ? "password" : "text"}
                       onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                       placeholder={f.placeholder}
                       className="bg-slate-950 border-slate-800 text-white text-xs font-mono h-9"/>
              )}
            </div>
          ))}
        </div>

        {status && (
          <div className={`text-xs p-2 rounded border ${status.ok
            ? "bg-emerald-500/5 border-emerald-500/40 text-emerald-200"
            : "bg-amber-500/5 border-amber-500/40 text-amber-200"}`}>
            {status.ok ? (
              <>✅ <strong>Verified.</strong> {status.note || "Backend accepted."}</>
            ) : (
              <>⚠️ <strong>Phase {status.phase || "2A"}.</strong> {status.note || status.reason || "Backend stub — waiting on Railway env."}</>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="ghost" onClick={clearAll}
                  className="text-slate-500 hover:text-red-400 mr-auto text-xs">
            <Trash2 className="w-3 h-3 mr-1"/>Clear
          </Button>
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400 hover:text-white">Cancel</Button>
          </DialogClose>
          <Button onClick={testNow} disabled={busy}
                  className="bg-emerald-600 hover:bg-emerald-500">
            {busy ? <><Loader2 className="w-4 h-4 mr-1 animate-spin"/>Testing</>
                  : <><Play className="w-4 h-4 mr-1"/>Save & test</>}
          </Button>
          <Button onClick={save} className="bg-blue-600 hover:bg-blue-500">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
