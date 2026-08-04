import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Search, Zap, Code2, Info } from "lucide-react";
import {
  ENTRY_FAMILIES, REV_RUN_PATHS, SL_UPDATES, CLOSE_REASONS, SESSIONS, TM_EVENTS,
} from "@/lib/pine_signals";

// Task #73 — Alert templates library.
// Reference sheet of every signal the Freeballin Pro v2.74 (6.24 base)
// indicator emits, with copy-paste PMT/TradersPost JSON for each event.
// Structured, no user data — this is a documentation page you can hand
// to a new user setting up their TradingView alerts.

const WEBHOOK_PLACEHOLDER = "{{ paste your account webhook URL here }}";

// PMT-compatible entry template — what a v2.74 entry alert body looks
// like when routed to PMT (source of truth for our observe endpoint too).
const entryTemplate = (family) => ({
  symbol: "{{ticker}}",
  data: family.family?.includes("SELL") ? "sell" : "buy",
  quantity: "{{strategy.order.contracts}}",
  price: "{{close}}",
  order_type: "MKT",
  duplicate_position_allow: true,
  same_direction_ignore: false,
  reverse_order_close: false,
  strategy_name: family.key,
  _kind: family.key,
  advance_tp_sl: [
    { quantity: 2, tp: "{{plot_1}}", sl: "{{plot_0}}" },
    { quantity: 1, tp: "{{plot_2}}", sl: "{{plot_0}}" },
    { quantity: 1, tp: "99999",       sl: "{{plot_0}}" },
  ],
});

const slTemplate = (update) => ({
  symbol: "{{ticker}}",
  data: "buy",
  quantity: "{{position_size}}",
  update_sl: true,
  update_tp: false,
  sl: "{{plot_0}}",
  strategy_name: `SL ${update.key} (#R2_NEWYORK)`,
  duplicate_position_allow: false,
  same_direction_ignore: false,
});

const closeTemplate = (reason) => ({
  symbol: "{{ticker}}",
  data: "CLOSE",
  quantity: 0,
  full_closed: true,
  strategy_name: `CLOSE (${reason.key})`,
  duplicate_position_allow: false,
  main_token_type: "LIVE",
});

