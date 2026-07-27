import React, { useState, useEffect } from "react";
import { User } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Save, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

  useEffect(() => {
    loadSettings();
    const url = `${window.location.origin}/api/log_trade`;
    setWebhookUrl(url);
  }, []);

  const loadSettings = async () => {
    setLoading(true);
    const user = await User.me();
    setSettings({
      notification_settings: user.notification_settings || {},
      alert_configuration: user.alert_configuration || {},
      trader_response: user.trader_response || {},
      desktop_header_text: user.desktop_header_text || "TradeCore",
    });
    setLoading(false);
  };

  const handleUpdate = (category, key, value) => {
    setSettings(prev => ({
      ...prev,
      [category]: { ...prev[category], [key]: value },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    await User.updateMyUserData(settings);
    setSaving(false);
  };

  if (loading || !settings) {
    return (
       <div className="p-8"><Skeleton className="h-[500px] w-full bg-slate-800" /></div>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-slate-400">Customize your trading environment.</p>
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Notification Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between"><Label>London Automation Chat</Label><Switch checked={settings.notification_settings.london_automation} onCheckedChange={(val) => handleUpdate('notification_settings', 'london_automation', val)} /></div>
            <div className="flex items-center justify-between"><Label>NY ORB Strategy Chat</Label><Switch checked={settings.notification_settings.ny_orb_strategy} onCheckedChange={(val) => handleUpdate('notification_settings', 'ny_orb_strategy', val)} /></div>
            <div className="flex items-center justify-between"><Label>Daily Levels Chat</Label><Switch checked={settings.notification_settings.daily_levels} onCheckedChange={(val) => handleUpdate('notification_settings', 'daily_levels', val)} /></div>
            <div className="flex items-center justify-between"><Label>Support & Community</Label><Switch checked={settings.notification_settings.support_community} onCheckedChange={(val) => handleUpdate('notification_settings', 'support_community', val)} /></div>
            <div className="flex items-center justify-between"><Label>Enable AI Assistant</Label><Switch checked={settings.notification_settings.enable_ai} onCheckedChange={(val) => handleUpdate('notification_settings', 'enable_ai', val)} /></div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Alert Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between"><Label>TP Hit Alert</Label><Switch checked={settings.alert_configuration.tp_hit} onCheckedChange={(val) => handleUpdate('alert_configuration', 'tp_hit', val)} /></div>
            <div className="flex items-center justify-between"><Label>Loss Alert</Label><Switch checked={settings.alert_configuration.loss_alert} onCheckedChange={(val) => handleUpdate('alert_configuration', 'loss_alert', val)} /></div>
            <div className="flex items-center justify-between"><Label>Guardian Lock Alert</Label><Switch checked={settings.alert_configuration.guardian_lock} onCheckedChange={(val) => handleUpdate('alert_configuration', 'guardian_lock', val)} /></div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Trader Response Options</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-6">
            <div>
              <Label className="mb-2 block">Win Popups</Label>
              <RadioGroup value={settings.trader_response.win_popup} onValueChange={(val) => handleUpdate('trader_response', 'win_popup', val)}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="gold" id="r1" /><Label htmlFor="r1">Gold</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="grey" id="r2" /><Label htmlFor="r2">Grey</Label></div>
              </RadioGroup>
            </div>
            <div>
              <Label className="mb-2 block">Loss Popups</Label>
              <RadioGroup value={settings.trader_response.loss_popup} onValueChange={(val) => handleUpdate('trader_response', 'loss_popup', val)}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="motivational" id="r3" /><Label htmlFor="r3">Motivational</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="ai_advice" id="r4" /><Label htmlFor="r4">AI Advice</Label></div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Appearance</CardTitle></CardHeader>
          <CardContent>
             <div className="space-y-2">
                <Label htmlFor="header_text">Desktop Header Text</Label>
                <Input id="header_text" value={settings.desktop_header_text} onChange={(e) => setSettings({...settings, desktop_header_text: e.target.value})} className="bg-slate-800 border-slate-700"/>
              </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white">Webhook Integration</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <p className="text-slate-400">Automate trade logging by sending a POST request to the URL below from your trading bot or a service like TradingView.</p>
                <Alert className="bg-slate-800 border-slate-700">
                    <Info className="h-4 w-4 text-blue-400" />
                    <AlertTitle className="text-white">Your Webhook URL</AlertTitle>
                    <AlertDescription className="text-slate-400 break-all">{webhookUrl}</AlertDescription>
                </Alert>
                <div>
                  <h4 className="font-semibold text-slate-300 mb-2">Required JSON Body:</h4>
                  <pre className="p-3 bg-slate-950 rounded-md text-xs text-slate-300 overflow-x-auto">
                    <code>
{`{
  "account_id": "YOUR_ACCOUNT_ID",
  "symbol": "EURUSD",
  "direction": "long",
  "entry_price": 1.0950,
  "exit_price": 1.0975,
  "stop_loss": 1.0925,
  "profit_loss": 250.00,
  "pips": 25,
  "session": "london",
  "strategy_id": "OPTIONAL_STRATEGY_ID"
}`}
                    </code>
                  </pre>
                </div>
            </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
