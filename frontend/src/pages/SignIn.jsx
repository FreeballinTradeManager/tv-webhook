import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, Mail, Lock, User, Eye, EyeOff, AlertCircle } from "lucide-react";

// Local session shim — real JWT + Postgres users table lands with task #40.
// For MVP: any email/password sign-in creates a local session and redirects.
export const AUTH_KEY = "tradecore_session_v1";
export function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); } catch { return null; }
}
export function setSession(session) {
  if (session) localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_KEY);
}
export function isAuthed() { return !!getSession(); }

export default function SignIn() {
  const nav = useNavigate();
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (!email || !password) return setErr("Email and password required");
    if (mode === "signup" && password !== confirm) return setErr("Passwords don't match");
    if (mode === "signup" && password.length < 8) return setErr("Password must be at least 8 characters");
    setBusy(true);
    try {
      // Local shim: no server call for now. Task #40 wires real backend.
      // We treat every submit as success. When #40 lands, replace with:
      //   const res = await api('/api/auth/signin', { method: 'POST', body: { email, password } })
      const session = {
        email,
        signed_in_at: new Date().toISOString(),
        // token: res.token — filled in by real backend later
      };
      setSession(session);
      nav("/Dashboard", { replace: true });
    } catch (e) {
      setErr(e.message || "Sign-in failed");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/40 flex items-center justify-center mb-3">
            <TrendingUp className="w-8 h-8 text-white"/>
          </div>
          <h1 className="text-3xl font-bold text-white">TradeCore</h1>
          <p className="text-slate-400 text-sm mt-1">Pro trading suite — the layer between TradingView and your broker.</p>
        </div>

        <Card className="bg-slate-900 border-slate-800 rounded-2xl">
          <CardContent className="p-6 space-y-5">

            {/* Mode toggle */}
            <div className="grid grid-cols-2 rounded-xl bg-slate-950 border border-slate-800 p-1">
              <button
                onClick={() => setMode("signin")}
                className={`h-9 text-sm font-semibold rounded-lg transition-colors ${
                  mode === "signin" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => setMode("signup")}
                className={`h-9 text-sm font-semibold rounded-lg transition-colors ${
                  mode === "signup" ? "bg-blue-600 text-white shadow-md" : "text-slate-400 hover:text-white"
                }`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white text-sm">Email</Label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="bg-slate-950 border-slate-700 text-white pl-10 h-11 rounded-xl"
                    autoFocus
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-white text-sm">Password</Label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-slate-950 border-slate-700 text-white pl-10 pr-10 h-11 rounded-xl"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div className="space-y-2">
                  <Label className="text-white text-sm">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"/>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      className="bg-slate-950 border-slate-700 text-white pl-10 h-11 rounded-xl"
                      required
                    />
                  </div>
                </div>
              )}

              {err && (
                <div className="flex items-center gap-2 text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded-xl px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0"/>
                  {err}
                </div>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 rounded-xl"
              >
                {busy ? "Working…" : mode === "signin" ? "Sign In" : "Create account"}
              </Button>
            </form>

            {mode === "signin" && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => alert("Password reset email flow — task #40")}
                  className="text-sm text-slate-400 hover:text-white"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-slate-800 text-center text-xs text-slate-500">
              After sign-in you'll add your <span className="text-white font-semibold">brokers</span> (Tradovate, Rithmic, cTrader, IBKR, PMT)
              — connect one to start trading.
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-500 mt-4">
          By continuing you agree to trade with your own money at your own risk.
          <br/>TradeCore never sends orders without your account credentials + explicit setup.
        </p>
      </div>
    </div>
  );
}
