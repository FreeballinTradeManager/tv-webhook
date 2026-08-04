import React, { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CHANNELS, loadPrefs, savePrefs, ensureBrowserPermission, notify, loadPending, clearPending } from "@/lib/notify";
import { Bell, BellOff, TestTube2, Check, AlertCircle, Trash2 } from "lucide-react";

// Notification Delivery card — where the trader picks which channels
// receive alerts and pastes creds for the paid ones. Browser + in-app
// work immediately. Discord/Telegram/Slack/Twilio/SMTP stage into the
// pending queue until the backend drain lands.
export default function NotifyDeliveryCard() {
  const [prefs, setPrefs] = useState(loadPrefs());
  const [perm, setPerm]   = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [pending, setPending] = useState(loadPending().length);
  const [testStatus, setTestStatus] = useState(null);

  useEffect(() => savePrefs(prefs), [prefs]);

  const toggleChannel = (key) => {
    setPrefs(p => ({ ...p, channels: { ...(p.channels || {}), [key]: !p.channels?.[key] } }));
  };
  const setCred = (key, val) => {
    setPrefs(p => ({ ...p, creds: { ...(p.creds || {}), [key]: val } }));
  };

  const requestPerm = async () => {
    const p = await ensureBrowserPermission();
    setPerm(p);
    if (p !== "granted") {
      setTestStatus({ ok: false, msg: p === "denied" ? "Blocked — enable in browser site settings." : "Permission not granted." });
    }
  };

  const sendTest = async () => {
    const res = await notify("entry_filled", {
      title: "TradeCore test alert",
      body: "If you can see this, delivery is working.",
    });
    setPending(loadPending().length);
    if (res.fired.length === 0 && res.staged.length === 0) {
      setTestStatus({ ok: false, msg: "No channel enabled. Turn on Browser or In-app first." });
    } else if (res.fired.length > 0) {
      setTestStatus({ ok: true, msg: `Sent via ${res.fired.join(", ")}${res.staged.length ? ` · queued ${res.staged.length}` : ""}` });
    } else {
      setTestStatus({ ok: true, msg: `Queued ${res.staged.length} for later — no live channel yet.` });
    }
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-400"/>
          Notification Delivery
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Browser permission row */}
        <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-3">
          <div>
            <div className="text-white text-sm font-semibold">Browser popup permission</div>
            <div className="text-xs text-slate-400 mt-0.5">
              Status: <span className={perm === "granted" ? "text-emerald-400" : perm === "denied" ? "text-red-400" : "text-amber-400"}>
                {perm}
              </span>
            </div>
          </div>
          {perm !== "granted" && perm !== "unsupported" && (
            <Button size="sm" variant="outline" onClick={requestPerm}>Request permission</Button>
          )}
          {perm === "granted" && (
            <span className="text-emerald-400 flex items-center gap-1 text-xs"><Check className="w-4 h-4"/>Enabled</span>
          )}
        </div>

        {/* Channel toggles */}
        <div className="space-y-2">
          {CHANNELS.map(ch => {
            const on = prefs.channels?.[ch.key] ?? false;
            return (
              <div key={ch.key} className="flex items-center justify-between bg-slate-950/60 border border-slate-800 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium flex items-center gap-2">
                    {ch.label}
                    {!ch.ready && (
                      <span className="text-[10px] uppercase tracking-wide bg-slate-800 text-slate-400 rounded px-1.5 py-0.5">
                        needs {ch.needs}
                      </span>
                    )}
                  </div>
                </div>
                <Switch checked={on} onCheckedChange={() => toggleChannel(ch.key)} />
              </div>
            );
          })}
        </div>

        {/* Credential inputs — only render when the channel is enabled */}
        {prefs.channels?.discord && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Discord webhook URL</Label>
            <Input value={prefs.creds?.discord_url || ""} onChange={e => setCred("discord_url", e.target.value)}
                   placeholder="https://discord.com/api/webhooks/..."
                   className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
          </div>
        )}
        {prefs.channels?.slack && (
          <div className="space-y-1">
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Slack webhook URL</Label>
            <Input value={prefs.creds?.slack_url || ""} onChange={e => setCred("slack_url", e.target.value)}
                   placeholder="https://hooks.slack.com/services/..."
                   className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
          </div>
        )}
        {prefs.channels?.telegram && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Telegram bot token</Label>
              <Input value={prefs.creds?.telegram_token || ""} onChange={e => setCred("telegram_token", e.target.value)}
                     placeholder="123456:ABC-DEF..." className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Chat ID</Label>
              <Input value={prefs.creds?.telegram_chat || ""} onChange={e => setCred("telegram_chat", e.target.value)}
                     placeholder="-100…" className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
          </div>
        )}
        {prefs.channels?.sms && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Twilio SID</Label>
              <Input value={prefs.creds?.twilio_sid || ""} onChange={e => setCred("twilio_sid", e.target.value)}
                     className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Twilio auth token</Label>
              <Input type="password" value={prefs.creds?.twilio_token || ""} onChange={e => setCred("twilio_token", e.target.value)}
                     className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">From (E.164)</Label>
              <Input value={prefs.creds?.twilio_from || ""} onChange={e => setCred("twilio_from", e.target.value)}
                     placeholder="+15551234567" className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">To (E.164)</Label>
              <Input value={prefs.creds?.twilio_to || ""} onChange={e => setCred("twilio_to", e.target.value)}
                     placeholder="+15559876543" className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
          </div>
        )}
        {prefs.channels?.email && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">SendGrid API key</Label>
              <Input type="password" value={prefs.creds?.email_key || ""} onChange={e => setCred("email_key", e.target.value)}
                     className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">From</Label>
              <Input value={prefs.creds?.email_from || ""} onChange={e => setCred("email_from", e.target.value)}
                     placeholder="alerts@you.com" className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs text-slate-400 uppercase tracking-wider">To</Label>
              <Input value={prefs.creds?.email_to || ""} onChange={e => setCred("email_to", e.target.value)}
                     placeholder="you@you.com" className="bg-slate-950 border-slate-800 text-white font-mono text-xs"/>
            </div>
          </div>
        )}

        {/* Test + pending queue */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <Button size="sm" onClick={sendTest} className="bg-blue-600 hover:bg-blue-500">
            <TestTube2 className="w-4 h-4 mr-1"/>Send test alert
          </Button>
          {pending > 0 && (
            <>
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3"/>{pending} queued (no live channel yet)
              </span>
              <Button size="sm" variant="ghost" onClick={() => { clearPending(); setPending(0); }}
                      className="text-slate-400 hover:text-red-400">
                <Trash2 className="w-3 h-3 mr-1"/>Clear
              </Button>
            </>
          )}
        </div>

        {testStatus && (
          <div className={`text-xs rounded-md px-3 py-2 border ${
            testStatus.ok
              ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
              : "bg-red-500/10 border-red-500/40 text-red-300"
          }`}>
            {testStatus.msg}
          </div>
        )}

        <div className="text-[11px] text-slate-500 leading-relaxed">
          Browser popups and in-app toasts work offline with zero setup. Discord / Telegram / Slack / SMS / Email require
          creds pasted above; alerts stage into a local queue and drain automatically the moment the backend delivery
          route ships.
        </div>
      </CardContent>
    </Card>
  );
}
