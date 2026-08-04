import React, { useState, useEffect, useMemo } from "react";
import { Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, AlertTriangle, TrendingUp, Layers } from "lucide-react";
import { assetSpec } from "@/lib/asset_registry";
import { sizingWarnings } from "@/lib/lot_sizing";

// ────────────────────────────────────────────────────────────────
// Futures presets — mirror Pine's f_preset_tick / f_preset_pv exactly
// pv = $ per 1.0 price point. tick = min price increment.
// ────────────────────────────────────────────────────────────────
const FUTURES = {
  MNQ: { tick: 0.25,  pv: 2,     name: "Micro Nasdaq" },
  NQ:  { tick: 0.25,  pv: 20,    name: "Nasdaq" },
  MES: { tick: 0.25,  pv: 5,     name: "Micro S&P" },
  ES:  { tick: 0.25,  pv: 50,    name: "S&P 500" },
  M2K: { tick: 0.10,  pv: 5,     name: "Micro Russell" },
  RTY: { tick: 0.10,  pv: 50,    name: "Russell 2000" },
  MYM: { tick: 1.0,   pv: 0.5,   name: "Micro Dow" },
  YM:  { tick: 1.0,   pv: 5,     name: "Dow Jones" },
  MGC: { tick: 0.10,  pv: 10,    name: "Micro Gold" },
  GC:  { tick: 0.10,  pv: 100,   name: "Gold" },
  CL:  { tick: 0.01,  pv: 1000,  name: "Crude Oil" },
  MNG: { tick: 0.001, pv: 1000,  name: "Micro Nat Gas" },
  NG:  { tick: 0.001, pv: 10000, name: "Natural Gas" },
};

const FOREX_PIP = {
  EURUSD: 10, GBPUSD: 10, USDJPY: 0.1, XAUUSD: 1,
  AUDUSD: 10, USDCAD: 10, NZDUSD: 10, EURGBP: 10,
};

