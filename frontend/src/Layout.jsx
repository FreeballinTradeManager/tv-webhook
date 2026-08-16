import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getSession, setSession } from "@/pages/SignIn";
import { Account } from "@/entities/all";
import { fleetHealth } from "@/lib/connection_health";
import NotifyToaster from "@/components/NotifyToaster";
import {
  LayoutDashboard,
  TrendingUp,
  Calculator,
  Wallet,
  BookOpen,
  Bell,
  Settings,
  PlusCircle,
  BarChart3,
  Rewind,
  KeyRound,
  Activity,
  Repeat,
  Sparkles,
  Code2,
  NotebookPen,
  LogOut,
  FileCode,
  ShieldCheck,
  Terminal,
  Eye,
  CreditCard,
  FileBarChart,
  Radio,
  Zap
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

// Group tags drive the sidebar sections. Adding a new item just needs a
// `group` field — no more hard-coded slice() ranges to update.
const navigationItems = [
  // ── TRADING ────────────────────────────────────────────────────
  { title: "Dashboard",       url: createPageUrl("Dashboard"),       icon: LayoutDashboard, group: "Trading" },
  { title: "Live Positions",  url: createPageUrl("LivePositions"),   icon: Activity,        group: "Trading" },
  { title: "New Trade",       url: createPageUrl("NewTrade"),        icon: PlusCircle,      group: "Trading" },
  { title: "Playbook",        url: createPageUrl("Playbook"),        icon: ShieldCheck,     group: "Trading" },
  { title: "Watchlist",       url: createPageUrl("Watchlist"),       icon: Eye,             group: "Trading" },

  // ── JOURNAL ────────────────────────────────────────────────────
  { title: "Trades",          url: createPageUrl("Trades"),          icon: TrendingUp,      group: "Journal" },
  { title: "Trade Log",       url: createPageUrl("TradeJournal"),    icon: BookOpen,        group: "Journal" },
  { title: "AI Insights",     url: createPageUrl("AIInsights"),      icon: Sparkles,        group: "Journal" },
  { title: "What-If",         url: createPageUrl("WhatIf"),          icon: Rewind,          group: "Journal" },
  { title: "Daily Journal",   url: createPageUrl("DailyJournal"),    icon: NotebookPen,     group: "Journal" },
  { title: "Reports",         url: createPageUrl("Reports"),         icon: FileBarChart,    group: "Journal" },
  { title: "Analytics",       url: createPageUrl("Analytics"),       icon: BarChart3,       group: "Journal" },

  // ── MANAGE ─────────────────────────────────────────────────────
  { title: "Accounts",        url: createPageUrl("Accounts"),        icon: Wallet,          group: "Manage" },
  { title: "Rotation",        url: createPageUrl("Rotation"),        icon: Repeat,          group: "Manage" },
  { title: "Strategies",      url: createPageUrl("Strategies"),      icon: BookOpen,        group: "Manage" },
  { title: "Subscriptions",   url: createPageUrl("Subscriptions"),   icon: CreditCard,      group: "Manage" },
  { title: "Vault",           url: createPageUrl("Vault"),           icon: KeyRound,        group: "Manage" },

  // ── TOOLS ──────────────────────────────────────────────────────
  { title: "Risk Calculator", url: createPageUrl("RiskCalculator"),  icon: Calculator,      group: "Tools" },
  { title: "Backtester",      url: createPageUrl("Backtester"),      icon: Rewind,          group: "Tools" },
  { title: "Alerts",          url: createPageUrl("Alerts"),          icon: Bell,            group: "Tools" },
  { title: "Alert Templates", url: createPageUrl("AlertTemplates"),  icon: FileCode,        group: "Tools" },
  { title: "Snippets",        url: createPageUrl("Snippets"),        icon: Code2,           group: "Tools" },
  { title: "Signal Log",      url: createPageUrl("Logs"),            icon: Terminal,        group: "Tools" },
  { title: "Trading Schedule",url: createPageUrl("TradingSchedule"), icon: Activity,        group: "Tools" },
  { title: "Asset Registry",  url: createPageUrl("AssetRegistry"),   icon: FileCode,        group: "Tools" },
  { title: "Chart Drawings",  url: createPageUrl("ChartDrawings"),   icon: NotebookPen,     group: "Tools" },
  { title: "Manual Signal",   url: createPageUrl("ManualSignal"),    icon: Zap,             group: "Tools" },
  { title: "MT5 Mirror",      url: createPageUrl("Mt5Mirror"),       icon: Repeat,          group: "Tools" },
  { title: "Outgoing Webhooks", url: createPageUrl("Webhooks"),      icon: Bell,            group: "Tools" },
  { title: "Integrations",    url: createPageUrl("Integrations"),    icon: KeyRound,        group: "Setup" },

  // ── SETUP ──────────────────────────────────────────────────────
  { title: "Setup Wizard",    url: createPageUrl("Setup"),           icon: Sparkles,        group: "Setup" },
  { title: "Connect PMT",     url: createPageUrl("ConnectPMT"),      icon: Radio,           group: "Setup" },
  { title: "Demo Sandbox",    url: createPageUrl("Demo"),            icon: Sparkles,        group: "Setup" },
  { title: "Settings",        url: createPageUrl("Settings"),        icon: Settings,        group: "Setup" },
];
// Fixed section order so the sidebar layout is deterministic.
const NAV_GROUP_ORDER = ["Trading", "Journal", "Manage", "Tools", "Setup"];
const navGroups = NAV_GROUP_ORDER
  .map(g => ({ label: g, items: navigationItems.filter(i => i.group === g) }))
  .filter(g => g.items.length > 0);

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const signOut = () => {
    if (!window.confirm("Sign out of TradeCore?")) return;
    setSession(null);
    navigate("/SignIn", { replace: true });
  };

  // Task #61 — global fleet health polled every 30s. Sits in the sidebar
  // footer so it's visible on every page. If ANY active account has gone
  // stale, this shows red — user's attention gets pulled without them
  // having to remember to visit Accounts.
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await Account.list();
        if (alive) setFeed(fleetHealth(list || []));
      } catch { /* silent — health is a nice-to-have signal */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <SidebarProvider>
      <style>
        {`
          /* shadcn tokens read as hsl(var(--token)) — MUST be HSL triplets
             (H S% L%), NOT raw RGB. Raw RGB parses as invalid HSL and Chrome
             falls back to weird colors (e.g. rgb(255,255,0) yellow on text-
             primary-foreground). Values below map to the app's slate/blue
             dark theme. */
          :root {
            --background: 222 47% 11%;      /* slate-900 */
            --foreground: 210 40% 98%;      /* slate-50 */
            --card: 217 33% 17%;            /* slate-800 */
            --card-foreground: 210 40% 98%;
            --popover: 217 33% 17%;
            --popover-foreground: 210 40% 98%;
            --primary: 217 91% 60%;         /* blue-500 */
            --primary-foreground: 0 0% 100%;
            --secondary: 215 25% 27%;       /* slate-700 */
            --secondary-foreground: 210 40% 98%;
            --muted: 215 25% 27%;
            --muted-foreground: 217 10% 65%;
            --accent: 217 91% 60%;
            --accent-foreground: 0 0% 100%;
            --destructive: 0 84% 60%;       /* red-500 */
            --destructive-foreground: 0 0% 100%;
            --border: 215 25% 27%;
            --input: 215 25% 27%;
            --ring: 217 91% 60%;
          }
          body {
            background: #0F172A;
            color: #F8FAFC;
          }
          /* Sidebar renders with the shadcn default light background
             (rgb(250,250,250)) — force every text spot inside it to
             dark so the trader can actually read the menu. Group labels
             stay muted, links stay solid. The blue active-state stripe
             keeps its blue accent color. */
          [data-sidebar="sidebar"],
          [data-sidebar="sidebar"] a,
          [data-sidebar="sidebar"] span,
          [data-sidebar="sidebar"] button:not([data-active="true"]),
          [data-sidebar="sidebar"] p {
            color: #0f172a !important;   /* slate-900 */
          }
          [data-sidebar="group-label"] {
            color: #475569 !important;   /* slate-600 — muted heading */
          }
          [data-sidebar="sidebar"] a:hover span,
          [data-sidebar="sidebar"] button:hover span {
            color: #1e40af !important;   /* blue-800 on hover */
          }
          [data-sidebar="sidebar"] [class*="bg-blue-500/20"] {
            color: #1e40af !important;   /* keep active link readable */
          }
        `}
      </style>
      <div className="min-h-screen flex w-full bg-slate-950">
        <Sidebar className="border-r border-slate-800 bg-slate-900">
          <SidebarHeader className="border-b border-slate-800 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/50">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-white">TradeCore</h2>
                <p className="text-xs text-slate-400">Pro Trading Suite</p>
              </div>
            </div>
          </SidebarHeader>

          <SidebarContent className="p-3">
            {navGroups.map((g, gi) => (
              <SidebarGroup key={g.label}>
                <SidebarGroupLabel className={`text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2 ${gi > 0 ? "mt-4" : ""}`}>
                  {g.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {g.items.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          className={`hover:bg-slate-800 transition-all duration-200 rounded-lg mb-1 ${
                            location.pathname === item.url
                              ? 'bg-blue-500/20 text-blue-400 border-l-2 border-blue-500'
                              : 'text-slate-300'
                          }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-3 py-2.5">
                            <item.icon className="w-4 h-4" />
                            <span className="font-medium">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="border-t border-slate-800 p-4 space-y-3">
            {/* Fleet feed health — one glance tells you if signals are
                reaching TradeCore across all accounts. Red = one or more
                accounts are stale (>60min silent). */}
            {feed && (
              <div className="flex items-center justify-between text-xs bg-slate-950/60 rounded-md px-2.5 py-1.5 border border-slate-800">
                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Feed</span>
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full shadow ${feed.dotClass}`}/>
                  <span className={`font-semibold uppercase tracking-wider ${feed.textClass}`}>{feed.label}</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">
                  {(session?.email || "T").slice(0, 1).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white text-sm truncate">
                  {session?.email?.split("@")[0] || "Trader"}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {session?.email || "Professional Account"}
                </p>
              </div>
              <button
                onClick={signOut}
                className="text-slate-400 hover:text-red-400 p-1.5 rounded-md hover:bg-red-500/10 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-4 h-4"/>
              </button>
            </div>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col bg-slate-950">
          <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 lg:hidden">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover:bg-slate-800 p-2 rounded-lg transition-colors" />
              <h1 className="text-lg font-semibold text-white">TradeCore</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
        <NotifyToaster />
      </div>
    </SidebarProvider>
  );
}
