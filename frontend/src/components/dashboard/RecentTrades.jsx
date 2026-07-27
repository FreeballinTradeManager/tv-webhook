import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function RecentTrades({ trades, loading }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800">
        <CardTitle className="text-xl text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-500" />
          Recent Trades
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                <th className="px-6 py-3">Symbol</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Entry</th>
                <th className="px-6 py-3">Exit</th>
                <th className="px-6 py-3">P&L</th>
                <th className="px-6 py-3">Pips</th>
                <th className="px-6 py-3">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading ? (
                Array(5).fill(0).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-20 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-20 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-12 bg-slate-800" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-16 bg-slate-800" /></td>
                  </tr>
                ))
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                    No trades yet. Start logging your trades!
                  </td>
                </tr>
              ) : (
                trades.map((trade) => (
                  <tr key={trade.id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-semibold text-white">{trade.symbol}</span>
                    </td>
                    <td className="px-6 py-4">
                      <Badge
                        variant="outline"
                        className={trade.direction === "long"
                          ? "bg-green-500/20 text-green-400 border-green-500/50"
                          : "bg-red-500/20 text-red-400 border-red-500/50"}
                      >
                        {trade.direction === "long" ? (
                          <TrendingUp className="w-3 h-3 mr-1" />
                        ) : (
                          <TrendingDown className="w-3 h-3 mr-1" />
                        )}
                        {trade.direction?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{trade.entry_price?.toFixed(5)}</td>
                    <td className="px-6 py-4 text-slate-300">{trade.exit_price?.toFixed(5) || "-"}</td>
                    <td className="px-6 py-4">
                      <span className={`font-semibold ${
                        (trade.profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500"
                      }`}>
                        ${(trade.profit_loss || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`font-medium ${
                        (trade.pips || 0) >= 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {(trade.pips || 0) >= 0 ? "+" : ""}{(trade.pips || 0).toFixed(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-slate-400 capitalize">{trade.session || "-"}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
