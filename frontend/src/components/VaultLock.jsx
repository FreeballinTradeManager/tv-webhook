import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateSecret, otpauthUri, verifyCode } from "@/lib/totp";
import { Lock, Smartphone, ShieldCheck, RefreshCw, Copy } from "lucide-react";

// VaultLock — TOTP gate that wraps the Vault page.
// First run: generates a secret, shows the user the manual-entry key
// + otpauth:// URI to paste into Google Authenticator / Authy /
// 1Password. On confirm, secret is stored in localStorage.
// Subsequent runs: prompt for the current 6-digit code. Once verified,
// the session is unlocked until the tab closes OR 15 min idle.

const SECRET_KEY = "tradecore_vault_totp_secret_v1";
const UNLOCK_KEY = "tradecore_vault_unlock_v1";           // sessionStorage
const IDLE_MINUTES = 15;

function getSecret() { return localStorage.getItem(SECRET_KEY); }
function setSecret(s) { localStorage.setItem(SECRET_KEY, s); }
function clearSecret() { localStorage.removeItem(SECRET_KEY); }

function isUnlocked() {
  const raw = sessionStorage.getItem(UNLOCK_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  if (!ts) return false;
  return (Date.now() - ts) < IDLE_MINUTES * 60_000;
}
function markUnlocked() { sessionStorage.setItem(UNLOCK_KEY, String(Date.now())); }
function markLocked()   { sessionStorage.removeItem(UNLOCK_KEY); }

export default function VaultLock({ children }) {
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const [secret, setSecretState] = useState(getSecret());

  // Refresh unlock TTL as the user interacts with vault pages.
  useEffect(() => {
    if (!unlocked) return;
    const bump = () => { if (isUnlocked()) markUnlocked(); };
    window.addEventListener("click", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("click", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [unlocked]);

  const lock = () => { markLocked(); setUnlocked(false); };

  if (unlocked) {
    return (
      <>
        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-4 flex justify-end">
          <Button size="sm" variant="ghost" onClick={lock}
                  className="text-xs text-slate-400 hover:text-red-400">
            <Lock className="w-3 h-3 mr-1"/>Lock now
          </Button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-slate-950 min-h-screen">
      <div className="max-w-md mx-auto pt-16">
        {secret
          ? <UnlockForm onSuccess={() => { markUnlocked(); setUnlocked(true); }}
                        onResetSecret={() => { clearSecret(); setSecretState(null); }} />
          : <SetupForm onSecretConfirmed={(s) => { setSecret(s); setSecretState(s); markUnlocked(); setUnlocked(true); }} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// First-run: enroll in TOTP
// ---------------------------------------------------------------------
function SetupForm({ onSecretConfirmed }) {
  const [secret] = useState(() => generateSecret());
  const [code, setCode] = useState("");
  const [err, setErr]   = useState("");
  const uri = otpauthUri({ secret, label: "TradeCore Vault", issuer: "TradeCore" });

  const copy = (text) => { try { navigator.clipboard.writeText(text); } catch {} };

  const confirm = async () => {
    setErr("");
    const ok = await verifyCode(secret, code);
    if (!ok) { setErr("Wrong code — try the current one from your app."); return; }
    onSecretConfirmed(secret);
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-6 space-y-5">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto"/>
          <div className="text-white text-lg font-semibold mt-2">Set up Vault 2FA</div>
          <div className="text-slate-400 text-sm mt-1">
            Add a TOTP entry in Google Authenticator, Authy, or 1Password. This locks the vault so a stolen laptop can't read your saved broker passwords.
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Smartphone className="w-3 h-3"/>Manual entry key
            </Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-white font-mono text-sm break-all flex-1">{secret}</code>
              <Button size="sm" variant="outline" onClick={() => copy(secret)}>
                <Copy className="w-3 h-3"/>
              </Button>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Type this into your authenticator app (Add → Manual entry). Label it "TradeCore Vault".
            </div>
          </div>
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-slate-400">otpauth URI (for apps that accept paste)</Label>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-slate-300 font-mono text-[10px] break-all flex-1">{uri}</code>
              <Button size="sm" variant="outline" onClick={() => copy(uri)}>
                <Copy className="w-3 h-3"/>
              </Button>
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs text-slate-400">Enter current 6-digit code from the app</Label>
          <Input value={code} onChange={e => setCode(e.target.value)}
                 inputMode="numeric" maxLength={6}
                 placeholder="123 456"
                 className="mt-1 bg-slate-950 border-slate-800 text-white text-center text-xl font-mono tracking-widest"/>
          {err && <div className="text-xs text-red-400 mt-1">{err}</div>}
        </div>

        <Button onClick={confirm} disabled={code.length !== 6}
                className="w-full bg-blue-600 hover:bg-blue-500">
          <ShieldCheck className="w-4 h-4 mr-1"/>Verify + enable
        </Button>

        <div className="text-[10px] text-slate-500 text-center">
          The secret is stored in this browser only. Losing it = you can't re-enroll unless you clear the vault and start over.
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Return visits: enter code
// ---------------------------------------------------------------------
function UnlockForm({ onSuccess, onResetSecret }) {
  const [code, setCode] = useState("");
  const [err, setErr]   = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (code.length !== 6) return;
    setBusy(true); setErr("");
    const secret = getSecret();
    const ok = await verifyCode(secret, code);
    setBusy(false);
    if (!ok) { setErr("Wrong code."); return; }
    onSuccess();
  };

  const reset = () => {
    if (!window.confirm("Reset TOTP secret? Any saved vault entries stay, but you'll need to re-enroll a new authenticator entry. Existing entries remain readable.")) return;
    onResetSecret();
  };

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-6 space-y-5">
        <div className="text-center">
          <Lock className="w-10 h-10 text-blue-400 mx-auto"/>
          <div className="text-white text-lg font-semibold mt-2">Vault locked</div>
          <div className="text-slate-400 text-sm mt-1">
            Enter the current 6-digit code from your authenticator app.
          </div>
        </div>

        <Input value={code} onChange={e => setCode(e.target.value)}
               onKeyDown={e => e.key === "Enter" && submit()}
               inputMode="numeric" maxLength={6}
               placeholder="123 456"
               className="bg-slate-950 border-slate-800 text-white text-center text-2xl font-mono tracking-widest"
               autoFocus/>
        {err && <div className="text-xs text-red-400 text-center">{err}</div>}

        <Button onClick={submit} disabled={code.length !== 6 || busy}
                className="w-full bg-blue-600 hover:bg-blue-500">
          {busy ? <RefreshCw className="w-4 h-4 mr-1 animate-spin"/> : <ShieldCheck className="w-4 h-4 mr-1"/>}
          Unlock
        </Button>

        <button onClick={reset}
                className="w-full text-[11px] text-slate-500 hover:text-red-400 text-center underline">
          Reset TOTP secret (I lost my authenticator)
        </button>
      </CardContent>
    </Card>
  );
}
