import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Clock, Plus, X, Save, AlertTriangle } from "lucide-react";

// TradingSchedule — unified page for session windows + avoid windows.
// One place to manage:
//   · Trading sessions (R1 Pre-NY, R2 NY, R3 Asia) with start/end hours
//   · Avoid windows (news blackouts, personal breaks)
//   · Weekend cut behavior
//   · Daily reset hour
//
// localStorage-backed so it survives without backend schema changes.
// The rotation executor + Pine indicator both read from this shape.

const KEY = "tradecore_trading_schedule_v1";

const DEFAULT_CFG = {
  timezone: "America/New_York",
  daily_reset_hour: 18,           // 18:00 ET = new "day" boundary
  weekend_cut: true,               // Friday 12:00 ET flatten
  friday_cut_hour: 12,
  friday_cut_min: 0,
  sunday_start_hour: 18,           // Sunday open
  sessions: [
    { key: "R1", label: "R1 Pre-NY",  start_h: 21, start_m: 0, end_h: 10, end_m: 0, active: true, notes: "Overnight → London handoff" },
    { key: "R2", label: "R2 New York", start_h: 10, start_m: 0, end_h: 15, end_m: 0, active: true, notes: "NY equities day session" },
    { key: "R3", label: "R3 Asia",     start_h: 18, start_m: 0, end_h: 21, end_m: 0, active: true, notes: "Evening / Asia pre-open" },
  ],
  avoid: [
    { label: "Overnight quiet zone", start_h: 1, start_m: 0, end_h: 7, end_m: 0, active: false, notes: "Low-liquidity gap" },
  ],
};

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || DEFAULT_CFG; } catch { return DEFAULT_CFG; } };
const save = (o) => localStorage.setItem(KEY, JSON.stringify(o));

