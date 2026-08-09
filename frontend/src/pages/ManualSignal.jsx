import React, { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Zap, Send, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { Account } from "@/entities/all";
import { api } from "@/lib/api";

// ManualSignal — fire test signals at the observe endpoint from inside
// TradeCore itself. Useful for:
//   · Seeding sample trades for demo / screenshot / video
//   · Testing rotation without waiting for TV to fire an alert
//   · Verifying a new account's observe URL is wired correctly
//
// Never routes to broker. Every send lands as an OBSERVE_* WebhookSignal
// row and (for ENTRY/CLOSE) creates/closes a Position row.

const EVENTS = [
  { key: "buy",   label: "BUY (open long)",  side: "buy",  creates: true },
  { key: "sell",  label: "SELL (open short)", side: "sell", creates: true },
  { key: "CLOSE", label: "CLOSE (flat)",      side: "close", creates: false },
  { key: "TP3",   label: "TP3 hit (close)",   side: "close", creates: false },
  { key: "STOP_HIT", label: "STOP_HIT",       side: "close", creates: false },
];

export default function ManualSignalPage() {
  const [accounts, setAccounts] = useState([]);
  const [acctId, setAcctId]     = useState("");
  const [eventKey, setEventKey] = useState("buy");
  const [symbol, setSymbol]     = useState("MNQ1!");
  const [qty, setQty]           = useState(1);
  const [price, setPrice]       = useState(24500);
  const [stop, setStop]         = useState(24480);
  const [tp1, setTp1]           = useState(24510);
  const [tp2, setTp2]           = useState(24520);
  const [tp3, setTp3]           = useState(24530);
  const [pnl, setPnl]           = useState(0);
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState(null);

  useEffect(() => {
    Account.list("-created_date").then(a => {
      setAccounts(a || []);
      if (a?.[0]) setAcctId(String(a[0].id));
    }).catch(() => {});
  }, []);

  const ev = EVENTS.find(e => e.key === eventKey);
  const isEntry = ev?.side === "buy" || ev?.side === "sell";

  const send = async () => {
    if (!acctId) { alert("Pick an account."); return; }
    setBusy(true); setResult(null);
    try {
      const payload = { data: ev.side === "buy" ? "buy" : ev.side === "sell" ? "sell" : "CLOSE",
                        event: ev.key,
                        symbol,
                        quantity: Number(qty) || 0,
                        price: Number(price) || 0 };
      if (isEntry) {
        payload.sl = Number(stop) || 0;
        payload.tp1_px = Number(tp1) || 0;
        payload.tp2_px = Number(tp2) || 0;
        payload.tp3_px = Number(tp3) || 0;
      } else {
        payload.exit_price = Number(price) || 0;
        if (pnl) payload.realized_pnl = Number(pnl);
      }
      const resp = await fetch(`/api/webhook/observe/${encodeURIComponent(acctId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      setResult({ ok: resp.ok, data, code: resp.status });
    } catch (e) {
      setResult({ ok: false, err: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-2xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Zap className="w-7 h-7 text-blue-400"/> Manual Signal Sender
          </h1>
          <p className="text-slate-400 mt-1">
            Fire a test signal at the observe endpoint. Creates a real Trade row on Dashboard. Broker is never touched.
          </p>
        </header>

        {/* Safety banner */}
        <Card className="bg-emerald-500/5 border-emerald-500/40">
          <CardContent className="p-3 text-xs text-emerald-200/90 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0"/>
            OBSERVE-ONLY — no broker order sent. Signals here appear in Journal / Dashboard / Signal Log identical to real PMT observe.
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-base">Signal</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-400 uppercase tracking-wider">Account</Label>
                <Select value={acctId} onValueChange={setAcctId}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                    <SelectValue placeholder="Pick an account"/>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white max-h-72">
                    {accounts.length === 0
                      ? <SelectItem value="__none" disabled>No accounts yet</SelectItem>
                      : accounts.map(a => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-400 uppercase tracking-wider">Event type</Label>
                <Select value={eventKey} onValueChange={setEventKey}>
                  <SelectTrigger className="bg-slate-950 border-slate-800 text-white">
                    <SelectValue/>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {EVENTS.map(e => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <MoneyOrText label="Symbol" val={symbol} onChange={setSymbol} placeholder="MNQ1!" mono/>
              <MoneyOrText label="Qty"    val={qty}    onChange={v => setQty(Number(v)||0)} placeholder="1"/>
              <MoneyOrText label={isEntry ? "Entry price" : "Exit price"} val={price} onChange={v => setPrice(Number(v)||0)} placeholder="24500"/>
            </div>

            {isEntry && (
              <div className="grid md:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
                <MoneyOrText label="Stop"  val={stop} onChange={v => setStop(Number(v)||0)} placeholder="24480"/>
                <MoneyOrText label="TP1"   val={tp1}  onChange={v => setTp1(Number(v)||0)}  placeholder="24510"/>
                <MoneyOrText label="TP2"   val={tp2}  onChange={v => setTp2(Number(v)||0)}  placeholder="24520"/>
                <MoneyOrText label="TP3"   val={tp3}  onChange={v => setTp3(Number(v)||0)}  placeholder="24530"/>
              </div>
            )}

            {!isEntry && (
              <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-slate-800">
                <MoneyOrText label="Realized P&L ($, optional)" val={pnl} onChange={v => setPnl(Number(v)||0)} placeholder="30"/>
              </div>
            )}

            <Button onClick={send} disabled={busy || !acctId}
                    className="w-full bg-blue-600 hover:bg-blue-500 h-11">
              <Send className="w-4 h-4 mr-2"/>{busy ? "Sending…" : `Fire ${ev?.label || "signal"}`}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card className={`border ${result.ok ? "bg-emerald-500/5 border-emerald-500/40" : "bg-red-500/5 border-red-500/40"}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {result.ok
                  ? <><CheckCircle2 className="w-4 h-4 text-emerald-400"/><span className="text-emerald-300">Accepted (HTTP {result.code})</span></>
                  : <><XCircle className="w-4 h-4 text-red-400"/><span className="text-red-300">Failed{result.code ? ` (HTTP ${result.code})` : ""}</span></>}
              </div>
              {result.data && (
                <>
                  <div className="text-xs text-slate-300 grid grid-cols-2 gap-2">
                    <div><span className="text-slate-500">position_action:</span> <code className="text-white">{result.data.position_action ?? "—"}</code></div>
                    <div><span className="text-slate-500">position_id:</span> <code className="text-white">{result.data.position_id ?? "—"}</code></div>
                    <div><span className="text-slate-500">event_id:</span> <code className="text-white">{result.data.event_id ?? "—"}</code></div>
                    <div><span className="text-slate-500">matched:</span> <code className="text-white">{String(result.data.matched)}</code></div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-slate-800">
                    <a href="/Trades" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3"/>Trades table
                    </a>
                    <a href="/Logs" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3"/>Signal Log
                    </a>
                    <a href="/Dashboard" className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3"/>Dashboard
                    </a>
                  </div>
                </>
              )}
              {result.err && <div className="text-xs text-red-300 font-mono">{result.err}</div>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function MoneyOrText({ label, val, onChange, placeholder, mono }) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wider">{label}</Label>
      <Input value={val ?? ""} onChange={e => onChange(e.target.value)} placeholder={placeholder}
             className={`bg-slate-950 border-slate-800 text-white ${mono ? "font-mono" : ""}`}/>
    </div>
  );
}
