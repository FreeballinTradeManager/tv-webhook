import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Package, DollarSign, TrendingUp } from "lucide-react";
import { ASSET_REGISTRY } from "@/lib/asset_registry";
import SymbolMapGlobal from "@/components/SymbolMapGlobal";

// AssetRegistry — quick-reference table for every futures contract the
// asset_registry lib knows about. Tick size, point value, day margin,
// overnight margin, exchange, notes. Filter box up top.
export default function AssetRegistryPage() {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.entries(ASSET_REGISTRY)
      .map(([root, spec]) => ({ root, ...spec }))
      .filter(r => !q
        || r.root.toLowerCase().includes(q)
        || (r.name || "").toLowerCase().includes(q)
        || (r.exchange || "").toLowerCase().includes(q));
  }, [filter]);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Package className="w-7 h-7 text-blue-400"/> Asset Registry
          </h1>
          <p className="text-slate-400 mt-1">
            Contract specs for every futures + FX pair TradeCore knows about. Tick size, point value, day margin, overnight margin.
          </p>
        </header>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between gap-2">
              <span>{rows.length} instrument{rows.length === 1 ? "" : "s"}</span>
              <Input placeholder="Filter by symbol / name / exchange"
                     value={filter} onChange={e => setFilter(e.target.value)}
                     className="w-72 bg-slate-950 border-slate-800 text-white text-sm"/>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-right">Tick</th>
                    <th className="px-3 py-2 text-right">$/point</th>
                    <th className="px-3 py-2 text-right">Day margin</th>
                    <th className="px-3 py-2 text-right">Overnight</th>
                    <th className="px-3 py-2 text-left">Exchange</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No matches.</td></tr>
                  ) : rows.map(r => (
                    <tr key={r.root} className="hover:bg-slate-800/30">
                      <td className="px-3 py-2 font-mono font-semibold text-white">{r.root}</td>
                      <td className="px-3 py-2 text-slate-300">{r.name || "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-300 font-mono">{r.tick ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-300 font-mono">${r.pv?.toLocaleString?.() ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-300 font-mono">${r.day_margin?.toLocaleString?.() ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-300 font-mono">${r.overnight_margin?.toLocaleString?.() ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{r.exchange || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <SymbolMapGlobal/>

        <div className="text-xs text-slate-500">
          Source: <code className="text-blue-400">lib/asset_registry.js</code>. Used by lot-sizing, risk calculator, and normalization.
        </div>
      </div>
    </div>
  );
}
