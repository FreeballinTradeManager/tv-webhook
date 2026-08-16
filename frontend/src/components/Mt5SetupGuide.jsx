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
  ExternalLink, CheckCircle2, Circle, KeyRound, ShieldCheck,
  AlertTriangle, Loader2, Play, Lock,
} from "lucide-react";

// Mt5SetupGuide — the step-by-step onramp from zero to "creds pasted, tested".
//
// PHASE 2A / 2B GATING
// -----------------------------------------------------------------------------
// The backend /api/mt5/setup-status endpoint returns { phase: "2A" | "2B" }.
//   2A → we don't have METAAPI_TOKEN in Railway env yet. Show the setup guide.
//   2B → env is live. Show the per-account creds entry + Test Connection flow.
//
// The guide walks the user through:
//   Step 1  FTMO free DEMO account (ftmo.com/demo)
//   Step 2  MetaAPI signup + free tier (metaapi.cloud)
//   Step 3  Provision the MT5 account inside MetaAPI dashboard
//   Step 4  Paste creds into TradeCore (dialog inside this component)
//   Step 5  Test connection — hits /api/mt5/test/{account_id}
//
// Progress is per-account and stored in localStorage so a browser reload keeps
// step ticks. NO passwords or tokens are stored in localStorage — only the
// booleans "did user say they finished step X" plus display login/server.

const PROGRESS_KEY = "tradecore_mt5_setup_progress_v1";

const loadProgress = () => {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); }
  catch { return {}; }
};
const saveProgress = (o) =>
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(o || {}));

// The 5-step onramp. Titles + hrefs + inline blurbs.
const STEPS = [
  {
    key:   "ftmo_demo",
    title: "Register a FREE FTMO demo",
    href:  "https://ftmo.com/en/challenges-free-trial/",
    blurb: "FTMO's Free Trial is a $10k demo, no credit card. Use this — never the paid Challenge — until connectivity is proven.",
    hint:  "You'll receive MT5 login + password + server (e.g. FTMO-Demo, FTMO-Demo2, FTMO-Server3) by email within a few minutes.",
  },
  {
    key:   "metaapi_signup",
    title: "Create a MetaAPI account",
    href:  "https://app.metaapi.cloud/",
    blurb: "MetaAPI is the bridge between our backend and your MT5. Free tier covers 1 account, no card required.",
    hint:  "In the MetaAPI dashboard, copy your API TOKEN (Settings → API Tokens) — you'll paste it below.",
  },
  {
    key:   "provision_mt5",
    title: "Provision the FTMO MT5 account inside MetaAPI",
    href:  "https://app.metaapi.cloud/mt-accounts",
    blurb: "In MetaAPI, add a new MT-account with your FTMO demo credentials. MetaAPI validates the login and returns an ACCOUNT ID.",
    hint:  "Wait for the account status to become DEPLOYED (usually 30-90 seconds). Copy the account_id (e.g. b1c7f8e0-...).",
  },
  {
    key:   "paste_creds",
    title: "Paste creds into TradeCore",
    blurb: "Enter your MT5 login/password/server and the MetaAPI token + account_id below. TradeCore stores login+server in localStorage; password + token are POSTed to the backend Vault only.",
    hint:  "Password and MetaAPI token NEVER touch server logs.",
    action: "open_dialog",
  },
  {
    key:   "test_connection",
    title: "Test connection",
    blurb: "TradeCore GETs your MetaAPI account details. A green badge confirms FTMO reachable, balance visible, ready for dry-run parity check.",
    hint:  "Phase 2A returns pending — Phase 2B swaps in the real MetaAPI call once your env is wired.",
    action: "test",
  },
];