export default function TradingSchedulePage() {
  const [cfg, setCfg] = useState(load);
  const [flash, setFlash] = useState("");
  useEffect(() => save(cfg), [cfg]);

  const patch = (partial) => setCfg(c => ({ ...c, ...partial }));

  const addWindow = (list) => setCfg(c => ({
    ...c, [list]: [...(c[list] || []), { label: "New window", start_h: 9, start_m: 30, end_h: 10, end_m: 0, active: true, notes: "" }],
  }));
  const removeWindow = (list, idx) => setCfg(c => ({ ...c, [list]: c[list].filter((_, i) => i !== idx) }));
  const updateWindow = (list, idx, key, val) => setCfg(c => ({
    ...c, [list]: c[list].map((w, i) => i === idx ? { ...w, [key]: val } : w),
  }));

  const doSave = () => {
    save(cfg);
    setFlash("Saved. Rotation engine + Pine both read this shape.");
    setTimeout(() => setFlash(""), 2500);
  };
  const doReset = () => {
    if (!window.confirm("Reset all trading schedule config to defaults? Custom windows will be lost.")) return;
    setCfg(DEFAULT_CFG);
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Clock className="w-7 h-7 text-blue-400"/> Trading Schedule
          </h1>
          <p className="text-slate-400 mt-1">
            One page for session windows + avoid windows. Rotation engine and Pine indicator both use these hours.
          </p>
        </header>

        {flash && (
          <div className="text-xs bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-md px-3 py-2">
            {flash}
          </div>
        )}

        {/* Global settings */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Global</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Timezone</Label>
              <Input value={cfg.timezone} disabled
                     className="bg-slate-950 border-slate-800 text-slate-400"/>
              <div className="text-[10px] text-slate-500 mt-1">Hardcoded ET — matches Pine session tags.</div>
            </div>
            <div>
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Daily reset hour</Label>
              <Input type="number" min={0} max={23} value={cfg.daily_reset_hour}
                     onChange={e => patch({ daily_reset_hour: Number(e.target.value) || 0 })}
                     className="bg-slate-950 border-slate-800 text-white"/>
              <div className="text-[10px] text-slate-500 mt-1">18:00 ET = pnl_today resets here.</div>
            </div>
            <div>
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Sunday start</Label>
              <Input type="number" min={0} max={23} value={cfg.sunday_start_hour}
                     onChange={e => patch({ sunday_start_hour: Number(e.target.value) || 0 })}
                     className="bg-slate-950 border-slate-800 text-white"/>
              <div className="text-[10px] text-slate-500 mt-1">Earliest trade time on Sunday.</div>
            </div>
            <div className="md:col-span-3 flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-3">
              <div>
                <Label className="text-sm text-white font-semibold">Weekend cut</Label>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Auto-flatten all positions at Friday {cfg.friday_cut_hour}:{String(cfg.friday_cut_min).padStart(2,"0")} ET.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Input type="number" min={0} max={23} value={cfg.friday_cut_hour}
                       onChange={e => patch({ friday_cut_hour: Number(e.target.value) || 0 })}
                       className="w-16 bg-slate-950 border-slate-800 text-white text-center"/>
                <span className="text-slate-500">:</span>
                <Input type="number" min={0} max={59} value={cfg.friday_cut_min}
                       onChange={e => patch({ friday_cut_min: Number(e.target.value) || 0 })}
                       className="w-16 bg-slate-950 border-slate-800 text-white text-center"/>
                <Switch checked={!!cfg.weekend_cut} onCheckedChange={v => patch({ weekend_cut: v })}/>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sessions */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between">
              <span>Trading Sessions</span>
              <Button size="sm" variant="outline" onClick={() => addWindow("sessions")}>
                <Plus className="w-3 h-3 mr-1"/>Add session
              </Button>
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              R1 / R2 / R3 match Pine's `#R1_PRENY / #R2_NEWYORK / #R3_ASIA` tags used in strategy_name suffixes.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {(cfg.sessions || []).map((s, i) => (
              <WindowRow key={i} w={s} idx={i} list="sessions"
                         update={updateWindow} remove={removeWindow}
                         showKey/>
            ))}
          </CardContent>
        </Card>

        {/* Avoid windows */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400"/> Avoid Windows
              </span>
              <Button size="sm" variant="outline" onClick={() => addWindow("avoid")}>
                <Plus className="w-3 h-3 mr-1"/>Add avoid
              </Button>
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              Rotation is blocked during these windows. Use for news blackouts, personal breaks, gaps.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {(cfg.avoid || []).length === 0 ? (
              <div className="text-sm text-slate-500 italic py-3">No avoid windows configured.</div>
            ) : (cfg.avoid || []).map((w, i) => (
              <WindowRow key={i} w={w} idx={i} list="avoid"
                         update={updateWindow} remove={removeWindow}/>
            ))}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={doReset} className="text-slate-400 hover:text-red-400">
            Reset to defaults
          </Button>
          <Button onClick={doSave} className="bg-blue-600 hover:bg-blue-500">
            <Save className="w-4 h-4 mr-1"/>Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function WindowRow({ w, idx, list, update, remove, showKey }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-2">
      <div className="grid grid-cols-[1fr_auto_1fr_auto_2fr_auto_auto] gap-2 items-center">
        <TimeCell hh={w.start_h} mm={w.start_m}
                  onChange={(h, m) => { update(list, idx, "start_h", h); update(list, idx, "start_m", m); }}/>
        <span className="text-slate-500 text-xs">→</span>
        <TimeCell hh={w.end_h} mm={w.end_m}
                  onChange={(h, m) => { update(list, idx, "end_h", h); update(list, idx, "end_m", m); }}/>
        {showKey && <span className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">{w.key || "—"}</span>}
        {!showKey && <div/>}
        <Input value={w.label || ""} onChange={e => update(list, idx, "label", e.target.value)}
               placeholder="Label"
               className="bg-slate-900 border-slate-800 text-white text-sm"/>
        <Switch checked={!!w.active} onCheckedChange={v => update(list, idx, "active", v)}/>
        <button onClick={() => remove(list, idx)} className="text-slate-500 hover:text-red-400" title="Remove">
          <X className="w-4 h-4"/>
        </button>
      </div>
      {w.notes && (
        <div className="text-[11px] text-slate-500 italic pl-1">{w.notes}</div>
      )}
    </div>
  );
}

function TimeCell({ hh, mm, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <Input type="number" min={0} max={23} value={hh}
             onChange={e => onChange(Number(e.target.value) || 0, mm)}
             className="w-14 h-8 text-xs text-center bg-slate-900 border-slate-800 text-white"/>
      <span className="text-slate-500">:</span>
      <Input type="number" min={0} max={59} value={mm}
             onChange={e => onChange(hh, Number(e.target.value) || 0)}
             className="w-14 h-8 text-xs text-center bg-slate-900 border-slate-800 text-white"/>
    </div>
  );
}
