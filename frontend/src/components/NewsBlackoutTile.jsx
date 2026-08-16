import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Newspaper, VolumeX, Clock, AlertCircle } from "lucide-react";
import {
  upcomingEvents, currentBlackoutStatus,
  getNewsBlackoutCfg, fmtCountdown, fmtLocalTime,
} from "@/lib/economic_calendar";

// NewsBlackoutTile — Dashboard tile showing the next few high-impact
// economic events with live countdown. If we're currently inside a
// blackout window (pre/post an event), pins a big red banner.
//
// Data comes from the hardcoded 2026 Fed/BLS/BEA schedule in
// economic_calendar.js — Phase 2 swaps it for live ForexFactory scrape
// via /Integrations/forex_factory.

export default function NewsBlackoutTile() {
  const [cfg, setCfg]     = useState(() => getNewsBlackoutCfg());
  const [now, setNow]     = useState(Date.now());
  const [blackout, setBlackout] = useState(() => currentBlackoutStatus());

  // Tick every 1s so countdowns update live. Cheap — pure in-memory.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setBlackout(currentBlackoutStatus());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (!cfg.show_tile) return null;
  const events = upcomingEvents(cfg.min_impact, cfg.max_upcoming);
  if (events.length === 0 && !blackout.active) return null;

  return (
    <Card className={`${blackout.active
      ? "bg-red-500/10 border-red-500/50"
      : "bg-slate-900 border-slate-800"}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {blackout.active
              ? <VolumeX className="w-5 h-5 text-red-400"/>
              : <Newspaper className="w-4 h-4 text-blue-400"/>}
            <span className={`text-xs font-semibold uppercase tracking-wider ${
                blackout.active ? "text-red-200" : "text-white"}`}>
              {blackout.active ? "News blackout ACTIVE" : "Upcoming news"}
            </span>
          </div>
          {!blackout.active && (
            <Badge className="bg-slate-800 text-slate-400 border-slate-700 text-[10px]">
              ± {cfg.pre_blackout_min}/{cfg.post_blackout_min} min · {cfg.min_impact}+
            </Badge>
          )}
        </div>

        {/* Blackout banner */}
        {blackout.active && (
          <div className="bg-red-500/15 border border-red-500/40 rounded p-3 space-y-1">
            <div className="text-sm font-semibold text-red-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4"/>
              {blackout.phase === "pre"
                ? `Pre-news blackout — ${blackout.event.name} in ${fmtCountdown(blackout.event.iso)}`
                : `Post-news cooldown — ${blackout.event.name} just fired`}
            </div>
            <div className="text-[11px] text-red-200/80">
              {blackout.event.note || "Groups configured with news blackout are paused until this window ends."}
            </div>
            <div className="text-[10px] text-red-300/60 font-mono">
              Ends {fmtCountdown(new Date(blackout.ends_at).toISOString())}
            </div>
          </div>
        )}

        {/* Upcoming events list */}
        {events.length > 0 && (
          <div className="space-y-1.5">
            {events.map(e => <EventRow key={e.iso} event={e}/>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({ event }) {
  const cd = fmtCountdown(event.iso);
  const soon = cd.startsWith("in ") && (cd.includes("m") && !cd.includes("h") && !cd.includes("d"));
  const impactCls = event.impact === "red"    ? "bg-red-500/15 text-red-300 border-red-500/40"
                  : event.impact === "orange" ? "bg-orange-500/15 text-orange-300 border-orange-500/40"
                  : "bg-slate-800 text-slate-400 border-slate-700";
  return (
    <div className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded border ${
        soon ? "bg-red-500/5 border-red-500/40" : "bg-slate-950 border-slate-800"}`}>
      <Badge className={`text-[9px] px-1 py-0 ${impactCls}`}>
        {event.impact.toUpperCase()}
      </Badge>
      <span className="font-mono text-white font-semibold">{event.name}</span>
      <span className="text-slate-500 font-mono text-[10px]">{event.currency}</span>
      <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
        <Clock className="w-3 h-3"/>
        <span>{fmtLocalTime(event.iso)}</span>
        <span className={soon ? "text-red-300 font-semibold" : "text-slate-500"}>
          · {cd}
        </span>
      </span>
    </div>
  );
}
