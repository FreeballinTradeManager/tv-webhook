import React, { useState, useEffect } from "react";
import { Account } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, AlertTriangle, TrendingUp } from "lucide-react";

export default function RiskCalculator() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [riskPercent, setRiskPercent] = useState(1);
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [symbol, setSymbol] = useState("EURUSD");

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    const data = await Account.list("-created_date");
    setAccounts(data);
    if (data.length > 0) setSelectedAccount(data[0]);
  };

  const pipValues = {
    EURUSD: 10,
    GBPUSD: 10,
    USDJPY: 0.1,
    XAUUSD: 1,
    AUDUSD: 10,
    USDCAD: 10,
    NZDUSD: 10,
    EURGBP: 10
  };

  const calculatePosition = () => {
    if (!selectedAccount || !entryPrice || !stopLoss) return null;

    const balance = selectedAccount.current_balance || 0;
    const riskAmount = balance * (riskPercent / 100);
    const entry = parseFloat(entryPrice);
    const sl = parseFloat(stopLoss);
    const pipValue = pipValues[symbol] || 10;

    const pips = Math.abs((entry - sl) * (symbol === "USDJPY" ? 100 : 10000));
    const lotSize = riskAmount / (pips * pipValue);

    const rewardRatios = [1.5, 2, 3].map(ratio => {
      const targetPips = pips * ratio;
      const targetPrice = entry > sl
        ? entry + (targetPips / (symbol === "USDJPY" ? 100 : 10000))
        : entry - (targetPips / (symbol === "USDJPY" ? 100 : 10000));
      const potentialProfit = targetPips * pipValue * lotSize;
      return { ratio, targetPrice: targetPrice.toFixed(5), potentialProfit };
    });

    return {
      balance,
      riskAmount,
      pips: pips.toFixed(1),
      lotSize: lotSize.toFixed(2),
      rewardRatios
    };
  };

  const result = calculatePosition();

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Risk Calculator</h1>
          <p className="text-slate-400">Calculate optimal position sizes and risk management</p>
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
                <Label className="text-slate-300">Select Account</Label>
                <Select
                  value={selectedAccount?.id}
                  onValueChange={(val) => setSelectedAccount(accounts.find(a => a.id === val))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue placeholder="Choose account" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id} className="text-white">
                        {acc.name} - ${acc.current_balance?.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Trading Pair</Label>
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {Object.keys(pipValues).map(pair => (
                      <SelectItem key={pair} value={pair} className="text-white">
                        {pair}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Risk Percentage (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Entry Price</Label>
                <Input
                  type="number"
                  step="0.00001"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="1.09500"
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Stop Loss</Label>
                <Input
                  type="number"
                  step="0.00001"
                  value={stopLoss}
                  onChange={(e) => setStopLoss(e.target.value)}
                  placeholder="1.09000"
                  className="bg-slate-800 border-slate-700 text-white"
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
                      <AlertTriangle className="w-5 h-5 text-orange-500" />
                      Position Sizing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between items-center p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-400">Account Balance</span>
                      <span className="text-xl font-bold text-white">${result.balance.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <span className="text-slate-400">Risk Amount</span>
                      <span className="text-xl font-bold text-red-400">${result.riskAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-400">Stop Loss Distance</span>
                      <span className="text-xl font-bold text-white">{result.pips} pips</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                      <span className="text-slate-400">Recommended Lot Size</span>
                      <span className="text-2xl font-bold text-blue-400">{result.lotSize}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-slate-900 border-slate-800">
                  <CardHeader className="border-b border-slate-800">
                    <CardTitle className="text-white flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-green-500" />
                      Take Profit Targets
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-6 space-y-4">
                    {result.rewardRatios.map((rr, idx) => (
                      <div key={idx} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm text-slate-400">TP{idx + 1} (R:{rr.ratio})</span>
                          <span className="text-lg font-bold text-green-400">+${rr.potentialProfit.toFixed(2)}</span>
                        </div>
                        <div className="text-sm text-slate-300">
                          Target: <span className="font-mono">{rr.targetPrice}</span>
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
