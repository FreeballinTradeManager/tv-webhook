import React, { useState, useEffect } from "react";
import { Trade, Account, Strategy } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Save, Upload } from "lucide-react";
import { UploadFile } from "@/integrations/Core";

export default function NewTrade() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [strategies, setStrategies] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    account_id: "",
    symbol: "",
    direction: "long",
    entry_price: "",
    exit_price: "",
    stop_loss: "",
    take_profit_1: "",
    take_profit_2: "",
    take_profit_3: "",
    lot_size: "",
    risk_percentage: "",
    risk_amount: "",
    profit_loss: "",
    pips: "",
    entry_time: new Date().toISOString().slice(0, 16),
    exit_time: "",
    session: "london",
    strategy_id: "",
    trailing_stop_used: false,
    trailing_stop_distance: "",
    status: "closed",
    notes: "",
    screenshot_url: ""
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [accountsData, strategiesData] = await Promise.all([
      Account.list("-created_date"),
      Strategy.list("-created_date")
    ]);
    setAccounts(accountsData);
    setStrategies(strategiesData);
    if (accountsData.length > 0) {
      setFormData(prev => ({ ...prev, account_id: accountsData[0].id }));
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const { file_url } = await UploadFile({ file });
    setFormData(prev => ({ ...prev, screenshot_url: file_url }));
    setUploading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    const tradeData = { ...formData };
    Object.keys(tradeData).forEach(key => {
      if (tradeData[key] === "") delete tradeData[key];
    });

    await Trade.create(tradeData);

    if (tradeData.strategy_id) {
      const strategy = strategies.find(s => s.id === tradeData.strategy_id);
      if (strategy) {
        const newTotalTrades = (strategy.total_trades || 0) + 1;
        const newTotalProfit = (strategy.total_profit || 0) + (parseFloat(tradeData.profit_loss) || 0);
        await Strategy.update(strategy.id, {
          total_trades: newTotalTrades,
          total_profit: newTotalProfit
        });
      }
    }

    if (tradeData.account_id && tradeData.profit_loss) {
      const account = accounts.find(a => a.id === tradeData.account_id);
      if (account) {
        await Account.update(account.id, {
          current_balance: (account.current_balance || 0) + parseFloat(tradeData.profit_loss)
        });
      }
    }

    setSaving(false);
    navigate(createPageUrl("Trades"));
  };

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate(createPageUrl("Dashboard"))}
            className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-white">Log New Trade</h1>
            <p className="text-slate-400">Record your trade details for tracking</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="border-b border-slate-800">
              <CardTitle className="text-white">Trade Information</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="account_id" className="text-slate-300">Account *</Label>
                  <Select value={formData.account_id} onValueChange={(val) => handleChange("account_id", val)} required>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {accounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id} className="text-white">
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="symbol" className="text-slate-300">Symbol *</Label>
                  <Input
                    id="symbol"
                    value={formData.symbol}
                    onChange={(e) => handleChange("symbol", e.target.value)}
                    placeholder="e.g., EURUSD, XAUUSD"
                    required
                    className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="direction" className="text-slate-300">Direction *</Label>
                  <Select value={formData.direction} onValueChange={(val) => handleChange("direction", val)} required>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="long" className="text-green-400">LONG (Buy)</SelectItem>
                      <SelectItem value="short" className="text-red-400">SHORT (Sell)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="session" className="text-slate-300">Session *</Label>
                  <Select value={formData.session} onValueChange={(val) => handleChange("session", val)} required>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="london" className="text-white">London</SelectItem>
                      <SelectItem value="new_york" className="text-white">New York</SelectItem>
                      <SelectItem value="asian" className="text-white">Asian</SelectItem>
                      <SelectItem value="daily" className="text-white">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="entry_price" className="text-slate-300">Entry Price *</Label>
                  <Input
                    id="entry_price"
                    type="number"
                    step="0.00001"
                    value={formData.entry_price}
                    onChange={(e) => handleChange("entry_price", e.target.value)}
                    required
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exit_price" className="text-slate-300">Exit Price</Label>
                  <Input
                    id="exit_price"
                    type="number"
                    step="0.00001"
                    value={formData.exit_price}
                    onChange={(e) => handleChange("exit_price", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stop_loss" className="text-slate-300">Stop Loss</Label>
                  <Input
                    id="stop_loss"
                    type="number"
                    step="0.00001"
                    value={formData.stop_loss}
                    onChange={(e) => handleChange("stop_loss", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="take_profit_1" className="text-slate-300">Take Profit 1</Label>
                  <Input
                    id="take_profit_1"
                    type="number"
                    step="0.00001"
                    value={formData.take_profit_1}
                    onChange={(e) => handleChange("take_profit_1", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lot_size" className="text-slate-300">Lot Size</Label>
                  <Input
                    id="lot_size"
                    type="number"
                    step="0.01"
                    value={formData.lot_size}
                    onChange={(e) => handleChange("lot_size", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="profit_loss" className="text-slate-300">P&L ($)</Label>
                  <Input
                    id="profit_loss"
                    type="number"
                    step="0.01"
                    value={formData.profit_loss}
                    onChange={(e) => handleChange("profit_loss", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pips" className="text-slate-300">Pips</Label>
                  <Input
                    id="pips"
                    type="number"
                    step="0.1"
                    value={formData.pips}
                    onChange={(e) => handleChange("pips", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="strategy_id" className="text-slate-300">Strategy</Label>
                  <Select value={formData.strategy_id} onValueChange={(val) => handleChange("strategy_id", val)}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue placeholder="Select strategy (optional)" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {strategies.map(strategy => (
                        <SelectItem key={strategy.id} value={strategy.id} className="text-white">
                          {strategy.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes" className="text-slate-300">Trade Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  placeholder="Add notes about trade setup, emotions, lessons learned..."
                  rows={4}
                  className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Chart Screenshot</Label>
                <div className="flex gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="screenshot"
                  />
                  <label htmlFor="screenshot">
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-slate-800 border-slate-700 text-slate-300"
                      disabled={uploading}
                      onClick={() => document.getElementById('screenshot').click()}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {uploading ? "Uploading..." : "Upload Screenshot"}
                    </Button>
                  </label>
                  {formData.screenshot_url && (
                    <span className="text-sm text-green-500 flex items-center">✓ Screenshot uploaded</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(createPageUrl("Dashboard"))}
                  className="bg-slate-800 border-slate-700 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? "Saving..." : "Save Trade"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