export default function RiskCalculator() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [market, setMarket] = useState("futures");   // "futures" | "forex"
  const [riskPercent, setRiskPercent] = useState(1);
  const [riskDollarOverride, setRiskDollarOverride] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [symbol, setSymbol] = useState("MNQ");

  useEffect(() => { loadAccounts(); }, []);

  // Reset symbol when market changes so we don't leave a stale futures preset selected in forex mode.
  useEffect(() => {
    setSymbol(market === "futures" ? "MNQ" : "EURUSD");
  }, [market]);

  const loadAccounts = async () => {
    const data = await Account.list("-created_date");
    setAccounts(data);
    if (data.length > 0) setSelectedAccount(data[0]);
  };

  const result = useMemo(() => {
    if (!selectedAccount || !entryPrice || !stopLoss) return null;
    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);
    if (isNaN(entry) || isNaN(sl) || entry === sl) return null;

    const balance = selectedAccount.current_balance || 0;
    // Manual $ override wins if provided; otherwise use % of balance.
    const overrideNum = parseFloat(riskDollarOverride);
    const riskAmount = !isNaN(overrideNum) && overrideNum > 0
      ? overrideNum
      : balance * (riskPercent / 100);

    if (market === "futures") {
      const preset = FUTURES[symbol];
      if (!preset) return null;
      const stopPoints = Math.abs(entry - sl);
      const stopTicks = Math.round(stopPoints / preset.tick);
      const dollarPerContract = stopPoints * preset.pv;
      if (dollarPerContract <= 0) return null;

      const contractsFloat = riskAmount / dollarPerContract;
      const contracts = Math.max(0, Math.floor(contractsFloat));
      const actualRisk = contracts * dollarPerContract;

      const isLong = entry > sl;
      const rewardRatios = [1.0, 2.0, 3.0].map(ratio => {
        const targetPoints = stopPoints * ratio;
        const rawTarget = isLong ? entry + targetPoints : entry - targetPoints;
        const targetPrice = Math.round(rawTarget / preset.tick) * preset.tick;
        const profit = targetPoints * preset.pv * contracts;
        return { ratio, targetPrice, targetTicks: Math.round(targetPoints / preset.tick), profit };
      });

      // Suggest micro if full-size rounded down to zero.
      const microMap = { NQ: "MNQ", ES: "MES", RTY: "M2K", YM: "MYM", GC: "MGC", NG: "MNG" };
      const microSuggest = (contracts === 0 && microMap[symbol]) ? microMap[symbol] : null;

      return {
        kind: "futures",
        balance, riskAmount, actualRisk,
        stopPoints, stopTicks,
        dollarPerContract, contracts, contractsFloat,
        preset, symbol,
        rewardRatios, microSuggest,
      };
    }

    // Forex
    const pipValue = FOREX_PIP[symbol] || 10;
    const jpy = symbol === "USDJPY";
    const pipMultiplier = jpy ? 100 : 10000;
    const pips = Math.abs((entry - sl) * pipMultiplier);
    if (pips <= 0) return null;
    const lotSizeRaw = riskAmount / (pips * pipValue);
    const lotSize = Math.round(lotSizeRaw * 100) / 100;
    const actualRisk = lotSize * pips * pipValue;
    const isLong = entry > sl;
    const rewardRatios = [1.0, 2.0, 3.0].map(ratio => {
      const targetPips = pips * ratio;
      const targetPrice = isLong
        ? entry + (targetPips / pipMultiplier)
        : entry - (targetPips / pipMultiplier);
      const profit = targetPips * pipValue * lotSize;
      return { ratio, targetPrice, targetPips, profit };
    });
    return {
      kind: "forex",
      balance, riskAmount, actualRisk,
      pips, pipValue, lotSize,
      rewardRatios,
    };
  }, [selectedAccount, entryPrice, stopLoss, riskPercent, riskDollarOverride, market, symbol]);

  const symbols = market === "futures" ? Object.keys(FUTURES) : Object.keys(FOREX_PIP);
  const priceStep = market === "futures" ? (FUTURES[symbol]?.tick ?? 0.25) : 0.00001;
  const priceDecimals = market === "futures"
    ? (FUTURES[symbol]?.tick === 1 ? 0 : FUTURES[symbol]?.tick === 0.001 ? 3 : FUTURES[symbol]?.tick === 0.01 ? 2 : FUTURES[symbol]?.tick === 0.10 ? 1 : 2)
    : (symbol === "USDJPY" ? 3 : 5);

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Risk Calculator</h1>
          <p className="text-slate-400">Position size + TP targets — futures and forex.</p>
        </div>

        {/* Market toggle */}
        <div className="mb-4 inline-flex rounded-lg border border-slate-700 bg-slate-900 p-1">
          {["futures", "forex"].map(m => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                market === m
                  ? "bg-blue-500 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {m === "futures" ? "Futures" : "Forex"}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="border-b border-slate-800">
              <CardTitle className="text-white flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-500" />
                Input Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label className="text-slate-300">Account</Label>
                <Select
                  value={selectedAccount?.id ? String(selectedAccount.id) : ""}
                  onValueChange={(val) => setSelectedAccount(accounts.find(a => String(a.id) === val))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="Choose account" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={String(acc.id)} className="text-white">
                        {acc.name} — ${acc.current_balance?.toFixed(2) ?? "0.00"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">
                  {market === "futures" ? "Contract" : "Pair"}
                </Label>
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 max-h-72">
                    {symbols.map(sym => (
                      <SelectItem key={sym} value={sym} className="text-white">
                        {sym}{market === "futures" && FUTURES[sym] ? ` — ${FUTURES[sym].name}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {market === "futures" && FUTURES[symbol] && (
                  <div className="text-xs text-slate-500 font-mono pt-1">
                    tick {FUTURES[symbol].tick} · ${FUTURES[symbol].pv}/pt · ${(FUTURES[symbol].tick * FUTURES[symbol].pv).toFixed(2)}/tick
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-slate-300">Risk %</Label>
                  <Input
                    type="number" step="0.1" min="0"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(parseFloat(e.target.value) || 0)}
                    className="bg-slate-800 border-slate-700 text-white font-mono"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Or Risk $ (override)</Label>
                  <Input
                    type="number" step="10" min="0"
                    value={riskDollarOverride}
                    onChange={(e) => setRiskDollarOverride(e.target.value)}
                    placeholder="e.g. 200"
                    className="bg-slate-800 border-slate-700 text-white font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Entry Price</Label>
                <Input
                  type="number" step={priceStep}
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder={market === "futures" ? "20120.50" : "1.09500"}
                  className="bg-slate-800 border-slate-700 text-white font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Stop Loss</Label>
                <Input
                  type="number" step={priceStep}
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder={market === "futures" ? "20100.00" : "1.09000"}
                  className="bg-slate-800 border-slate-700 text-white font-mono"
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {result && (
              <>
                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="border-b border-slate-800">
                    <CardTitle className="text-white flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-blue-500" />
                      Position Sizing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    <Row label="Account Balance" value={`$${result.balance.toFixed(2)}`} />
                    <Row label="Risk Budget" value={`$${result.riskAmount.toFixed(2)}`} tone="red" />
                    {result.kind === "futures" ? (
                      <>
                        <Row
                          label="Stop Distance"
                          value={`${result.stopTicks} ticks · ${result.stopPoints.toFixed(priceDecimals)} pts`}
                        />
                        <Row
                          label="Risk per Contract"
                          value={`$${result.dollarPerContract.toFixed(2)}`}
                        />
                        <Row
                          label="Recommended Contracts"
                          value={`${result.contracts}`}
                          bigValue
                          tone="blue"
                          sub={result.contracts > 0
                            ? `Actual risk $${result.actualRisk.toFixed(2)} (${result.contractsFloat.toFixed(2)} rounded down)`
                            : "Below 1 contract — consider a micro"}
                        />
                        {result.microSuggest && (
                          <div className="mt-2 p-3 bg-slate-800 border border-slate-600 rounded-md text-sm text-slate-200">
                            Full-size rounds to 0 contracts. Switch to <button
                              onClick={() => setSymbol(result.microSuggest)}
                              className="underline font-bold text-blue-300 hover:text-blue-200">{result.microSuggest}</button> for micro sizing.
                          </div>
                        )}

                        {/* Task #141 — Margin preview (day + overnight). */}
                        {(() => {
                          const spec = assetSpec(result.symbol);
                          if (!spec || result.contracts <= 0) return null;
                          const dayMargin = spec.day_margin * result.contracts;
                          const onMargin  = spec.overnight_margin * result.contracts;
                          const dayPct = result.balance > 0 ? (dayMargin / result.balance) * 100 : 0;
                          const onPct  = result.balance > 0 ? (onMargin  / result.balance) * 100 : 0;
                          const warnings = sizingWarnings({
                            qty: result.contracts,
                            marginPct: dayPct,
                            riskUsd: result.actualRisk,
                            balance: result.balance,
                            daily_loss_limit: selectedAccount?.daily_loss_limit || 0,
                          });
                          return (
                            <div className="mt-4 pt-4 border-t border-slate-800 space-y-2">
                              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1">
                                <Layers className="w-3 h-3 text-blue-400"/>Margin required for {result.contracts} × {spec.root}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <MarginTile label="Day session"
                                            amount={dayMargin}
                                            pct={dayPct}
                                            warn={dayPct > 50}/>
                                <MarginTile label="Overnight (held past session close)"
                                            amount={onMargin}
                                            pct={onPct}
                                            warn={onPct > 80}/>
                              </div>
                              {warnings.length > 0 && (
                                <div className="space-y-1">
                                  {warnings.map((w, i) => (
                                    <div key={i}
                                         className={`text-[11px] px-2.5 py-1.5 rounded-md border ${
                                           w.level === "danger"
                                             ? "bg-red-950/50 border-red-800/60 text-red-200"
                                             : "bg-slate-800 border-slate-700 text-slate-200"
                                         }`}>
                                      <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5"/>{w.msg}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <Row label="Stop Distance" value={`${result.pips.toFixed(1)} pips`} />
                        <Row label="$ per Pip" value={`$${result.pipValue.toFixed(2)}`} />
                        <Row label="Recommended Lot Size" value={result.lotSize.toFixed(2)} bigValue tone="blue" />
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="border-b border-slate-800">
                    <CardTitle className="text-white flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                      Take Profit Targets
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-3">
                    {result.rewardRatios.map((rr, idx) => (
                      <div key={idx} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-sm text-slate-400">TP{idx + 1} · RR {rr.ratio.toFixed(1)}</span>
                          <span className="text-lg font-bold text-green-400 font-mono">
                            +${rr.profit.toFixed(2)}
                          </span>
                        </div>
                        <div className="text-sm text-slate-300 font-mono flex justify-between">
                          <span>Target {rr.targetPrice.toFixed(priceDecimals)}</span>
                          <span className="text-slate-500">
                            {result.kind === "futures" ? `+${rr.targetTicks} ticks` : `${rr.targetPips.toFixed(1)} pips`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MarginTile({ label, amount, pct, warn }) {
  return (
    <div className={`rounded-md border p-2.5 ${warn ? "border-red-800/60 bg-red-950/30" : "border-slate-700 bg-slate-950"}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-lg font-bold font-mono tabular-nums ${warn ? "text-red-300" : "text-white"}`}>
        ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div className={`text-[10px] font-mono ${warn ? "text-red-400" : "text-slate-500"}`}>
        {pct.toFixed(1)}% of balance
      </div>
    </div>
  );
}

function Row({ label, value, tone = "default", bigValue = false, sub = null }) {
  const bg = tone === "red" ? "bg-red-500/10 border border-red-500/30"
           : tone === "blue" ? "bg-blue-500/10 border border-blue-500/30"
           : "bg-slate-800";
  const valColor = tone === "red" ? "text-red-400"
                 : tone === "blue" ? "text-blue-400"
                 : "text-white";
  return (
    <div className={`p-3 rounded-lg ${bg}`}>
      <div className="flex justify-between items-center">
        <span className="text-slate-400 text-sm">{label}</span>
        <span className={`${bigValue ? "text-2xl" : "text-lg"} font-bold ${valColor} font-mono tabular-nums`}>
          {value}
        </span>
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}
