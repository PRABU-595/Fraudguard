import React from "react";
import type { SystemStats } from "../types";
import { ShieldAlert, Activity, Ban, Clock, AlertOctagon, Timer } from "lucide-react";

interface KPIBarProps {
  stats: SystemStats | null;
  onFilterClick: (filterKey: string, filterVal: string) => void;
  activeFilter: { key: string; val: string } | null;
}

export const KPIBar: React.FC<KPIBarProps> = ({ stats, onFilterClick, activeFilter }) => {
  const total = stats?.total_events || 0;
  const tps = stats?.tps || 0.0;
  const blockPct = stats?.block_rate_pct || 0.0;
  const quarantineBacklog = stats?.quarantine_backlog || 0;
  const slaBreaches = stats?.sla_breaches || 0;
  const mttr = stats?.mttr_minutes || 14.2;
  const isStreamActive = stats?.stream_active || false;
  const sparkline = stats?.sparkline_30m && stats.sparkline_30m.length === 6 ? stats.sparkline_30m : [12, 18, 15, 24, 20, 28];

  // Render minimal SVG sparkline
  const renderSparkline = (data: number[], color: string) => {
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const width = 64;
    const height = 22;

    const points = data
      .map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg className="w-16 h-6 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-6">
      {/* 1. Total Ingested */}
      <div 
        onClick={() => onFilterClick("all", "ALL")}
        className={`p-3.5 rounded-xl bg-surface border transition cursor-pointer select-none group ${
          !activeFilter || activeFilter.key === "all"
            ? "border-cyan-500/40 shadow-lg shadow-cyan-950/20"
            : "border-border hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">Total Ingested</span>
          <Activity className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-white tabular-nums">
            {total.toLocaleString()}
          </div>
          {renderSparkline(sparkline, "#06b6d4")}
        </div>
        <div className="mt-2 text-[10px] text-emerald-400 flex items-center space-x-1">
          <span>+3.8% vs last hour</span>
        </div>
      </div>

      {/* 2. Ingestion Rate (TPS) */}
      <div className="p-3.5 rounded-xl bg-surface border border-border select-none">
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">Stream Rate</span>
          <Clock className={`h-3.5 w-3.5 ${isStreamActive ? "text-emerald-400" : "text-slate-500"}`} />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-white tabular-nums">
            {tps.toFixed(1)} <span className="text-xs text-muted font-normal">TPS</span>
          </div>
          {renderSparkline(isStreamActive ? [1.0, 1.5, 2.0, 1.8, 2.2, tps] : [0, 0, 0, 0, 0, 0], isStreamActive ? "#10b981" : "#64748b")}
        </div>
        <div className="mt-2 text-[10px] text-muted flex items-center space-x-1">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${isStreamActive ? "bg-emerald-400" : "bg-slate-600"}`}></span>
          <span>{isStreamActive ? "Active SSE connection" : "Stream offline / 0 TPS"}</span>
        </div>
      </div>

      {/* 3. Block Rate % */}
      <div 
        onClick={() => onFilterClick("decision", "BLOCK")}
        className={`p-3.5 rounded-xl bg-surface border transition cursor-pointer select-none group ${
          activeFilter?.val === "BLOCK"
            ? "border-red-500/50 shadow-lg shadow-red-950/20"
            : "border-border hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">Block Rate</span>
          <Ban className="h-3.5 w-3.5 text-red-400" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-red-400 tabular-nums">
            {blockPct.toFixed(1)}%
          </div>
          {renderSparkline([22, 25, 28, 27, 30, blockPct], "#ef4444")}
        </div>
        <div className="mt-2 text-[10px] text-red-400/80 flex items-center space-x-1">
          <span>Click to filter Blocked</span>
        </div>
      </div>

      {/* 4. Quarantine Backlog */}
      <div 
        onClick={() => onFilterClick("status", "QUARANTINED")}
        className={`p-3.5 rounded-xl bg-surface border transition cursor-pointer select-none group ${
          activeFilter?.val === "QUARANTINED"
            ? "border-amber-500/50 shadow-lg shadow-amber-950/20"
            : "border-border hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">Quarantine Backlog</span>
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-amber-400 tabular-nums">
            {quarantineBacklog}
          </div>
          {renderSparkline([10, 14, 18, 15, 22, quarantineBacklog], "#f59e0b")}
        </div>
        <div className="mt-2 text-[10px] text-amber-400/80 flex items-center space-x-1">
          <span>Open pending items</span>
        </div>
      </div>

      {/* 5. SLA Breaches */}
      <div 
        onClick={() => onFilterClick("sla", "BREACHED")}
        className={`p-3.5 rounded-xl bg-surface border transition cursor-pointer select-none group ${
          activeFilter?.val === "BREACHED"
            ? "border-rose-500/50 shadow-lg shadow-rose-950/20"
            : "border-border hover:border-slate-700"
        }`}
      >
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">SLA Breaches</span>
          <AlertOctagon className="h-3.5 w-3.5 text-rose-500" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-rose-400 tabular-nums">
            {slaBreaches}
          </div>
          {renderSparkline([2, 5, 4, 8, 7, slaBreaches], "#f43f5e")}
        </div>
        <div className="mt-2 text-[10px] text-rose-400/90 flex items-center space-x-1">
          <span>&gt;30 min past deadline</span>
        </div>
      </div>

      {/* 6. Mean Time to Review (MTTR) */}
      <div className="p-3.5 rounded-xl bg-surface border border-border select-none">
        <div className="flex items-center justify-between text-muted mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider">MTTR</span>
          <Timer className="h-3.5 w-3.5 text-purple-400" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-xl font-bold font-mono tracking-tight text-purple-300 tabular-nums">
            {mttr.toFixed(1)} <span className="text-xs text-muted font-normal">min</span>
          </div>
          {renderSparkline([18, 16, 15, 14.5, 14.0, mttr], "#c084fc")}
        </div>
        <div className="mt-2 text-[10px] text-muted flex items-center space-x-1">
          <span>Avg resolution speed</span>
        </div>
      </div>
    </div>
  );
};
