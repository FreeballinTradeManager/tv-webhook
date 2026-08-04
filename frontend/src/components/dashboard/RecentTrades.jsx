import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// Bracket rows for a CLOSED trade with hit status inferred from exit_price.
function bracketRows(trade) {
  const isLong = (trade.direction || trade.side || "").toLowerCase() === "long";
  const exit = trade.exit_price ?? trade.avg_fill_price ?? null;
  const stopHit = exit != null && trade.stop_loss != null &&
    (isLong ? exit <= trade.stop_loss * 1.0005 : exit >= trade.stop_loss * 0.9995);
  const tpHit = (level) => {
    if (!level || exit == null) return false;
    return isLong ? exit >= level : exit <= level;
  };
  const rows = [];
  if (trade.stop_loss != null) rows.push({ role: "SL",  price: trade.stop_loss,     hit: stopHit, tone: "red" });
  if (trade.entry_price != null) rows.push({ role: "E", price: trade.entry_price,   hit: true,    tone: "blue" });
  if (trade.take_profit_1) rows.push({ role: "TP1", price: trade.take_profit_1, hit: tpHit(trade.take_profit_1), tone: "green" });
  if (trade.take_profit_2) rows.push({ role: "TP2", price: trade.take_profit_2, hit: tpHit(trade.take_profit_2), tone: "green" });
  if (trade.take_profit_3) rows.push({ role: "TP3", price: trade.take_profit_3, hit: tpHit(trade.take_profit_3), tone: "green" });
  return rows;
}

function BracketChip({ row }) {
  const toneBg =
    row.tone === "red"    ? (row.hit ? "bg-red-500/20 border-red-500/50 text-red-300"     : "bg-red-500/5 border-red-500/20 text-red-400/60")
    : row.tone === "blue" ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
    :                       (row.hit ? "bg-green-500/20 border-green-500/50 text-green-300" : "bg-slate-800/60 border-slate-700 text-slate-500");
  const mark = row.tone === "blue" ? "→" : row.hit ? "✓" : "×";
  const markCol = row.tone === "blue" ? "text-blue-400" : row.hit ? "text-green-400" : "text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border rounded text-[10px] font-mono ${toneBg} whitespace-nowrap`}>
      <span className="opacity-70">{row.role}</span>
      <span className="tabular-nums">{row.price?.toFixed(2)}</span>
      <span className={markCol}>{mark}</span>
    </span>
  );
}

export default function RecentTrades({ trades, loading }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800">
        <CardTitle className="text-xl text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          Recent Trades
          <span className="text-xs text-slate-500 font-normal font-mono ml-auto">
            Every closed trade in bracket format
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Side</th>
                <th className="px-4 py-3">Brackets (SL · E · TP1 · TP2 · TP3)</th>
                <th className="px-4 py-3 text-right">P&amp;L</th>
                <th className="px-4 py-3">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    <td className="px-4 py-4"><Skeleton className="h-4 w-20 bg-slate-800" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-4 w-64 bg-slate-800" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-4 w-20 bg-slate-800 ml-auto" /></td>
                    <td className="px-4 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                  </tr>
                ))
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
                    No trades yet. Start logging your trades!
                  </td>
                </tr>
              ) : (
                trades.map((trade) => {
                  const isLong = (trade.direction || trade.side || "").toLowerCase() === "long";
                  const rows = bracketRows(trade);
                  return (
                    <tr key={trade.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-white font-mono">{trade.symbol || trade.ticker}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={isLong
                            ? "bg-green-500/20 text-green-400 border-green-500/50"
                            : "bg-red-500/20 text-red-400 border-red-500/50"}
                        >
                          {isLong
                            ? <TrendingUp className="w-3 h-3 mr-1" />
                            : <TrendingDown className="w-3 h-3 mr-1" />}
                          {isLong ? "LONG" : "SHORT"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {rows.length === 0
                          ? <span className="text-slate-500 text-xs">—</span>
                          : <div className="flex items-center gap-1 flex-wrap">
                              {rows.map((r, i) => <BracketChip key={i} row={r}/>)}
                            </div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold font-mono tabular-nums ${
                          (trade.profit_loss || 0) > 0 ? "text-green-400"
                          : (trade.profit_loss || 0) < 0 ? "text-red-400" : "text-slate-400"
                        }`}>
                          {(trade.profit_loss || 0) >= 0 ? "+" : "-"}${Math.abs(trade.profit_loss || 0).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-slate-400 capitalize text-xs">{trade.session || "-"}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
