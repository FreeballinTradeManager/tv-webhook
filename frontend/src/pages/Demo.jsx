import React, { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, RefreshCw, Trash2, Sparkles, CheckCircle2 } from "lucide-react";

// Persist the trial_key locally so refreshes keep the same sandbox.
// The key IS the credential — anyone with it can post; make it hard to guess.
function ensureTrialKey() {
  const k = localStorage.getItem("tradecore_demo_trial_key");
  if (k && k.length >= 12) return k;
  const fresh = "trial_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  localStorage.setItem("tradecore_demo_trial_key", fresh);
  return fresh;
}

function makeAbsoluteUrl(path) {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function CopyChip({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className="border-slate-700 text-slate-300 hover:bg-slate-800 h-8 px-3 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {}
      }}
    >
      {copied ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-green-400"/> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1.5"/> {label}</>}
    </Button>
  );
}

export default function Demo() {
  const [trialKey] = useState(ensureTrialKey);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const webhookPath = `/api/webhook/demo/${trialKey}`;
  const webhookUrl = makeAbsoluteUrl(webhookPath);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const d = await api(`/api/webhook/demo/${trialKey}/events?limit=50`);
      setEvents(d.events || []);
    } catch (e) {
      setErr(e.message || String(e));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const fireTestEvent = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(webhookPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "ENTRY",
          ticker: "MNQ1!",
          side: "LONG",
          quantity: 4,
          entry_px: 20120.5,
          stop_px: 20100.0,
          tp1_px: 20141.0,
          tp2_px: 20161.5,
          tp3_px: 20182.0,
          note: "test-fired-from-demo-page",
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      await load();
    } catch (e) {
      alert(`Test fire failed: ${e.message}`);
    }
    setBusy(false);
  };

  const clearAll = async () => {
    if (!window.confirm("Clear all demo events for this trial? Cannot undo.")) return;
    setBusy(true);
    try {
      await api(`/api/webhook/demo/${trialKey}/events`, { method: "DELETE" });
      setEvents([]);
    } catch (e) { alert(`Clear failed: ${e.message}`); }
    setBusy(false);
  };

  const pineSnippet = useMemo(() => `//@version=6
indicator("TradeCore Demo Signal", overlay=true)

// Configure webhook URL in this file below.
// URL: ${webhookUrl}
// Alert Message body will be the JSON below. Copy this whole block into
// your TradingView alert's Message tab.

longSig  = ta.crossover(ta.ema(close, 9),  ta.ema(close, 21))
shortSig = ta.crossunder(ta.ema(close, 9), ta.ema(close, 21))

if longSig
    alert('{"event":"ENTRY","ticker":"{{ticker}}","side":"LONG","quantity":4,"entry_px":' + str.tostring(close) + ',"stop_px":' + str.tostring(close - 20 * syminfo.mintick) + ',"tp1_px":' + str.tostring(close + 20 * syminfo.mintick) + ',"tp2_px":' + str.tostring(close + 40 * syminfo.mintick) + ',"tp3_px":' + str.tostring(close + 60 * syminfo.mintick) + '}', alert.freq_once_per_bar)

if shortSig
    alert('{"event":"ENTRY","ticker":"{{ticker}}","side":"SHORT","quantity":4,"entry_px":' + str.tostring(close) + ',"stop_px":' + str.tostring(close + 20 * syminfo.mintick) + ',"tp1_px":' + str.tostring(close - 20 * syminfo.mintick) + ',"tp2_px":' + str.tostring(close - 40 * syminfo.mintick) + ',"tp3_px":' + str.tostring(close - 60 * syminfo.mintick) + '}', alert.freq_once_per_bar)

plotshape(longSig,  location=location.belowbar, color=color.green, style=shape.triangleup,   size=size.small)
plotshape(shortSig, location=location.abovebar, color=color.red,   style=shape.triangledown, size=size.small)`,
  [webhookUrl]);

  const curlSnippet = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"ENTRY","ticker":"MNQ1!","side":"LONG","quantity":4}'`;

  return (
    <div className="p-4 md:p-6 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-amber-400"/>
            Demo Sandbox
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Try TradeCore without connecting a real broker. Fire webhooks here from anything — TradingView, curl, Postman — and see them stream in below.
            Nothing sent here touches a real account.
          </p>
        </div>

        {/* Webhook URL card */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 py-3">
            <CardTitle className="text-white text-base">Your webhook URL</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                readOnly
                value={webhookUrl}
                className="bg-slate-950 border-slate-700 text-white font-mono text-sm h-9 flex-1 min-w-0"
                onClick={e => e.target.select()}
              />
              <CopyChip text={webhookUrl}/>
            </div>
            <p className="text-xs text-slate-500">
              The trial key is stored in your browser's localStorage. Share the URL with anyone to let them fire signals into your sandbox — the key is the credential.
              &nbsp;<span className="text-slate-400">Method: <code className="font-mono">POST</code>. Body: any JSON.</span>
            </p>
          </CardContent>
        </Card>

        {/* Live events */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 py-3 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              Live events
              <span className="text-xs text-slate-500 font-normal font-mono">({events.length})</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline"
                      onClick={fireTestEvent} disabled={busy}
                      className="border-blue-500/40 text-blue-300 hover:bg-blue-500/10 h-8 text-xs">
                Fire test event
              </Button>
              <Button size="sm" variant="ghost" onClick={load} disabled={loading}
                      className="text-slate-400 hover:text-white h-8 text-xs">
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`}/>
                Refresh
              </Button>
              <Button size="sm" variant="outline"
                      onClick={clearAll} disabled={busy || events.length === 0}
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-8 text-xs">
                <Trash2 className="w-3.5 h-3.5 mr-1.5"/>Clear
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {err && <div className="p-4 text-sm text-red-400 font-mono">Error: {err}</div>}
            {!err && events.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-slate-400 text-sm">No events yet. Click <strong className="text-white">Fire test event</strong> or POST to your URL above.</p>
                <p className="text-xs text-slate-500 mt-2">Auto-refreshes every 5s.</p>
              </div>
            )}
            {events.length > 0 && (
              <div className="divide-y divide-slate-800/70">
                {events.map(ev => (
                  <div key={ev.id} className="px-4 py-2.5 grid grid-cols-[110px_120px_1fr_auto] items-center gap-3 hover:bg-slate-800/30 text-sm">
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {ev.ts ? new Date(ev.ts).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}) : "—"}
                    </span>
                    <span className="text-blue-400 font-mono text-xs uppercase tracking-wider font-semibold">
                      {ev.event.replace(/^DEMO_/, "")}
                    </span>
                    <span className="text-slate-300 font-mono text-xs">
                      {ev.ticker} <span className="text-slate-500">·</span> {ev.side} <span className="text-slate-500">·</span> {ev.qty}ct
                    </span>
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer hover:text-slate-300">payload</summary>
                      <pre className="mt-1 p-2 bg-slate-950 border border-slate-800 rounded font-mono text-[11px] whitespace-pre-wrap break-all max-w-md">{ev.raw_payload}</pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pine snippet */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 py-3 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-white text-base">Demo Pine indicator</CardTitle>
            <CopyChip text={pineSnippet} label="Copy Pine"/>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto bg-slate-950/40 max-h-[400px] overflow-y-auto">
{pineSnippet}
            </pre>
          </CardContent>
        </Card>

        {/* curl snippet */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 py-3 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-white text-base">Test from terminal</CardTitle>
            <CopyChip text={curlSnippet} label="Copy curl"/>
          </CardHeader>
          <CardContent className="p-0">
            <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto bg-slate-950/40">
{curlSnippet}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
