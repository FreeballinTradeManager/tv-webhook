import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Plus, Trash2, Copy, Save, Sparkles, X } from "lucide-react";
import {
  EMPTY_PROFILE, MODE_FIELDS, loadProfiles, upsertProfile, deleteProfile,
  consistencyLimit, seedDefaultProfiles,
} from "@/lib/rule_profiles";

// RuleProfilesCard — CRUD for prop-firm rule presets.
// User configures Lucid 25k rules once, saves as "Lucid 25k",
// then attaches to an Account or Group so rotation enforces them.
export default function RuleProfilesCard() {
  const [profiles, setProfiles] = useState(() => loadProfiles());
  const [editing, setEditing]   = useState(null); // profile being edited (null = list mode)
  const [flash, setFlash]       = useState("");

  const refresh = () => setProfiles(loadProfiles());
  const doSeed  = () => {
    const added = seedDefaultProfiles();
    refresh();
    setFlash(added > 0 ? `Seeded ${added} preset profile${added === 1 ? "" : "s"}.` : "All defaults already present.");
    setTimeout(() => setFlash(""), 2500);
  };
  const doDelete = (id) => {
    if (!window.confirm("Delete this rule profile? Accounts attached to it will fall back to their firm defaults.")) return;
    deleteProfile(id);
    refresh();
  };
  const doDuplicate = (p) => {
    const copy = { ...p, id: "", name: `${p.name} (copy)` };
    upsertProfile(copy);
    refresh();
  };
  const doNew = () => setEditing({ ...EMPTY_PROFILE });

  return (
    <Card className="bg-slate-900 border-slate-800" id="rule-profiles">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-400"/>
            Rule Profiles
          </span>
          <div className="flex items-center gap-2">
            {profiles.length === 0 && (
              <Button size="sm" variant="outline" onClick={doSeed}
                      className="text-xs">
                <Sparkles className="w-3 h-3 mr-1"/>Seed defaults
              </Button>
            )}
            <Button size="sm" onClick={doNew} className="bg-blue-600 hover:bg-blue-500 text-xs">
              <Plus className="w-3 h-3 mr-1"/>New profile
            </Button>
          </div>
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Save your prop firm's rules once — attach to any account or group. Rotation reads them at run-time.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {flash && (
          <div className="text-xs bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-md px-3 py-2">
            {flash}
          </div>
        )}

        {editing ? (
          <ProfileForm
            profile={editing}
            onCancel={() => setEditing(null)}
            onSave={(p) => {
              upsertProfile(p);
              refresh();
              setEditing(null);
              setFlash(`Saved "${p.name || 'Untitled'}".`);
              setTimeout(() => setFlash(""), 2500);
            }}
          />
        ) : profiles.length === 0 ? (
          <div className="text-sm text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-6 text-center">
            No rule profiles yet. Click <strong className="text-white">Seed defaults</strong> for Lucid/Apex/MFFU examples, or <strong className="text-white">New profile</strong> to build one from scratch.
          </div>
        ) : (
          <div className="space-y-2">
            {profiles.map(p => (
              <ProfileRow key={p.id} p={p}
                          onEdit={() => setEditing({ ...p })}
                          onDelete={() => doDelete(p.id)}
                          onDuplicate={() => doDuplicate(p)}/>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileRow({ p, onEdit, onDelete, onDuplicate }) {
  const climit = consistencyLimit(p);
  const modeColor = p.mode === "Live" ? "text-emerald-300 border-emerald-500/40"
                : p.mode === "Evaluation" ? "text-amber-300 border-amber-500/40"
                : "text-blue-300 border-blue-500/40";
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-semibold">{p.name || "Untitled"}</span>
          <span className={`text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 ${modeColor}`}>
            {p.mode}
          </span>
          {p.firm && (
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{p.firm}{p.size ? ` · ${p.size}` : ""}</span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-300">
          {p.profit_target > 0 && <MiniStat k="Target" v={`$${(+p.profit_target).toLocaleString()}`}/>}
          {p.mode === "Live" && p.loss_limit > 0 && <MiniStat k="Loss cap" v={`$${(+p.loss_limit).toLocaleString()}`}/>}
          {p.daily_loss_limit > 0 && <MiniStat k="Daily loss" v={`$${(+p.daily_loss_limit).toLocaleString()}`}/>}
          {p.trailing_dd > 0 && <MiniStat k="Trailing DD" v={`$${(+p.trailing_dd).toLocaleString()}`}/>}
          {p.consistency_on && (
            <MiniStat k={(p.consistency_source === "fixed") ? "Consistency (fixed $)" : `Consistency ${p.consistency_pct}%`}
                      v={climit != null ? `≤ $${climit.toLocaleString(undefined, {maximumFractionDigits: 0})}` : "—"}
                      tone="warn"/>
          )}
          {p.max_losing_accounts > 0 && <MiniStat k="Max losing" v={p.max_losing_accounts}/>}
          {(p.uses_per_account || 1) > 1 && <MiniStat k="Uses/acct" v={`${p.uses_per_account}×`}/>}
        </div>
        {p.notes && <div className="text-[11px] text-slate-500 mt-2 italic">{p.notes}</div>}
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 px-2 text-xs">Edit</Button>
        <Button size="sm" variant="ghost" onClick={onDuplicate} className="h-7 px-2 text-xs text-slate-400" title="Duplicate">
          <Copy className="w-3 h-3"/>
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 px-2 text-xs text-slate-400 hover:text-red-400">
          <Trash2 className="w-3 h-3"/>
        </Button>
      </div>
    </div>
  );
}

function MiniStat({ k, v, tone }) {
  const cls = tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
      <div className={`font-semibold ${cls}`}>{v}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// The editor form. Mode dropdown picks which fields to show.
// ---------------------------------------------------------------------
function ProfileForm({ profile, onSave, onCancel }) {
  const [p, setP] = useState(profile);
  const set = (k, v) => setP(prev => ({ ...prev, [k]: v }));
  const fields = MODE_FIELDS[p.mode] || MODE_FIELDS.Custom;
  const climit = consistencyLimit(p);

  const has = (f) => fields.includes(f);

  const save = () => {
    if (!p.name.trim()) { alert("Give the profile a name."); return; }
    onSave(p);
  };

  return (
    <div className="bg-slate-950 border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-white font-semibold text-sm">
          {p.id ? "Edit rule profile" : "New rule profile"}
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel} className="text-slate-400">
          <X className="w-4 h-4"/>
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">Name</Label>
          <Input value={p.name} onChange={e => set("name", e.target.value)}
                 placeholder="e.g. Lucid 25k"
                 className="bg-slate-900 border-slate-800 text-white"/>
        </div>
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">Rotation Mode</Label>
          <Select value={p.mode} onValueChange={v => set("mode", v)}>
            <SelectTrigger className="bg-slate-900 border-slate-800 text-white">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white">
              <SelectItem value="Live">Live</SelectItem>
              <SelectItem value="Evaluation">Evaluation</SelectItem>
              <SelectItem value="Custom">Custom (all fields)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {has("firm") && (
          <TextField label="Prop firm" val={p.firm}    onChange={v => set("firm", v)}    placeholder="Lucid / Apex / MFFU"/>
        )}
        {has("size") && (
          <TextField label="Account size" val={p.size} onChange={v => set("size", v)}    placeholder="25k / 50k / 150k"/>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {has("profit_target") && (
          <MoneyField label="Profit target" val={p.profit_target} onChange={v => set("profit_target", v)} placeholder="1250"/>
        )}
        {has("loss_limit") && (
          <MoneyField label="Total loss limit" val={p.loss_limit} onChange={v => set("loss_limit", v)} placeholder="2500"/>
        )}
        {has("trailing_dd") && (
          <MoneyField label="Trailing drawdown" val={p.trailing_dd} onChange={v => set("trailing_dd", v)} placeholder="1000"/>
        )}
        {has("daily_loss_limit") && (
          <MoneyField label="Daily loss limit" val={p.daily_loss_limit} onChange={v => set("daily_loss_limit", v)} placeholder="750"/>
        )}
        {has("max_losing_accounts") && (
          <NumField label="Max losing accounts" val={p.max_losing_accounts} onChange={v => set("max_losing_accounts", v)} placeholder="2"/>
        )}
      </div>

      {has("consistency_on") && (
        <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs text-slate-300 font-semibold">Consistency rule</Label>
              <div className="text-[10px] text-slate-500">
                Single-day profit cannot exceed the cap. Common with Lucid, FTMO, MFF.
              </div>
            </div>
            <Switch checked={!!p.consistency_on} onCheckedChange={v => set("consistency_on", v)}/>
          </div>
          {p.consistency_on && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div>
                <Label className="text-xs text-slate-400 uppercase tracking-wider">Cap source</Label>
                <Select value={p.consistency_source || "percent"}
                        onValueChange={v => set("consistency_source", v)}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                    <SelectValue/>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="percent">% of target (auto)</SelectItem>
                    <SelectItem value="fixed">Fixed $ (I set it)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {(p.consistency_source || "percent") === "percent" ? (
                  <NumField label="Consistency %" val={p.consistency_pct}
                            onChange={v => set("consistency_pct", v)} placeholder="50"/>
                ) : (
                  <MoneyField label="Fixed cap" val={p.consistency_fixed_usd}
                              onChange={v => set("consistency_fixed_usd", v)} placeholder="300"/>
                )}
                <div>
                  <Label className="text-xs text-slate-400 uppercase tracking-wider">
                    {(p.consistency_source || "percent") === "percent" ? "Auto: single-day cap" : "Effective cap"}
                  </Label>
                  <div className="mt-1 h-9 flex items-center px-3 bg-slate-950 border border-slate-800 rounded text-amber-300 font-semibold">
                    {climit != null ? `≤ $${climit.toLocaleString(undefined, {maximumFractionDigits: 2})}` : "—"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {has("uses_per_account") && (
        <div className="bg-slate-900 border border-slate-800 rounded p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-xs text-slate-300 font-semibold">Uses per account before rotating</Label>
              <div className="text-[10px] text-slate-500">
                1 = advance to next account after every trade (strict round-robin). 2 = each account fires twice, then advance.
              </div>
            </div>
            <div className="w-24 shrink-0">
              <Select value={String(p.uses_per_account || 1)}
                      onValueChange={v => set("uses_per_account", Number(v))}>
                <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="1">1×</SelectItem>
                  <SelectItem value="2">2×</SelectItem>
                  <SelectItem value="3">3×</SelectItem>
                  <SelectItem value="5">5×</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}

      {has("notes") && (
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">Notes (optional)</Label>
          <Input value={p.notes} onChange={e => set("notes", e.target.value)}
                 placeholder="Reference the firm's rules page URL, exact figures, etc."
                 className="bg-slate-900 border-slate-800 text-white"/>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
        <Button variant="ghost" onClick={onCancel} className="text-slate-400">Cancel</Button>
        <Button onClick={save} className="bg-blue-600 hover:bg-blue-500">
          <Save className="w-4 h-4 mr-1"/>Save profile
        </Button>
      </div>
    </div>
  );
}

function TextField({ label, val, onChange, placeholder }) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wider">{label}</Label>
      <Input value={val || ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}
             className="bg-slate-900 border-slate-800 text-white"/>
    </div>
  );
}
function MoneyField({ label, val, onChange, placeholder }) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wider">{label} ($)</Label>
      <Input type="number" value={val || ""} onChange={e => onChange(Number(e.target.value) || 0)} placeholder={placeholder}
             className="bg-slate-900 border-slate-800 text-white"/>
    </div>
  );
}
function NumField({ label, val, onChange, placeholder }) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wider">{label}</Label>
      <Input type="number" value={val || ""} onChange={e => onChange(Number(e.target.value) || 0)} placeholder={placeholder}
             className="bg-slate-900 border-slate-800 text-white"/>
    </div>
  );
}
