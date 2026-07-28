import React, { useState, useEffect } from "react";
import { User, Account, Strategy, Group, Goal } from "@/entities/all";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import {
  Sparkles, ListChecks, Wallet, BookOpen, Users, Link2, Target,
  CheckCircle2, ArrowRight, ArrowLeft, Copy, Zap
} from "lucide-react";

// ---------------- Prop firm presets (task #122 stub) ----------------
// One-click templates for the common firms with pre-loaded rules.
const PROP_FIRM_PRESETS = [
  { firm: "FTMO", broker: "mt5", env: "demo", daily_loss_limit: 5000, max_trades_today: 0, weekend_close_required: true },
  { firm: "MyForexFunds", broker: "mt5", env: "demo", daily_loss_limit: 2500, weekend_close_required: true },
  { firm: "Apex", broker: "tradovate", env: "demo", daily_loss_limit: 2500, weekend_close_required: true },
  { firm: "Lucid", broker: "tradovate", env: "demo", daily_loss_limit: 1500, weekend_close_required: false },
  { firm: "Blueberry Funded", broker: "tradovate", env: "demo", daily_loss_limit: 2000, weekend_close_required: true },
  { firm: "TopStep", broker: "tradovate", env: "demo", daily_loss_limit: 2000, weekend_close_required: true },
  { firm: "The5ers", broker: "mt5", env: "demo", daily_loss_limit: 500, weekend_close_required: true },
  { firm: "TopOneTrader", broker: "mt5", env: "demo", daily_loss_limit: 1500, weekend_close_required: true },
  { firm: "Custom", broker: "simulated", env: "demo", daily_loss_limit: 500, weekend_close_required: false },
];

// ---------------- Step configuration ----------------
const STEPS = [
  { id: "profile",   title: "Your Profile",  icon: Sparkles },
  { id: "rules",     title: "Trading Rules", icon: ListChecks },
  { id: "account",   title: "First Account", icon: Wallet },
  { id: "strategy",  title: "First Strategy",icon: BookOpen },
  { id: "group",     title: "Rotation Group",icon: Users },
  { id: "alert",     title: "TradingView Alert", icon: Link2 },
  { id: "goal",      title: "Set a Goal",    icon: Target },
  { id: "done",      title: "You're Live!",  icon: CheckCircle2 },
];

