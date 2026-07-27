import React, { useState, useEffect } from "react";
import { Strategy } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, Copy, Link2, Zap, Code2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const BROKER_FORMATS = [
  { value: "futures", label: "Futures (Tradovate/Rithmic)", hint: "qty = contracts" },
  { value: "mt5", label: "MT5 (FTMO/The5ers/most forex firms)", hint: "volume = lots" },
  { value: "mt4", label: "MT4", hint: "volume = lots" },
  { value: "forex", label: "Forex generic", hint: "volume = lots" },
  { value: "stocks", label: "Stocks (Alpaca/IBKR)", hint: "qty = shares" },
  { value: "crypto", label: "Crypto", hint: "qty = units" },
];

function StrategyForm({ strategy, onSave }) {
  const [formData, setFormData] = useState(strategy || {
    name: "", description: "", rules: "", timeframe: "15m",
    preferred_session: "london", broker_format: "futures", alert_description: "",
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-slate-300">Strategy Name *</Label>
        <Input id="name" value={formData.name} onChange={(e) => handleChange('name', e.target.value)}
               placeholder="e.g. Freeballin 6.24 base, v2.72, TM Manual"
               className="bg-slate-700 border-slate-600" required/>
        <p className="text-xs text-slate-500">Also becomes your webhook URL slug — e.g. "Freeballin 6.24 base" → /api/webhook/strategy/freeballin-6-24-base</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-slate-300">Broker Format</Label>
          <Select value={formData.broker_format || "futures"} onValueChange={(v) => handleChange('broker_format', v)}>
            <SelectTrigger className="bg-slate-700 border-slate-600 text-white"><SelectValue/></SelectTrigger>
            <SelectContent className="bg-slate-700 border-slate-600 text-white">
              {BROKER_FORMATS.map(f => (
                <SelectItem key={f.value} value={f.value}>
                  <div className="flex flex-col"><span>{f.label}</span><span className="text-xs text-slate-500">{f.hint}</span></div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300">Timeframe</Label>
          <Input value={formData.timeframe || "15m"} onChange={(e) => handleChange('timeframe', e.target.value)}
                 placeholder="1m / 5m / 15m / 1h / 4h / D"
                 className="bg-slate-700 border-slate-600"/>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Description</Label>
        <Textarea value={formData.description || ""} onChange={(e) => handleChange('description', e.target.value)}
                  placeholder="What is this strategy? What does it trade?"
                  className="bg-slate-700 border-slate-600"/>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">Rules</Label>
        <Textarea value={formData.rules || ""} onChange={(e) => handleChange('rules', e.target.value)}
                  placeholder={"Pre-entry checklist:\n- 3EMA crossed?\n- CD armed?\n- Session OK?"}
                  className="bg-slate-700 border-slate-600 h-24 text-sm font-mono"/>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300">What does this webhook do?</Label>
        <Textarea value={formData.alert_description || ""} onChange={(e) => handleChange('alert_description', e.target.value)}
                  placeholder="e.g. '6.24 base fires ENTRY on 3EMA cross. Runs on 5min MNQ. Routes to Apex + Lucid rotation.'"
                  className="bg-slate-700 border-slate-600"/>
      </div>
      <DialogFooter className="pt-4">
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" className="bg-blue-600 hover:bg-blue-700">Save Strategy</Button>
      </DialogFooter>
    </form>
  );
}

function AlertTemplatesDialog({ strategy, open, onOpenChange }) {
  const [flash, setFlash] = useState("");
  const templates = strategy?.alert_templates || {};
  const events = Object.keys(templates);
  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setFlash(`✓ ${label} copied`);
      setTimeout(() => setFlash(""), 1500);
    } catch { alert("Clipboard blocked"); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-[720px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Alert JSON — {strategy?.name}</DialogTitle>
          <div className="text-sm text-slate-400 mt-1">
            Broker format: <span className="text-blue-400 font-semibold">{strategy?.broker_format || "futures"}</span> —
            {" "}copy any of these into a TradingView alert's Message field.
          </div>
        </DialogHeader>

        {flash && (
          <div className="fixed top-4 right-4 z-50 bg-green-500/20 border border-green-500/50 text-green-400 px-4 py-2 rounded-lg text-sm shadow-lg">
            {flash}
          </div>
        )}

        {strategy?.webhook_url && (
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Webhook URL (paste into TradingView alert "Webhook URL")</Label>
            <div className="flex gap-2">
              <Input readOnly value={strategy.webhook_url} className="bg-slate-900 border-slate-700 font-mono text-xs"/>
              <Button size="sm" variant="outline" onClick={() => copy(strategy.webhook_url, "URL")}>
                <Copy className="w-4 h-4"/>
              </Button>
            </div>
          </div>
        )}

        {events.length === 0 && (
          <div className="text-center py-8 text-slate-400">No templates yet — save the strategy to generate them.</div>
        )}

        {events.map(ev => {
          const tpl = templates[ev];
          const json = JSON.stringify(tpl.json_body, null, 2);
          return (
            <div key={ev} className="space-y-2 border-t border-slate-700 pt-3">
              <div className="flex justify-between items-center">
                <div>
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">{ev}</Badge>
                  <span className="text-sm text-slate-400 ml-2">{tpl.description}</span>
                </div>
                <Button size="sm" onClick={() => copy(json, `${ev} JSON`)} className="bg-blue-600 hover:bg-blue-700">
                  <Copy className="w-3 h-3 mr-1"/>Copy JSON
                </Button>
              </div>
              <pre className="bg-slate-950 rounded-md p-3 text-xs overflow-x-auto text-slate-300 font-mono">{json}</pre>
            </div>
          );
        })}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState(null);

  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    setLoading(true);
    const data = await Strategy.list("-created_date");
    setStrategies(data);
    setLoading(false);
  };

  const handleSave = async (strategyData) => {
    if (editingStrategy) {
      await Strategy.update(editingStrategy.id, strategyData);
    } else {
      await Strategy.create(strategyData);
    }
    setEditingStrategy(null);
    setIsFormOpen(false);
    loadStrategies();
  };

  const handleDelete = async (strategyId) => {
    if (window.confirm("Are you sure you want to delete this strategy?")) {
      await Strategy.delete(strategyId);
      loadStrategies();
    }
  };

  const [templatesFor, setTemplatesFor] = useState(null);   // strategy object or null
  const copyUrl = async (url) => {
    try { await navigator.clipboard.writeText(url); }
    catch { alert("Clipboard blocked"); }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-white">Strategy Library</h1>
            <p className="text-slate-400">Manage and analyze your trading strategies.</p>
          </div>
          <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
            <DialogTrigger asChild><Button onClick={() => setEditingStrategy(null)} className="bg-blue-600 hover:bg-blue-700"><Plus className="w-4 h-4 mr-2"/>New Strategy</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[525px] bg-slate-800 border-slate-700 text-white">
              <DialogHeader><DialogTitle>{editingStrategy ? 'Edit' : 'Create'} Strategy</DialogTitle></DialogHeader>
              <StrategyForm strategy={editingStrategy} onSave={handleSave} />
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-60 w-full bg-slate-800" />)}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {strategies.map(s => (
              <Card key={s.id} className="bg-slate-900 border-slate-800 flex flex-col">
                <CardHeader>
                  <CardTitle className="text-white">{s.name}</CardTitle>
                  <p className="text-sm text-slate-400 pt-1 line-clamp-2">{s.description}</p>
                </CardHeader>
                <CardContent className="flex-grow space-y-3">
                  <div className="flex justify-between text-slate-300"><span>Win Rate</span> <Badge className="bg-blue-500/20 text-blue-300">{s.win_rate?.toFixed(1) || 0}%</Badge></div>
                  <div className="flex justify-between text-slate-300"><span>Total P&L</span> <span className={s.total_profit >= 0 ? 'text-green-500' : 'text-red-500'}>${s.total_profit?.toFixed(2) || 0}</span></div>
                  <div className="flex justify-between text-slate-300"><span>Total Trades</span> <span>{s.total_trades || 0}</span></div>
                  {s.broker_format && (
                    <div className="flex justify-between text-slate-300 pt-2 border-t border-slate-800">
                      <span>Broker Format</span>
                      <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30 capitalize">{s.broker_format}</Badge>
                    </div>
                  )}
                  {s.webhook_url && (
                    <div className="space-y-1 pt-2 border-t border-slate-800">
                      <div className="text-xs text-slate-500 flex items-center gap-1"><Link2 className="w-3 h-3"/> Webhook URL</div>
                      <div className="flex gap-1">
                        <code className="flex-1 text-xs bg-slate-800 rounded px-2 py-1 text-blue-400 truncate">{s.webhook_url}</code>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copyUrl(s.webhook_url)} title="Copy URL">
                          <Copy className="w-3 h-3 text-slate-400"/>
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
                <div className="p-4 flex justify-between items-center gap-2 border-t border-slate-800">
                  <Button size="sm" variant="outline" onClick={() => setTemplatesFor(s)}
                          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10">
                    <Code2 className="w-3 h-3 mr-1"/> Alert JSON
                  </Button>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}><Trash2 className="w-4 h-4 text-red-500"/></Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEditingStrategy(s); setIsFormOpen(true); }}><Edit className="w-4 h-4 text-slate-400"/></Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertTemplatesDialog
        strategy={templatesFor}
        open={!!templatesFor}
        onOpenChange={(v) => !v && setTemplatesFor(null)}
      />
    </div>
  );
}
