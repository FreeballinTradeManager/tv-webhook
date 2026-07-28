import React from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
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
  Sparkles
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

const navigationItems = [
  { title: "Dashboard", url: createPageUrl("Dashboard"), icon: LayoutDashboard },
  { title: "Live Positions", url: createPageUrl("LivePositions"), icon: Activity },
  { title: "Trades", url: createPageUrl("Trades"), icon: TrendingUp },
  { title: "New Trade", url: createPageUrl("NewTrade"), icon: PlusCircle },
  { title: "Risk Calculator", url: createPageUrl("RiskCalculator"), icon: Calculator },
  { title: "Backtester", url: createPageUrl("Backtester"), icon: Rewind },
  { title: "Accounts", url: createPageUrl("Accounts"), icon: Wallet },
  { title: "Rotation", url: createPageUrl("Rotation"), icon: Repeat },
  { title: "Analytics", url: createPageUrl("Analytics"), icon: BarChart3 },
  { title: "Strategies", url: createPageUrl("Strategies"), icon: BookOpen },
  { title: "Alerts", url: createPageUrl("Alerts"), icon: Bell },
  { title: "Vault", url: createPageUrl("Vault"), icon: KeyRound },
  { title: "Setup Wizard", url: createPageUrl("Setup"), icon: Sparkles },
  { title: "Settings", url: createPageUrl("Settings"), icon: Settings },
];

export default function Layout({ children }) {
  const location = useLocation();

  return (
    <SidebarProvider>
      <style>
        {`
          :root {
            --background: 15 23 42;
            --foreground: 248 250 252;
            --card: 30 41 59;
            --card-foreground: 248 250 252;
            --primary: 59 130 246;
            --primary-foreground: 255 255 255;
            --secondary: 51 65 85;
            --muted: 51 65 85;
            --accent: 59 130 246;
            --destructive: 239 68 68;
            --border: 51 65 85;
            --input: 51 65 85;
            --ring: 59 130 246;
          }
          body {
            background: #0F172A;
            color: #F8FAFC;
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
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2">
                Trading
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.slice(0, 3).map((item) => (
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

            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2 mt-4">
                Management
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.slice(3, 8).map((item) => (
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

            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2 mt-4">
                System
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navigationItems.slice(8).map((item) => (
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
          </SidebarContent>

          <SidebarFooter className="border-t border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                <span className="text-white font-semibold text-sm">T</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white text-sm truncate">Trader</p>
                <p className="text-xs text-slate-400 truncate">Professional Account</p>
              </div>
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
      </div>
    </SidebarProvider>
  );
}
