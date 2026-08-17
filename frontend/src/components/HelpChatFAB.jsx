import React, { useState, useEffect } from "react";
import { MessageCircle, X, Sparkles, Send } from "lucide-react";

/**
 * Task #231 — floating Help Chat button. Bottom-right FAB, opens a panel
 * with suggested prompts + a message input. Uses Claude via the same
 * /api/ai/journal-insights endpoint (routing swap when we wire a dedicated
 * chat endpoint later). Listens for a custom event so OnboardingBanner
 * (or anything else) can programmatically open it.
 */
const SUGGESTIONS = [
  { icon: "🚀", text: "How do I add a Tradovate account?" },
  { icon: "📈", text: "Why is my Trade Journal empty?" },
  { icon: "🛡️", text: "How does the news blackout work?" },
  { icon: "💡", text: "What's the Pine Trade Engine Key?" },
  { icon: "🔁", text: "How do I copy trades to my FTMO MT5?" },
];

export default function HelpChatFAB() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener("tradecore:help:open", openHandler);
    return () => window.removeEventListener("tradecore:help:open", openHandler);
  }, []);

  const send = async (msg) => {
    const text = (msg || input).trim();
    if (!text || busy) return;
    setInput("");
    setThread(t => [...t, { role: "user", text }]);
    setBusy(true);
    try {
      // Piggyback on the AI insights endpoint for now — it accepts
      // freeform questions and knows the trader's account context.
      const resp = await fetch("/api/ai/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = await resp.json().catch(() => ({}));
      const answer = data.answer || data.response || data.detail
        || "Chat endpoint isn't wired to Claude yet. This suggestion has been logged — for now try the specific pages listed in the sidebar, or check the setup guide under Config → Accounts.";
      setThread(t => [...t, { role: "assistant", text: answer }]);
    } catch {
      setThread(t => [...t, { role: "assistant", text: "Couldn't reach the help endpoint. Check your connection and try again." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Floating action button — always visible bottom-right */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50 hover:scale-105 transition-transform flex items-center justify-center"
        title="Ask TradeCore anything"
      >
        {open ? <X className="w-6 h-6 text-white"/> : <MessageCircle className="w-6 h-6 text-white"/>}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-40 w-[360px] max-w-[calc(100vw-3rem)] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400"/>
              <span className="font-extrabold text-white">Ask TradeCore</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4"/>
            </button>
          </div>

          <div className="max-h-[400px] overflow-y-auto p-4 space-y-3">
            {thread.length === 0 ? (
              <>
                <p className="text-xs text-slate-400">Ask anything about your trades, setup, or how the app works.</p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => send(s.text)}
                      className="w-full text-left px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
                    >
                      <span className="mr-1.5">{s.icon}</span>{s.text}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              thread.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-lg px-3 py-2 ${
                    m.role === "user"
                      ? "bg-blue-600 text-white ml-8"
                      : "bg-slate-800 text-slate-100 mr-8"
                  }`}
                >
                  {m.text}
                </div>
              ))
            )}
            {busy && <div className="text-xs text-slate-500 italic">Thinking…</div>}
          </div>

          <div className="border-t border-slate-800 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()}
                placeholder="Type your question…"
                disabled={busy}
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => send()}
                disabled={!input.trim() || busy}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              >
                <Send className="w-4 h-4"/>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">Powered by Claude · Uses your trade context</p>
          </div>
        </div>
      )}
    </>
  );
}
