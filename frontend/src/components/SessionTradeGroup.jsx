import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import CompactTradeRow from "./CompactTradeRow";

// SessionTradeGroup — groups a trade list by (date, session-window) and
// renders each group as: date header + compact one-liner rows.
//
// Session windows match her Big Risk pattern from memory:
//   18:00-01:00 (Asia / Late)
//   03:00-08:00 (London)
//   09:30-16:00 (NY)
//   11:45-15:00 (Big Risk mid-NY)
// Plus a generic OTHER bucket for anything outside.

const SESSIONS = [
  { key: "ASIA",     label: "18:00 – 01:00",   startH: 18, endH: 1  },  // wraps midnight
  { key: "LONDON",   label: "03:00 – 08:00",   startH: 3,  endH: 8  },
  { key: "PRE-NY",   label: "08:00 – 09:30",   startH: 8,  endH: 9.5 },
  { key: "NY",       label: "09:30 – 16:00",   startH: 9.5, endH: 16 },
  { key: "POST-NY",  label: "16:00 – 18:00",   startH: 16, endH: 18 },
];

function etHourOf(iso) {
  if (!iso) return null;
  // Approximate ET without DST — good enough for grouping
  const d = new Date(iso);
  return ((d.getUTCHours() - 4) + 24) % 24 + d.getUTCMinutes() / 60;
}

function sessionOf(iso) {
  const h = etHourOf(iso);
  if (h == null) return "OTHER";
  for (const s of SESSIONS) {
    if (s.startH < s.endH) {
      if (h >= s.startH && h < s.endH) return s.key;
    } else {
      // wraps midnight (e.g. 18:00–01:00)
      if (h >= s.startH || h < s.endH) return s.key;
    }
  }
  return "OTHER";
}

function dateKey(iso) {
  if (!iso) return "unknown";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dateLabel(iso) {
  if (!iso) return "Unknown date";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export default function SessionTradeGroup({ trades, accounts, dateFilter = null }) {
  // Group by { date → { session → trades[] } }
  const groups = useMemo(() => {
    const out = {};
    for (const t of (trades || [])) {
      const iso = t.entry_time || t.created_date || t.date;
      const dk  = dateKey(iso);
      if (dateFilter && dk !== dateFilter) continue;
      const sk  = sessionOf(iso);
      out[dk] ||= { label: dateLabel(iso), sessions: {} };
      out[dk].sessions[sk] ||= [];
      out[dk].sessions[sk].push(t);
    }
    // Sort trades within each session by time
    for (const dk of Object.keys(out)) {
      for (const sk of Object.keys(out[dk].sessions)) {
        out[dk].sessions[sk].sort((a, b) =>
          new Date(a.entry_time || a.created_date || 0) - new Date(b.entry_time || b.created_date || 0));
      }
    }
    return out;
  }, [trades, dateFilter]);

  // Sorted date keys (newest first)
  const dates = useMemo(() =>
    Object.keys(groups).sort((a, b) => b.localeCompare(a)), [groups]);

  const acctFor = (t) => (accounts || []).find(a => a.id === t.account_id) || null;

  if (dates.length === 0) {
    return (
      <div className="text-sm text-slate-500 italic text-center py-8">
        No trades to display{dateFilter ? ` for ${dateFilter}` : ""}.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dates.map(dk => {
        const dg = groups[dk];
        // Session order: Asia first (matches her workflow of 18:00 start), then chronologically
        const sessionKeys = Object.keys(dg.sessions).sort((a, b) => {
          const ai = SESSIONS.findIndex(s => s.key === a);
          const bi = SESSIONS.findIndex(s => s.key === b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        return (
          <Card key={dk} className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3 border-b border-slate-800">
              <CardTitle className="text-white text-base flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-blue-400"/>
                  <span className="uppercase font-semibold">{dg.label}</span>
                </span>
                <DayTotals sessions={dg.sessions}/>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {sessionKeys.map(sk => {
                const list = dg.sessions[sk];
                const spec = SESSIONS.find(s => s.key === sk);
                return (
                  <div key={sk} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 uppercase tracking-wider pl-1">
                      <span className="font-semibold text-slate-400">{sk}</span>
                      {spec && <span className="text-slate-500">· {spec.label}</span>}
                      <span className="ml-auto text-slate-500">{list.length} trade{list.length === 1 ? "" : "s"}</span>
                      <SessionTotal trades={list}/>
                    </div>
                    <div className="space-y-1">
                      {list.map((t, i) => (
                        <CompactTradeRow key={t.id || i} trade={t} index={i + 1}
                                          account={acctFor(t)}/>
                      ))}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
function DayTotals({ sessions }) {
  const all = Object.values(sessions).flat();
  const n   = all.length;
  const pnl = all.reduce((a, t) => a + Number(t.profit_loss ?? t.pnl ?? 0), 0);
  const w   = all.filter(t => Number(t.profit_loss ?? t.pnl ?? 0) > 0).length;
  const l   = all.filter(t => Number(t.profit_loss ?? t.pnl ?? 0) < 0).length;
  return (
    <span className="text-xs font-mono flex items-center gap-2">
      <span className="text-slate-400">{n} trade{n === 1 ? "" : "s"}</span>
      <span className="text-slate-600">·</span>
      <span className="text-emerald-400">{w}W</span>
      <span className="text-slate-600">/</span>
      <span className="text-red-400">{l}L</span>
      <span className="text-slate-600">·</span>
      <span className={pnl > 0 ? "text-emerald-400 font-semibold"
                     : pnl < 0 ? "text-red-400 font-semibold" : "text-slate-400"}>
        {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(pnl >= 100 || pnl <= -100 ? 0 : 2)}
      </span>
    </span>
  );
}

function SessionTotal({ trades }) {
  const pnl = trades.reduce((a, t) => a + Number(t.profit_loss ?? t.pnl ?? 0), 0);
  if (pnl === 0) return null;
  return (
    <span className={`font-mono text-[11px] tabular-nums ${pnl > 0 ? "text-emerald-400" : "text-red-400"}`}>
      {pnl >= 0 ? "+" : "-"}${Math.abs(pnl).toFixed(0)}
    </span>
  );
}
