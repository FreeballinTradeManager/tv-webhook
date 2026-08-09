import React, { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, ArrowUp, ArrowDown, Clock, Plus, X, ShieldCheck, Save } from "lucide-react";
import { Account } from "@/entities/all";
import { api } from "@/lib/api";
import { getGroupConfig, setGroupConfig, moveInCascade, defaultCascadeFrom, currentMasterFor, pickCurrentAccount, accountHitTarget } from "@/lib/group_config";
import { loadProfiles } from "@/lib/rule_profiles";
import { seedBusinessGroupConfig } from "@/lib/seed_business_group";

// AccountGroupsCard — customizable per-group rotation config.
// Rule Profile · Time Masters · Cascade order · Uses per account
//
// Fully local (localStorage). Backend routing will read these fields
// once wired; until then, the card is the source of truth and the
// "Current master" calculator answers "who fires right now?" live.
export default function AccountGroupsCard() {
  const [groups, setGroups]     = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [g, a] = await Promise.all([
          api("/api/groups").catch(() => []),
          Account.list("-created_date").catch(() => []),
        ]);
        setGroups(Array.isArray(g) ? g : (g?.groups || []));
        setAccounts(a || []);
        setProfiles(loadProfiles());
      } finally { setLoading(false); }
    })();
  }, []);

  if (loading) {
    return <Card className="bg-slate-900 border-slate-800"><CardContent className="p-6 text-slate-400 text-sm">Loading groups…</CardContent></Card>;
  }
  if (groups.length === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader><CardTitle className="text-white flex items-center gap-2"><Users className="w-5 h-5 text-blue-400"/>Account Groups</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-400">
          No groups yet. Create groups via the Rotation page's existing controls, then come back here to add Rule Profiles, time-based masters, and custom cascade order.
        </CardContent>
      </Card>
    );
  }

  // Find a group named "Business" so the one-click seed can attach to it.
  const businessGroup = groups.find(g => g.name?.toLowerCase() === "business");
  const businessMembers = accounts.filter(a =>
    (a.group_id === businessGroup?.id) || (a.group === businessGroup?.name)
  );
  const canSeedBusiness = businessGroup && businessMembers.length >= 2;

  const doSeedBusiness = () => {
    if (!businessGroup) {
      alert("Create a group named 'Business' first (New Group button above), attach 5 accounts, then click Seed Business.");
      return;
    }
    if (businessMembers.length < 2) {
      alert(`Business group needs at least 2 accounts to seed masters. Currently has ${businessMembers.length}. Add accounts on the Rotation page first.`);
      return;
    }
    const memberIds = businessMembers.map(a => a.id);
    seedBusinessGroupConfig(businessGroup.id, memberIds);
    alert(
      `Seeded Business group config:\n` +
      `  · ${businessMembers[0]?.name} = master 18:00–01:00 ET\n` +
      (businessMembers[1] ? `  · ${businessMembers[1].name} = master 11:45–15:00 ET\n` : "") +
      (businessMembers.slice(2).length > 0
        ? `  · Cascade: ${businessMembers.slice(2).map(a => a.name).join(" → ")}\n`
        : "") +
      `\nAttach a Rule Profile below to enforce profit-target rotation.`
    );
    window.location.reload();
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400"/>Account Groups — Custom Rotation
          </span>
          <Button size="sm" variant="outline" onClick={doSeedBusiness}
                  className={canSeedBusiness ? "text-emerald-300 border-emerald-500/40 hover:bg-emerald-950/30" : "text-slate-500"}
                  title={canSeedBusiness
                    ? "Seed acct 1 = 18:00–01:00 master, acct 2 = 11:45–15:00 master, rest cascade"
                    : "Create a group named 'Business' with ≥2 accounts first"}>
            Seed Business
          </Button>
        </CardTitle>
        <p className="text-xs text-slate-400 mt-1">
          Attach a saved Rule Profile per group. Set time-based masters (e.g. Business: acct 1 master 18:00–01:00, acct 2 master 11:45–15:00). Reorder cascade. Cap uses per account before rotating.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map(g => (
          <GroupRow key={g.id} group={g} accounts={accounts} profiles={profiles}/>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupRow({ group, accounts, profiles }) {
  const memberAccounts = useMemo(
    () => accounts.filter(a => (a.group_id === group.id) || (a.group === group.name)),
    [accounts, group]
  );

  const [cfg, setCfgState] = useState(() => {
    const stored = getGroupConfig(group.id);
    if (!stored.cascade_order?.length && memberAccounts.length > 0) {
      stored.cascade_order = defaultCascadeFrom(memberAccounts);
    }
    return stored;
  });

  const commit = (next) => {
    const merged = { ...cfg, ...next };
    setGroupConfig(group.id, merged);
    setCfgState(merged);
  };

  const now = new Date();
  const nyH = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const nyM = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", minute: "numeric" }));

  const attachedProfile = profiles.find(p => p.id === cfg.rule_profile_id);
  const usesFromProfile = attachedProfile?.uses_per_account || 1;
  const effectiveUses = cfg.uses_per_account > 0 ? cfg.uses_per_account : usesFromProfile;

  // pickCurrentAccount respects: time-master → profit-target-hit skip → cascade order
  const activeId = pickCurrentAccount(cfg, memberAccounts, attachedProfile, nyH, nyM);
  const activeAccount = memberAccounts.find(a => a.id === activeId);
  const timeMasterId = currentMasterFor(cfg, nyH, nyM);
  const timeMasterAcct = memberAccounts.find(a => a.id === timeMasterId);
  const skippedBecauseTargetHit = timeMasterId && timeMasterId !== activeId && accountHitTarget(timeMasterAcct, attachedProfile);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
      {/* Header — group name + live master + member count */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-white font-semibold text-base flex items-center gap-2">
            {group.name}
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-normal">
              {memberAccounts.length} member{memberAccounts.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Next signal fires on: <span className="text-emerald-300 font-semibold">{activeAccount?.name || "— none eligible —"}</span>
            {" · "}
            Uses/account: <span className="text-white">{effectiveUses}×</span>
          </div>
          {skippedBecauseTargetHit && (
            <div className="text-[10px] text-amber-400 mt-1">
              ⓘ {timeMasterAcct?.name} hit profit target — skipped, cascaded to {activeAccount?.name || "next"}.
            </div>
          )}
        </div>
      </div>

      {/* Rule Profile picker */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <ShieldCheck className="w-3 h-3"/>Rule Profile
          </Label>
          <Select value={cfg.rule_profile_id || "__none"}
                  onValueChange={v => commit({ rule_profile_id: v === "__none" ? "" : v })}>
            <SelectTrigger className="bg-slate-900 border-slate-800 text-white">
              <SelectValue placeholder="No profile attached"/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-64">
              <SelectItem value="__none">— No profile —</SelectItem>
              {profiles.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {attachedProfile && (
            <div className="text-[10px] text-slate-500 mt-1">
              {attachedProfile.mode} · Target ${attachedProfile.profit_target?.toLocaleString?.() || 0}
              {attachedProfile.consistency_on ? " · consistency ON" : ""}
            </div>
          )}
        </div>
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">
            Override uses/account (0 = inherit)
          </Label>
          <Select value={String(cfg.uses_per_account || 0)}
                  onValueChange={v => commit({ uses_per_account: Number(v) })}>
            <SelectTrigger className="bg-slate-900 border-slate-800 text-white">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 text-white">
              <SelectItem value="0">Inherit ({usesFromProfile}×)</SelectItem>
              <SelectItem value="1">1×</SelectItem>
              <SelectItem value="2">2×</SelectItem>
              <SelectItem value="3">3×</SelectItem>
              <SelectItem value="5">5×</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Time-based masters */}
      <TimeMastersEditor
        masters={cfg.time_masters || []}
        accounts={memberAccounts}
        onChange={(next) => commit({ time_masters: next })}
      />

      {/* Cascade order */}
      <CascadeEditor
        order={cfg.cascade_order || []}
        accounts={memberAccounts}
        profile={attachedProfile}
        onChange={(next) => commit({ cascade_order: next })}
      />

      {/* Notes */}
      <div>
        <Label className="text-xs text-slate-400 uppercase tracking-wider">Notes</Label>
        <Input value={cfg.notes || ""} onChange={e => commit({ notes: e.target.value })}
               placeholder="e.g. Business — Big-risk overnight master, day session master, then cascade"
               className="bg-slate-900 border-slate-800 text-white"/>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Time Masters — list of {start, end, account}
// ---------------------------------------------------------------------
function TimeMastersEditor({ masters, accounts, onChange }) {
  const add = () => {
    onChange([...(masters || []), { start_hh: 18, start_mm: 0, end_hh: 1, end_mm: 0, account_id: accounts[0]?.id || "" }]);
  };
  const remove = (idx) => onChange(masters.filter((_, i) => i !== idx));
  const update = (idx, patch) => onChange(masters.map((m, i) => i === idx ? { ...m, ...patch } : m));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-slate-300 font-semibold flex items-center gap-1">
          <Clock className="w-3 h-3"/>Time-based masters
        </Label>
        <Button size="sm" variant="outline" onClick={add} className="h-7 text-xs">
          <Plus className="w-3 h-3 mr-1"/>Add window
        </Button>
      </div>
      {masters.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic">
          No windows set — cascade order below is used top-to-bottom regardless of time.
        </div>
      ) : (
        <div className="space-y-2">
          {masters.map((m, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto_2fr_auto] items-center gap-2 bg-slate-950 border border-slate-800 rounded px-2 py-1.5">
              <TimeCell hh={m.start_hh} mm={m.start_mm}
                        onChange={(hh, mm) => update(i, { start_hh: hh, start_mm: mm })}/>
              <span className="text-slate-500 text-xs">→</span>
              <TimeCell hh={m.end_hh} mm={m.end_mm}
                        onChange={(hh, mm) => update(i, { end_hh: hh, end_mm: mm })}/>
              <span className="text-slate-500 text-[10px] uppercase tracking-wider">acct</span>
              <Select value={m.account_id || ""} onValueChange={v => update(i, { account_id: v })}>
                <SelectTrigger className="h-8 text-xs bg-slate-900 border-slate-800 text-white">
                  <SelectValue placeholder="pick"/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-64">
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => remove(i)} className="text-slate-500 hover:text-red-400" title="Remove">
                <X className="w-3.5 h-3.5"/>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
        Wrap-around supported — e.g. 18:00 → 01:00 covers overnight.
      </div>
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

// ---------------------------------------------------------------------
// Cascade order — reorderable list of accounts
// ---------------------------------------------------------------------
function CascadeEditor({ order, accounts, onChange, profile }) {
  // Merge in any group members that aren't in the order yet
  const knownIds = new Set(order);
  const missing = accounts.filter(a => !knownIds.has(a.id)).map(a => a.id);
  const fullOrder = [...order.filter(id => accounts.some(a => a.id === id)), ...missing];
  const byId = Object.fromEntries(accounts.map(a => [a.id, a]));

  const move = (from, to) => onChange(moveInCascade(fullOrder, from, to));

  return (
    <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
      <Label className="text-xs text-slate-300 font-semibold">Cascade order (top → bottom)</Label>
      {fullOrder.length === 0 ? (
        <div className="text-[11px] text-slate-500 italic">No accounts in this group yet.</div>
      ) : (
        <div className="space-y-1">
          {fullOrder.map((id, idx) => {
            const a = byId[id];
            if (!a) return null;
            const targetHit = accountHitTarget(a, profile);
            const stopped = a.state === "stopped" || a.state === "benched";
            return (
              <div key={id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs border ${
                targetHit ? "bg-emerald-500/5 border-emerald-500/30"
                : stopped ? "bg-red-500/5 border-red-500/30"
                : "bg-slate-950 border-slate-800"}`}>
                <span className="text-slate-500 w-6 text-right">{idx + 1}.</span>
                <span className="flex-1 text-white">{a.name}</span>
                {typeof a.pnl_today === "number" && (
                  <span className={`text-[10px] font-mono ${a.pnl_today >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {a.pnl_today >= 0 ? "+" : ""}${a.pnl_today.toFixed(0)}
                  </span>
                )}
                {targetHit && (
                  <span className="text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-500/40 rounded px-1.5 py-0.5">
                    ✓ target hit
                  </span>
                )}
                {stopped && (
                  <span className="text-[10px] uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-1.5 py-0.5">
                    {a.state}
                  </span>
                )}
                <button disabled={idx === 0} onClick={() => move(idx, idx - 1)}
                        className={`p-1 rounded ${idx === 0 ? "text-slate-700 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
                        title="Move up">
                  <ArrowUp className="w-3.5 h-3.5"/>
                </button>
                <button disabled={idx === fullOrder.length - 1} onClick={() => move(idx, idx + 1)}
                        className={`p-1 rounded ${idx === fullOrder.length - 1 ? "text-slate-700 cursor-not-allowed" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
                        title="Move down">
                  <ArrowDown className="w-3.5 h-3.5"/>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
        Rotation: when the master account hits its profit target, next signal auto-cascades to the next eligible row.
      </div>
    </div>
  );
}
