import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Lock, Radio, TrendingUp, ExternalLink, Trash2 } from "lucide-react";
import {
  getMirrorCfg, setMirrorCfg, BROKER_PRESETS,
  getDryRunLog, clearDryRunLog,
} from "@/lib/mt5_mirror";
import { listMt5Targets } from "@/lib/mt5_symbol_map";
import { DEFAULT_CFD_OFFSETS } from "@/lib/mt5_lot_math";

// Mt5MirrorCard — mounted inside AccountCard on the Accounts page.
//
// Lets the trader:
//   · toggle mirror ON/OFF for this account
//   · pick a CFD prop firm preset (FTMO / Funded Next / etc.)
//   · enter MT5 login + server (display only; secrets stay out of localStorage)
//   · pick sizing mode + fixed lot + hard $ cap
//   · see the last few dry-run entries so they can eyeball what WOULD fire
//
// Everything is localStorage — no server call needed for Phase 1.
// The ARM toggle is hard-disabled and captioned "Phase 2 — real MT5 send".

const SIZING_MODES = [
  { key: "match_risk", label: "Match Pine $ risk (recommended)" },
  { key: "fixed_lot",  label: "Fixed lot per signal" },
  { key: "match_qty",  label: "Fixed lot × Pine qty" },
];

// Task #217 — futures↔CFD price conversion modes
const PRICE_MODES = [
  { key: "market",        label: "Market + stop distance (safest)" },
  { key: "fixed_offset",  label: "Fixed offset per symbol" },
  { key: "live_reanchor", label: "Live reanchor (Phase 2B)", disabled: true },
];

