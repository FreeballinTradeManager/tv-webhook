import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Account } from "@/entities/all";
import { X } from "lucide-react";

/**
 * Task #231 — Natalia's 5-step onboarding flow at the top of Dashboard.
 * Auto-detects which steps are done from real data (accounts exist,
 * mt5 mirror configured, etc.) — no manual checkboxes to forget.
 * Dismissible per-browser via localStorage; comes back if state regresses.
 */
const DISMISS_KEY = "tradecore_onboarding_dismissed_v1";

const STEPS = [
  {
    key: "signin",
    title: "Sign in",
    sub: "Session active",
    detect: () => true,   // If they see the dashboard, they're signed in
    action: null,
  },
  {
    key: "accounts",
    title: "Add accounts",
    sub: "Tradovate · FTMO · Lucid",
    detect: (state) => (state.accounts?.length || 0) > 0,
    action: (nav) => nav("/Config?tab=accounts"),
  },
  {
    key: "copies",
    title: "Copies + rotation",
    sub: "MT5 mirror · group cascade",
    detect: (state) => {
      const mt5On = (state.accounts || []).some(a => a?.config?.mt5_mirror);
      const hasGroups = (state.accounts || []).some(a => a?.group_id);
      return mt5On || hasGroups;
    },
    action: (nav) => nav("/Config?tab=mt5"),
  },
  {
    key: "rules",
    title: "Rules checklist",
    sub: "Prop firm compliance",
    detect: (state) => {
      try {
        const rules = JSON.parse(localStorage.getItem("tradecore_daily_rules") || "[]");
        return rules.some(r => r.checked);
      } catch { return false; }
    },
    action: (nav) => nav("/Tools?tab=playbook"),
  },
  {
    key: "help",
    title: "Help chat",
    sub: "Ask anything — Claude answers",
    detect: () => {
      try {
        return !!localStorage.getItem("tradecore_help_opened_once");
      } catch { return false; }
    },
    action: () => {
      try { localStorage.setItem("tradecore_help_opened_once", "1"); } catch {}
      // Toggle the FAB open — HelpChatFAB listens for this event
      window.dispatchEvent(new CustomEvent("tradecore:help:open"));
    },
  },
];

export default function OnboardingBanner() {
  const navigate = useNavigate();
  const [state, setState] = useState({ accounts: [] });
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    Account.list()
      .then(a => alive && setState({ accounts: a || [] }))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const done = STEPS.map(s => s.detect(state));
  const currentIdx = done.findIndex(d => !d);
  const doneCount = done.filter(Boolean).length;
  const pct = Math.round((doneCount / STEPS.length) * 100);
  const allDone = currentIdx === -1;

  // Auto-dismiss when everything's checked off. Also honor manual dismiss.
  if (dismissed || allDone) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setDismissed(true);
  };

  return (
    <div className="rounded-2xl border border-blue-500/40 bg-gradient-to-r from-blue-500/10 to-blue-600/5 p-5 md:p-6 mb-6">
      <div className="flex items-baseline justify-between mb-4">
        <div className="font-extrabold text-base text-white">
          <span className="mr-2">🚀</span>
          Get set up in {STEPS.length} steps
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs font-bold text-blue-300">
            Step {Math.min(currentIdx + 1, STEPS.length)} of {STEPS.length} · {pct}%
          </div>
          <button
            onClick={dismiss}
            className="text-slate-400 hover:text-white transition-colors"
            title="Dismiss — I'll set up later"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {STEPS.map((step, i) => {
          const isDone = done[i];
          const isCurrent = i === currentIdx;
          return (
            <button
              key={step.key}
              onClick={() => step.action?.(navigate)}
              disabled={!step.action}
              className={`text-left p-3 rounded-xl border transition-all ${
                isDone
                  ? "bg-emerald-500/8 border-emerald-500/40"
                  : isCurrent
                    ? "bg-blue-500/12 border-blue-500 shadow-[0_0_0_3px_rgba(59,130,246,0.15)]"
                    : "bg-slate-900 border-slate-800 hover:border-blue-500/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-extrabold ${
                  isDone ? "bg-emerald-500 text-white"
                  : isCurrent ? "bg-blue-500 text-white"
                  : "bg-slate-700 text-slate-300"
                }`}>
                  {isDone ? "✓" : i + 1}
                </span>
                <span className="font-bold text-sm text-white">{step.title}</span>
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">{step.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
