import React, { useState, useEffect } from "react";
import { Strategy } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function StrategyForm({ strategy, onSave }) {
  const [formData, setFormData] = useState(strategy || { name: "", description: "", rules: "", timeframe: "15m", preferred_session: "london" });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(formData); }} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name" className="text-slate-300">Strategy Name</Label>
        <Input id="name" value={formData.name} onChange={(e) => handleChange('name', e.target.value)} className="bg-slate-700 border-slate-600" required/>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description" className="text-slate-300">Description</Label>
        <Textarea id="description" value={formData.description} onChange={(e) => handleChange('description', e.target.value)} className="bg-slate-700 border-slate-600"/>
      </div>
       <div className="space-y-2">
        <Label htmlFor="rules" className="text-slate-300">Rules</Label>
        <Textarea id="rules" value={formData.rules} onChange={(e) => handleChange('rules', e.target.value)} className="bg-slate-700 border-slate-600 h-32"/>
      </div>
      <DialogFooter className="pt-4">
        <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit">Save Strategy</Button>
      </DialogFooter>
    </form>
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
                </CardContent>
                <div className="p-4 flex justify-end gap-2 border-t border-slate-800">
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(s.id)}><Trash2 className="w-4 h-4 text-red-500"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => { setEditingStrategy(s); setIsFormOpen(true); }}><Edit className="w-4 h-4 text-slate-400"/></Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
