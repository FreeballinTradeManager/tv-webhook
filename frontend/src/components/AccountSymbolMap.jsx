import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Repeat, Plus, X } from "lucide-react";
import { accountMappings, setMapping } from "@/lib/symbol_map";

// Per-account symbol map editor — mounted inside AccountCard.
// Tiny block that shows the current alias table with a "+ add" row.
// The mappings are pure config; resolveSymbol() reads them from
// wherever the webhook receiver eventually plugs it in.
export default function AccountSymbolMap({ account }) {
  const key = account.id || account.name;
  const [mapping, setLocalMapping] = useState(() => accountMappings(key));
  const [pine, setPine] = useState("");
  const [broker, setBroker] = useState("");

  const add = () => {
    const p = pine.trim().toUpperCase(), b = broker.trim().toUpperCase();
    if (!p || !b) return;
    const next = setMapping(key, p, b);
    setLocalMapping(next[key] || {});
    setPine(""); setBroker("");
  };
  const remove = (p) => {
    const next = setMapping(key, p, null);
    setLocalMapping(next[key] || {});
  };

  const entries = Object.entries(mapping);

  return (
    <div className="border-t border-slate-800 pt-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-semibold">
        <Repeat className="w-3.5 h-3.5 text-blue-400"/>
        Symbol map <span className="text-slate-500 font-normal">Pine → this account</span>
      </div>

      {entries.length === 0 && (
        <div className="text-[11px] text-slate-500 italic">
          No aliases — Pine's symbol routes as-is. Add a row to reroute (e.g. NQ → MNQ for a micros-only account).
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-1">
          {entries.map(([p, b]) => (
            <div key={p} className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs">
              <span className="font-mono text-white">{p}</span>
              <span className="text-slate-500">→</span>
              <span className="font-mono text-emerald-400">{b}</span>
              <button onClick={() => remove(p)} className="ml-auto text-slate-500 hover:text-red-400" title="Remove">
                <X className="w-3 h-3"/>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <Input value={pine} onChange={e => setPine(e.target.value)}
               placeholder="NQ" maxLength={12}
               className="h-7 text-xs bg-slate-950 border-slate-800 text-white font-mono uppercase"/>
        <span className="text-slate-500">→</span>
        <Input value={broker} onChange={e => setBroker(e.target.value)}
               placeholder="MNQ" maxLength={12}
               className="h-7 text-xs bg-slate-950 border-slate-800 text-white font-mono uppercase"/>
        <Button size="sm" variant="outline" onClick={add}
                className="h-7 px-2 text-xs">
          <Plus className="w-3 h-3"/>
        </Button>
      </div>
    </div>
  );
}
