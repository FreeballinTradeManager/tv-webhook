import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";

export default function StatsCard({ title, value, icon: Icon, trend, trendUp, bgGradient }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="bg-slate-900 border-slate-800 overflow-hidden relative group hover:shadow-xl hover:shadow-blue-500/10 transition-all duration-300">
        <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${bgGradient} opacity-10 rounded-full blur-2xl group-hover:opacity-20 transition-opacity`} />
        <CardContent className="p-6 relative">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
              <h3 className="text-2xl md:text-3xl font-bold text-white">{value}</h3>
            </div>
            <div className={`p-3 rounded-xl bg-gradient-to-br ${bgGradient} shadow-lg`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
          </div>
          {trend && (
            <div className="flex items-center gap-1 text-sm">
              {trendUp ? (
                <TrendingUp className="w-4 h-4 text-green-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-500" />
              )}
              <span className={trendUp ? "text-green-500" : "text-red-500"}>
                {trend}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
