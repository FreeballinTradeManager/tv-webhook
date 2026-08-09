import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, PenLine, Save } from "lucide-react";
import {
  listChartsWithDrawings, loadDrawings, saveDrawings,
  addDrawing, removeDrawing, clearDrawings, chartIdOf,
} from "@/lib/chart_drawings";

// ChartDrawings — persistence UI for chart annotations.
// The chart_drawings lib stores drawings per chart_id (symbol+timeframe).
// This page lists all charts that have drawings, lets trader view/edit,
// add a note, remove a specific drawing, or clear the whole chart.
//
// Drawings are just JSON — the actual chart canvas (TradingView Charting
// Library) will read/write via loadDrawings/saveDrawings when the
// standalone chart tier (#176) lands. Until then, the trader can pre-fill
// notes / manual levels here and they'll persist forever.

const TF_OPTIONS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "D"];

export default function ChartDrawingsPage() {
  const [charts, setCharts] = useState(() => listChartsWithDrawings());
  const [picked, setPicked] = useState(charts[0]?.chartId || "");
  const [newSymbol, setNewSymbol] = useState("MNQ1!");
  const [newTF, setNewTF] = useState("5m");

  const refresh = () => {
    const list = listChartsWithDrawings();
    setCharts(list);
    if (!list.some(c => c.chartId === picked) && list.length > 0) {
      setPicked(list[0].chartId);
    }
  };
  useEffect(() => refresh(), []);

  const openChart = (chartId) => setPicked(chartId);

  const createChart = () => {
    const cid = chartIdOf(newSymbol.trim(), newTF);
    if (!cid) return;
    saveDrawings(cid, []);
    setPicked(cid);
    refresh();
  };

  const doClear = (chartId) => {
    if (!window.confirm(`Clear all drawings on ${chartId}?`)) return;
    clearDrawings(chartId);
    refresh();
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <PenLine className="w-7 h-7 text-blue-400"/> Chart Drawings
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Save trendlines, levels, notes per chart. Persist through browser reloads and (later) sync when auth ships.
            The standalone chart tier reads from this store when it lands.
          </p>
        </header>

        {/* Create + list */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center justify-between gap-2">
              <span>Your charts ({charts.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* New chart form */}
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <Label className="text-xs text-slate-400 uppercase tracking-wider">Symbol</Label>
                <Input value={newSymbol} onChange={e => setNewSymbol(e.target.value)}
                       className="w-32 h-9 font-mono bg-slate-950 border-slate-800 text-white"/>
              </div>
              <div>
                <Label className="text-xs text-slate-400 uppercase tracking-wider">Timeframe</Label>
                <Select value={newTF} onValueChange={setNewTF}>
                  <SelectTrigger className="w-24 h-9 bg-slate-950 border-slate-800 text-white">
                    <SelectValue/>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {TF_OPTIONS.map(tf => <SelectItem key={tf} value={tf}>{tf}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createChart} className="bg-blue-600 hover:bg-blue-500 h-9">
                <Plus className="w-3 h-3 mr-1"/>Create / Open
              </Button>
            </div>

            {/* Existing charts */}
            {charts.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-4">
                No chart drawings saved yet. Enter a symbol + TF above and click Create.
              </div>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                {charts.map(c => (
                  <button key={c.chartId} onClick={() => openChart(c.chartId)}
                          className={`text-left rounded p-3 border transition-colors ${
                            picked === c.chartId
                              ? "bg-blue-950/40 border-blue-500/60"
                              : "bg-slate-950 border-slate-800 hover:border-slate-700"
                          }`}>
                    <div className="font-mono text-sm text-white">{c.chartId}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {c.count} drawing{c.count === 1 ? "" : "s"}
                      {c.saved_at ? ` · updated ${new Date(c.saved_at).toLocaleString()}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor for picked chart */}
        {picked && <ChartEditor chartId={picked} onChange={refresh} onClear={() => doClear(picked)}/>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
function ChartEditor({ chartId, onChange, onClear }) {
  const [drawings, setDrawings] = useState(() => loadDrawings(chartId).drawings || []);
  const [newNote, setNewNote] = useState("");
  const [newLevel, setNewLevel] = useState("");

  useEffect(() => {
    setDrawings(loadDrawings(chartId).drawings || []);
  }, [chartId]);

  const addNote = () => {
    const note = newNote.trim();
    if (!note) return;
    addDrawing(chartId, { type: "note", note });
    setDrawings(loadDrawings(chartId).drawings || []);
    setNewNote("");
    onChange?.();
  };
  const addLevel = () => {
    const price = Number(newLevel);
    if (!price || isNaN(price)) return;
    addDrawing(chartId, { type: "level", points: [{ price }] });
    setDrawings(loadDrawings(chartId).drawings || []);
    setNewLevel("");
    onChange?.();
  };
  const rm = (id) => {
    removeDrawing(chartId, id);
    setDrawings(loadDrawings(chartId).drawings || []);
    onChange?.();
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-blue-400"/>
            <span className="font-mono">{chartId}</span>
            <span className="text-xs font-normal text-slate-400 ml-2">
              {drawings.length} drawing{drawings.length === 1 ? "" : "s"}
            </span>
          </span>
          <Button size="sm" variant="ghost" onClick={onClear}
                  className="text-slate-400 hover:text-red-400 text-xs">
            <Trash2 className="w-3 h-3 mr-1"/>Clear all
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add level */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Add price level</Label>
            <Input type="number" step="any" value={newLevel} onChange={e => setNewLevel(e.target.value)}
                   placeholder="e.g. 24500.25"
                   className="bg-slate-950 border-slate-800 text-white font-mono"/>
          </div>
          <Button onClick={addLevel} disabled={!newLevel} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="w-3 h-3 mr-1"/>Add
          </Button>
        </div>

        {/* Add note */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Add note</Label>
            <Input value={newNote} onChange={e => setNewNote(e.target.value)}
                   onKeyDown={e => e.key === "Enter" && addNote()}
                   placeholder="e.g. Prior day high — watch for rejection"
                   className="bg-slate-950 border-slate-800 text-white"/>
          </div>
          <Button onClick={addNote} disabled={!newNote} className="bg-blue-600 hover:bg-blue-500">
            <Plus className="w-3 h-3 mr-1"/>Add
          </Button>
        </div>

        {/* List */}
        {drawings.length === 0 ? (
          <div className="text-sm text-slate-500 italic py-4">
            No drawings yet. Add a price level or note above.
          </div>
        ) : (
          <div className="space-y-1 pt-2 border-t border-slate-800">
            {drawings.map(d => (
              <div key={d.id} className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs">
                <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14">{d.type}</span>
                <span className="flex-1 text-white">
                  {d.type === "note"  && (d.note || "—")}
                  {d.type === "level" && (d.points?.[0]?.price != null ? `$${Number(d.points[0].price).toLocaleString()}` : "—")}
                  {d.type !== "note" && d.type !== "level" && JSON.stringify(d.points || d)}
                </span>
                {d.created_at && (
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {new Date(d.created_at).toLocaleDateString()}
                  </span>
                )}
                <button onClick={() => rm(d.id)} className="text-slate-500 hover:text-red-400" title="Remove">
                  <Trash2 className="w-3.5 h-3.5"/>
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
