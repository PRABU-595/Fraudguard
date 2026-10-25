import React, { useState } from "react";
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
  Moon
} from "lucide-react";
import type { SystemStats } from "../types";

interface HeaderProps {
  stats: SystemStats | null;
  activeTab: "ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config";
  setActiveTab: (tab: "ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config") => void;
  onOpenCommandPalette: () => void;
  onTriggerScenario: (scenario: string) => Promise<void>;
  onToggleSimulator: (running: boolean, tps: number) => Promise<void>;
  userRole?: string;
  setUserRole?: (role: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  stats,
  activeTab,
  setActiveTab,
  onOpenCommandPalette,
  onTriggerScenario,
  onToggleSimulator,
  userRole = "analyst",
  setUserRole,
}) => {
  const [showSimulatorModal, setShowSimulatorModal] = useState(false);
  const [simTps, setSimTps] = useState(stats?.tps || 2.0);
  const [simLoading, setSimLoading] = useState(false);

  const streamState = stats?.stream_state || "OFF";
  const isStreamActive = stats?.stream_active || false;

  const handleSimToggle = async () => {
    setSimLoading(true);
    try {
      await onToggleSimulator(!isStreamActive, simTps);
    } finally {
      setSimLoading(false);
    }
  };

  const handleScenarioClick = async (scenario: string) => {
    setSimLoading(true);
    try {
      await onTriggerScenario(scenario);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <header className="h-16 border-b border-border bg-surface/90 backdrop-blur sticky top-0 z-30 flex items-center justify-between px-6 select-none">
      {/* Brand & Tabs */}
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2.5">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <ShieldAlert className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold tracking-tight text-white text-base">FraudGuard</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                SOC Console
              </span>
            </div>
            <p className="text-[11px] text-muted-dark leading-none">Real-Time Threat Detection</p>
          </div>
        </div>

        {/* Primary Views Nav */}
        <nav className="flex items-center space-x-1 pl-4 border-l border-border/80">
          <button
            onClick={() => setActiveTab("ingestion")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "ingestion"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span>Live Ingestion</span>
          </button>

          <button
            onClick={() => setActiveTab("map")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "map"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <Globe className="h-3.5 w-3.5 text-blue-400" />
            <span>Threat Map</span>
          </button>

          <button
            onClick={() => setActiveTab("quarantine")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "quarantine"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
            <span>Quarantine</span>
          </button>

          <button
            onClick={() => setActiveTab("accounts")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "accounts"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <User className="h-3.5 w-3.5 text-purple-400" />
            <span>Accounts</span>
          </button>

          <button
            onClick={() => setActiveTab("analytics")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "analytics"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            <span>Analytics</span>
          </button>

          <button
            onClick={() => setActiveTab("config")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center space-x-2 transition-all ${
              activeTab === "config"
                ? "bg-surface-elevated text-white border border-border shadow-sm font-bold"
                : "text-muted hover:text-slate-200 hover:bg-surface-hover"
            }`}
          >
            <Sliders className="h-3.5 w-3.5 text-slate-400" />
            <span>Governance</span>
          </button>
        </nav>
      </div>

      {/* Global Search / Command Palette Bar */}
      <div className="flex-1 max-w-md mx-6">
        <button
          onClick={onOpenCommandPalette}
          className="w-full flex items-center justify-between px-3.5 py-1.5 rounded-lg bg-surface-card border border-border/90 text-muted hover:border-slate-600 text-xs transition group"
        >
          <div className="flex items-center space-x-2">
            <Search className="h-3.5 w-3.5 text-muted-dark group-hover:text-cyan-400 transition" />
            <span>Search transactions, accounts, IPs, cities...</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center space-x-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-surface-elevated text-muted border border-border">
            <span>⌘K</span>
          </kbd>
        </button>
      </div>

      {/* Status, Simulator, Bell & User Controls */}
      <div className="flex items-center space-x-3.5">
        {/* Stream Status Pill (Single Source of Truth) */}
        <div 
          className={`flex items-center space-x-2 px-2.5 py-1 rounded-full border text-xs font-medium ${
            isStreamActive
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
              : "bg-slate-900 border-slate-700 text-slate-400"
          }`}
        >
          <span className="relative flex h-2 w-2">
            {isStreamActive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isStreamActive ? "bg-emerald-400" : "bg-slate-500"}`}></span>
          </span>
          <span className="font-mono text-[11px] tracking-wide uppercase">
            {isStreamActive ? `STREAM ${streamState} (${stats?.tps.toFixed(1)} TPS)` : "STREAM OFF"}
          </span>
        </div>

        {/* Environment Badge */}
        <span className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/40">
          PCI-DSS L1
        </span>

        {/* Attack Simulator Popover Trigger */}
        <div className="relative">
          <button
            onClick={() => setShowSimulatorModal(!showSimulatorModal)}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-surface-elevated hover:bg-surface-hover border border-border text-xs text-slate-200 transition"
          >
            <Sliders className="h-3.5 w-3.5 text-cyan-400" />
            <span>Simulator</span>
          </button>

          {showSimulatorModal && (
            <div className="absolute right-0 mt-2 w-80 rounded-xl bg-surface-elevated border border-border shadow-2xl p-4 z-50 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border/80">
                <div className="flex items-center space-x-2">
                  <Zap className="h-4 w-4 text-cyan-400" />
                  <span className="font-semibold text-white">Adversary Simulator</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/50">
                  ADMIN ONLY
                </span>
              </div>

              {/* Streaming TPS Control */}
              <div className="py-3 border-b border-border/80 space-y-2">
                <div className="flex items-center justify-between text-muted">
                  <span>Stream Generator</span>
                  <span className="font-mono text-white">{simTps} TPS</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="8.0"
                  step="0.5"
                  value={simTps}
                  onChange={(e) => setSimTps(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 h-1.5 bg-surface rounded cursor-pointer"
                />
                <button
                  onClick={handleSimToggle}
                  disabled={simLoading}
                  className={`w-full py-1.5 rounded font-medium flex items-center justify-center space-x-2 transition ${
                    isStreamActive
                      ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                      : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30"
                  }`}
                >
                  {isStreamActive ? (
                    <>
                      <Square className="h-3 w-3" />
                      <span>Halt Stream Ingestion</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      <span>Start Background Stream</span>
                    </>
                  )}
                </button>
              </div>

              {/* Attack Scenarios */}
              <div className="pt-3 space-y-1.5">
                <p className="text-[11px] font-medium text-muted uppercase tracking-wider mb-2">
                  Inject Attack Scenarios
                </p>
                <button
                  onClick={() => handleScenarioClick("NORMAL")}
                  disabled={simLoading}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between transition group"
                >
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-slate-200">Normal Domestic</span>
                  </div>
                  <span className="text-[10px] text-muted-dark group-hover:text-muted">ALLOW</span>
                </button>

                <button
                  onClick={() => handleScenarioClick("IMPOSSIBLE_TRAVEL")}
                  disabled={simLoading}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between transition group"
                >
                  <div className="flex items-center space-x-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    <span className="text-slate-200">Impossible Travel</span>
                  </div>
                  <span className="text-[10px] text-red-400">BLOCK (&gt;900km/h)</span>
                </button>

                <button
                  onClick={() => handleScenarioClick("TOR")}
                  disabled={simLoading}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between transition group"
                >
                  <div className="flex items-center space-x-2">
                    <Radio className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-slate-200">Tor Exit Node</span>
                  </div>
                  <span className="text-[10px] text-red-400">BLOCK</span>
                </button>

                <button
                  onClick={() => handleScenarioClick("BURST")}
                  disabled={simLoading}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between transition group"
                >
                  <div className="flex items-center space-x-2">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    <span className="text-slate-200">Velocity Burst</span>
                  </div>
                  <span className="text-[10px] text-red-400">BURST 5x</span>
                </button>

                <button
                  onClick={() => handleScenarioClick("NIGHT")}
                  disabled={simLoading}
                  className="w-full text-left px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between transition group"
                >
                  <div className="flex items-center space-x-2">
                    <Moon className="h-3.5 w-3.5 text-indigo-400" />
                    <span className="text-slate-200">Night Fraud</span>
                  </div>
                  <span className="text-[10px] text-amber-400">REVIEW</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Notifications Bell */}
        <button 
          title="Notifications"
          className="p-1.5 rounded-md hover:bg-surface-elevated text-muted hover:text-slate-200 transition relative"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-cyan-400"></span>
        </button>

        {/* User Role Selector */}
        <div className="flex items-center space-x-2 pl-3 border-l border-border/80">
          <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
            <User className="h-3.5 w-3.5" />
          </div>
          <div className="hidden md:block leading-tight text-left">
            <button
              onClick={() => setUserRole && setUserRole(userRole === "admin" ? "analyst" : "admin")}
              className="text-left group"
              title="Click to toggle Admin / Analyst role"
            >
              <span className="block text-xs font-semibold text-slate-200 group-hover:text-cyan-300">
                {userRole === "admin" ? "SOC Administrator" : "SOC Analyst"}
              </span>
              <span className="block text-[10px] text-cyan-400 font-mono">
                {userRole === "admin" ? "Super Admin (R/W)" : "L2 Analyst (Role-Gated)"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