export default function Mt5SetupGuide({ account }) {
  const [phase, setPhase] = useState("loading");
  const [note, setNote]   = useState("");
  const [progress, setProgress] = useState(() => loadProgress()[account?.id] || {});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  // Poll the global setup status once — cheap, tells us 2A vs 2B.
  useEffect(() => {
    fetch("/api/mt5/setup-status")
      .then(r => r.json())
      .then(d => { setPhase(d.phase); setNote(d.note || ""); })
      .catch(() => setPhase("2A"));
  }, []);

  const tickStep = (key) => {
    const next = { ...progress, [key]: true };
    setProgress(next);
    const all = loadProgress();
    saveProgress({ ...all, [account.id]: next });
  };

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(`/api/mt5/test/${account.id}`);
      const d = await r.json();
      setTestResult(d);
      if (d.ok) tickStep("test_connection");
    } catch (e) {
      setTestResult({ ok: false, reason: String(e?.message || e) });
    } finally {
      setTesting(false);
    }
  };

  const completed = Object.values(progress).filter(Boolean).length;

  return (
    <Card className="bg-slate-900 border-blue-500/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-white text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-blue-400"/>
            FTMO + MT5 setup — {account.name}
          </span>
          <Badge className={`text-[10px] ${phase === "2B"
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              : "bg-amber-500/15 text-amber-300 border-amber-500/40"}`}>
            Phase {phase === "loading" ? "…" : phase}
          </Badge>
        </CardTitle>
        <div className="text-xs text-slate-400 mt-1">
          {completed}/{STEPS.length} steps done · {note}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {phase === "2A" && (
          <div className="bg-amber-500/5 border border-amber-500/40 rounded p-3 text-xs text-amber-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"/>
            <div>
              <strong>Phase 2A</strong> — TradeCore's MetaAPI env is not wired yet. Work through
              steps 1-4 to get your creds ready. Step 5 unlocks the moment we deploy the
              MetaAPI token to Railway env.
            </div>
          </div>
        )}

        {STEPS.map((s, i) => (
          <StepRow key={s.key} step={s} index={i+1}
                   done={!!progress[s.key]}
                   onTick={() => tickStep(s.key)}
                   onOpenDialog={() => setDialogOpen(true)}
                   onTest={testConnection}
                   testing={testing}
                   testResult={s.action === "test" ? testResult : null}/>
        ))}

        {/* Creds dialog */}
        <CredsDialog open={dialogOpen} onOpenChange={setDialogOpen}
                     account={account}
                     onSaved={() => { tickStep("paste_creds"); setDialogOpen(false); }}/>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
function StepRow({ step, index, done, onTick, onOpenDialog, onTest, testing, testResult }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-slate-950 border border-slate-800 rounded">
      <button onClick={onTick}
              className="mt-0.5 shrink-0"
              title="Tick when this step is done">
        {done
          ? <CheckCircle2 className="w-5 h-5 text-emerald-400"/>
          : <Circle className="w-5 h-5 text-slate-600 hover:text-slate-400"/>}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">Step {index}</span>
          <span className={`text-sm font-semibold ${done ? "text-emerald-300" : "text-white"}`}>
            {step.title}
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">{step.blurb}</p>
        {step.hint && <p className="text-[11px] text-slate-500 mt-1 italic">{step.hint}</p>}

        <div className="flex items-center gap-2 mt-2">
          {step.href && (
            <a href={step.href} target="_blank" rel="noopener noreferrer"
               className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
              Open <ExternalLink className="w-3 h-3"/>
            </a>
          )}
          {step.action === "open_dialog" && (
            <Button size="sm" onClick={onOpenDialog} className="h-7 bg-blue-600 hover:bg-blue-500 text-xs">
              <KeyRound className="w-3 h-3 mr-1"/>Enter creds
            </Button>
          )}
          {step.action === "test" && (
            <>
              <Button size="sm" onClick={onTest} disabled={testing}
                      className="h-7 bg-emerald-600 hover:bg-emerald-500 text-xs">
                {testing
                  ? <><Loader2 className="w-3 h-3 mr-1 animate-spin"/>Testing…</>
                  : <><Play className="w-3 h-3 mr-1"/>Test connection</>}
              </Button>
              {testResult && (
                <Badge className={`text-[10px] ${
                  testResult.ok
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                    : "bg-amber-500/15 text-amber-300 border-amber-500/40"}`}>
                  {testResult.ok ? "Connected" : testResult.reason || "Pending"}
                </Badge>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function CredsDialog({ open, onOpenChange, account, onSaved }) {
  const [form, setForm] = useState({
    mt5_login: "", mt5_password: "", mt5_server: "",
    metaapi_token: "", metaapi_account_id: "",
    broker_label: "FTMO", platform: "MT5",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await fetch("/api/mt5/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, account_id: account.id }),
      });
      const d = await r.json();
      setResult({ ok: r.ok, data: d });
      if (r.ok) {
        // Cache display-only bits (login + server) for the mirror card
        const cfg = JSON.parse(localStorage.getItem("tradecore_mt5_mirror_cfg_v1") || "{}");
        cfg[account.id] = { ...(cfg[account.id] || {}),
          login: form.mt5_login, server: form.mt5_server, broker: form.broker_label, platform: form.platform };
        localStorage.setItem("tradecore_mt5_mirror_cfg_v1", JSON.stringify(cfg));
        setTimeout(onSaved, 800);
      }
    } catch (e) {
      setResult({ ok: false, err: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-400"/>
            MT5 + MetaAPI credentials
          </DialogTitle>
        </DialogHeader>

        <div className="bg-emerald-500/5 border border-emerald-500/40 rounded p-2 text-[11px] text-emerald-200 mb-3 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5"/>
          Password + MetaAPI token POSTed to backend Vault. NEVER logged. NEVER stored in localStorage.
          Only login + server display strings are cached client-side.
        </div>

        <div className="space-y-3">
          <FieldGroup label="MT5 (from FTMO email)">
            <div className="grid grid-cols-2 gap-2">
              <F label="Login">
                <Input value={form.mt5_login} onChange={e => setForm({...form, mt5_login: e.target.value})}
                       placeholder="e.g. 51234567" className="bg-slate-950 border-slate-800 text-white font-mono h-9"/>
              </F>
              <F label="Server">
                <Input value={form.mt5_server} onChange={e => setForm({...form, mt5_server: e.target.value})}
                       placeholder="e.g. FTMO-Demo" className="bg-slate-950 border-slate-800 text-white font-mono h-9"/>
              </F>
            </div>
            <F label="Password">
              <Input type="password" value={form.mt5_password}
                     onChange={e => setForm({...form, mt5_password: e.target.value})}
                     placeholder="•••••••••" className="bg-slate-950 border-slate-800 text-white font-mono h-9"/>
            </F>
          </FieldGroup>

          <FieldGroup label="MetaAPI (from app.metaapi.cloud dashboard)">
            <F label="MetaAPI token">
              <Input type="password" value={form.metaapi_token}
                     onChange={e => setForm({...form, metaapi_token: e.target.value})}
                     placeholder="eyJhbG… (from Settings → API Tokens)" className="bg-slate-950 border-slate-800 text-white font-mono h-9 text-xs"/>
            </F>
            <F label="MetaAPI account_id">
              <Input value={form.metaapi_account_id}
                     onChange={e => setForm({...form, metaapi_account_id: e.target.value})}
                     placeholder="b1c7f8e0-… (after MetaAPI provisions your MT5)"
                     className="bg-slate-950 border-slate-800 text-white font-mono h-9 text-xs"/>
            </F>
          </FieldGroup>

          {result?.data && (
            <div className={`text-xs p-2 rounded border ${result.ok
              ? "bg-emerald-500/5 border-emerald-500/40 text-emerald-200"
              : "bg-red-500/5 border-red-500/40 text-red-200"}`}>
              <div><strong>Phase:</strong> {result.data.phase}</div>
              <div>{result.data.next_step}</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="ghost" className="text-slate-400 hover:text-white">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={busy || !form.mt5_login || !form.mt5_password || !form.mt5_server}
                  className="bg-blue-600 hover:bg-blue-500">
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/>Sending…</> : "Save & test"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">{label}</Label>
      {children}
    </div>
  );
}
function FieldGroup({ label, children }) {
  return (
    <div className="border-t border-slate-800 pt-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      {children}
    </div>
  );
}
