import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Repeat, Plus, X, Save } from "lucide-react";

// Global symbol map — TradingView symbol → Tradovate symbol → IBKR symbol.
// One row per instrument, mapping the same asset across broker vernaculars.
// Different from AccountSymbolMap (per-account NQ→MNQ aliasing).
//
// Example: NQ trades as "NQ1!" on TradingView, "NQZ4" on Tradovate,
//          "NQ FUT" on IBKR. This table stores that mapping globally.

const KEY = "tradecore_symbol_map_global_v1";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const save = (rows) => localStorage.setItem(KEY, JSON.stringify(rows));

const DEFAULTS = [
  { root: "MNQ", tradingview: "MNQ1!",    tradovate: "MNQU5",    ibkr: "MNQ FUT",   notes: "Micro E-mini NASDAQ" },
  { root: "NQ",  tradingview: "NQ1!",     tradovate: "NQU5",     ibkr: "NQ FUT",    notes: "E-mini NASDAQ" },
  { root: "MES", tradingview: "MES1!",    tradovate: "MESU5",    ibkr: "MES FUT",   notes: "Micro E-mini S&P" },
  { root: "ES",  tradingview: "ES1!",     tradovate: "ESU5",     ibkr: "ES FUT",    notes: "E-mini S&P" },
  { root: "GC",  tradingview: "GC1!",     tradovate: "GCZ5",     ibkr: "GC FUT",    notes: "Gold" },
  { root: "MGC", tradingview: "MGC1!",    tradovate: "MGCZ5",    ibkr: "MGC FUT",   notes: "Micro Gold" },
  { root: "CL",  tradingview: "CL1!",     tradovate: "CLU5",     ibkr: "CL FUT",    notes: "Crude Oil" },
];

export default function SymbolMapGlobal() {
  const [rows, setRows] = useState(() => {
    const stored = load();
    return stored.length ? stored : DEFAULTS;
  });
  const [flash, setFlash] = useState("");

  useEffect(() => save(rows), [rows]);

  const add = () => setRows(r => [...r, { root: "", tradingview: "", tradovate: "", ibkr: "", notes: "" }]);
  const update = (idx, key, val) => setRows(r => r.map((row, i) => i === idx ? { ...row, [key]: val } : row));
  const remove = (idx) => setRows(r => r.filter((_, i) => i !== idx));

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Repeat className="w-5 h-5 text-blue-400"/>Global Symbol Map
          <span className="text-xs font-normal text-slate-400 ml-2">
            TradingView ↔ Tradovate ↔ IBKR
          </span>
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Cross-broker naming for the same asset. Different from per-account NQ→MNQ aliasing on the Accounts page.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800/40 text-slate-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-2 py-1.5 text-left">Root</th>
                <th className="px-2 py-1.5 text-left">TradingView</th>
                <th className="px-2 py-1.5 text-left">Tradovate</th>
                <th className="px-2 py-1.5 text-left">IBKR</th>
                <th className="px-2 py-1.5 text-left">Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-4 text-slate-500 text-center italic">No mappings — click Add.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} className="hover:bg-slate-800/20">
                  <td className="p-1"><Input value={r.root} onChange={e => update(i, "root", e.target.value.toUpperCase())} placeholder="MNQ"
                                             className="h-8 font-mono bg-slate-950 border-slate-800 text-white"/></td>
                  <td className="p-1"><Input value={r.tradingview} onChange={e => update(i, "tradingview", e.target.value)} placeholder="MNQ1!"
                                             className="h-8 font-mono bg-slate-950 border-slate-800 text-white"/></td>
                  <td className="p-1"><Input value={r.tradovate} onChange={e => update(i, "tradovate", e.target.value)} placeholder="MNQU5"
                                             className="h-8 font-mono bg-slate-950 border-slate-800 text-white"/></td>
                  <td className="p-1"><Input value={r.ibkr} onChange={e => update(i, "ibkr", e.target.value)} placeholder="MNQ FUT"
                                             className="h-8 font-mono bg-slate-950 border-slate-800 text-white"/></td>
                  <td className="p-1"><Input value={r.notes} onChange={e => update(i, "notes", e.target.value)} placeholder="…"
                                             className="h-8 bg-slate-950 border-slate-800 text-white"/></td>
                  <td className="p-1">
                    <button onClick={() => remove(i)} className="text-slate-500 hover:text-red-400" title="Remove">
                      <X className="w-4 h-4"/>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <Button size="sm" variant="outline" onClick={add}>
            <Plus className="w-3 h-3 mr-1"/>Add row
          </Button>
          {flash && <span className="text-[11px] text-emerald-300">{flash}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
