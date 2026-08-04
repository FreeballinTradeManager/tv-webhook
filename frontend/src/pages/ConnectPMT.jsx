import React, { useEffect, useState } from "react";
import { Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio, Copy, CheckCircle2, ExternalLink, Eye, ShieldCheck, AlertTriangle } from "lucide-react";

// ConnectPMT — walk-through page for connecting PMT (Pick My Trade) as
// TradeCore's data source in OBSERVE-ONLY mode.
//
// The plan (LOCKED per feedback_tradecore_pmt_observe_mode):
//   1. Your TV alert continues to fire PMT as the ONLY execution
//      webhook. TradeCore never routes orders.
//   2. In the SAME TV alert, add a SECOND webhook URL: the observe
//      endpoint for the account this alert is associated with.
//   3. TradeCore's observe route logs the payload but never forwards
//      to any broker. Journal / analytics / rotation / positions /
//      timeline all populate from it.
//   4. Because TradeCore never talks to PMT and never talks to
//      Tradovate, there is nothing PMT / your prop firm can complain
//      about — TradeCore is a passive listener on your own alert.
//
// The observe endpoint /api/webhook/observe/{account_key} is already
// live (task #186). This page is the LAST-MILE UX: it hands the
// trader the exact URL(s) to paste, in the right order, with the
// LOCKED constraints called out at the top.

function observeUrl(accountKey) {
  const base = window.location.origin.replace(/\/$/, "");
  return `${base}/api/webhook/observe/${encodeURIComponent(accountKey)}`;
}

