import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AccountOverview({ accounts, loading }) {
  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800">
        <CardTitle className="text-xl text-white flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-500" />
          Accounts
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {loading ? (
          <div className="space-y-4">
            {Array(3).fill(0).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32 bg-slate-800" />
                <Skeleton className="h-6 w-24 bg-slate-800" />
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 mb-4">No accounts yet</p>
            <Link to={createPageUrl("Accounts")}>
              <button className="text-blue-500 hover:text-blue-400">Add Account</button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {accounts.map((account) => {
              const profit = (account.current_balance || 0) - (account.starting_balance || 0);
              const profitPercent = account.starting_balance > 0
                ? (profit / account.starting_balance) * 100
                : 0;

              return (
                <div key={account.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-blue-500/50 transition-colors">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-white">{account.name}</h4>
                      <p className="text-xs text-slate-400">{account.broker_name || account.broker}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={account.account_type === "prop_firm"
                        ? "bg-purple-500/20 text-purple-400 border-purple-500/50"
                        : "bg-blue-500/20 text-blue-400 border-blue-500/50"}
                    >
                      {account.account_type || account.env}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-2xl font-bold text-white">
                        ${(account.current_balance || 0).toFixed(2)}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <TrendingUp className={`w-3 h-3 ${profit >= 0 ? "text-green-500" : "text-red-500"}`} />
                        <span className={`text-sm font-medium ${profit >= 0 ? "text-green-500" : "text-red-500"}`}>
                          {profit >= 0 ? "+" : ""}${profit.toFixed(2)} ({profitPercent >= 0 ? "+" : ""}{profitPercent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
