import React, { useState, useEffect } from "react";
import { Account } from "@/entities/all";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Shield, ShieldAlert, ShieldCheck, Unlock, Zap, CheckCircle2, ExternalLink, Radio, Building2, Copy, Pause, Play } from "lucide-react";
import { feedHealth, relativeAge } from "@/lib/connection_health";
import { PROP_FIRMS, firmByKey, guardrailsFor, firmSummary } from "@/lib/prop_firms";
import { useContextMenu } from "@/components/RightClickMenu";
import { isObserveMode } from "@/lib/broker_mode";
import AccountSizingCard from "@/components/AccountSizingCard";
import AccountSymbolMap from "@/components/AccountSymbolMap";
import { audit, AUDIT_EVENTS } from "@/lib/audit_log";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function AccountForm({ account, onSave, onCancel }) {
  const [formData, setFormData] = useState(account || {
    name: "",
    broker_name: "",
    account_number: "",
    account_type: "prop_firm",
    starting_balance: "",
    current_balance: "",
    currency: "USD",
    daily_max_loss: "",
    total_max_loss: "",
    leverage: 100,
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(formData).map(([key, value]) => {
          if (key === 'id' || key.includes('_date') || key === 'created_by' || key === 'is_active') return null;

          if (key === 'account_type') {
            return (
              <div key={key} className="space-y-2 col-span-1">
                <Label htmlFor={key} className="text-slate-300">Account Type</Label>
                <Select value={value} onValueChange={(val) => handleChange(key, val)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600 text-white">
                    <SelectItem value="prop_firm">Prop Firm</SelectItem>
                    <SelectItem value="funded">Funded</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                    <SelectItem value="demo">Demo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            );
          }

          if (key === 'currency') {
            return (
              <div key={key} className="space-y-2 col-span-1">
                <Label htmlFor={key} className="text-slate-300">Currency</Label>
                <Select value={value} onValueChange={(val) => handleChange(key, val)}>
                  <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-700 border-slate-600 text-white">
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )
          }

          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key} className="text-slate-300 capitalize">{key.replace(/_/g, ' ')}</Label>
              <Input
                id={key}
                type={typeof value === 'number' ? 'number' : 'text'}
                value={value}
                onChange={(e) => handleChange(key, e.target.value)}
                className="bg-slate-700 border-slate-600 text-white"
                required={['name', 'starting_balance', 'current_balance'].includes(key)}
              />
            </div>
          )
        })}
      </div>
      <DialogFooter className="pt-4">
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit">Save Account</Button>
      </DialogFooter>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────
// Broker catalog — every broker TradeCore knows how to plug into.
// Each entry defines the credential fields the modal will collect.
// ────────────────────────────────────────────────────────────────
const BROKER_CATALOG = [
  { key: "tradovate",   name: "Tradovate",           tag: "Futures · Apex/MFFU/Tradeify/Lucid/5%ers",
    accent: "blue",   status: "ready",
    fields: [
      { key: "username",   label: "Username",   type: "text",     placeholder: "your Tradovate login" },
      { key: "password",   label: "Password",   type: "password", placeholder: "••••••" },
      { key: "cid",        label: "App CID",    type: "text",     placeholder: "from Tradovate dev dashboard" },
      { key: "sec",        label: "App SEC",    type: "password", placeholder: "••••••" },
      { key: "account_id", label: "Account ID", type: "text",     placeholder: "DEMO4193333 or APEX30494…" },
    ] },
  { key: "pmt",         name: "PickMyTrade",         tag: "Observe-only — PMT runs execution, we collect data",
    accent: "purple", status: "ready", mode: "observe",
    note: "PMT keeps running your indicator alerts and executing on Tradovate — nothing about that setup changes. Add TradeCore as a second webhook (either duplicate your TradingView alert or add our URL to the same alert) so we can OBSERVE every signal. From that data we power your journal, analytics, rules checklist, rotation stats, live position display, timelines, and streaks. TradeCore never sends orders in observe mode — PMT stays in the driver's seat.",
    fields: [
      { key: "account_id", label: "Account label", type: "text", placeholder: "APEX30494 / MFFU50K-1 / etc." },
    ] },
  { key: "tradersport", name: "TradersPost",         tag: "Observe-only — TradersPost runs execution, we collect data",
    accent: "teal",   status: "ready", mode: "observe",
    note: "TradersPost keeps running your multi-broker routing — no change there. Add TradeCore as a second webhook in the same TradingView alert so we can OBSERVE every signal. That data powers your TradeCore journal, analytics, rules, rotation stats, live position display and timelines. We never route orders in observe mode.",
    fields: [
      { key: "account_id", label: "Account label", type: "text", placeholder: "TP-Apex-01" },
    ] },
  { key: "rithmic",     name: "Rithmic",             tag: "Futures · TopStep + power users",
    accent: "emerald", status: "planned",
    fields: [] },
  { key: "topstepx",    name: "TopStepX",            tag: "TopStep's newer platform",
    accent: "orange", status: "planned",
    fields: [] },
  { key: "ibkr",        name: "Interactive Brokers", tag: "Multi-asset retail",
    accent: "red",    status: "planned",
    fields: [] },
  { key: "ctrader",     name: "cTrader",             tag: "Forex · CFD",
    accent: "slate",  status: "planned",
    fields: [] },
  { key: "mt5",         name: "MetaTrader 5",        tag: "FTMO / Funded Next (via MetaAPI)",
    accent: "slate",  status: "planned",
    fields: [] },
  { key: "simulated",   name: "Simulated",           tag: "Paper trading — try TradeCore risk-free",
    accent: "slate",  status: "ready",
    fields: [
      { key: "starting_balance", label: "Starting balance $", type: "number", placeholder: "50000" },
    ] },
];

function AddBrokerSection({ onConnected }) {
  const [selected, setSelected] = useState(null);
  return (
    <>
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="border-b border-slate-800">
          <CardTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500"/>
            Connect a broker
          </CardTitle>
          <p className="text-sm text-slate-400 mt-1">
            Pick your broker to add a real (or simulated) trading account. Credentials are encrypted before storage.
          </p>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {BROKER_CATALOG.map(b => {
              const isPlanned = b.status === "planned";
              const accentBar = {
                blue: "bg-blue-500", purple: "bg-purple-500", teal: "bg-teal-500",
                emerald: "bg-emerald-500", orange: "bg-orange-500", red: "bg-red-500", slate: "bg-slate-500"
              }[b.accent] || "bg-slate-500";
              return (
                <button
                  key={b.key}
                  onClick={() => !isPlanned && setSelected(b)}
                  disabled={isPlanned}
                  className={`text-left rounded-xl border overflow-hidden bg-slate-950 hover:bg-slate-900 transition-colors ${
                    isPlanned
                      ? "border-slate-800 opacity-60 cursor-not-allowed"
                      : "border-slate-700 hover:border-blue-500/60"
                  }`}
                >
                  <div className={`h-1 ${accentBar}`}/>
                  <div className="p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold text-white">{b.name}</span>
                      {isPlanned
                        ? <span className="text-[10px] uppercase text-slate-500 font-semibold">Coming soon</span>
                        : <span className="text-[10px] uppercase text-emerald-400 font-semibold">Ready</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-snug">{b.tag}</p>
                    {b.mode === "observe" && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-950/40 border border-emerald-800/40 px-1.5 py-0.5 text-[10px] uppercase font-semibold text-emerald-300 tracking-wide">
                        Observe mode · read-only
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <BrokerCredentialsModal
          broker={selected}
          onClose={() => setSelected(null)}
          onConnected={(acct) => { setSelected(null); onConnected?.(acct); }}
        />
      )}
    </>
  );
}

function BrokerCredentialsModal({ broker, onClose, onConnected }) {
  const [nickname, setNickname] = useState("");
  const [env, setEnv] = useState("demo");
  const [firmKey, setFirmKey] = useState("");     // Task #122 — prop firm preset
  const [firmSize, setFirmSize] = useState("");   // account size (from firm.accounts)
  const [creds, setCreds] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [connectedAccount, setConnectedAccount] = useState(null);
  const setField = (k, v) => setCreds(c => ({ ...c, [k]: v }));
  const currentFirm = firmByKey(firmKey);

  // TradeCore observe webhook — the user pastes this as a SECOND webhook
  // in their existing TradingView alert (their primary webhook still fires
  // at PMT / TradersPost for execution). We only read the signal; we never
  // route orders in observe mode.
  const tradecoreWebhook = (acctId) => {
    const base = window.location.origin.replace(/\/$/, "");
    return `${base}/api/webhook/observe/${encodeURIComponent(acctId || "…")}`;
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!nickname.trim()) return setErr("Nickname required");
    setBusy(true); setErr(null);
    try {
      // Apply firm-preset guardrails if the user picked a firm.
      // This auto-fills daily_loss_limit / max_drawdown / etc. from the
      // published prop-firm rules (task #122).
      const firmGuardrails = firmKey && firmKey !== "custom"
        ? guardrailsFor(firmKey, firmSize ? Number(firmSize) : null)
        : null;

      const payload = {
        name: nickname.trim(),
        broker: broker.key,
        env,
        active: true,
        // observe: PMT/TradersPost already own the TV→broker path; we just
        //          receive a copy of the alert for journal/analytics/rules.
        // direct:  we hold broker creds and execute (Tradovate direct — later).
        mode: broker.mode || "direct",
        credentials: creds,
        ...(firmGuardrails || {}),
      };
      const created = await Account.create(payload);
      // Observe accounts need a second-webhook setup step, so we show the
      // TradeCore URL to paste. Direct brokers just close.
      if (broker.mode === "observe") {
        setConnectedAccount(created);
      } else {
        onConnected?.(created);
      }
    } catch (e) {
      setErr(e.message || "Failed to connect");
    }
    setBusy(false);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard?.writeText(text);
  };

  // Post-connect setup screen for OBSERVE brokers — user must add
  // TradeCore as a SECOND webhook in their existing TradingView alert.
  if (connectedAccount && broker.mode === "observe") {
    const url = tradecoreWebhook(connectedAccount.id || connectedAccount.name);
    return (
      <Dialog open onOpenChange={o => { if (!o) { onConnected?.(connectedAccount); } }}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400"/>
              {broker.name} connected — observe mode
            </DialogTitle>
            <p className="text-sm text-slate-400">
              Add this URL as a <span className="text-white font-semibold">second webhook</span> in your existing TradingView
              alert (or duplicate the alert with this URL). Your primary {broker.name} webhook keeps firing normally — TradeCore
              just receives a copy of the signal to power your journal, analytics, rules, rotation and live position display.
            </p>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-white text-sm">Your TradeCore observe URL</Label>
              <div className="flex gap-2">
                <Input value={url} readOnly
                       className="bg-slate-950 border-slate-700 text-white text-sm"/>
                <Button type="button" onClick={() => copyToClipboard(url)}
                        className="bg-blue-600 hover:bg-blue-700 text-white shrink-0">
                  Copy
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 p-3 text-sm text-emerald-200 leading-relaxed">
              <div className="font-semibold mb-1">What you get in observe mode</div>
              Journal · analytics · rules checklist · rotation stats · live position display · timelines · streaks · goals — all populated from the signals we observe.
              <div className="mt-2 pt-2 border-t border-emerald-800/40 text-emerald-300/80 text-xs">
                Broker-direct actions (Emergency Flatten, Modify SL/TP from our UI, SL-drift auto-push) need a Tradovate-direct
                account — TradeCore never sends orders on your behalf in observe mode.
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => onConnected?.(connectedAccount)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500"/>
            Connect {broker.name}
          </DialogTitle>
          <p className="text-sm text-slate-400">
            {broker.tag}. Credentials are encrypted at rest — nothing routes out until you explicitly arm it.
          </p>
        </DialogHeader>

        {broker.note && (
          <div className="rounded-lg border border-blue-800/40 bg-blue-950/30 p-3 text-sm text-blue-100 leading-relaxed">
            <div className="font-semibold text-white mb-1">How this works</div>
            {broker.note}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-white">Account nickname</Label>
            <Input value={nickname} onChange={e => setNickname(e.target.value)}
                   placeholder="e.g. Apex #01 / MFFU 50K / Lucid Prop"
                   className="bg-slate-950 border-slate-700 text-white"
                   autoFocus required/>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white">Environment</Label>
            <div className="grid grid-cols-2 rounded-lg bg-slate-950 border border-slate-800 p-0.5">
              {["demo", "live"].map(e => (
                <button key={e} type="button" onClick={() => setEnv(e)}
                        className={`h-9 text-sm font-semibold rounded-md capitalize ${
                          env === e
                            ? (e === "demo" ? "bg-blue-600 text-white" : "bg-red-600 text-white")
                            : "text-slate-400 hover:text-white"}`}>
                  {e === "demo" ? "Demo (paper)" : "Live (real money)"}
                </button>
              ))}
            </div>
          </div>

          {/* Prop firm preset — auto-fills daily DD / max DD / consistency / etc.
              from the firm's published rules. Independent of the broker/router
              above (an Apex account can be routed via PMT observe OR direct). */}
          <div className="space-y-2 border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-500"/>
              <Label className="text-white text-sm">Prop Firm (optional)</Label>
            </div>
            <select value={firmKey}
                    onChange={e => { setFirmKey(e.target.value); setFirmSize(""); }}
                    className="w-full h-10 rounded-md bg-slate-950 border border-slate-700 text-white px-3 text-sm">
              <option value="">— No firm (personal account) —</option>
              {PROP_FIRMS.filter(f => f.key !== "custom").map(f => (
                <option key={f.key} value={f.key}>{f.name}</option>
              ))}
              <option value="custom">Custom / Other firm</option>
            </select>
            {currentFirm && currentFirm.accounts.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-slate-400 text-xs">Account size</Label>
                <select value={firmSize}
                        onChange={e => setFirmSize(e.target.value)}
                        className="w-full h-9 rounded-md bg-slate-950 border border-slate-700 text-white px-3 text-sm">
                  <option value="">— Pick a size —</option>
                  {currentFirm.accounts.map(a => (
                    <option key={a.size} value={a.size}>
                      ${a.size.toLocaleString()}
                      {a.daily_dd ? ` · $${a.daily_dd.toLocaleString()} daily DD` : ""}
                      {a.max_dd  ? ` · $${a.max_dd.toLocaleString()} max DD` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Presets the guardrails on your Account so Equity Guardian + Kill Switch know when to intervene. Verify current rules with the firm.
                </p>
              </div>
            )}
            {currentFirm && (
              <div className="text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-md p-2.5">
                {currentFirm.blurb}
                {currentFirm.scaling_notes && (
                  <div className="text-slate-500 mt-1">{currentFirm.scaling_notes}</div>
                )}
              </div>
            )}
          </div>

          {broker.fields.length > 0 && (
            <div className="space-y-3 border-t border-slate-800 pt-4">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Credentials</div>
              {broker.fields.map(f => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-white text-sm">{f.label}</Label>
                  <Input
                    type={f.type}
                    value={creds[f.key] ?? ""}
                    onChange={e => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="bg-slate-950 border-slate-700 text-white font-mono text-sm"
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
          )}

          {broker.fields.length === 0 && (
            <div className="text-sm text-slate-400 bg-slate-950 border border-slate-800 rounded-md p-3">
              No extra credentials needed for {broker.name}.
            </div>
          )}

          {err && (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded-md px-3 py-2">
              {err}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}
                    className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
              Cancel
            </Button>
            <Button type="submit" disabled={busy}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              {busy ? "Connecting…" : <><CheckCircle2 className="w-4 h-4 mr-2"/>Connect</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountCard({ acc, onEdit, onDelete, onResetGuardian, onTogglePause, onCopyWebhook, onCopyId }) {
  const observe = isObserveMode(acc);
  const isPaused = acc.is_active === false || acc.state === "paused";
  const { menuProps, menu } = useContextMenu([
    { header: acc.name || "Account" },
    { label: "Edit account",      icon: <Edit className="w-4 h-4"/>,    onClick: onEdit, kbd: "dbl-click" },
    { label: isPaused ? "Resume account" : "Pause account",
      icon: isPaused ? <Play className="w-4 h-4"/> : <Pause className="w-4 h-4"/>,
      onClick: onTogglePause },
    acc.state === "stopped" && { label: "Reset Guardian", icon: <Unlock className="w-4 h-4"/>, onClick: onResetGuardian },
    observe && { label: "Copy observe webhook URL", icon: <Copy className="w-4 h-4"/>, onClick: onCopyWebhook },
    { label: "Copy account ID",   icon: <Copy className="w-4 h-4"/>,    onClick: onCopyId },
    { separator: true },
    { label: "Delete account",    icon: <Trash2 className="w-4 h-4"/>,  onClick: onDelete, danger: true },
  ].filter(Boolean));

  return (
    <>
    <Card {...menuProps} onDoubleClick={onEdit}
          title="Right-click for actions · Double-click to edit"
          className="bg-slate-900 border-slate-800 flex flex-col justify-between">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-white">{acc.name}</CardTitle>
                    <Badge variant="outline" className="capitalize bg-blue-500/10 text-blue-400 border-blue-500/30">{(acc.account_type || acc.env || 'live').replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-sm text-slate-400">{acc.broker_name || acc.broker || '—'}</p>
                  {acc.firm && firmByKey(acc.firm) && (
                    <div className="mt-1 space-y-0.5">
                      <div className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-blue-600 text-white">
                        <Building2 className="w-2.5 h-2.5"/>{firmByKey(acc.firm).name}
                      </div>
                      <div className="text-[10px] text-slate-500">{firmSummary(acc)}</div>
                      <a href={`/Playbook?firm=${encodeURIComponent(firmByKey(acc.firm).name)}#rule-profiles`}
                         className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold uppercase tracking-wide text-blue-400 hover:text-blue-300 hover:underline">
                        <ShieldCheck className="w-2.5 h-2.5"/>Rule Profile
                      </a>
                    </div>
                  )}
                  {(() => {
                    const h = feedHealth(acc);
                    return (
                      <div className="flex items-center gap-2 mt-2 text-xs">
                        <span className={`inline-block w-2 h-2 rounded-full shadow ${h.dotClass}`} title={h.label}/>
                        <span className={`font-semibold uppercase tracking-wider ${h.textClass}`}>{h.label}</span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-500">last signal {relativeAge(acc.last_signal_at)}</span>
                      </div>
                    );
                  })()}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-slate-300"><span>Current Balance</span> <span className="font-bold text-white">${(acc.current_balance ?? 0).toLocaleString()}</span></div>
                  <div className="flex justify-between text-slate-300"><span>Starting Balance</span> <span className="font-mono">${(acc.starting_balance ?? 0).toLocaleString()}</span></div>
                  <div className="flex justify-between text-slate-300"><span>Total P&L</span> <span className={((acc.current_balance ?? 0) - (acc.starting_balance ?? 0)) >= 0 ? 'text-green-500' : 'text-red-500'}>${((acc.current_balance ?? 0) - (acc.starting_balance ?? 0)).toLocaleString()}</span></div>
                  <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800"><span>Today's P&L</span> <span className={(acc.pnl_today ?? 0) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>${(acc.pnl_today ?? 0).toFixed(2)}</span></div>
                  <div className="flex justify-between text-xs text-slate-400"><span>Wins today</span><span>{acc.wins_today ?? 0}W / {acc.losses_today ?? 0}L</span></div>

                  {(acc.daily_loss_limit ?? 0) > 0 && (() => {
                    const limit = acc.daily_loss_limit;
                    const pnl = acc.pnl_today ?? 0;
                    const pct = pnl < 0 ? Math.min(100, (Math.abs(pnl) / limit) * 100) : 0;
                    const color = pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-slate-400' : 'bg-emerald-500';
                    const textColor = pct >= 80 ? 'text-red-400' : pct >= 50 ? 'text-slate-300' : 'text-emerald-400';
                    return (
                      <div className="pt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400 flex items-center gap-1">
                            {pct >= 80 ? <ShieldAlert className="w-3 h-3"/> : <Shield className="w-3 h-3"/>}
                            Daily DD
                          </span>
                          <span className={textColor}>{pct.toFixed(0)}% of ${limit.toLocaleString()}</span>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className={`h-full ${color} transition-all`} style={{width: `${pct}%`}}/>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex justify-between items-center text-slate-300 pt-2 border-t border-slate-800">
                    <span className="text-xs">State</span>
                    <Badge variant="outline" className={
                      (acc.state === 'active' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                       acc.state === 'benched' ? 'bg-slate-700/40 text-slate-200 border-slate-600' :
                       acc.state === 'cooled' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                       acc.state === 'stopped' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                       'bg-slate-500/10 text-slate-400 border-slate-500/30')
                    }>{acc.state || 'active'}</Badge>
                  </div>

                  {acc.state === 'stopped' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full bg-red-600 hover:bg-red-700 text-white border-0 font-semibold"
                      onClick={onResetGuardian}
                    >
                      <Unlock className="w-3 h-3 mr-2" />Reset Guardian
                    </Button>
                  )}

                  <AccountSizingCard account={acc}/>
                  <AccountSymbolMap account={acc}/>
                </CardContent>
                <div className="p-4 flex justify-end gap-2 border-t border-slate-800">
                  <Button variant="ghost" size="icon" onClick={onDelete}>
                    <Trash2 className="w-4 h-4 text-red-500"/>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={onEdit}>
                    <Edit className="w-4 h-4 text-slate-400"/>
                  </Button>
                </div>
              </Card>
    {menu}
    </>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    setLoading(true);
    const data = await Account.list("-created_date");
    setAccounts(data);
    setLoading(false);
  };

  const handleSave = async (accountData) => {
    if (editingAccount) {
      await Account.update(editingAccount.id, accountData);
    } else {
      await Account.create(accountData);
    }
    setEditingAccount(null);
    setIsFormOpen(false);
    loadAccounts();
  };

  const handleDelete = async (accountId) => {
    if (window.confirm("Are you sure you want to delete this account and all its trades?")) {
      await Account.delete(accountId);
      audit(AUDIT_EVENTS.ACCOUNT_DELETE, { accountId });
      loadAccounts();
    }
  };

  const handleResetGuardian = async (acc) => {
    if (!window.confirm(`Reset Guardian on ${acc.name}? This clears the daily loss lock, sets state=active, and zeros today's P&L counters.`)) return;
    try {
      await api(`/api/accounts/${acc.id}/reset-guardian`, { method: "POST" });
      audit(AUDIT_EVENTS.GUARDIAN_RESET, { accountId: acc.id, accountName: acc.name });
      loadAccounts();
    } catch (e) {
      alert(`Reset failed: ${e.message}`);
    }
  };

  const handleTogglePause = async (acc) => {
    try {
      const wasActive = acc.is_active !== false;
      await Account.update(acc.id, { is_active: !wasActive });
      audit(wasActive ? AUDIT_EVENTS.ACCOUNT_PAUSE : AUDIT_EVENTS.ACCOUNT_RESUME,
            { accountId: acc.id, accountName: acc.name });
      loadAccounts();
    } catch (e) {
      alert(`Toggle failed: ${e.message}`);
    }
  };

  const copyToClip = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch { alert(`Clipboard blocked (${label})`); }
  };

  const observeWebhookUrl = (acc) => {
    const base = window.location.origin.replace(/\/$/, "");
    const id = acc.id || acc.name || "";
    return `${base}/api/webhook/observe/${encodeURIComponent(id)}`;
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-white">Account Manager</h1>
            <p className="text-slate-400">Manage all your trading accounts in one place.</p>
          </div>
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditingAccount(null)} className="bg-blue-600 hover:bg-blue-700 text-white"><Plus className="w-4 h-4 mr-2" />Add Account</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[625px] bg-slate-800 border-slate-700 text-white">
              <DialogHeader>
                <DialogTitle>{editingAccount ? "Edit" : "Add"} Account</DialogTitle>
              </DialogHeader>
              <AccountForm
                account={editingAccount}
                onSave={handleSave}
                onCancel={() => { setIsFormOpen(false); setEditingAccount(null); }}
              />
            </DialogContent>
          </Dialog>
        </div>

        <AddBrokerSection onConnected={loadAccounts} />

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full bg-slate-800" />)}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accounts.map(acc => (
              <AccountCard
                key={acc.id}
                acc={acc}
                onEdit={() => { setEditingAccount(acc); setIsFormOpen(true); }}
                onDelete={() => handleDelete(acc.id)}
                onResetGuardian={() => handleResetGuardian(acc)}
                onTogglePause={() => handleTogglePause(acc)}
                onCopyWebhook={() => copyToClip(observeWebhookUrl(acc), "webhook")}
                onCopyId={() => copyToClip(String(acc.id ?? acc.name ?? ""), "account id")}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