export default function Mt5MirrorCard({ account }) {
  const [cfg, setCfg] = useState(() => getMirrorCfg(account.id));
  const [log, setLog] = useState(() => getDryRunLog({ accountId: account.id, limit: 8 }));

  const targets = listMt5Targets();

  const persist = (patch) => {
    const next = setMirrorCfg(account.id, patch);
    setCfg(next);
  };

  // Refresh log every 4s while mounted — cheap read from localStorage.
  useEffect(() => {
    const t = setInterval(() => {
      setLog(getDryRunLog({ accountId: account.id, limit: 8 }));
    }, 4000);
    return () => clearInterval(t);
  }, [account.id]);

  const pickPreset = (key) => {
    const p = BROKER_PRESETS.find(b => b.key === key);
    if (!p) return;
    persist({ broker: p.key, platform: p.platform, suffix: p.suffix });
  };

  return (
    <div className="mt-3 border-t border-slate-800 pt-3 space-y-3">
      {/* Header row — enable + arm status */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${cfg.enabled ? "text-blue-400" : "text-slate-600"}`}/>
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">MT5 mirror</span>
          {cfg.enabled && (
            <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/40 text-[10px]">
              {cfg.broker} · {cfg.platform}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400"/>
            <span className="text-[10px] uppercase tracking-wider text-emerald-300">Dry-run only</span>
          </div>
          <Switch checked={!!cfg.enabled}
                  onCheckedChange={v => persist({ enabled: v })}
                  aria-label="Enable mirror"/>
        </div>
      </div>

      {cfg.enabled && (
        <>
          {/* Broker preset + platform / suffix */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Broker">
              <Select value={cfg.broker} onValueChange={pickPreset}>
                <SelectTrigger className="h-8 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {BROKER_PRESETS.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Platform">
              <Select value={cfg.platform} onValueChange={v => persist({ platform: v })}>
                <SelectTrigger className="h-8 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="MT5">MT5</SelectItem>
                  <SelectItem value="MT4">MT4</SelectItem>
                  <SelectItem value="cTrader">cTrader</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Login / server (display only — no secrets stored) */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Login (display)">
              <Input value={cfg.login || ""} onChange={e => persist({ login: e.target.value })}
                     placeholder="e.g. 51234567" className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
            <Field label="Server (display)">
              <Input value={cfg.server || ""} onChange={e => persist({ server: e.target.value })}
                     placeholder="e.g. FTMO-Server3" className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
          </div>

          {/* Symbol suffix + override */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Symbol suffix">
              <Input value={cfg.suffix || ""} onChange={e => persist({ suffix: e.target.value })}
                     placeholder='"" or ".cash" or ".m"'
                     className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
            <Field label="Symbol override (optional)">
              <Select value={cfg.symbolOverride || "__none"}
                      onValueChange={v => persist({ symbolOverride: v === "__none" ? null : v })}>
                <SelectTrigger className="h-8 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-64">
                  <SelectItem value="__none">Auto-map from Pine</SelectItem>
                  {targets.map(t => <SelectItem key={t.core} value={t.core}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Price conversion (task #217) — futures→CFD */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Price conversion (futures → CFD)">
              <Select value={cfg.priceConversionMode || "market"}
                      onValueChange={v => persist({ priceConversionMode: v })}>
                <SelectTrigger className="h-8 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {PRICE_MODES.map(m => (
                    <SelectItem key={m.key} value={m.key} disabled={m.disabled}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {cfg.priceConversionMode === "fixed_offset" && (
              <Field label="Offset for this symbol">
                <SymbolOffsetInput cfg={cfg} onChange={patch => persist(patch)}/>
              </Field>
            )}
          </div>

          {/* Sizing */}
          <div className="grid grid-cols-3 gap-2">
            <Field label="Sizing mode">
              <Select value={cfg.sizingMode} onValueChange={v => persist({ sizingMode: v })}>
                <SelectTrigger className="h-8 bg-slate-950 border-slate-800 text-white text-xs">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {SIZING_MODES.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Fixed lot">
              <Input type="number" step="0.01" min="0.01" value={cfg.fixedLot}
                     onChange={e => persist({ fixedLot: Number(e.target.value) || 0.01 })}
                     className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
            <Field label="$ cap per trade">
              <Input type="number" step="1" min="0" value={cfg.riskCapUsd}
                     onChange={e => persist({ riskCapUsd: Number(e.target.value) || 0 })}
                     className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono"/>
            </Field>
          </div>

          {/* ARM row — locked in Phase 1 */}
          <div className="flex items-center justify-between gap-2 bg-amber-500/5 border border-amber-500/30 rounded px-3 py-2">
            <div className="flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-400"/>
              <span className="text-xs text-amber-200">
                <strong>ARM MT5 sends</strong>
                <span className="text-amber-200/70"> — Phase 2 unlock. Dry-run only for now.</span>
              </span>
            </div>
            <Switch checked={false} disabled aria-label="Arm (locked in Phase 1)"/>
          </div>

          {/* Dry-run log */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Last {log.length} dry-run{log.length === 1 ? "" : "s"}</span>
              <div className="flex items-center gap-3">
                <a href="/Mt5Mirror" className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-1">
                  Full log <ExternalLink className="w-2.5 h-2.5"/>
                </a>
                {log.length > 0 && (
                  <button onClick={() => { clearDryRunLog(account.id); setLog([]); }}
                          className="text-[10px] text-slate-500 hover:text-red-400 inline-flex items-center gap-1">
                    <Trash2 className="w-2.5 h-2.5"/>Clear
                  </button>
                )}
              </div>
            </div>
            {log.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic py-2">
                No signals yet — fire one from the Manual Signal page or wait for a Pine alert.
              </div>
            ) : (
              <div className="space-y-1">
                {log.map(r => <DryRunRow key={r.id} r={r}/>)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">{label}</Label>
      {children}
    </div>
  );
}

function DryRunRow({ r }) {
  const ok = r.would_send?.ok;
  const w  = r.would_send;
  const sideClass = w?.side === "BUY"  ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
                  : w?.side === "SELL" ? "bg-purple-500/15 text-purple-300 border-purple-500/40"
                  : "bg-slate-500/15 text-slate-300 border-slate-500/40";
  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 flex items-center gap-2 text-[11px]">
      {ok ? (
        <>
          <Badge className={`text-[9px] px-1.5 py-0 ${sideClass}`}>{w.side || "?"}</Badge>
          <span className="font-mono text-white">{w.target}</span>
          <span className="text-slate-500">·</span>
          <span className="font-mono text-emerald-400">{w.lots} lot</span>
          {w.estimated_risk_usd != null && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">risk ~${w.estimated_risk_usd.toFixed(0)}</span>
            </>
          )}
          <span className="ml-auto text-slate-600 text-[10px]">{ts(r.ts)}</span>
        </>
      ) : (
        <>
          <Badge className="text-[9px] px-1.5 py-0 bg-red-500/15 text-red-300 border-red-500/40">SKIP</Badge>
          <span className="text-red-300/80">{w?.note || "no order"}</span>
          <span className="ml-auto text-slate-600 text-[10px]">{ts(r.ts)}</span>
        </>
      )}
    </div>
  );
}

function ts(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Small helper — pick a symbol from the target list + set its offset. Reflects
// current DEFAULT_CFD_OFFSETS as placeholder hints. Persists to symbolOffsets.
function SymbolOffsetInput({ cfg, onChange }) {
  const [sym, setSym] = React.useState(cfg.symbolOverride || "NAS100");
  const cur = (cfg.symbolOffsets || {})[sym] ?? DEFAULT_CFD_OFFSETS[sym] ?? 0;
  return (
    <div className="flex items-center gap-1">
      <Select value={sym} onValueChange={setSym}>
        <SelectTrigger className="h-8 w-24 bg-slate-950 border-slate-800 text-white text-xs font-mono">
          <SelectValue/>
        </SelectTrigger>
        <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-64">
          {Object.keys(DEFAULT_CFD_OFFSETS).map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="number" step="0.01" value={cur}
             onChange={e => {
               const v = Number(e.target.value);
               const next = { ...(cfg.symbolOffsets || {}), [sym]: v };
               onChange({ symbolOffsets: next });
             }}
             className="h-8 bg-slate-950 border-slate-800 text-white text-xs font-mono flex-1"/>
    </div>
  );
}
