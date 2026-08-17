import React from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * TabbedPage — one nav-item wraps N old top-level pages behind tabs.
 * Reads/writes ?tab= in the URL so tabs are shareable + browser-back works.
 *
 * Usage:
 *   <TabbedPage title="Journal" subtitle="Trades · Log · Notes"
 *     tabs={[
 *       { key: "trades", label: "All trades",  Component: Trades },
 *       { key: "log",    label: "Log view",    Component: TradeJournal },
 *     ]}
 *   />
 *
 * Tabs render lazily — only the active tab's Component mounts.
 */
export default function TabbedPage({ title, subtitle, tabs, headerAction }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const activeKey = params.get("tab") || tabs[0]?.key;
  const activeTab = tabs.find(t => t.key === activeKey) || tabs[0];
  const ActiveComp = activeTab?.Component;

  const switchTab = (key) => {
    const next = new URLSearchParams(location.search);
    next.set("tab", key);
    navigate(`${location.pathname}?${next.toString()}`, { replace: false });
  };

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
        </div>
        {headerAction}
      </div>

      {/* Tab strip — big and clickable, PC-app pill style */}
      <div className="inline-flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 mb-6 overflow-x-auto max-w-full">
        {tabs.map(t => {
          const active = t.key === activeTab?.key;
          return (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 md:px-5 py-2 rounded-lg font-bold text-sm whitespace-nowrap transition-colors ${
                active
                  ? "bg-blue-600 text-white shadow"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              {t.icon && <span className="mr-1.5">{t.icon}</span>}
              {t.label}
            </button>
          );
        })}
      </div>

      <div>{ActiveComp ? <ActiveComp /> : null}</div>
    </div>
  );
}
