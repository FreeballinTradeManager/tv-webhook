import React, { useState, useEffect } from "react";
import { Vault } from "@/entities/all";
import VaultLock from "@/components/VaultLock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  KeyRound, Plus, Eye, EyeOff, Copy, Trash2, Star, ExternalLink, Shield
} from "lucide-react";

const CATEGORIES = [
  { value: "prop_firm", label: "Prop Firm", color: "bg-purple-500/10 text-purple-400 border-purple-500/30" },
  { value: "broker", label: "Broker", color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  { value: "tradingview", label: "TradingView", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30" },
  { value: "exchange", label: "Exchange", color: "bg-slate-800 text-slate-200 border-slate-600" },
  { value: "email", label: "Email", color: "bg-green-500/10 text-green-400 border-green-500/30" },
  { value: "other", label: "Other", color: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
];

function VaultEntryForm({ entry, onSave }) {
  const [form, setForm] = useState(entry || {
    label: "", category: "prop_firm", url: "", username: "", password: "", notes: "", is_favorite: false,
  });
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <div className="space-y-2">
        <Label className="text-slate-300">Label *</Label>
        <Input value={form.label} onChange={e => set("label", e.target.value)}
               placeholder="e.g. FTMO 100K Challenge, Tradovate Live, TradingView"
               className="bg-slate-700 border-slate-600 text-white" required/>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Category</Label>
          <Select value={form.category} onValueChange={v => set("category", v)}>
            <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue/></SelectTrigger>
            <SelectContent className="bg-slate-700 border-slate-600 text-white">
              {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Website URL</Label>
          <Input value={form.url || ""} onChange={e => set("url", e.target.value)}
                 placeholder="https://trader.ftmo.com" className="bg-slate-700 border-slate-600 text-white"/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Username / Email</Label>
          <Input value={form.username || ""} onChange={e => set("username", e.target.value)}
                 className="bg-slate-700 border-slate-600 text-white"/>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Password</Label>
          <Input type="password" value={form.password || ""} onChange={e => set("password", e.target.value)}
                 placeholder={entry ? "(leave blank to keep existing)" : ""}
                 className="bg-slate-700 border-slate-600 text-white"/>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Notes (2FA method, security questions, etc.)</Label>
        <Textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)}
                  rows={3} className="bg-slate-700 border-slate-600 text-white"/>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={!!form.is_favorite}
               onChange={e => set("is_favorite", e.target.checked)}
               id="fav" className="accent-yellow-500"/>
        <Label htmlFor="fav" className="text-slate-300 cursor-pointer">Pin as favorite</Label>
      </div>
      <DialogFooter className="pt-4">
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Save</Button>
      </DialogFooter>
    </form>
  );
}

export default function VaultPageGated() {
  return <VaultLock><VaultPageInner/></VaultLock>;
}

function VaultPageInner() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState({}); // { entryId: "plaintext" }
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState("");  // brief "Copied!" indicator

  useEffect(() => { load(); }, []);
  const load = async () => {
    setLoading(true);
    setEntries(await Vault.list());
    setLoading(false);
  };

  const handleSave = async (data) => {
    // If editing + password is empty string, don't send it (keep existing)
    if (editing && !data.password) {
      const { password, ...rest } = data;
      await Vault.update(editing.id, rest);
    } else if (editing) {
      await Vault.update(editing.id, data);
    } else {
      await Vault.create(data);
    }
    setEditing(null);
    setDialogOpen(false);
    load();
  };

  const handleReveal = async (id) => {
    if (revealed[id]) {
      // Toggle hide
      setRevealed(prev => { const n = {...prev}; delete n[id]; return n; });
      return;
    }
    try {
      const full = await Vault.reveal(id);
      setRevealed(prev => ({...prev, [id]: full.password || "(empty)"}));
    } catch (e) {
      alert(`Reveal failed: ${e.message}`);
    }
  };

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(`✓ ${label} copied`);
      setTimeout(() => setFlash(""), 1500);
    } catch (e) {
      alert("Clipboard blocked by browser — select + Cmd+C instead");
    }
  };

  const handleDelete = async (id, label) => {
    if (window.confirm(`Delete "${label}"? This can't be undone.`)) {
      await Vault.delete(id);
      load();
    }
  };

  const grouped = entries.reduce((acc, e) => {
    (acc[e.category] = acc[e.category] || []).push(e);
    return acc;
  }, {});
  // Favorites float to top within each category (server already sorts is_favorite DESC)
  const catInfo = (cat) => CATEGORIES.find(c => c.value === cat) || CATEGORIES[CATEGORIES.length-1];

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <KeyRound className="w-7 h-7 text-blue-500"/> Password Vault
            </h1>
            <p className="text-slate-400 mt-1">
              Encrypted store for prop firm portals, broker logins, TradingView, and other credentials.
              Passwords are Fernet-encrypted at rest — nothing sent to disk in plaintext.
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2"/>Add Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-[625px]">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit" : "New"} Vault Entry</DialogTitle>
              </DialogHeader>
              <VaultEntryForm entry={editing} onSave={handleSave}/>
            </DialogContent>
          </Dialog>
        </div>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-green-500/20 border border-green-500/50 text-green-400 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        <Card className="bg-slate-900 border-slate-800 border-l-4 border-l-blue-500">
          <CardContent className="p-4 text-sm text-slate-300 flex items-start gap-3">
            <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5"/>
            <div>
              <strong className="text-white">Set VAULT_KEY in Railway env</strong> to make entries survive
              restarts. Right now the server uses an ephemeral key — entries will lose their passwords on redeploy.
              Generate one with: <code className="bg-slate-800 px-1.5 py-0.5 rounded text-xs">python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"</code>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="space-y-4">{Array(3).fill(0).map((_,i) => <Skeleton key={i} className="h-32 w-full bg-slate-800"/>)}</div>
        ) : entries.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-12 text-center">
              <KeyRound className="w-12 h-12 text-slate-600 mx-auto mb-4"/>
              <p className="text-slate-400 mb-4">No entries yet.</p>
              <p className="text-sm text-slate-500">Add your prop firm portals, broker logins, and other frequently-used credentials.</p>
            </CardContent>
          </Card>
        ) : (
          Object.entries(grouped).map(([cat, list]) => {
            const info = catInfo(cat);
            return (
              <div key={cat} className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{info.label} ({list.length})</h3>
                <div className="grid gap-3">
                  {list.map(e => {
                    const isRevealed = e.id in revealed;
                    return (
                      <Card key={e.id} className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center gap-2">
                              {e.is_favorite && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500"/>}
                              <span className="font-semibold text-white text-lg">{e.label}</span>
                              <Badge variant="outline" className={info.color}>{info.label}</Badge>
                            </div>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => { setEditing(e); setDialogOpen(true); }}
                                      title="Edit">
                                <Plus className="w-4 h-4 text-slate-400 rotate-45"/>
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => handleDelete(e.id, e.label)} title="Delete">
                                <Trash2 className="w-4 h-4 text-red-500"/>
                              </Button>
                            </div>
                          </div>
                          <div className="grid md:grid-cols-2 gap-3">
                            {e.url && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-500 w-20">URL</span>
                                <a href={e.url} target="_blank" rel="noopener noreferrer"
                                   className="text-blue-400 hover:underline flex items-center gap-1 truncate">
                                  {e.url}<ExternalLink className="w-3 h-3 shrink-0"/>
                                </a>
                              </div>
                            )}
                            {e.username && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-500 w-20">Username</span>
                                <span className="text-slate-300 font-mono truncate flex-1">{e.username}</span>
                                <Button size="icon" variant="ghost" className="h-6 w-6"
                                        onClick={() => copyToClipboard(e.username, "Username")}>
                                  <Copy className="w-3 h-3 text-slate-400"/>
                                </Button>
                              </div>
                            )}
                            {e.has_password && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-slate-500 w-20">Password</span>
                                <span className="text-slate-300 font-mono truncate flex-1">
                                  {isRevealed ? revealed[e.id] : "••••••••••••"}
                                </span>
                                <Button size="icon" variant="ghost" className="h-6 w-6"
                                        onClick={() => handleReveal(e.id)} title="Reveal / hide">
                                  {isRevealed ? <EyeOff className="w-3 h-3 text-slate-400"/>
                                              : <Eye className="w-3 h-3 text-slate-400"/>}
                                </Button>
                                {isRevealed && (
                                  <Button size="icon" variant="ghost" className="h-6 w-6"
                                          onClick={() => copyToClipboard(revealed[e.id], "Password")}>
                                    <Copy className="w-3 h-3 text-slate-400"/>
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                          {e.notes && <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-400 whitespace-pre-wrap">{e.notes}</div>}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
