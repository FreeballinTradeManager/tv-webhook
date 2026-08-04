import React, { useState, useEffect, useMemo, useRef } from "react";
import { Group, Account, Strategy } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import {
  Users, ArrowRight, Plus, Trash2, Zap, Repeat, Trophy,
  Clock, Link2, UserPlus, Save, X, BookOpen, ShieldAlert,
  Copy, Pencil, Power,
} from "lucide-react";
import { useContextMenu } from "@/components/RightClickMenu";

// Preset time windows for common sessions.
// Locked Pine palette — no pink, no washed-out 15%-opacity backgrounds.
// Solid fills + white text so the buttons read at a glance.
const SESSION_PRESETS = [
  {
    label: "London",
    windows: [{start:"03:00",end:"12:00",tz:"America/New_York"}],
    cls: "bg-blue-600 hover:bg-blue-700 text-white border border-blue-500",
  },
  {
    label: "New York",
    windows: [{start:"08:00",end:"17:00",tz:"America/New_York"}],
    cls: "bg-teal-600 hover:bg-teal-700 text-white border border-teal-500",
  },
  {
    label: "Asian",
    windows: [{start:"20:00",end:"02:00",tz:"America/New_York"}],
    cls: "bg-slate-700 hover:bg-slate-600 text-white border border-slate-600",
  },
  {
    label: "Big Risk",
    windows: [
      {start:"18:00",end:"01:00",tz:"America/New_York"},
      {start:"11:45",end:"15:00",tz:"America/New_York"},
    ],
    cls: "bg-red-600 hover:bg-red-700 text-white border border-red-500",
  },
  {
    label: "24/7",
    windows: [],
    cls: "bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500",
  },
];

/** Cascade chain visualization for a group — walks next_group_id links */
function CascadeChain({ startGroupId, allGroups }) {
  const chain = [];
  const seen = new Set();
  let cur = startGroupId;
  while (cur && !seen.has(cur) && chain.length < 6) {  // guard against loops
    const g = allGroups.find(x => x.id === cur);
    if (!g) break;
    chain.push(g);
    seen.add(cur);
    cur = g.next_group_id;
  }
  if (chain.length <= 1) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs">
      {chain.map((g, i) => (
        <React.Fragment key={g.id}>
          <Badge variant="outline" className={i === 0
            ? "bg-blue-500/20 text-blue-300 border-blue-500/50 font-semibold"
            : "bg-slate-800 text-slate-400 border-slate-700"}>
            {String.fromCharCode(65 + i)} · {g.name}
          </Badge>
          {i < chain.length - 1 && <ArrowRight className="w-3 h-3 text-slate-600"/>}
        </React.Fragment>
      ))}
    </div>
  );
}