export default function SetupPage() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState({
    // Profile
    trader_name: "",
    welcome_message_template: "Let's bank some coin {name}!! Stick to your rules",
    // Rules
    trading_rules: [
      "No revenge trades",
      "Max 3 trades per day",
      "Stop trading by 2pm ET",
      "Only trade with the trend",
      "Journal every trade",
    ],
    // Account
    firm_preset: "Apex",
    account_name: "",
    account_daily_loss_limit: 2500,
    account_weekend_close: true,
    account_max_concurrent: 3,
    // Strategy
    strategy_name: "",
    strategy_broker_format: "futures",
    strategy_description: "",
    strategy_timeframe: "5m",
    // Group
    group_name: "",
    group_rotate_wins: 2,
    group_rotate_losses: 2,
    group_rotate_profit: 500,
    group_rotate_loss: 500,
    // Alert (auto-generated)
    // Goal
    goal_amount: 500,
    goal_period: "daily",
  });
  const [saving, setSaving] = useState(false);
  const [createdIds, setCreatedIds] = useState({ account: null, strategy: null, group: null, goal: null });
  const [strategyDetails, setStrategyDetails] = useState(null);

  // Prefill trader_name if user already set it
  useEffect(() => {
    User.me().then(u => {
      if (u?.trader_name) setState(s => ({ ...s, trader_name: u.trader_name }));
    }).catch(() => {});
  }, []);

  const set = (k, v) => setState(prev => ({ ...prev, [k]: v }));
  const preset = PROP_FIRM_PRESETS.find(p => p.firm === state.firm_preset) || PROP_FIRM_PRESETS[0];

  const canAdvance = () => {
    const s = STEPS[step].id;
    if (s === "profile") return state.trader_name.trim().length > 0;
    if (s === "rules") return true;  // rules optional
    if (s === "account") return state.account_name.trim().length > 0;
    if (s === "strategy") return state.strategy_name.trim().length > 0;
    if (s === "group") return true;  // group optional
    return true;
  };

  const saveStep = async () => {
    setSaving(true);
    const s = STEPS[step].id;
    try {
      if (s === "profile" || s === "rules") {
        await User.updateMyUserData({
          trader_name: state.trader_name,
          welcome_message_template: state.welcome_message_template,
          trading_rules: state.trading_rules.map(r => r.trim()).filter(Boolean),
        });
      } else if (s === "account") {
        const acct = await Account.create({
          name: state.account_name,
          broker: preset.broker,
          env: preset.env,
          daily_loss_limit: state.account_daily_loss_limit,
          weekend_close_required: state.account_weekend_close,
          max_concurrent_positions: state.account_max_concurrent,
          config: { firm: state.firm_preset },
        });
        setCreatedIds(prev => ({ ...prev, account: acct.id }));
      } else if (s === "strategy") {
        const strat = await Strategy.create({
          name: state.strategy_name,
          description: state.strategy_description,
          broker_format: state.strategy_broker_format,
          timeframe: state.strategy_timeframe,
        });
        setCreatedIds(prev => ({ ...prev, strategy: strat.id }));
        setStrategyDetails(strat);
      } else if (s === "group") {
        if (state.group_name.trim()) {
          const grp = await Group.create({
            name: state.group_name,
            active: true,
            rotate_after_wins: state.group_rotate_wins || null,
            rotate_after_losses: state.group_rotate_losses || null,
            rotate_after_profit: state.group_rotate_profit || null,
            rotate_after_loss_pnl: state.group_rotate_loss || null,
          });
          setCreatedIds(prev => ({ ...prev, group: grp.id }));
          // Add the account to this group
          if (createdIds.account) {
            await Group.addMember(grp.id, { account_id: createdIds.account, multiplier: 1.0 });
          }
          // Bind strategy to this group
          if (createdIds.strategy) {
            await Strategy.update(createdIds.strategy, { default_group_id: grp.id });
            // Reload strategy to get updated webhook_url + templates
            const refreshed = await Strategy.get(createdIds.strategy);
            setStrategyDetails(refreshed);
          }
        }
      } else if (s === "goal") {
        const goal = await Goal.create({
          name: `${state.goal_period} $${state.goal_amount} target`,
          period: state.goal_period,
          target_amount: state.goal_amount,
        });
        setCreatedIds(prev => ({ ...prev, goal: goal.id }));
      }
    } catch (e) {
      alert(`Save failed: ${e.message}`);
      setSaving(false);
      return false;
    }
    setSaving(false);
    return true;
  };

  const next = async () => {
    const ok = await saveStep();
    if (!ok) return;
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => setStep(s => Math.max(0, s - 1));

  const stepId = STEPS[step].id;

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-blue-400"/> Set up your platform
          </h1>
          <p className="text-slate-400 mt-1">
            Zero to live trading in 7 steps. Everything can be edited later — this just gets you moving.
          </p>
        </div>

        {/* Progress rail */}
        <div className="flex items-center gap-1 md:gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            const Icon = s.icon;
            return (
              <React.Fragment key={s.id}>
                <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap ${
                  done ? "bg-green-500/20 text-green-400 border border-green-500/40"
                       : active ? "bg-blue-500/20 text-blue-400 border border-blue-500/40 font-semibold"
                                : "bg-slate-800 text-slate-500 border border-slate-700"
                }`}>
                  {done ? <CheckCircle2 className="w-3 h-3"/> : <Icon className="w-3 h-3"/>}
                  {s.title}
                </div>
                {i < STEPS.length - 1 && <span className="text-slate-600">›</span>}
              </React.Fragment>
            );
          })}
        </div>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              {(() => { const I = STEPS[step].icon; return <I className="w-5 h-5 text-blue-500"/>; })()}
              Step {step + 1}: {STEPS[step].title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ---- Step: Profile ---- */}
            {stepId === "profile" && (
              <>
                <div className="space-y-2">
                  <Label className="text-slate-300">Your name (used in Dashboard greeting)</Label>
                  <Input value={state.trader_name} onChange={e => set("trader_name", e.target.value)}
                         placeholder="Natalia"
                         className="bg-slate-800 border-slate-700 text-white text-lg"/>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Welcome message (use {'{name}'} placeholder)</Label>
                  <Input value={state.welcome_message_template}
                         onChange={e => set("welcome_message_template", e.target.value)}
                         className="bg-slate-800 border-slate-700 text-white"/>
                  <p className="text-xs text-slate-500">Preview: <span className="text-blue-400 italic">
                    {state.welcome_message_template.replace("{name}", state.trader_name || "Trader")}
                  </span></p>
                </div>
              </>
            )}

            {/* ---- Step: Rules ---- */}
            {stepId === "rules" && (
              <>
                <p className="text-slate-400 text-sm">
                  Your personal trading rules — displayed on Dashboard as a daily checklist you tick before your first trade.
                </p>
                <Textarea rows={8}
                          value={state.trading_rules.join("\n")}
                          onChange={e => set("trading_rules", e.target.value.split("\n"))}
                          className="bg-slate-800 border-slate-700 text-white text-sm font-mono"/>
                <p className="text-xs text-slate-500">One rule per line. Edit anytime in Settings.</p>
              </>
            )}

            {/* ---- Step: Account ---- */}
            {stepId === "account" && (
              <>
                <div className="space-y-2">
                  <Label className="text-slate-300">Prop firm</Label>
                  <Select value={state.firm_preset} onValueChange={v => {
                    const p = PROP_FIRM_PRESETS.find(x => x.firm === v);
                    setState(s => ({...s, firm_preset: v,
                      account_daily_loss_limit: p.daily_loss_limit,
                      account_weekend_close: p.weekend_close_required}));
                  }}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white"><SelectValue/></SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700 text-white max-h-64">
                      {PROP_FIRM_PRESETS.map(p => (
                        <SelectItem key={p.firm} value={p.firm}>
                          <span>{p.firm} <span className="text-slate-500 text-xs ml-1">— {p.broker} / DD ${p.daily_loss_limit}</span></span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">Presets fill in the broker + daily DD limit + weekend rules automatically.</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Account name (your label)</Label>
                  <Input value={state.account_name} onChange={e => set("account_name", e.target.value)}
                         placeholder={`${state.firm_preset} #1`}
                         className="bg-slate-800 border-slate-700 text-white"/>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs">Daily loss limit ($)</Label>
                    <Input type="number" value={state.account_daily_loss_limit}
                           onChange={e => set("account_daily_loss_limit", +e.target.value)}
                           className="bg-slate-800 border-slate-700 text-white"/>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs">Max concurrent positions</Label>
                    <Input type="number" value={state.account_max_concurrent}
                           onChange={e => set("account_max_concurrent", +e.target.value)}
                           className="bg-slate-800 border-slate-700 text-white"/>
                  </div>
                  <div className="space-y-2 flex items-end">
                    <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                      <input type="checkbox" checked={state.account_weekend_close}
                             onChange={e => set("account_weekend_close", e.target.checked)}
                             className="accent-blue-500"/>
                      Weekend flat
                    </label>
                  </div>
                </div>
                <div className="text-xs text-slate-500 bg-slate-800/50 border border-slate-700 rounded p-2">
                  Guardian will auto-flatten this account if today's P&L reaches −${state.account_daily_loss_limit.toLocaleString()}.
                  Max {state.account_max_concurrent} concurrent positions. {state.account_weekend_close && "Auto-flat Friday 3:45pm ET."}
                </div>
              </>
            )}

            {/* ---- Step: Strategy ---- */}
            {stepId === "strategy" && (
              <>
                <div className="space-y-2">
                  <Label className="text-slate-300">Strategy name (Pine indicator name)</Label>
                  <Input value={state.strategy_name} onChange={e => set("strategy_name", e.target.value)}
                         placeholder="Freeballin 6.24 base"
                         className="bg-slate-800 border-slate-700 text-white text-lg"/>
                  <p className="text-xs text-slate-500">
                    Becomes your webhook URL slug — "Freeballin 6.24 base" → <code className="text-blue-400">/api/webhook/strategy/freeballin-6-24-base</code>
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs">Broker format</Label>
                    <Select value={state.strategy_broker_format} onValueChange={v => set("strategy_broker_format", v)}>
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white"><SelectValue/></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700 text-white">
                        <SelectItem value="futures">Futures (Tradovate)</SelectItem>
                        <SelectItem value="mt5">MT5 (forex prop firms)</SelectItem>
                        <SelectItem value="mt4">MT4</SelectItem>
                        <SelectItem value="stocks">Stocks (Alpaca/IBKR)</SelectItem>
                        <SelectItem value="crypto">Crypto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs">Timeframe</Label>
                    <Input value={state.strategy_timeframe} onChange={e => set("strategy_timeframe", e.target.value)}
                           className="bg-slate-800 border-slate-700 text-white"/>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 text-xs">Description</Label>
                  <Textarea rows={3} value={state.strategy_description}
                            onChange={e => set("strategy_description", e.target.value)}
                            placeholder="What does this strategy trade? What's the setup?"
                            className="bg-slate-800 border-slate-700 text-white"/>
                </div>
              </>
            )}

            {/* ---- Step: Group ---- */}
            {stepId === "group" && (
              <>
                <p className="text-slate-400 text-sm">
                  Optional — put your account into a rotation group. Skip this step if you want the strategy to
                  fire the account directly (standalone).
                </p>
                <div className="space-y-2">
                  <Label className="text-slate-300">Group name</Label>
                  <Input value={state.group_name} onChange={e => set("group_name", e.target.value)}
                         placeholder="e.g. group1_auto, Big Risk (leave blank to skip)"
                         className="bg-slate-800 border-slate-700 text-white"/>
                </div>
                {state.group_name && (
                  <div className="grid grid-cols-4 gap-2">
                    <div className="space-y-2">
                      <Label className="text-slate-500 text-xs">Rotate after N wins</Label>
                      <Input type="number" value={state.group_rotate_wins}
                             onChange={e => set("group_rotate_wins", +e.target.value)}
                             className="bg-slate-800 border-slate-700 text-white"/>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-500 text-xs">N losses</Label>
                      <Input type="number" value={state.group_rotate_losses}
                             onChange={e => set("group_rotate_losses", +e.target.value)}
                             className="bg-slate-800 border-slate-700 text-white"/>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-500 text-xs">Win $ cap</Label>
                      <Input type="number" value={state.group_rotate_profit}
                             onChange={e => set("group_rotate_profit", +e.target.value)}
                             className="bg-slate-800 border-slate-700 text-white"/>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-slate-500 text-xs">Loss $ cap</Label>
                      <Input type="number" value={state.group_rotate_loss}
                             onChange={e => set("group_rotate_loss", +e.target.value)}
                             className="bg-slate-800 border-slate-700 text-white"/>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ---- Step: Alert ---- */}
            {stepId === "alert" && strategyDetails && (
              <>
                <p className="text-slate-400 text-sm">
                  Almost there! Copy this into your TradingView alert to route signals here:
                </p>
                <div className="space-y-2">
                  <Label className="text-slate-300 text-xs">Webhook URL — paste into TradingView alert 'Webhook URL' field</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={strategyDetails.webhook_url || ""}
                           className="bg-slate-800 border-slate-700 text-blue-400 font-mono text-xs"/>
                    <Button variant="outline" size="sm"
                            onClick={() => navigator.clipboard?.writeText(strategyDetails.webhook_url)}>
                      <Copy className="w-3 h-3"/>
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300 text-xs">ENTRY alert JSON — paste into TradingView alert 'Message' field</Label>
                  {strategyDetails.alert_templates?.ENTRY && (
                    <>
                      <pre className="bg-slate-950 rounded p-3 text-xs overflow-x-auto text-slate-300 font-mono max-h-64">
                        {JSON.stringify(strategyDetails.alert_templates.ENTRY.json_body, null, 2)}
                      </pre>
                      <Button size="sm" onClick={() => navigator.clipboard?.writeText(
                        JSON.stringify(strategyDetails.alert_templates.ENTRY.json_body, null, 2)
                      )} className="bg-blue-600 hover:bg-blue-700">
                        <Copy className="w-3 h-3 mr-1"/>Copy ENTRY JSON
                      </Button>
                    </>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Also grab STOP_UPDATE + FLAT templates anytime from the Strategies page → Alert JSON button.
                </p>
              </>
            )}
            {stepId === "alert" && !strategyDetails && (
              <p className="text-slate-400">Loading strategy details…</p>
            )}

            {/* ---- Step: Goal ---- */}
            {stepId === "goal" && (
              <>
                <p className="text-slate-400 text-sm">
                  Set a first target so the Dashboard can show your progress toward it.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-300">Target ($)</Label>
                    <Input type="number" value={state.goal_amount}
                           onChange={e => set("goal_amount", +e.target.value)}
                           className="bg-slate-800 border-slate-700 text-white text-lg"/>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">Period</Label>
                    <Select value={state.goal_period} onValueChange={v => set("goal_period", v)}>
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white"><SelectValue/></SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700 text-white">
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="cycle">Cycle (all-time)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {/* ---- Step: Done ---- */}
            {stepId === "done" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <CheckCircle2 className="w-8 h-8 text-green-400"/>
                  <div>
                    <div className="text-lg font-bold text-green-400">You're set up!</div>
                    <div className="text-sm text-slate-300">Everything's saved. Head to Dashboard to see your platform in action.</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">What's live now</div>
                    <ul className="text-sm text-slate-300 space-y-1">
                      <li>✅ Trader name: <strong>{state.trader_name}</strong></li>
                      <li>✅ {state.trading_rules.filter(Boolean).length} trading rules</li>
                      <li>✅ Account: <strong>{state.account_name}</strong> ({state.firm_preset})</li>
                      <li>✅ Strategy: <strong>{state.strategy_name}</strong></li>
                      {createdIds.group && <li>✅ Group: <strong>{state.group_name}</strong></li>}
                      <li>✅ Goal: <strong>${state.goal_amount} {state.goal_period}</strong></li>
                    </ul>
                  </div>
                  <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                    <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Next steps</div>
                    <ul className="text-sm text-slate-300 space-y-1">
                      <li>• Paste the alert JSON into TradingView</li>
                      <li>• Turn on the alert in TV</li>
                      <li>• Watch your first signal fire in <Link to="/LivePositions" className="text-blue-400 hover:underline">Live Positions</Link></li>
                      <li>• Add more accounts anytime in <Link to="/Accounts" className="text-blue-400 hover:underline">Accounts</Link></li>
                    </ul>
                  </div>
                </div>
                <Link to="/Dashboard">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg py-6">
                    <Sparkles className="w-5 h-5 mr-2"/>Take me to my Dashboard
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Nav */}
        {stepId !== "done" && (
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={back} disabled={step === 0}>
              <ArrowLeft className="w-4 h-4 mr-1"/>Back
            </Button>
            <div className="flex gap-2">
              {stepId === "group" && !state.group_name && (
                <Button variant="outline" onClick={() => setStep(s => s + 1)} className="text-slate-400">
                  Skip
                </Button>
              )}
              <Button onClick={next} disabled={!canAdvance() || saving}
                      className="bg-blue-600 hover:bg-blue-700 font-semibold">
                {saving ? "Saving…" : "Next"} <ArrowRight className="w-4 h-4 ml-1"/>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
