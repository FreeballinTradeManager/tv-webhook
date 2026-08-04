import React, { useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Building2, ChevronRight, CheckCircle2, Copy, ExternalLink, ArrowLeft, ShieldCheck,
} from "lucide-react";
import { PROP_FIRMS, firmByKey, guardrailsFor } from "@/lib/prop_firms";

// Task #64 — Onboarding wizard for new prop firm accounts.
// 4 steps: pick firm → pick account size → confirm rules → wire in TC.
// Uses the same prop_firms lib as Accounts so the guardrails match.
// URL:  /Onboarding/prop-firm            (firm picker)
//       /Onboarding/prop-firm/apex       (jumps straight to that firm)

const STEPS = [
  { key: "firm",    label: "Firm" },
  { key: "size",    label: "Account size" },
  { key: "rules",   label: "Rules" },
  { key: "connect", label: "Connect" },
];

export default function PropFirmOnboardingPage() {
  const { firmKey: firmKeyParam } = useParams();
  const nav = useNavigate();

  const [firmKey, setFirmKey] = useState(firmKeyParam || "");
  const [size, setSize]       = useState("");
  const [nickname, setNickname] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState(null);

  const firm = firmByKey(firmKey);
  const stepIndex = !firm ? 0 : !size ? 1 : createdId ? 3 : 2;
  const guardrails = firm && size ? guardrailsFor(firmKey, Number(size)) : null;

  const finish = async () => {
    if (!firm || !size) return;
    setCreating(true);
    try {
      const acct = await Account.create({
        name: nickname.trim() || `${firm.name} · ${size}`,
        broker: "pmt",
        env: "demo",
        active: true,
        mode: "observe",   // safe default per memory rule
        ...(guardrails || {}),
      });
      setCreatedId(acct?.id || "created");
    } catch (e) { alert(`Setup failed: ${e.message}`); }
    setCreating(false);
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-3xl mx-auto space-y-6">

        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Link to="/Setup" className="hover:text-white">Setup</Link>
              <ChevronRight className="w-3 h-3"/>
              <span className="text-white">Prop firm onboarding</span>
            </div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2 mt-1">
              <Building2 className="w-7 h-7 text-blue-500"/> New prop-firm account
            </h1>
          </div>
          {firm && (
            <Button variant="outline"
                    onClick={() => { setFirmKey(""); setSize(""); setCreatedId(null); nav("/Onboarding/prop-firm"); }}
                    className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700 h-9">
              <ArrowLeft className="w-4 h-4 mr-2"/>Change firm
            </Button>
          )}
        </header>

        {/* Step strip */}
        <div className="flex items-center gap-2 flex-wrap">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              <div className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                stepIndex === i
                  ? "bg-blue-600 border-blue-500 text-white"
                  : stepIndex > i
                    ? "bg-emerald-900/40 border-emerald-700 text-emerald-300"
                    : "bg-slate-900 border-slate-800 text-slate-400"
              }`}>
                {stepIndex > i && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5"/>}
                {i + 1}. {s.label}
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-slate-600"/>}
            </React.Fragment>
          ))}
        </div>

        {/* STEP 1 — Firm picker */}
        {!firm && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white">Which firm are you starting with?</CardTitle>
              <p className="text-xs text-slate-400 mt-1">Same firm list as the Add Broker flow. Pick one to see its rules pre-loaded.</p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PROP_FIRMS.filter(f => f.key !== "custom").map(f => (
                <button key={f.key}
                        onClick={() => { setFirmKey(f.key); nav(`/Onboarding/prop-firm/${f.key}`); }}
                        className="text-left px-3 py-2.5 rounded-md border border-slate-800 bg-slate-950 hover:border-blue-500/60 hover:bg-slate-900 transition-colors">
                  <div className="text-white font-bold">{f.name}</div>
                  <div className="text-xs text-slate-400">{f.blurb}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* STEP 2 — Account size picker */}
        {firm && !size && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">{firm.name} · account size</CardTitle>
              <p className="text-xs text-slate-400 mt-1">Pick the size that matches your challenge / funded account.</p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {firm.accounts.length === 0 ? (
                <div className="text-slate-500 text-sm col-span-2">
                  No preset sizes for {firm.name} — you'll enter guardrails manually on the Accounts page.
                  <div className="mt-3">
                    <Button onClick={() => setSize("0")} className="bg-blue-600 hover:bg-blue-700 text-white">
                      Continue anyway
                    </Button>
                  </div>
                </div>
              ) : firm.accounts.map(a => (
                <button key={a.size}
                        onClick={() => setSize(String(a.size))}
                        className="text-left px-3 py-2.5 rounded-md border border-slate-800 bg-slate-950 hover:border-blue-500/60 hover:bg-slate-900 transition-colors">
                  <div className="text-white font-bold text-lg tabular-nums">${a.size.toLocaleString()}</div>
                  <div className="text-xs text-slate-400 tabular-nums">
                    {a.daily_dd && <span>${a.daily_dd.toLocaleString()} daily DD · </span>}
                    {a.max_dd  && <span>${a.max_dd.toLocaleString()} max DD</span>}
                  </div>
                  {a.price && <div className="text-[10px] text-slate-500 mt-0.5">Fee ${a.price}/mo</div>}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* STEP 3 — Rule review + confirm */}
        {firm && size && !createdId && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400"/> Confirm the rules
              </CardTitle>
              <p className="text-xs text-slate-400 mt-1">TradeCore will preset these guardrails on the new account. Change any of them later on Accounts.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <Rule label="Daily loss limit" value={guardrails?.daily_loss_limit ? `$${guardrails.daily_loss_limit.toLocaleString()}` : "—"}/>
                <Rule label="Max drawdown"     value={guardrails?.max_drawdown      ? `$${guardrails.max_drawdown.toLocaleString()}`      : "—"}/>
                <Rule label="DD type"          value={guardrails?.drawdown_type || "—"}/>
                <Rule label="Min trading days" value={String(guardrails?.min_trading_days ?? "—")}/>
                <Rule label="Consistency"      value={guardrails?.consistency_pct ? `${guardrails.consistency_pct}%` : "—"}/>
                <Rule label="Weekend flat"     value={guardrails?.weekend_flat ? "Required" : "OK"}/>
                <Rule label="News flat"        value={guardrails?.news_flat ? "Required" : "OK"}/>
                <Rule label="Payout split"     value={guardrails?.payout_split_pct ? `${guardrails.payout_split_pct}%` : "—"}/>
                <Rule label="First payout in"  value={guardrails?.payout_min_days ? `${guardrails.payout_min_days}d` : "—"}/>
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-2">
                <Label className="text-white text-sm">Account nickname</Label>
                <Input value={nickname}
                       onChange={e => setNickname(e.target.value)}
                       placeholder={`e.g. ${firm.name} #1 · ${size}`}
                       className="bg-slate-950 border-slate-700 text-white"
                       autoFocus/>
                <p className="text-[11px] text-slate-500">Free text — how you'll recognise this account on the dashboard.</p>
              </div>

              <Button onClick={finish} disabled={creating}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                {creating ? "Creating…" : <><CheckCircle2 className="w-4 h-4 mr-2"/>Create the account (observe mode)</>}
              </Button>
              <p className="text-[10px] text-slate-500 text-center">
                Created in OBSERVE mode — TradeCore only records signals, PMT/TradersPost keeps executing. You can switch to direct routing per account later.
              </p>
            </CardContent>
          </Card>
        )}

        {/* STEP 4 — Post-connect */}
        {createdId && (
          <Card className="bg-slate-900 border-slate-800 border-l-4 border-l-emerald-500">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-6 h-6"/>
                <div className="text-lg font-bold">Account created.</div>
              </div>
              <p className="text-slate-400 text-sm">
                Next steps to get your <span className="text-white font-semibold">{firm.name}</span> account observing:
              </p>
              <ol className="space-y-2 text-sm text-slate-200">
                <li className="flex gap-2"><span className="text-blue-400 font-bold">1.</span> On the Accounts page, open the new account row → copy the observe webhook URL.</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">2.</span> Paste it as a <span className="text-white font-mono">second webhook</span> in your existing TradingView alert (or duplicate the alert with this URL).</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">3.</span> Fire a test trade to confirm signals reach the Signal Log.</li>
              </ol>
              <div className="flex gap-2 flex-wrap pt-2">
                <Link to="/Accounts">
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                    Open Accounts <ExternalLink className="w-4 h-4 ml-2"/>
                  </Button>
                </Link>
                <Link to="/Logs">
                  <Button variant="outline" className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                    Watch Signal Log
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Rule({ label, value }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950 p-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}
