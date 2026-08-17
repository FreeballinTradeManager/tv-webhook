import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getSession, setSession } from "@/pages/SignIn";
import { Account } from "@/entities/all";
import { fleetHealth } from "@/lib/connection_health";
import NotifyToaster from "@/components/NotifyToaster";
import HelpChatFAB from "@/components/HelpChatFAB";
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

// Task #231 — nav consolidation. Down from 32 items across 6 groups to
// 5 primary items + a user menu. Old URLs still work: the new consolidated
// pages (Journal, Config, Tools) render the old page components as tabs,
// so /Trades, /Accounts, etc. keep responding. Anything not surfaced here
// remains reachable by direct URL (ManualSignal, Logs, Demo, ConnectPMT,
// PropFirmOnboarding, TradeShare, ChartDrawings) — kept for links but off
// the main nav so the sidebar stays scannable.
const primaryNav = [
  { title: "Dashboard", url: createPageUrl("Dashboard"), icon: LayoutDashboard,
    hint: "Live view + today's P&L" },
  { title: "Journal",   url: createPageUrl("Journal"),   icon: BookOpen,
    hint: "Trades · Log · Daily notes · AI insights · What-if" },
  { title: "Analytics", url: createPageUrl("Analytics"), icon: BarChart3,
    hint: "Reports · Sessions · Sharing" },
  { title: "Config",    url: createPageUrl("Config"),    icon: Wallet,
    hint: "Accounts · Strategies · Rotation · MT5 · Integrations" },
  { title: "Tools",     url: createPageUrl("Tools"),     icon: Zap,
    hint: "Risk calc · Backtester · Alerts · Manual fire" },
];

// User menu — lives in the sidebar footer next to Sign Out. These are
// per-user config items nobody clicks daily, so they don't earn primary
// nav space.
const userMenuNav = [
  { title: "Settings",      url: createPageUrl("Settings"),      icon: Settings },
  { title: "Vault",         url: createPageUrl("Vault"),         icon: KeyRound },
  { title: "Subscriptions", url: createPageUrl("Subscriptions"), icon: CreditCard },
];

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

          {/* PC-app style — 5 primary items, big + bold, hint text under.
              No section headings needed with only 5 items. Active state is
              a solid blue pill, not a subtle stripe. */}
          <SidebarContent className="p-3">
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {primaryNav.map((item) => {
                    const active = location.pathname === item.url
                      || (item.url !== "/Dashboard" && location.pathname.startsWith(item.url + "?"))
                      || (item.url !== "/Dashboard" && location.pathname === item.url + "/");
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          className={`transition-all duration-150 rounded-xl mb-2 h-auto py-3 ${
                            active
                              ? 'bg-blue-600 !text-white hover:bg-blue-600 shadow-md'
                              : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <Link to={item.url} className="flex items-start gap-3 px-4">
                            <item.icon className={`w-6 h-6 mt-0.5 ${active ? 'text-white' : 'text-blue-400'}`} />
                            <span className="flex flex-col leading-tight">
                              <span className={`font-bold text-base ${active ? 'text-white' : ''}`}>{item.title}</span>
                              <span className={`text-[11px] mt-0.5 ${active ? 'text-blue-100' : 'text-slate-500'}`}>{item.hint}</span>
                            </span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Divider before user menu — visually separates "what I do"
                from "how the app is set up for me". */}
            <div className="border-t border-slate-800 my-3 mx-2" />

            <SidebarGroup>
              <SidebarGroupLabel className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">
                Account
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {userMenuNav.map((item) => {
                    const active = location.pathname === item.url;
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          className={`transition-all duration-150 rounded-lg mb-1 ${
                            active
                              ? 'bg-slate-700 text-white'
                              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-3 py-2">
                            <item.icon className="w-4 h-4" />
                            <span className="font-medium text-sm">{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
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
        {/* Task #231 — floating help chat available on every page */}
        <HelpChatFAB />
      </div>
    </SidebarProvider>
  );
}