function TimeWindowsEditor({ windows, onChange }) {
  const add = () => onChange([...(windows || []), { start: "09:30", end: "16:00", tz: "America/New_York" }]);
  const remove = (i) => onChange(windows.filter((_, idx) => idx !== i));
  const patch = (i, k, v) => onChange(windows.map((w, idx) => idx === i ? {...w, [k]: v} : w));
  const applyPreset = (preset) => onChange([...preset.windows]);

  return (
    <div className="space-y-2">
      {(!windows || windows.length === 0) && (
        <div className="text-xs text-green-400 bg-green-500/10 border border-green-500/30 rounded px-2 py-1.5">
          🟢 Always tradeable (no time restrictions)
        </div>
      )}
      {(windows || []).map((w, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs">
          <Clock className="w-3 h-3 text-slate-500 shrink-0"/>
          <Input type="time" value={w.start || "09:30"} onChange={e => patch(i, "start", e.target.value)}
                 className="bg-slate-800 border-slate-700 text-white h-7 w-24"/>
          <span className="text-slate-500">→</span>
          <Input type="time" value={w.end || "16:00"} onChange={e => patch(i, "end", e.target.value)}
                 className="bg-slate-800 border-slate-700 text-white h-7 w-24"/>
          <span className="text-slate-500 text-[10px]">ET</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={() => remove(i)}>
            <X className="w-3 h-3 text-red-500"/>
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1 pt-1">
        <Button size="sm" variant="outline"
                onClick={add}
                className="h-6 text-xs bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
          <Plus className="w-3 h-3 mr-1"/>Custom
        </Button>
        {SESSION_PRESETS.map(p => (
          <Button key={p.label} size="sm" variant="outline"
                  onClick={() => applyPreset(p)}
                  className={`h-6 text-xs ${p.cls}`}>
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function GroupCard({ group, allGroups, allAccounts, allStrategies, onUpdate, onDelete,
                    onAddMember, onDeleteMember, onDuplicate, groupIndex }) {
  const [edit, setEdit] = useState({
    name: group.name || "",
    rotate_after_wins: group.rotate_after_wins || "",
    rotate_after_losses: group.rotate_after_losses || "",
    rotate_after_profit: group.rotate_after_profit || "",
    rotate_after_loss_pnl: group.rotate_after_loss_pnl || "",
    min_active_count: group.min_active_count || 1,
    next_group_id: group.next_group_id || "",
    active: group.active !== false,
    time_windows: group.time_windows || [],
    schedule_label: group.schedule_label || "",
  });
  const [dirty, setDirty] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newAcctId, setNewAcctId] = useState("");
  const [newMult, setNewMult] = useState(1.0);

  const set = (k, v) => { setEdit(prev => ({...prev, [k]: v})); setDirty(true); };
  const setWindows = (w) => set("time_windows", w);

  const save = async () => {
    const payload = {};
    for (const [k, v] of Object.entries(edit)) {
      if (v === "" && ["rotate_after_wins","rotate_after_losses","rotate_after_profit","rotate_after_loss_pnl","next_group_id"].includes(k)) {
        payload[k] = null;
      } else {
        payload[k] = v;
      }
    }
    await onUpdate(group.id, payload);
    setDirty(false);
  };

  const memberAccounts = (group.members || []).map(m => ({
    ...m, account: allAccounts.find(a => a.id === m.account_id),
  }));
  const boundStrategies = allStrategies.filter(s => s.default_group_id === group.id);
  const nextGroup = group.next_group_id ? allGroups.find(g => g.id === group.next_group_id) : null;

  // Format rotation rules as readable summary
  const rules = [];
  if (edit.rotate_after_wins) rules.push(`${edit.rotate_after_wins} wins`);
  if (edit.rotate_after_losses) rules.push(`${edit.rotate_after_losses} losses`);
  if (edit.rotate_after_profit) rules.push(`+$${edit.rotate_after_profit}`);
  if (edit.rotate_after_loss_pnl) rules.push(`−$${edit.rotate_after_loss_pnl}`);
  const rulesSummary = rules.length ? rules.join(" · ") : "no triggers";

  // Right-click quick actions on the group card. Task #189.
  const nameInputRef = useRef(null);
  const { menuProps, menu } = useContextMenu([
    { header: `Group ${String.fromCharCode(65 + groupIndex)} · ${edit.name || "(unnamed)"}` },
    { label: "Rename", icon: <Pencil className="w-4 h-4"/>, onClick: () => nameInputRef.current?.focus() },
    { label: edit.active ? "Pause" : "Activate",
      icon: <Power className="w-4 h-4"/>,
      onClick: () => { set("active", !edit.active); setTimeout(save, 0); } },
    { label: "Duplicate", icon: <Copy className="w-4 h-4"/>,
      onClick: () => onDuplicate?.(group) },
    { separator: true },
    { label: "Delete group", icon: <Trash2 className="w-4 h-4"/>,
      danger: true, onClick: () => onDelete(group.id) },
  ]);

  return (
    <Card {...menuProps}
          title="Right-click for actions"
          className={`bg-slate-900 border-slate-800 ${!edit.active ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Badge className="bg-blue-600 text-white border-0 font-bold shrink-0 w-8 h-7 flex items-center justify-center text-base">
              {String.fromCharCode(65 + groupIndex)}
            </Badge>
            <Users className="w-5 h-5 text-blue-500 shrink-0"/>
            {/* Group name — click to edit. Subtle border on hover / focus
                so users know it's editable. Autosaves on blur so a rename
                sticks even if they forget to hit "Save changes" below. */}
            <Input
              ref={nameInputRef}
              value={edit.name}
              onChange={e => set("name", e.target.value)}
              onBlur={() => { if (dirty) save(); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
              title="Click to rename · right-click for more"
              placeholder="Group name"
              className="bg-transparent border border-transparent hover:border-slate-700 focus:border-blue-500 text-white text-xl font-bold px-2 h-9 rounded-md focus-visible:ring-0 min-w-0 transition-colors"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm"
                    onClick={() => set("active", !edit.active)}
                    className={edit.active
                      ? "h-7 bg-emerald-600 hover:bg-emerald-700 text-white border-0 font-semibold"
                      : "h-7 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600"}>
              {edit.active ? "● Active" : "○ Paused"}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onDelete(group.id)} className="h-7 w-7">
              <Trash2 className="w-4 h-4 text-red-500"/>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {/* Section 1: TIME */}
        <div className="border-l-2 border-blue-500 pl-3">
          <div className="text-xs uppercase tracking-wider text-white font-semibold mb-2 flex items-center gap-1">
            <Clock className="w-3 h-3"/> Time — when this group is allowed to trade
          </div>
          <TimeWindowsEditor windows={edit.time_windows} onChange={setWindows}/>
        </div>

        {/* Section 2: STRATEGY */}
        <div className="border-l-2 border-purple-500 pl-3">
          <div className="text-xs uppercase tracking-wider text-white font-semibold mb-2 flex items-center gap-1">
            <BookOpen className="w-3 h-3"/> Strategy — Pine indicators firing into this group
          </div>
          {boundStrategies.length === 0 ? (
            <div className="text-xs text-slate-500">
              No strategies bound. Go to Strategies page → edit a strategy → set default_group_id to bind.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {boundStrategies.map(s => (
                <Badge key={s.id} variant="outline"
                       className="bg-purple-500/10 text-purple-300 border-purple-500/30 text-xs">
                  <Zap className="w-2.5 h-2.5 mr-1"/>{s.name}
                  {s.broker_format && <span className="ml-1 text-slate-500">({s.broker_format})</span>}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: PROP FIRMS / ACCOUNTS */}
        <div className="border-l-2 border-emerald-500 pl-3">
          <div className="text-xs uppercase tracking-wider text-white font-semibold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1"><UserPlus className="w-3 h-3"/> Prop Firms — accounts in this group ({memberAccounts.length})</span>
            <Button size="sm" variant="outline" onClick={() => setAddingMember(!addingMember)}
                    className="h-6 text-xs bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-white">
              {addingMember ? "Cancel" : "+ Add"}
            </Button>
          </div>
          {addingMember && (
            <div className="mb-2 p-2 bg-slate-800 rounded-md space-y-2">
              <Select value={newAcctId} onValueChange={setNewAcctId}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-8">
                  <SelectValue placeholder="Pick an account"/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  {allAccounts
                    .filter(a => !memberAccounts.some(m => m.account_id === a.id))
                    .map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({a.broker})</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-slate-400 text-xs">Size multiplier</Label>
                  <Input type="number" step="0.1" min="0" value={newMult}
                         onChange={e => setNewMult(+e.target.value)}
                         className="bg-slate-900 border-slate-700 text-white h-8"/>
                </div>
                <Button size="sm" onClick={async () => {
                  if (!newAcctId) return;
                  await onAddMember(group.id, { account_id: +newAcctId, multiplier: newMult });
                  setNewAcctId(""); setNewMult(1.0); setAddingMember(false);
                }} className="bg-blue-600 hover:bg-blue-700 self-end">Add</Button>
              </div>
            </div>
          )}
          <div className="space-y-1">
            {memberAccounts.length === 0 && (
              <div className="text-xs text-slate-500">No accounts yet.</div>
            )}
            {memberAccounts.map(m => {
              const acc = m.account;
              const stateColor = acc?.state === "active" ? "text-green-400" :
                                 acc?.state === "cooled" ? "text-blue-400" :
                                 acc?.state === "stopped" ? "text-red-400" :
                                 acc?.state === "benched" ? "text-slate-300" : "text-slate-400";
              return (
                <div key={m.id} className="flex items-center justify-between text-sm bg-slate-800/50 rounded px-2 py-1">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs ${stateColor}`}>●</span>
                    <span className="text-slate-200 truncate">{acc?.name || `#${m.account_id}`}</span>
                    {acc?.broker && <span className="text-[10px] text-slate-500">{acc.broker}</span>}
                    <span className="text-xs text-slate-500 ml-auto">×{m.multiplier}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-5 w-5 ml-1"
                          onClick={() => onDeleteMember(group.id, m.id)}>
                    <Trash2 className="w-3 h-3 text-red-500"/>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Section 4: RULES */}
        <div className="border-l-2 border-red-500 pl-3">
          <div className="text-xs uppercase tracking-wider text-white font-semibold mb-2 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-red-400"/> Rules — rotate when any trigger hits
            <span className="ml-auto text-slate-400 normal-case font-normal">Currently: {rulesSummary}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 text-xs">
            <div>
              <Label className="text-slate-500 text-[10px]">Wins</Label>
              <Input type="number" min="0" value={edit.rotate_after_wins}
                     onChange={e => set("rotate_after_wins", e.target.value ? +e.target.value : "")}
                     placeholder="—" className="bg-slate-800 border-slate-700 text-white h-7"/>
            </div>
            <div>
              <Label className="text-slate-500 text-[10px]">Losses</Label>
              <Input type="number" min="0" value={edit.rotate_after_losses}
                     onChange={e => set("rotate_after_losses", e.target.value ? +e.target.value : "")}
                     placeholder="—" className="bg-slate-800 border-slate-700 text-white h-7"/>
            </div>
            <div>
              <Label className="text-slate-500 text-[10px]">Win $</Label>
              <Input type="number" min="0" value={edit.rotate_after_profit}
                     onChange={e => set("rotate_after_profit", e.target.value ? +e.target.value : "")}
                     placeholder="500" className="bg-slate-800 border-slate-700 text-white h-7"/>
            </div>
            <div>
              <Label className="text-slate-500 text-[10px]">Loss $</Label>
              <Input type="number" min="0" value={edit.rotate_after_loss_pnl}
                     onChange={e => set("rotate_after_loss_pnl", e.target.value ? +e.target.value : "")}
                     placeholder="500" className="bg-slate-800 border-slate-700 text-white h-7"/>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Label className="text-slate-500 text-[10px]">Min active accounts</Label>
            <Input type="number" min="1" value={edit.min_active_count}
                   onChange={e => set("min_active_count", +e.target.value)}
                   className="bg-slate-800 border-slate-700 text-white h-7 w-16"/>
          </div>
        </div>

        {/* Section 5: CASCADE CHAIN */}
        <div className="border-l-2 border-teal-500 pl-3">
          <div className="text-xs uppercase tracking-wider text-white font-semibold mb-2 flex items-center gap-1">
            <Link2 className="w-3 h-3"/> Rotate Groups — chain to next when exhausted
          </div>
          <Select value={String(edit.next_group_id || "")}
                  onValueChange={v => set("next_group_id", v ? +v : "")}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-8">
              <SelectValue placeholder="(stop here — no cascade)"/>
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-white">
              <SelectItem value="">(stop here — no cascade)</SelectItem>
              {allGroups.filter(g => g.id !== group.id).map(g => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-2">
            <CascadeChain startGroupId={group.id} allGroups={allGroups}/>
          </div>
        </div>

        {dirty && (
          <Button size="sm" onClick={save} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold ring-2 ring-blue-400 shadow-lg shadow-blue-500/30 animate-pulse">
            <Save className="w-3 h-3 mr-1"/>Save Changes
          </Button>
        )}
      </CardContent>
      {menu}
    </Card>
  );
}

function NewGroupDialog({ open, onOpenChange, onCreate }) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader><DialogTitle>New Group</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label className="text-slate-300">Group Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)}
                 placeholder="e.g. Auto Rotation, Big Risk, London Session"
                 className="bg-slate-700 border-slate-600 text-white"/>
          <p className="text-xs text-slate-500">
            After creating, add rotation rules + time windows + prop firm accounts + chain to next group.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={async () => {
            if (!name.trim()) return;
            await onCreate({ name: name.trim(), active: true });
            setName(""); onOpenChange(false);
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RotationPage() {
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [gs, as, ss] = await Promise.all([Group.list(), Account.list(), Strategy.list().catch(() => [])]);
    setGroups(gs); setAccounts(as); setStrategies(ss); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleUpdate = async (id, payload) => { await Group.update(id, payload); load(); };
  const handleDelete = async (id) => {
    if (window.confirm("Delete this group? Its accounts stay but are un-grouped.")) {
      await Group.delete(id); load();
    }
  };
  const handleAddMember = async (groupId, payload) => { await Group.addMember(groupId, payload); load(); };
  const handleDeleteMember = async (groupId, memberId) => { await Group.deleteMember(groupId, memberId); load(); };
  const handleCreate = async (payload) => { await Group.create(payload); load(); };
  const handleDuplicate = async (g) => {
    // Clone group settings but not member accounts — user picks who joins the copy.
    const {
      id, members, next_group_id, // strip identity + wiring
      ...rest
    } = g;
    await Group.create({ ...rest, name: `${g.name || "Group"} (copy)` });
    load();
  };

  const groupedAcctIds = new Set(groups.flatMap(g => (g.members || []).map(m => m.account_id)));
  const standalone = accounts.filter(a => !groupedAcctIds.has(a.id));

  // Find any groups that are "roots" of a cascade chain (nothing else cascades INTO them)
  const cascadedInto = new Set(groups.map(g => g.next_group_id).filter(Boolean));
  const rootGroups = groups.filter(g => !cascadedInto.has(g.id));

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Repeat className="w-8 h-8 text-blue-500"/> Group Your Trades
            </h1>
            <p className="text-slate-400 mt-1">
              Each group ties together a <span className="text-white font-semibold">time window</span>, a <span className="text-white font-semibold">strategy</span>, and one or more <span className="text-white font-semibold">prop-firm accounts</span> — with rotation rules that cascade Group A → B → C when limits hit.
            </p>
          </div>
          <Button onClick={() => setNewGroupOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2"/>New Group
          </Button>
        </div>

        {/* Cascade chains overview */}
        {rootGroups.length > 0 && groups.length > 1 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="text-xs uppercase text-slate-500 font-semibold mb-2">Your Rotation Chains</div>
              <div className="space-y-2">
                {rootGroups.map(root => (
                  <div key={root.id} className="flex items-center gap-2">
                    <CascadeChain startGroupId={root.id} allGroups={groups}/>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Groups */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-slate-500 text-center py-8">Loading…</div>
          ) : groups.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800 border-dashed">
              <CardContent className="p-8 text-center text-slate-400">
                No groups yet. Click "New Group" to start.
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {groups.map((g, i) => (
                <GroupCard key={g.id}
                           group={g} groupIndex={i}
                           allGroups={groups} allAccounts={accounts} allStrategies={strategies}
                           onUpdate={handleUpdate} onDelete={handleDelete}
                           onAddMember={handleAddMember} onDeleteMember={handleDeleteMember}
                           onDuplicate={handleDuplicate}/>
              ))}
            </div>
          )}
        </div>

        {/* Standalone accounts */}
        {standalone.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
              <Users className="w-5 h-5"/>Standalone Accounts ({standalone.length})
              <span className="text-sm font-normal text-slate-500">— not in any group, each uses its own webhook via Strategies page</span>
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {standalone.map(a => (
                <div key={a.id} className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-white font-medium">{a.name}</div>
                    <div className="text-xs text-slate-500">{a.broker} · {a.env}</div>
                  </div>
                  <Badge variant="outline" className="bg-slate-800 text-slate-400 border-slate-700 text-xs">standalone</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <NewGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} onCreate={handleCreate}/>
    </div>
  );
}
