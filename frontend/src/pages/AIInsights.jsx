import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, RefreshCw, ExternalLink, KeyRound, Copy } from "lucide-react";
import { Trade, User } from "@/entities/all";
import { Link } from "react-router-dom";

// AIInsights — Ask Claude to review the trader's recent trades.
// Phase 2A: backend returns canned response until ANTHROPIC_API_KEY is set.
// Phase 2B: real Claude analysis.
//
// Caches last response in localStorage so revisits load instant, plus
// remembers the window size + style the trader last used.

const CACHE_KEY = "tradecore_ai_insights_last_v1";

export default function AIInsightsPage() {
  const [days, setDays]     = useState(7);
  const [style, setStyle]   = useState("coaching");
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; }
  });
  const [error, setError]   = useState(null);

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const [trades, user] = await Promise.all([
        Trade.list("-entry_time", 500).catch(() => []),
        User.me().catch(() => null),
      ]);
      const closed = (trades || []).filter(t =>
        t.status === "closed" || t.exit_time || t.close_time);
      const cutoff = Date.now() - days * 86400_000;
      const windowTrades = closed.filter(t => {
        const ts = new Date(t.exit_time || t.close_time || t.entry_time || t.created_date || 0).getTime();
        return ts >= cutoff;
      });

      const resp = await fetch("/api/ai/journal-insights", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          trades:        windowTrades,
          window_days:   days,
          trading_rules: user?.trading_rules || null,
          style,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
      const withMeta = { ...data, generated_at: new Date().toISOString(), days, style };
      setResult(withMeta);
      localStorage.setItem(CACHE_KEY, JSON.stringify(withMeta));
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const copyOut = async () => {
    if (!result?.insight) return;
    try { await navigator.clipboard.writeText(result.insight); } catch {}
  };

  const s = result?.summary;
  const isPhase2A = result?.phase === "2A";

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-blue-400"/> AI Journal Insights
          </h1>
          <p className="text-slate-400 mt-1 max-w-2xl">
            Ask Claude to review your recent trades — patterns, mistakes, wins, one action for next session.
          </p>
        </header>

        {/* Phase 2A hint */}
        {isPhase2A && (
          <Card className="bg-amber-500/5 border-amber-500/40">
            <CardContent className="p-3 text-xs text-amber-200 flex items-start gap-2">
              <KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"/>
              <div>
                <strong>Phase 2A</strong> — you're seeing a canned preview. Paste your Anthropic API key at{" "}
                <Link to="/Integrations" className="text-amber-300 underline hover:text-amber-200">
                  /Integrations → Anthropic (Claude)
                </Link>{" "}
                and once <code>ANTHROPIC_API_KEY</code> lands on Railway, this button starts returning real
                Claude analysis.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Controls */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Window</div>
              <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
                <SelectTrigger className="h-9 w-28 bg-slate-950 border-slate-800 text-white text-sm">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="1">Today</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Style</div>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="h-9 w-40 bg-slate-950 border-slate-800 text-white text-sm">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="coaching">Coaching (default)</SelectItem>
                  <SelectItem value="critical">Critical — blunt</SelectItem>
                  <SelectItem value="analytical">Analytical — neutral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={generate} disabled={busy}
                    className="h-9 bg-blue-600 hover:bg-blue-500 ml-auto self-end">
              {busy
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin"/>Analyzing…</>
                : <><Sparkles className="w-4 h-4 mr-1.5"/>{result ? "Regenerate" : "Generate insights"}</>}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Card className="bg-red-500/5 border-red-500/40">
            <CardContent className="p-3 text-xs text-red-200">Error: {error}</CardContent>
          </Card>
        )}

        {/* Summary strip */}
        {s && (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 grid grid-cols-4 gap-3">
              <Stat label="Window"    value={`${result.days}d`}/>
              <Stat label="Trades"    value={s.trades}/>
              <Stat label="Win rate"  value={`${(s.win_rate * 100).toFixed(0)}%`}
                    tint={s.win_rate >= 0.5 ? "text-emerald-400" : "text-red-400"}/>
              <Stat label="Net P&L"   value={`${s.total_pnl >= 0 ? "+" : "-"}$${Math.abs(s.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                    tint={s.total_pnl > 0 ? "text-emerald-400" : s.total_pnl < 0 ? "text-red-400" : "text-slate-400"}/>
            </CardContent>
          </Card>
        )}

        {/* Insight body */}
        {result?.insight && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400"/> Insight
                <Badge className={result.phase === "2B"
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 text-[10px]"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/40 text-[10px]"}>
                  Phase {result.phase}
                </Badge>
                {result.model && <span className="text-[10px] text-slate-500 font-mono">{result.model}</span>}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={copyOut}
                        className="h-7 text-slate-400 hover:text-white text-xs">
                  <Copy className="w-3 h-3 mr-1"/>Copy
                </Button>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(result.generated_at).toLocaleString()}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <MarkdownLite text={result.insight}/>
              {result.note && (
                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500 italic">
                  {result.note}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!result && !busy && (
          <Card className="bg-slate-900 border-slate-800 border-dashed">
            <CardContent className="p-8 text-center text-slate-500">
              Click <strong className="text-white">Generate insights</strong> to have Claude review your last {days} days of trades.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-xl font-semibold font-mono ${tint || "text-white"}`}>{value}</div>
    </div>
  );
}

// Minimal markdown-to-HTML: bold, italic, headings, links, list items, code
function MarkdownLite({ text }) {
  const html = String(text || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // bold **x**
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // italic _x_
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
    // code `x`
    .replace(/`([^`]+)`/g, '<code class="bg-slate-800 px-1 py-0.5 rounded text-blue-300">$1</code>')
    // links [x](y)
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-400 hover:underline">$1</a>')
    // headings (#, ##, ###)
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-white mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="text-base font-semibold text-white mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 class="text-lg font-bold text-white mt-4 mb-2">$1</h1>')
    // numbered list items
    .replace(/^\d+\.\s+(.+)$/gm, '<div class="pl-4 my-1 relative before:content-[\'•\'] before:absolute before:left-0 before:text-slate-500">$1</div>')
    // paragraphs
    .split(/\n\n+/)
    .map(p => p.startsWith("<") ? p : `<p class="my-2">${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return <div className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}/>;
}
