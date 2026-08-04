import React, { useMemo, useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { autoLotSize, sizingWarnings } from "@/lib/lot_sizing";
import { ASSET_REGISTRY, normalizeSymbol } from "@/lib/asset_registry";
import { Calculator, AlertTriangle } from "lucide-react";

// Per-account inline sizing card — mounted inside AccountCard.
//
// Small block that shows the trader "at your current balance + DD limit,
// how many contracts should I fire per trade on MNQ / ES / GC?" No math
// in the trader's head. Preferences persist per account in localStorage
// (account_id → {symbol, stop_ticks, mode, fixed_usd, pct}).
//
// The Pine indicator still owns final qty — this is a PLANNING card the
// trader looks at BEFORE the session, not a live routing override.

const KEY = "tradecore_account_sizing_v1";
const loadAll = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const saveAll = (o) => localStorage.setItem(KEY, JSON.stringify(o));

const DEFAULTS = { symbol: "MNQ", stop_ticks: 40, mode: "fixed_usd", fixed_usd: 120, pct: 1, session: "day" };
const MODES = [
  { key: "fixed_usd",   label: "Fixed $ per trade" },
  { key: "pct_balance", label: "% of balance" },
  { key: "pct_dd",      label: "% of daily DD limit" },
];

const KNOWN_SYMBOLS = Object.keys(ASSET_REGISTRY);

export default function AccountSizingCard({ account }) {
  const key = account.id || account.name;
  const all = loadAll();
  const persisted = all[key] || {};
  const [cfg, setCfg] = useState({ ...DEFAULTS, ...persisted });

  useEffect(() => {
    const next = { ...loadAll(), [key]: cfg };
    saveAll(next);
  }, [key, cfg]);

  const result = useMemo(() => autoLotSize({
    symbol: normalizeSymbol(cfg.symbol) || cfg.symbol,
    balance: Number(account.current_balance || 0),
    daily_loss_limit: Number(account.daily_loss_limit || 0),
    stop_ticks: Number(cfg.stop_ticks || 0),
    mode: cfg.mode,
    fixed_usd: Number(cfg.fixed_usd || 0),
    pct: Number(cfg.pct || 0),
    session: cfg.session,
  }), [cfg, account.current_balance, account.daily_loss_limit]);

  const warns = useMemo(() => result ? sizingWarnings({
    qty: result.qty,
    marginPct: result.marginPct,
    riskUsd: result.riskUsd,
    balance: Number(account.current_balance || 0),
    daily_loss_limit: Number(account.daily_loss_limit || 0),
  }) : [], [result, account.current_balance, account.daily_loss_limit]);

  return (
    <div className="border-t border-slate-800 pt-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
        <Calculator className="w-3.5 h-3.5 text-blue-400"/>
        Auto-Size Preview
      </div>

      {/* Inputs — kept small so the card doesn't balloon */}
      <div className="grid grid-cols-2 gap-2">
        <MiniField label="Symbol">
          <Select value={cfg.symbol} onValueChange={v => setCfg(s => ({...s, symbol: v}))}>
            <SelectTrigger className="h-7 text-xs bg-slate-950 border-slate-800 text-white">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-64">
              {KNOWN_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </MiniField>
        <MiniField label="Stop ticks">
          <Input type="number" value={cfg.stop_ticks}
                 onChange={e => setCfg(s => ({...s, stop_ticks: Number(e.target.value)}))}
                 className="h-7 text-xs bg-slate-950 border-slate-800 text-white"/>
        </MiniField>
        <MiniField label="Sizing mode">
          <Select value={cfg.mode} onValueChange={v => setCfg(s => ({...s, mode: v}))}>
            <SelectTrigger className="h-7 text-xs bg-slate-950 border-slate-800 text-white">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white">
              {MODES.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </MiniField>
        <MiniField label={cfg.mode === "fixed_usd" ? "Risk $" : "Risk %"}>
          <Input type="number"
                 value={cfg.mode === "fixed_usd" ? cfg.fixed_usd : cfg.pct}
                 onChange={e => {
                   const v = Number(e.target.value);
                   setCfg(s => cfg.mode === "fixed_usd" ? {...s, fixed_usd: v} : {...s, pct: v});
                 }}
                 className="h-7 text-xs bg-slate-950 border-slate-800 text-white"/>
        </MiniField>
      </div>

      {/* Result */}
      {result ? (
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1 text-xs">
          <Row label="Suggested qty" value={<span className="text-white font-bold text-base">{result.qty}</span>}/>
          <Row label="$ at risk"     value={`$${result.riskUsd.toFixed(2)}`}/>
          <Row label="Per contract"  value={`$${result.riskPerContract.toFixed(2)}`}/>
          <Row label="Day margin"    value={`$${result.marginRequired.toLocaleString()} (${(result.marginPct||0).toFixed(1)}%)`}/>
        </div>
      ) : (
        <div className="text-xs text-slate-500 italic">
          Set a symbol + stop ticks. Balance = ${(account.current_balance || 0).toLocaleString()}.
        </div>
      )}

      {warns.length > 0 && (
        <div className="space-y-1">
          {warns.map((w, i) => (
            <div key={i} className={`text-[11px] flex items-start gap-1.5 rounded px-2 py-1 border ${
              w.level === "danger" ? "text-red-300 bg-red-500/10 border-red-500/30"
                                   : "text-amber-300 bg-amber-500/10 border-amber-500/30"
            }`}>
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0"/>{w.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniField({ label, children }) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5 block">{label}</Label>
      {children}
    </div>
  );
}
function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200">{value}</span>
    </div>
  );
}
