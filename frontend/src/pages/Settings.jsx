import React, { useState, useEffect } from "react";
import { User } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Save, Info, User as UserIcon, Palette } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import NotifyDeliveryCard from "@/components/NotifyDeliveryCard";

// Task #142 + #181 — persisted trader profile + theme.
// localStorage-backed so it's portable and works even before backend
// user_settings shape catches up.
const PROFILE_KEY = "tradecore_trader_profile_v1";
const THEME_KEY   = "tradecore_theme_v1";

const TF_OPTIONS = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "D"];
const ASSET_OPTIONS = ["MNQ", "NQ", "MES", "ES", "MYM", "YM", "M2K", "RTY", "MGC", "GC", "MNG", "NG", "CL", "EURUSD", "6E", "GBPUSD"];
const RISK_STYLES = [
  { key: "flat",    label: "Flat $ risk", hint: "Same $ per trade regardless of streak" },
  { key: "half",    label: "Half-after-losses", hint: "Cut $ risk in half after N consecutive losses" },
  { key: "percent", label: "% of balance", hint: "Fixed % of current account balance" },
];

const THEME_ACCENTS = [
  { key: "blue",    label: "Signal Blue", css: "217 91% 60%" },
  { key: "teal",    label: "Tape Teal",   css: "173 80% 40%" },
  { key: "violet",  label: "Trader Violet", css: "270 60% 55%" },
  { key: "emerald", label: "Prop Green",  css: "160 84% 40%" },
];
const THEME_FONTS = [
  { key: "system", label: "System Sans (default)", css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { key: "inter",  label: "Inter",                  css: "'Inter', -apple-system, sans-serif" },
  { key: "mono",   label: "Monospace",              css: "'SF Mono', ui-monospace, Menlo, Consolas, monospace" },
  { key: "serif",  label: "Serif",                  css: "Georgia, 'Iowan Old Style', serif" },
];

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { return {}; }
}
function loadTheme() {
  try { return JSON.parse(localStorage.getItem(THEME_KEY) || "{}"); } catch { return {}; }
}
function applyTheme(theme) {
  const accent = THEME_ACCENTS.find(a => a.key === theme.accent) || THEME_ACCENTS[0];
  const font   = THEME_FONTS.find(f => f.key === theme.font)     || THEME_FONTS[0];
  const root = document.documentElement;
  root.style.setProperty("--primary", accent.css);
  root.style.setProperty("--tradecore-font", font.css);
  document.body.style.fontFamily = font.css;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [profile, setProfile] = useState(loadProfile);
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    loadSettings();
    const url = `${window.location.origin}/api/log_trade`;
    setWebhookUrl(url);
  }, []);

  useEffect(() => { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }, [profile]);
  useEffect(() => {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    applyTheme(theme);
  }, [theme]);

  const toggleInList = (list, val) => (list || []).includes(val)
    ? (list || []).filter(x => x !== val)
    : [...(list || []), val];

  const loadSettings = async () => {
    setLoading(true);
    const user = await User.me();
    setSettings({
      notification_settings: user.notification_settings || {},
      alert_configuration: user.alert_configuration || {},
      trader_response: user.trader_response || {},
      desktop_header_text: user.desktop_header_text || "TradeCore",
      trader_name: user.trader_name || "",
      trading_rules: user.trading_rules || [],
      welcome_message_template: user.welcome_message_template || "Let's bank some coin {name}!! Stick to your rules",
    });
    setLoading(false);
  };

  // Rules editor helpers — string of \n-separated rules ↔ array
  const rulesText = (settings?.trading_rules || []).join('\n');
  const setRulesText = (text) => setSettings(prev => ({
    ...prev,
    trading_rules: text.split('\n').map(s => s.trim()).filter(Boolean),
  }));

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
          <CardHeader><CardTitle className="text-white">Your Profile</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trader_name" className="text-slate-300">Your Name</Label>
              <Input
                id="trader_name"
                value={settings.trader_name || ""}
                onChange={(e) => setSettings({...settings, trader_name: e.target.value})}
                placeholder="e.g. Natalia"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <p className="text-xs text-slate-500">Used in your Dashboard greeting.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome_msg" className="text-slate-300">Welcome Message</Label>
              <Input
                id="welcome_msg"
                value={settings.welcome_message_template || ""}
                onChange={(e) => setSettings({...settings, welcome_message_template: e.target.value})}
                placeholder="Let's bank some coin {name}!! Stick to your rules"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <p className="text-xs text-slate-500">Use <code>{'{name}'}</code> where your name should appear.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trading_rules" className="text-slate-300">Your Trading Rules</Label>
              <textarea
                id="trading_rules"
                value={rulesText}
                onChange={(e) => setRulesText(e.target.value)}
                placeholder={"No revenge trades\nMax 3 trades per day\nStop trading by 2pm ET\nOnly trade with the trend\nJournal every trade"}
                rows={8}
                className="w-full bg-slate-800 border border-slate-700 rounded-md p-3 text-white text-sm font-mono"
              />
              <p className="text-xs text-slate-500">
                One rule per line. Shown on the Dashboard as a daily checklist —
                tick each one before you take your first trade of the day.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Task #142 — Trader profile: default preferred TFs / assets / strategies. */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-blue-400"/> Trader Profile
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              These defaults auto-fill new trade entries, filter analytics, and hint the AI Coach on what you actually trade.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Preferred timeframes</Label>
              <div className="flex flex-wrap gap-2">
                {TF_OPTIONS.map(tf => {
                  const on = (profile.timeframes || []).includes(tf);
                  return (
                    <button key={tf} type="button"
                            onClick={() => setProfile(p => ({ ...p, timeframes: toggleInList(p.timeframes, tf) }))}
                            className={`px-3 h-8 rounded-md text-xs font-semibold border transition-colors ${
                              on
                                ? "bg-blue-600 border-blue-500 text-white"
                                : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                            }`}>
                      {tf}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Preferred assets</Label>
              <div className="flex flex-wrap gap-2">
                {ASSET_OPTIONS.map(a => {
                  const on = (profile.assets || []).includes(a);
                  return (
                    <button key={a} type="button"
                            onClick={() => setProfile(p => ({ ...p, assets: toggleInList(p.assets, a) }))}
                            className={`px-3 h-8 rounded-md text-xs font-semibold font-mono border transition-colors ${
                              on
                                ? "bg-blue-600 border-blue-500 text-white"
                                : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                            }`}>
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Risk sizing style</Label>
              <div className="grid grid-cols-1 gap-2">
                {RISK_STYLES.map(rs => {
                  const on = (profile.risk_style || "flat") === rs.key;
                  return (
                    <button key={rs.key} type="button"
                            onClick={() => setProfile(p => ({ ...p, risk_style: rs.key }))}
                            className={`text-left px-3 py-2 rounded-md border transition-colors ${
                              on
                                ? "bg-blue-600/20 border-blue-500 text-white"
                                : "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600"
                            }`}>
                      <div className="text-sm font-semibold">{rs.label}</div>
                      <div className="text-xs text-slate-400">{rs.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Task #181 — Font + color theme customization. */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Palette className="w-5 h-5 text-blue-400"/> Theme
            </CardTitle>
            <p className="text-xs text-slate-400 mt-1">
              Change TradeCore's accent color and font. Applied immediately, saved to your browser.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Accent color</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {THEME_ACCENTS.map(a => {
                  const on = (theme.accent || "blue") === a.key;
                  return (
                    <button key={a.key} type="button"
                            onClick={() => setTheme(t => ({ ...t, accent: a.key }))}
                            className={`px-3 py-2 rounded-md border transition-all ${
                              on ? "border-white ring-2 ring-white/30" : "border-slate-700 hover:border-slate-600"
                            }`}
                            style={{ background: `hsl(${a.css} / 0.15)` }}>
                      <div className="w-full h-2 rounded-full mb-1.5" style={{ background: `hsl(${a.css})` }}/>
                      <div className="text-xs text-white text-left font-semibold">{a.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">Font family</Label>
              <div className="grid grid-cols-1 gap-2">
                {THEME_FONTS.map(f => {
                  const on = (theme.font || "system") === f.key;
                  return (
                    <button key={f.key} type="button"
                            onClick={() => setTheme(t => ({ ...t, font: f.key }))}
                            className={`text-left px-3 py-2 rounded-md border transition-colors ${
                              on
                                ? "bg-blue-600/20 border-blue-500 text-white"
                                : "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600"
                            }`}
                            style={{ fontFamily: f.css }}>
                      <div className="text-sm font-semibold">{f.label}</div>
                      <div className="text-xs text-slate-400">The quick brown fox — 0123456789</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button type="button"
                    onClick={() => { setTheme({}); applyTheme({}); }}
                    className="text-xs text-slate-400 hover:text-white underline">
              Reset to defaults
            </button>
          </CardContent>
        </Card>

        <NotifyDeliveryCard />

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white">Notification Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Position Hit</Label>
              <Switch checked={settings.notification_settings.position_hit ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'position_hit', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Entry Filled</Label>
              <Switch checked={settings.notification_settings.entry_filled ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'entry_filled', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Price Near Key Level</Label>
              <Switch checked={settings.notification_settings.price_near_level ?? false}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'price_near_level', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Stop Moved (BE / Trail / Creep)</Label>
              <Switch checked={settings.notification_settings.stop_moved ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'stop_moved', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Emergency Close Fired</Label>
              <Switch checked={settings.notification_settings.emergency_close ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'emergency_close', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Daily Loss Approaching Limit</Label>
              <Switch checked={settings.notification_settings.daily_loss_approaching ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'daily_loss_approaching', val)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-white text-base">Prop Firm Rule Warning</Label>
              <Switch checked={settings.notification_settings.prop_firm_warning ?? true}
                      onCheckedChange={(val) => handleUpdate('notification_settings', 'prop_firm_warning', val)} />
            </div>
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
