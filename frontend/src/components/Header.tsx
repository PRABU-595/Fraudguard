import React, { useState, useEffect, useRef } from "react";
import { 
  ShieldAlert, 
  Activity, 
  Search, 
  Play, 
  Square, 
  Sliders, 
  Bell, 
  User, 
  Radio, 
  Globe, 
  Zap,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Moon,
  Menu,
  X,
  ChevronDown,
  ShieldCheck,
  Check
} from "lucide-react";
import type { SystemStats } from "../types";

interface HeaderProps {
  stats: SystemStats | null;
  activeTab: "ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config";
  setActiveTab: (tab: "ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config") => void;
  onOpenCommandPalette: () => void;
  userRole?: string;
  setUserRole?: (role: string) => void;
  environment?: string;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  activeTab,
  setActiveTab,
  onOpenCommandPalette,
  userRole = "analyst",
  setUserRole,
  environment = "Demo",
}) => {
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(3);
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    title: string;
    desc: string;
    tier: "CRITICAL" | "WARNING" | "INFO" | "SUCCESS";
    time: string;
    tab: "ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config";
    unread: boolean;
  }>>([
    {
      id: "notif_1",
      title: "Critical Impossible Travel Alert",
      desc: "Account acc_travel_12 initiated transaction in London 3m after New York (1,420 km/h).",
      tier: "CRITICAL",
      time: "Just now",
      tab: "quarantine",
      unread: true
    },
    {
      id: "notif_2",
      title: "SLA Breach Imminent (14m remaining)",
      desc: "Quarantined case CASE-1004 has exceeded 45 minutes in pending review queue.",
      tier: "WARNING",
      time: "4m ago",
      tab: "quarantine",
      unread: true
    },
    {
      id: "notif_3",
      title: "Tor Exit Relay Enforced",
      desc: "High risk onion node 185.220.101.1 was automatically force-blocked via Rule TOR_EXIT_NODE.",
      tier: "INFO",
      time: "8m ago",
      tab: "map",
      unread: true
    },
    {
      id: "notif_4",
      title: "AWS SNS Alert Published",
      desc: "SNS Topic fraudguard-critical-alerts successfully dispatched 2 critical security alerts.",
      tier: "SUCCESS",
      time: "15m ago",
      tab: "analytics",
      unread: false
    }
  ]);
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);

  const [windowWidth, setWindowWidth] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1440);

  const userDropdownRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLDivElement>(null);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  // Resize listener for exact responsive breakpoints
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setShowUserDropdown(false);
      }
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (hamburgerRef.current && !hamburgerRef.current.contains(e.target as Node)) {
        setShowHamburgerMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);





  const navItems = [
    { id: "ingestion", label: "Live Ingestion", icon: Activity, color: "text-cyan-400" },
    { id: "map", label: "Threat Map", icon: Globe, color: "text-blue-400" },
    { id: "quarantine", label: "Quarantine", icon: AlertTriangle, color: "text-amber-400" },
    { id: "accounts", label: "Accounts", icon: User, color: "text-purple-400" },
    { id: "analytics", label: "Analytics", icon: Activity, color: "text-emerald-400" },
    { id: "config", label: "Governance", icon: Sliders, color: "text-slate-400" },
  ] as const;

  const isCompactNav = windowWidth < 1600 && windowWidth >= 1100;
  const isHamburger = windowWidth < 1100;

  return (
    <header className="h-16 border-b border-border bg-[#080c14]/95 backdrop-blur-md sticky top-0 z-40 flex items-center justify-between px-4 lg:px-6 select-none flex-nowrap whitespace-nowrap overflow-visible">
      {/* Brand & Desktop Navigation */}
      <div className="flex items-center space-x-4 lg:space-x-6 shrink-0">
        <div className="flex items-center space-x-2.5 shrink-0">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <ShieldAlert className="h-5 w-5 text-white" />
          </div>
          <div className="shrink-0">
            <div className="flex items-center space-x-2">
              <span className="font-bold tracking-tight text-white text-base leading-none">FraudGuard</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 leading-none">
                SOC
              </span>
            </div>
            <p className="text-[11px] text-muted-dark leading-none mt-1">Real-Time Threat Detection</p>
          </div>
        </div>

        {/* Primary Views Nav: Full text >=1400px, Icons only 1100-1399px */}
        {!isHamburger && (
          <nav className="flex items-center space-x-1 pl-4 border-l border-border/80 shrink-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all shrink-0 whitespace-nowrap ${
                    isActive
                      ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                      : "text-muted hover:text-slate-200 hover:bg-surface-hover"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${item.color} shrink-0`} />
                  {!isCompactNav && <span className="whitespace-nowrap">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        )}

        {/* Hamburger Menu Trigger < 1100px */}
        {isHamburger && (
          <div className="relative shrink-0" ref={hamburgerRef}>
            <button
              onClick={() => setShowHamburgerMenu(!showHamburgerMenu)}
              className="p-1.5 rounded-md bg-surface-elevated border border-border text-slate-300 hover:text-white"
              title="Toggle Navigation Menu"
            >
              {showHamburgerMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>

            {showHamburgerMenu && (
              <div className="absolute left-0 top-full mt-2 w-52 rounded-xl bg-surface-elevated border border-border shadow-2xl p-2 z-50 text-xs">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setShowHamburgerMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-center space-x-2.5 transition ${
                        isActive
                          ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                          : "text-muted hover:text-white hover:bg-surface-hover"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${item.color}`} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Global Search: shrinks to fit (max 320px), expands on focus, single row, never wraps */}
      <div className="mx-2 sm:mx-4 shrink max-w-[320px] w-full min-w-[140px]">
        <div 
          className={`transition-all duration-200 w-full ${
            searchFocused ? "max-w-[400px]" : "max-w-[320px]"
          }`}
        >
          <button
            onClick={onOpenCommandPalette}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full flex items-center justify-between px-3.5 py-1.5 rounded-lg bg-surface-card border border-border/90 text-muted hover:border-slate-600 text-xs transition group whitespace-nowrap overflow-hidden"
          >
            <div className="flex items-center space-x-2 shrink-0 truncate">
              <Search className="h-3.5 w-3.5 text-muted-dark group-hover:text-cyan-400 transition shrink-0" />
              <span className="text-muted-dark group-hover:text-slate-300 truncate whitespace-nowrap">
                Search...
              </span>
            </div>
            <kbd className="inline-flex items-center space-x-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface-elevated text-muted border border-border shrink-0 ml-2">
              <span>⌘K</span>
            </kbd>
          </button>
        </div>
      </div>

      {/* Status, Simulator, Bell & User Controls (Pinned at right edge, strictly single line) */}
      <div className="flex items-center space-x-3 shrink-0 ml-auto">


        {/* Notifications Bell with Interactive Alert Center Dropdown */}
        <div className="relative shrink-0" ref={notifDropdownRef}>
          <button 
            title="Security Notifications & SOC Alerts"
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-1.5 rounded-md hover:bg-surface-elevated text-muted hover:text-slate-200 transition relative shrink-0 cursor-pointer"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifications > 0 && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-cyan-400 ring-2 ring-background animate-pulse"></span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl bg-surface-elevated border border-border shadow-2xl z-50 text-xs overflow-hidden">
              <div className="p-3 border-b border-border/80 flex items-center justify-between bg-surface-card/60">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-white text-xs">Security Alerts</span>
                  {unreadNotifications > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                      {unreadNotifications} new
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-2 text-[11px]">
                  <button
                    onClick={() => {
                      setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
                      setUnreadNotifications(0);
                    }}
                    className="text-cyan-400 hover:text-cyan-300 hover:underline"
                  >
                    Mark read
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => {
                      setNotifications([]);
                      setUnreadNotifications(0);
                    }}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-border/60">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center text-muted">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
                    <span>No unread security alerts</span>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => {
                        setActiveTab(n.tab);
                        setShowNotifications(false);
                      }}
                      className={`p-3 hover:bg-surface-hover cursor-pointer transition flex items-start space-x-2.5 ${
                        n.unread ? "bg-cyan-950/20" : ""
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {n.tier === "CRITICAL" ? (
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                        ) : n.tier === "WARNING" ? (
                          <AlertTriangle className="h-4 w-4 text-amber-400" />
                        ) : n.tier === "SUCCESS" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Radio className="h-4 w-4 text-cyan-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className={`font-semibold text-xs truncate ${n.unread ? "text-white" : "text-slate-300"}`}>
                            {n.title}
                          </span>
                          <span className="text-[10px] text-muted shrink-0 font-mono">{n.time}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{n.desc}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Menu: Avatar + Name + Role Pill ("Analyst"). Details in dropdown. No top clipping. */}
        <div className="relative shrink-0" ref={userDropdownRef}>
          <button
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-surface-elevated border border-transparent hover:border-border transition shrink-0 whitespace-nowrap"
            title="Account Profile & Role Settings"
          >
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              AC
            </div>
            <span className="text-xs font-semibold text-slate-200 hidden sm:inline whitespace-nowrap">
              Alex Chen
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800/60 uppercase shrink-0">
              {userRole === "admin" ? "Admin" : "Analyst"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-dark shrink-0" />
          </button>

          {showUserDropdown && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-surface-elevated border border-border shadow-2xl p-3 z-50 text-xs">
              <div className="flex items-center space-x-3 pb-3 border-b border-border/80">
                <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                  AC
                </div>
                <div>
                  <div className="font-semibold text-white">Alex Chen</div>
                  <div className="text-[11px] text-muted-dark font-mono">analyst_04@soc.internal</div>
                </div>
              </div>

              {/* Role Details */}
              <div className="py-2.5 border-b border-border/80 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Assigned Tier:</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {userRole === "admin" ? "Super Admin (R/W)" : "L2 Analyst (Role-Gated)"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-dark">
                  <span>Permissions:</span>
                  <span>{userRole === "admin" ? "Full Config / Release R/W" : "Read-Only / Review <80"}</span>
                </div>
              </div>

              {/* Role Switcher */}
              <div className="pt-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted mb-2">Switch Active Role</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setUserRole && setUserRole("analyst");
                      setShowUserDropdown(false);
                    }}
                    className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center space-x-1 transition ${
                      userRole === "analyst"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold"
                        : "bg-surface hover:bg-surface-hover text-muted hover:text-white border border-border"
                    }`}
                  >
                    {userRole === "analyst" && <Check className="h-3 w-3 mr-1" />}
                    <span>Analyst</span>
                  </button>

                  <button
                    onClick={() => {
                      setUserRole && setUserRole("admin");
                      setShowUserDropdown(false);
                    }}
                    className={`py-1.5 px-2 rounded-lg font-medium flex items-center justify-center space-x-1 transition ${
                      userRole === "admin"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold"
                        : "bg-surface hover:bg-surface-hover text-muted hover:text-white border border-border"
                    }`}
                  >
                    {userRole === "admin" && <Check className="h-3 w-3 mr-1" />}
                    <span>Admin</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
