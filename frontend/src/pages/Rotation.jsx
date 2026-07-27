import React, { useState, useEffect, useMemo } from "react";
import { Group, Account } from "@/entities/all";
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
  Users, ArrowRight, Plus, Trash2, Zap, Repeat, ChevronRight, Trophy,
  ShieldAlert, Clock, Link2, UserPlus, Save
} from "lucide-react";

// Config panel for one group — inline edit of all rotation fields
function GroupCard({ group, allGroups, allAccounts, onUpdate, onDelete, onAddMember, onDeleteMember }) {
  const [edit, setEdit] = useState({
    name: group.name || "",
    rotate_after_wins: group.rotate_after_wins || "",
    rotate_after_losses: group.rotate_after_losses || "",
    rotate_after_profit: group.rotate_after_profit || "",
    rotate_after_loss_pnl: group.rotate_after_loss_pnl || "",
    min_active_count: group.min_active_count || 1,
    next_group_id: group.next_group_id || "",
    active: group.active !== false,
  });
  const [dirty, setDirty] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newAcctId, setNewAcctId] = useState("");
  const [newMult, setNewMult] = useState(1.0);

  const nextGroup = group.next_group_id
    ? allGroups.find(g => g.id === group.next_group_id)
    : null;

  const set = (k, v) => { setEdit(prev => ({...prev, [k]: v})); setDirty(true); };

  const save = async () => {
    // Normalize empty strings to null so the backend doesn't get "" for numeric fields
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
    ...m,
    account: allAccounts.find(a => a.id === m.account_id),
  }));

  return (
    <Card className={`bg-slate-900 border-slate-800 ${!edit.active ? "opacity-60" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-500"/>
            <Input
              value={edit.name}
              onChange={e => set("name", e.target.value)}
              className="bg-transparent border-0 text-white text-xl font-bold p-0 h-auto focus-visible:ring-0"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={edit.active ? "outline" : "ghost"}
                    onClick={() => set("active", !edit.active)}
                    className={edit.active
                      ? "text-green-400 border-green-500/30"
                      : "text-slate-500"}>
              {edit.active ? "🟢 Active" : "⚪ Paused"}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => onDelete(group.id)}>
              <Trash2 className="w-4 h-4 text-red-500"/>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rotation triggers */}
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold mb-2 flex items-center gap-1">
            <Repeat className="w-3 h-3"/> Rotation Triggers (any one fires cascade)
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <Label className="text-slate-400 text-xs">After N wins</Label>
              <Input type="number" min="0" value={edit.rotate_after_wins}
                     onChange={e => set("rotate_after_wins", e.target.value ? +e.target.value : "")}
                     placeholder="—"
                     className="bg-slate-800 border-slate-700 text-white h-8"/>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">After N losses</Label>
              <Input type="number" min="0" value={edit.rotate_after_losses}
                     onChange={e => set("rotate_after_losses", e.target.value ? +e.target.value : "")}
                     placeholder="—"
                     className="bg-slate-800 border-slate-700 text-white h-8"/>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">$ profit cap</Label>
              <Input type="number" min="0" value={edit.rotate_after_profit}
                     onChange={e => set("rotate_after_profit", e.target.value ? +e.target.value : "")}
                     placeholder="e.g. 500"
                     className="bg-slate-800 border-slate-700 text-white h-8"/>
            </div>
            <div>
              <Label className="text-slate-400 text-xs">$ loss cap</Label>
              <Input type="number" min="0" value={edit.rotate_after_loss_pnl}
                     onChange={e => set("rotate_after_loss_pnl", e.target.value ? +e.target.value : "")}
                     placeholder="e.g. 500"
                     className="bg-slate-800 border-slate-700 text-white h-8"/>
            </div>
          </div>
          <div className="mt-2">
            <Label className="text-slate-400 text-xs">Min active accounts</Label>
            <Input type="number" min="1" value={edit.min_active_count}
                   onChange={e => set("min_active_count", +e.target.value)}
                   className="bg-slate-800 border-slate-700 text-white h-8 w-24"/>
          </div>
        </div>

        {/* Cascade target */}
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold mb-1 flex items-center gap-1">
            <ArrowRight className="w-3 h-3"/> When exhausted → cascade to
          </div>
          <Select value={String(edit.next_group_id || "")}
                  onValueChange={v => set("next_group_id", v ? +v : "")}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-9">
              <SelectValue placeholder="(none — stop here)"/>
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700 text-white">
              <SelectItem value="">(none — stop here)</SelectItem>
              {allGroups.filter(g => g.id !== group.id).map(g => (
                <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nextGroup && (
            <div className="mt-2 flex items-center gap-2 text-sm text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-md px-3 py-2">
              <Link2 className="w-3 h-3"/>
              Next up: <span className="font-semibold">{nextGroup.name}</span>
            </div>
          )}
        </div>

        {/* Members */}
        <div>
          <div className="text-xs uppercase text-slate-500 font-semibold mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1"><UserPlus className="w-3 h-3"/> Accounts in this group ({memberAccounts.length})</span>
            <Button size="sm" variant="outline" onClick={() => setAddingMember(!addingMember)} className="h-7 text-xs">
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
              <div className="text-xs text-slate-500 text-center py-3">No accounts in this group yet.</div>
            )}
            {memberAccounts.map(m => {
              const acc = m.account;
              const stateColor = acc?.state === "active" ? "text-green-400" :
                                 acc?.state === "cooled" ? "text-blue-400" :
                                 acc?.state === "stopped" ? "text-red-400" :
                                 acc?.state === "benched" ? "text-yellow-400" : "text-slate-400";
              return (
                <div key={m.id} className="flex items-center justify-between text-sm bg-slate-800/50 rounded px-2 py-1.5">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className={`text-xs ${stateColor}`}>●</span>
                    <span className="text-slate-200 truncate">{acc?.name || `#${m.account_id}`}</span>
                    <span className="text-xs text-slate-500">×{m.multiplier}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-6 w-6"
                          onClick={() => onDeleteMember(group.id, m.id)}>
                    <Trash2 className="w-3 h-3 text-red-500"/>
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {dirty && (
          <Button size="sm" onClick={save} className="w-full bg-blue-600 hover:bg-blue-700">
            <Save className="w-3 h-3 mr-1"/>Save Changes
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// New Group creation form
function NewGroupDialog({ open, onOpenChange, onCreate }) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader><DialogTitle>New Group</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label className="text-slate-300">Group Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)}
                 placeholder="e.g. group1_auto, group2_manual, big_risk"
                 className="bg-slate-700 border-slate-600 text-white"/>
          <p className="text-xs text-slate-500">
            Groups fan-out signals to their active accounts. Configure rotation triggers + cascade after creation.
          </p>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button className="bg-blue-600 hover:bg-blue-700" onClick={async () => {
            if (!name.trim()) return;
            await onCreate({ name: name.trim(), active: true });
            setName("");
            onOpenChange(false);
          }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RotationPage() {
  const [groups, setGroups] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [gs, as] = await Promise.all([Group.list(), Account.list()]);
    setGroups(gs); setAccounts(as); setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleUpdate = async (id, payload) => {
    await Group.update(id, payload);
    load();
  };
  const handleDelete = async (id) => {
    if (window.confirm("Delete this group? Members' accounts stay, they just won't belong to any group.")) {
      await Group.delete(id);
      load();
    }
  };
  const handleAddMember = async (groupId, payload) => {
    await Group.addMember(groupId, payload);
    load();
  };
  const handleDeleteMember = async (groupId, memberId) => {
    await Group.deleteMember(groupId, memberId);
    load();
  };
  const handleCreate = async (payload) => {
    await Group.create(payload);
    load();
  };

  // Accounts not in any group — standalone accounts (each gets its own routing)
  const groupedAcctIds = new Set(
    groups.flatMap(g => (g.members || []).map(m => m.account_id))
  );
  const standalone = accounts.filter(a => !groupedAcctIds.has(a.id));

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Repeat className="w-8 h-8 text-blue-500"/> Group Your Trades
            </h1>
            <p className="text-slate-400 mt-1">
              Rotate accounts within a group, chain groups together, or keep accounts standalone.
              <span className="text-slate-500 block text-sm mt-1">
                Same webhook can fan out to a group — OR each account can have its own webhook via the Strategies page.
              </span>
            </p>
          </div>
          <Button onClick={() => setNewGroupOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-2"/>New Group
          </Button>
        </div>

        {/* Legend explaining the concept */}
        <Card className="bg-slate-900 border-slate-800 border-l-4 border-l-blue-500">
          <CardContent className="p-4 text-sm text-slate-300 grid md:grid-cols-3 gap-3">
            <div className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-blue-400 mt-0.5 shrink-0"/>
              <div><strong className="text-white">Group with rotation</strong> — one webhook fans out to N accounts, rotates when triggers fire</div>
            </div>
            <div className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 text-purple-400 mt-0.5 shrink-0"/>
              <div><strong className="text-white">Chain groups</strong> — Group1 exhausts → cascades to Group2 → Group3</div>
            </div>
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-slate-400 mt-0.5 shrink-0"/>
              <div><strong className="text-white">Standalone</strong> — accounts not in any group get their own webhook via Strategies page</div>
            </div>
          </CardContent>
        </Card>

        {/* Groups */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
            <Users className="w-5 h-5"/>Groups ({groups.length})
          </h2>
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
              {groups.map(g => (
                <GroupCard key={g.id}
                           group={g}
                           allGroups={groups}
                           allAccounts={accounts}
                           onUpdate={handleUpdate}
                           onDelete={handleDelete}
                           onAddMember={handleAddMember}
                           onDeleteMember={handleDeleteMember}/>
              ))}
            </div>
          )}
        </div>

        {/* Standalone accounts */}
        {standalone.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-300 flex items-center gap-2">
              <Users className="w-5 h-5"/>Standalone Accounts ({standalone.length})
              <span className="text-sm font-normal text-slate-500">— not in any group, each uses its own webhook</span>
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