export default function ConnectPMTPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try { setAccounts(await Account.list("-created_date") || []); }
      catch { setAccounts([]); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Radio className="w-7 h-7 text-blue-400"/> Connect PMT — Observe Mode
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            PMT stays your execution engine. TradeCore just <em>listens</em> to the same TradingView alert
            so you get the journal, analytics, rotation state, positions, and per-trade timeline — without
            any TradeCore→broker link.
          </p>
        </header>

        {/* Guardrails — the locked rules right up top */}
        <Card className="bg-emerald-500/5 border-emerald-500/40">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
              <ShieldCheck className="w-5 h-5"/>Locked guarantees
            </div>
            <ul className="text-xs text-emerald-200/90 space-y-1 pl-6 list-disc">
              <li>TradeCore never sends orders to PMT, Tradovate, or any broker.</li>
              <li>PMT owns TV → Tradovate execution — same as it does today.</li>
              <li>The observe endpoint logs the payload and populates the UI. Nothing else.</li>
              <li>Emergency Flatten / Modify SL / drift-push stay disabled in observe mode.</li>
            </ul>
          </CardContent>
        </Card>

        {/* Two labelled starting tracks — DEMO first, LIVE Lucid second */}
        <div className="grid md:grid-cols-2 gap-3">
          <Card className="bg-slate-900 border-blue-500/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-blue-300 font-semibold text-sm mb-2">
                <ShieldCheck className="w-4 h-4"/>Track A — DEMO first
              </div>
              <div className="text-xs text-slate-300 leading-relaxed space-y-2">
                <p>Recommended path. Point the observe URL for your DEMO Tradovate account into your existing PMT alert(s). Fire a test signal from TradingView. Watch it land in <a href="/Logs" className="text-blue-400 hover:underline">Signal Log</a>. Zero real-money risk while you verify.</p>
                <p className="text-emerald-300"><strong>Graduation gate:</strong> at least 1 ENTRY + 1 TP + 1 CLOSE signal appear correctly tagged with the DEMO account before switching to Track B.</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-purple-500/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-purple-300 font-semibold text-sm mb-2">
                <ShieldCheck className="w-4 h-4"/>Track B — Lucid LIVE (observe-only)
              </div>
              <div className="text-xs text-slate-300 leading-relaxed space-y-2">
                <p>Once DEMO looks right, add the observe URL for your Lucid account as a SECOND webhook on the LIVE alert. Real trades keep executing through PMT → Tradovate; TradeCore just reads a copy.</p>
                <p className="text-amber-300"><strong>Prop-firm compliance:</strong> observe mode is data-only. Nothing about the signal path to Tradovate changes, so no rule is affected. If Lucid asks, TradeCore is a journal.</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Strategy sources — proves all three lanes flow through the same observe endpoint */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <Radio className="w-4 h-4 text-blue-400"/>What flows through observe
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-300 space-y-2">
            <p>All three of your signal sources land in the same journal — one observe URL per account is enough:</p>
            <ul className="pl-6 list-disc space-y-1">
              <li><strong className="text-blue-300">Automation #1 — Freeballin Pro Auto v2.74 (6.24 base)</strong> — auto entries + SL updates + CLOSE. Source label shows <code className="text-blue-300">v2.74</code>.</li>
              <li><strong className="text-purple-300">Automation #2 — FREEBALLIN v17.9.15 (2.1.1 / 2.4)</strong> — same PMT envelope, older engine. Source label shows <code className="text-purple-300">v17.9.15</code>.</li>
              <li><strong className="text-emerald-300">Manual — TM v20.87 STOPS</strong> — drag-to-arm entries + TP/BE/Jump/Creep/Trail updates + MASTER_CLOSE. Source label shows <code className="text-emerald-300">TM v20.87</code>.</li>
            </ul>
            <p className="text-slate-400 pt-1 border-t border-slate-800">The Trades table and Signal Log auto-detect the source per row so you can filter by strategy after the fact.</p>
          </CardContent>
        </Card>

        {/* The 3 steps */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-lg">How to wire it up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Step n={1} title="Open the TradingView alert you already use for PMT">
              Same alert firing your Freeballin Pro Auto (or TM v20.87 manual). Do not create a new alert.
            </Step>
            <Step n={2} title="In the same alert, add a second webhook URL">
              TradingView accepts multiple webhook URLs per alert (one per line in the "Webhook URL" box on newer TV, or use "Add" on the Notifications tab). Paste the observe URL for the account this alert is tied to — copy it from the list below.
            </Step>
            <Step n={3} title="Save. Fire a test.">
              Send one test signal from TV. It should appear in <a href="/Logs" className="text-blue-400 hover:underline">Signal Log</a> tagged with this account. If it doesn't, the observe URL is wrong or the TV alert isn't firing.
            </Step>
          </CardContent>
        </Card>

        {/* Per-account URLs */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-400"/> Your observe URLs
              <span className="text-xs font-normal text-slate-400 ml-2">
                one per account · paste each into that account's TV alert
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-800 rounded"/>)
            ) : accounts.length === 0 ? (
              <div className="bg-slate-950 border border-slate-800 rounded p-6 text-center text-slate-400 text-sm">
                No accounts yet. <a href="/Accounts" className="text-blue-400 hover:underline">Create one</a> first — each needs its own observe URL so signals get routed to the right journal.
              </div>
            ) : (
              accounts.map(a => <AccountObserveRow key={a.id || a.name} account={a}/>)
            )}
          </CardContent>
        </Card>

        {/* Common gotchas */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400"/> Common gotchas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-300">
            <p><strong className="text-white">Same alert body, two webhooks.</strong> Do NOT duplicate the alert — same body, just an extra destination. Otherwise a single Pine signal fires PMT twice.</p>
            <p><strong className="text-white">Match the account key.</strong> The URL ends in your account's ID or name. If two accounts share an alert (a group fan-out on PMT's side), copy each account's URL and add both.</p>
            <p><strong className="text-white">Turn off any TradeCore write features.</strong> Emergency Flatten and Modify SL should already be gated — this page is proof they are.</p>
            <p><strong className="text-white">If a signal doesn't appear</strong> in Signal Log within a few seconds of firing, the URL is wrong. Copy it again — the account_key must match this account exactly.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 shrink-0 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-sm">{n}</div>
      <div>
        <div className="text-white font-semibold text-sm">{title}</div>
        <div className="text-slate-400 text-xs mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function AccountObserveRow({ account }) {
  const key = account.id || account.name || "";
  const url = observeUrl(key);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-white font-semibold text-sm">{account.name || key}</span>
          {account.firm && (
            <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/30">
              {account.firm}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            OBSERVE
          </Badge>
        </div>
        <div className="font-mono text-[11px] text-slate-400 truncate">{url}</div>
      </div>
      <Button size="sm" variant="outline" onClick={copy}
              className={`shrink-0 ${copied ? "border-emerald-500/50 text-emerald-400" : ""}`}>
        {copied
          ? <><CheckCircle2 className="w-3 h-3 mr-1"/>Copied</>
          : <><Copy className="w-3 h-3 mr-1"/>Copy URL</>}
      </Button>
    </div>
  );
}
