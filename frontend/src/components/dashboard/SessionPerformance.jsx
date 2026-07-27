import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Award } from "lucide-react";

export default function SessionPerformance({ trades }) {
  const sessionData = React.useMemo(() => {
    const sessions = { london: 0, new_york: 0, asian: 0, daily: 0 };

    trades.filter(t => t.status === "closed").forEach(trade => {
      if (trade.session && Object.prototype.hasOwnProperty.call(sessions, trade.session)) {
        sessions[trade.session] += trade.profit_loss || 0;
      }
    });

    return [
      { name: "London", profit: sessions.london, fill: "#3B82F6" },
      { name: "New York", profit: sessions.new_york, fill: "#EF4444" },
      { name: "Asian", profit: sessions.asian, fill: "#F59E0B" },
      { name: "Daily", profit: sessions.daily, fill: "#10B981" }
    ];
  }, [trades]);

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader className="border-b border-slate-800">
        <CardTitle className="text-xl text-white flex items-center gap-2">
          <Award className="w-5 h-5 text-blue-500" />
          Session Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={sessionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="name" stroke="#94A3B8" />
            <YAxis stroke="#94A3B8" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1E293B",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#F8FAFC"
              }}
              formatter={(value) => [`$${value.toFixed(2)}`, "Profit"]}
            />
            <Bar dataKey="profit" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
