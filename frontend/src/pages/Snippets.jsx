import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import { Plus, Copy, Edit, Trash2, Code2, Search, FileText } from "lucide-react";
import { useContextMenu } from "@/components/RightClickMenu";

// Task #149 — General JSON snippet library.
// LocalStorage-backed for MVP so it works before backend #40 auth ships;
// once real users exist we sync the same shape into a Snippet table.

const SNIPPETS_KEY = "tradecore_snippets_v1";

const DEFAULT_SEED = [
  {
    id: 1,
    name: "MNQ Entry — Long 2ct",
    tag: "MNQ",
    body: JSON.stringify({
      action: "buy",
      symbol: "MNQ1!",
      quantity: 2,
      price: "{{close}}",
      stop_loss: "{{plot_0}}",
      take_profit: "{{plot_1}}",
    }, null, 2),
  },
  {
    id: 2,
    name: "Flatten All — Emergency",
    tag: "flatten",
    body: JSON.stringify({ action: "flatten_all", reason: "manual_emergency" }, null, 2),
  },
];

function loadSnippets() {
  try {
    const raw = localStorage.getItem(SNIPPETS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_SEED;
  } catch { return DEFAULT_SEED; }
}
function saveSnippets(list) {
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list));
}

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState(loadSnippets);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => saveSnippets(snippets), [snippets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(s =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.tag || "").toLowerCase().includes(q) ||
      (s.body || "").toLowerCase().includes(q)
    );
  }, [snippets, query]);

  const openNew = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (s) => { setEditing(s); setDialogOpen(true); };

  const upsert = (data) => {
    setSnippets(prev => {
      if (editing) return prev.map(s => s.id === editing.id ? { ...s, ...data } : s);
      const id = (prev.reduce((m, s) => Math.max(m, s.id || 0), 0)) + 1;
      return [{ id, ...data }, ...prev];
    });
    setDialogOpen(false);
    setEditing(null);
    setFlash(editing ? "✓ Snippet updated" : "✓ Snippet added");
    setTimeout(() => setFlash(""), 1500);
  };

  const remove = (s) => {
    if (!window.confirm(`Delete snippet "${s.name}"? This cannot be undone.`)) return;
    setSnippets(prev => prev.filter(x => x.id !== s.id));
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(`✓ ${label} copied`);
      setTimeout(() => setFlash(""), 1200);
    } catch { alert("Clipboard blocked"); }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-start md:items-center flex-col md:flex-row gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-2">
              <Code2 className="w-7 h-7 text-blue-500"/> Snippet Library
            </h1>
            <p className="text-slate-400 mt-1 max-w-2xl">
              Named JSON snippets for fast copy-paste into TradingView, PMT, or curl tests.
              Great for kill-switch payloads, per-asset entry templates, or one-off drift checks.
            </p>
          </div>
          <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4 mr-2"/>New snippet
          </Button>
        </div>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
          <Input value={query} onChange={e => setQuery(e.target.value)}
                 placeholder="Search by name, tag, or JSON body..."
                 className="bg-slate-900 border-slate-700 text-white pl-10 h-10"/>
        </div>

        {filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-8 text-center">
              <Code2 className="w-12 h-12 text-slate-700 mx-auto mb-3"/>
              <p className="text-slate-400">
                {query ? `No snippets match "${query}".` : "No snippets yet — add your first."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map(s => (
              <SnippetCard key={s.id} snippet={s}
                           onCopy={() => copy(s.body, s.name)}
                           onEdit={() => openEdit(s)}
                           onDelete={() => remove(s)}
                           onDuplicate={() => upsert({ name: `${s.name} (copy)`, tag: s.tag, body: s.body })}/>
            ))}
          </div>
        )}

        <SnippetForm
          key={editing?.id ?? "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          snippet={editing}
          onSave={upsert}
        />
      </div>
    </div>
  );
}