export default function AlertTemplatesPage() {
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState("");

  const q = query.trim().toLowerCase();
  const familyMatch = (f) => !q || f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) || (f.description || "").toLowerCase().includes(q);

  const families = useMemo(() => ENTRY_FAMILIES.filter(familyMatch), [q]);
  const sls      = useMemo(() => SL_UPDATES.filter(familyMatch), [q]);
  const closes   = useMemo(() => CLOSE_REASONS.filter(familyMatch), [q]);
  const revRun   = useMemo(() => REV_RUN_PATHS.filter(p =>
                    !q || p.key.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)), [q]);

  const copy = async (obj, name) => {
    try {
      const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
      await navigator.clipboard.writeText(text);
      setFlash(`✓ ${name} copied`);
      setTimeout(() => setFlash(""), 1500);
    } catch { alert("Clipboard blocked"); }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">

        <header className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Code2 className="w-7 h-7 text-blue-500"/> Alert Template Library
            </h1>
            <p className="text-slate-400 mt-1 max-w-3xl">
              Every signal the Freeballin Pro <span className="text-blue-400 font-semibold">v2.74 (6.24 base)</span> indicator emits — with a copy-paste PMT/TradersPost JSON body for each event. Paste any of these into a TradingView alert's <span className="text-slate-200 font-mono">Message</span> field.
            </p>
          </div>
        </header>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
          <Input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Filter — try 'REV', 'TRAIL', 'stop', 'FVG'…"
                 className="bg-slate-900 border-slate-700 text-white pl-10 h-10"/>
        </div>

        <Card className="bg-slate-900 border-blue-800/40">
          <CardContent className="p-4 flex items-start gap-3 text-sm text-slate-300 leading-relaxed">
            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5"/>
            <div>
              <strong className="text-white">Webhook URL:</strong> use the per-account URL from Accounts → your broker card → Copy webhook URL.
              For OBSERVE mode this fires alongside your primary PMT/TradersPost webhook — TradeCore only records the signal, never routes an order.
              For direct mode (Tradovate) this IS the primary webhook.
              <span className="block mt-1 text-slate-500 text-xs">Placeholders in curly braces are TradingView tokens (<span className="font-mono">{"{{ticker}}"}</span>, <span className="font-mono">{"{{plot_0}}"}</span>) — TV substitutes them at fire time.</span>
            </div>
          </CardContent>
        </Card>

        {/* Entry families */}
        {families.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
              Entry alerts <span className="text-slate-500 text-sm font-normal">· fires when Pine opens a new trade</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {families.map(f => (
                <TemplateCard
                  key={f.key}
                  title={f.label}
                  badgeText={f.key}
                  badgeClass={f.color}
                  description={f.description}
                  body={entryTemplate(f)}
                  onCopy={copy}
                />
              ))}
            </div>
          </section>
        )}

        {/* SL updates */}
        {sls.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
              SL update alerts <span className="text-slate-500 text-sm font-normal">· fires when Pine ratchets the stop</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {sls.map(u => (
                <TemplateCard
                  key={u.key}
                  title={u.label}
                  badgeText={`SL ${u.key}`}
                  badgeClass={u.color}
                  description={u.description}
                  body={slTemplate(u)}
                  onCopy={copy}
                />
              ))}
            </div>
          </section>
        )}

        {/* CLOSE reasons */}
        {closes.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
              CLOSE alerts <span className="text-slate-500 text-sm font-normal">· fires when the trade exits</span>
            </h2>
            <div className="grid md:grid-cols-2 gap-4">
              {closes.map(r => (
                <TemplateCard
                  key={r.key}
                  title={r.label}
                  badgeText={`CLOSE (${r.key})`}
                  badgeClass={r.color}
                  description={`Exit reason emitted by Pine when: ${r.label.toLowerCase()}.`}
                  body={closeTemplate(r)}
                  onCopy={copy}
                />
              ))}
            </div>
          </section>
        )}

        {/* REV / RUN paths reference */}
        {revRun.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
              REV / RUN path suffixes <span className="text-slate-500 text-sm font-normal">· appears as <code className="text-purple-400">REVBUY-FVG</code>, <code className="text-sky-400">RUNSELL-100</code> etc.</span>
            </h2>
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {revRun.map(p => (
                  <div key={p.key} className="flex items-baseline gap-2 py-1">
                    <code className="text-blue-400 font-mono text-xs px-1.5 py-0.5 bg-slate-950 border border-slate-800 rounded">{p.key}</code>
                    <span className="text-slate-300">{p.label}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {/* Task #128 — Trade Manager (v20.87 STOPS) events */}
        <section className="space-y-3">
          <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
            Trade Manager alerts <span className="text-slate-500 text-sm font-normal">· manual TM v20.87 STOPS</span>
          </h2>
          <p className="text-xs text-slate-400 -mt-1 max-w-3xl">
            The Trade Manager is manually-armed — the trader drags entry / stop lines and toggles pending. TradeCore recognizes every event it emits (PMT, TradersPost, and Trade Engine formats) so observe-mode still captures the full trade lifecycle.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {TM_EVENTS.filter(familyMatch).map(ev => (
              <TemplateCard
                key={ev.key}
                title={ev.label}
                badgeText={ev.key}
                badgeClass={ev.color}
                description={ev.description}
                body={{
                  event: ev.key,
                  ticker: "{{ticker}}",
                  side: "{{strategy.market_position}}",
                  qty: "{{strategy.position_size}}",
                  key: "{{ your webhook key }}",
                  strategy_name: `TM v20.87 · ${ev.key}`,
                }}
                onCopy={copy}
              />
            ))}
          </div>
        </section>

        {/* Sessions reference */}
        <section className="space-y-3">
          <h2 className="text-white text-xl font-bold flex items-baseline gap-2">
            Session tags <span className="text-slate-500 text-sm font-normal">· appears in <code className="text-slate-400">strategy_name</code> as <code>#R1_PRENY</code> / <code>#R2_NEWYORK</code> / <code>#R3_ASIA</code></span>
          </h2>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 space-y-2 text-sm">
              {SESSIONS.map(s => (
                <div key={s.key} className="flex items-baseline gap-3 py-1">
                  <Badge className="bg-slate-700 text-white font-mono text-xs">{s.key}</Badge>
                  <span className="text-slate-300 font-semibold">{s.label}</span>
                  <span className="text-slate-500 text-xs ml-auto">{s.hours}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

      </div>
    </div>
  );
}

function TemplateCard({ title, badgeText, badgeClass, description, body, onCopy }) {
  const json = JSON.stringify(body, null, 2);
  return (
    <Card className="bg-slate-900 border-slate-800 flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-white text-base">{title}</CardTitle>
          <Badge className={`${badgeClass} text-[10px] uppercase tracking-wider`}>{badgeText}</Badge>
        </div>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      </CardHeader>
      <CardContent className="flex-grow space-y-2">
        <pre className="bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-300 font-mono overflow-x-auto max-h-56">
{json}
        </pre>
        <Button size="sm" onClick={() => onCopy(body, title)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white">
          <Copy className="w-3.5 h-3.5 mr-1.5"/>Copy JSON
        </Button>
      </CardContent>
    </Card>
  );
}
