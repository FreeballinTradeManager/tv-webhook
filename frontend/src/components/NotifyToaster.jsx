import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

// Global in-app toaster — subscribes to the "tradecore:notify" custom
// event fired by @/lib/notify.js and shows a stack of dismissible
// toasts in the top-right of the app. Zero dependencies, zero creds.
//
// Mount ONCE at the app root (Layout.jsx). Every page automatically
// gets toasts when any code path calls notify(...).

const AUTO_DISMISS_MS = 6000;
const MAX_STACK = 5;

export default function NotifyToaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onNotify = (e) => {
      const t = e.detail || {};
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setToasts(prev => [...prev, { id, ...t }].slice(-MAX_STACK));
      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== id));
      }, AUTO_DISMISS_MS);
    };
    window.addEventListener("tradecore:notify", onNotify);
    return () => window.removeEventListener("tradecore:notify", onNotify);
  }, []);

  const dismiss = (id) => setToasts(prev => prev.filter(x => x.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
             className="pointer-events-auto min-w-[280px] max-w-sm bg-slate-900 border border-slate-700 rounded-lg shadow-lg shadow-black/40 p-3 flex items-start gap-2 animate-in slide-in-from-right-2 fade-in">
          <Bell className="w-4 h-4 text-blue-400 shrink-0 mt-0.5"/>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-semibold truncate">{t.title}</div>
            {t.body && <div className="text-slate-300 text-xs mt-0.5 leading-snug">{t.body}</div>}
            {t.url && (
              <a href={t.url} target="_blank" rel="noopener noreferrer"
                 className="text-blue-400 text-xs hover:underline mt-1 inline-block">
                Open →
              </a>
            )}
          </div>
          <button onClick={() => dismiss(t.id)}
                  className="text-slate-500 hover:text-white shrink-0">
            <X className="w-4 h-4"/>
          </button>
        </div>
      ))}
    </div>
  );
}