// Extract for hook-per-card. useContextMenu is a React hook so each
// card that wants a right-click menu needs to be its own component.
function SnippetCard({ snippet: s, onCopy, onEdit, onDelete, onDuplicate }) {
  const { menuProps, menu } = useContextMenu([
    { header: s.name },
    { label: "Copy JSON",    icon: <Copy className="w-4 h-4"/>,  onClick: onCopy },
    { label: "Edit snippet", icon: <Edit className="w-4 h-4"/>,  onClick: onEdit },
    { label: "Duplicate",    icon: <FileText className="w-4 h-4"/>, onClick: onDuplicate },
    { separator: true },
    { label: "Delete",       icon: <Trash2 className="w-4 h-4"/>, onClick: onDelete, danger: true },
  ]);
  return (
    <>
      <Card {...menuProps} onDoubleClick={onEdit}
            title="Right-click for actions · Double-click to edit"
            className="bg-slate-900 border-slate-800 flex flex-col hover:border-slate-700 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-white text-base">{s.name}</CardTitle>
                    {s.tag && (
                      <Badge className="bg-blue-600 text-white text-[10px] uppercase tracking-wider">
                        {s.tag}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-grow space-y-2">
                  <pre className="bg-slate-950 border border-slate-800 rounded-md p-2.5 text-xs text-slate-300 font-mono overflow-x-auto max-h-40">
                    {s.body}
                  </pre>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={onCopy}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                      <Copy className="w-3.5 h-3.5 mr-1.5"/>Copy JSON
                    </Button>
                    <Button size="sm" variant="outline" onClick={onEdit}
                            className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                      <Edit className="w-3.5 h-3.5"/>
                    </Button>
                    <Button size="sm" variant="outline" onClick={onDelete}
                            className="bg-slate-800 border-slate-700 text-red-400 hover:bg-red-900/40 hover:text-red-300">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </Button>
                  </div>
                </CardContent>
      </Card>
      {menu}
    </>
  );
}

function SnippetForm({ open, onOpenChange, snippet, onSave }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState(null);

  useEffect(() => {
    setName(snippet?.name || "");
    setTag(snippet?.tag || "");
    setBody(snippet?.body || "");
    setErr(null);
  }, [snippet, open]);

  const beautify = () => {
    try {
      const parsed = JSON.parse(body);
      setBody(JSON.stringify(parsed, null, 2));
      setErr(null);
    } catch (e) {
      setErr(`Invalid JSON: ${e.message}`);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Name required");
    if (!body.trim()) return setErr("JSON body required");
    // Non-blocking validity: allow non-JSON bodies (e.g. curl templates)
    // — but warn if they look like broken JSON.
    if (body.trim().startsWith("{") || body.trim().startsWith("[")) {
      try { JSON.parse(body); } catch (e) {
        if (!window.confirm(`Body doesn't parse as JSON (${e.message}). Save anyway?`)) return;
      }
    }
    onSave({ name: name.trim(), tag: tag.trim(), body });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{snippet ? "Edit" : "New"} Snippet</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-white text-sm">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)}
                     placeholder="e.g. MNQ entry template"
                     className="bg-slate-950 border-slate-700 text-white" required autoFocus/>
            </div>
            <div className="space-y-1.5">
              <Label className="text-white text-sm">Tag</Label>
              <Input value={tag} onChange={e => setTag(e.target.value)}
                     placeholder="MNQ / flatten / test"
                     className="bg-slate-950 border-slate-700 text-white uppercase"/>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label className="text-white text-sm">Body</Label>
              <button type="button" onClick={beautify}
                      className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
                ↻ Beautify JSON
              </button>
            </div>
            <textarea value={body} onChange={e => setBody(e.target.value)}
                      placeholder='{ "action": "buy", "symbol": "MNQ1!", "quantity": 2 }'
                      rows={12}
                      className="w-full bg-slate-950 border border-slate-700 rounded-md p-3 text-white font-mono text-sm resize-y"
                      required/>
          </div>
          {err && (
            <div className="text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline"
                      className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white">
              {snippet ? "Save changes" : "Add snippet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
