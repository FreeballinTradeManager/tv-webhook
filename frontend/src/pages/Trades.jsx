import React, { useState, useEffect, useMemo } from "react";
import { Trade, Account } from "@/entities/all";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Plus, Filter, ArrowUpDown } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Skeleton } from "@/components/ui/skeleton";

export default function TradesPage() {
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ symbol: "", accountId: "all", session: "all", direction: "all" });
  const [sort, setSort] = useState({ key: "entry_time", order: "desc" });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [tradesData, accountsData] = await Promise.all([
      Trade.list("-entry_time"),
      Account.list()
    ]);
    setTrades(tradesData);
    setAccounts(accountsData);
    setLoading(false);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSort = (key) => {
    setSort(prev => ({
      key,
      order: prev.key === key && prev.order === "desc" ? "asc" : "desc"
    }));
  };

  const filteredAndSortedTrades = useMemo(() => {
    let filtered = trades.filter(trade => {
      const symbolMatch = !filters.symbol || trade.symbol.toLowerCase().includes(filters.symbol.toLowerCase());
      const accountMatch = filters.accountId === "all" || trade.account_id === filters.accountId;
      const sessionMatch = filters.session === "all" || trade.session === filters.session;
      const directionMatch = filters.direction === "all" || trade.direction === filters.direction;
      return symbolMatch && accountMatch && sessionMatch && directionMatch;
    });

    return filtered.sort((a, b) => {
      const aVal = a[sort.key] || 0;
      const bVal = b[sort.key] || 0;
      if (aVal < bVal) return sort.order === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.order === "asc" ? 1 : -1;
      return 0;
    });
  }, [trades, filters, sort]);

  const getAccountName = (accountId) => {
    return accounts.find(acc => acc.id === accountId)?.name || "N/A";
  };

  const TradeRow = ({ trade }) => (
    <TableRow className="hover:bg-slate-800/50 transition-colors">
      <TableCell className="font-semibold text-white">{trade.symbol}</TableCell>
      <TableCell className="text-slate-300">{getAccountName(trade.account_id)}</TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className={trade.direction === "long" ? "bg-green-500/20 text-green-400 border-green-500/50" : "bg-red-500/20 text-red-400 border-red-500/50"}
        >
          {trade.direction === "long" ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
          {trade.direction.toUpperCase()}
        </Badge>
      </TableCell>
      <TableCell className="text-slate-300">{format(new Date(trade.entry_time), "MMM d, yyyy HH:mm")}</TableCell>
      <TableCell className="text-slate-300">{trade.entry_price?.toFixed(5)}</TableCell>
      <TableCell className="text-slate-300">{trade.exit_price?.toFixed(5) || '-'}</TableCell>
      <TableCell className={`font-semibold ${(trade.profit_loss || 0) >= 0 ? "text-green-500" : "text-red-500"}`}>
        ${(trade.profit_loss || 0).toFixed(2)}
      </TableCell>
      <TableCell className="text-slate-400 capitalize">{trade.session}</TableCell>
    </TableRow>
  );

  const SortableHeader = ({ tkey, label }) => (
    <TableHead onClick={() => handleSort(tkey)} className="cursor-pointer hover:bg-slate-700">
      <div className="flex items-center gap-1">
        {label}
        {sort.key === tkey && <ArrowUpDown className="w-3 h-3" />}
      </div>
    </TableHead>
  );

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Trade Journal</h1>
            <p className="text-slate-400">A complete log of all your trades.</p>
          </div>
          <Link to={createPageUrl("NewTrade")}>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30">
              <Plus className="w-5 h-5 mr-2" />
              Log New Trade
            </Button>
          </Link>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800 p-4 flex flex-row items-center gap-4">
            <Filter className="w-5 h-5 text-slate-400" />
            <Input
              placeholder="Filter by Symbol..."
              value={filters.symbol}
              onChange={(e) => handleFilterChange("symbol", e.target.value)}
              className="max-w-xs bg-slate-800 border-slate-700 text-white"
            />
            <Select value={filters.accountId} onValueChange={(val) => handleFilterChange("accountId", val)}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="All Accounts" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                <SelectItem value="all">All Accounts</SelectItem>
                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
              </SelectContent>
            </Select>
             <Select value={filters.session} onValueChange={(val) => handleFilterChange("session", val)}>
              <SelectTrigger className="w-[180px] bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="All Sessions" />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700 text-white">
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="london">London</SelectItem>
                <SelectItem value="new_york">New York</SelectItem>
                <SelectItem value="asian">Asian</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-800/50 text-xs text-slate-400 uppercase tracking-wider">
                  <TableRow>
                    <SortableHeader tkey="symbol" label="Symbol" />
                    <TableHead>Account</TableHead>
                    <TableHead>Direction</TableHead>
                    <SortableHeader tkey="entry_time" label="Entry Time" />
                    <SortableHeader tkey="entry_price" label="Entry Price" />
                    <SortableHeader tkey="exit_price" label="Exit Price" />
                    <SortableHeader tkey="profit_loss" label="P&L" />
                    <SortableHeader tkey="session" label="Session" />
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-slate-800">
                  {loading ? (
                    Array(10).fill(0).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}><Skeleton className="h-5 w-full bg-slate-800"/></TableCell>
                      </TableRow>
                    ))
                  ) : filteredAndSortedTrades.length > 0 ? (
                    filteredAndSortedTrades.map(trade => <TradeRow key={trade.id} trade={trade} />)
                  ) : (
                    <TableRow><TableCell colSpan={8} className="text-center py-10 text-slate-400">No trades match your criteria.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
