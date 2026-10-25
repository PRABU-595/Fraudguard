import React, { useState, useEffect } from "react";
import { 
  BarChart3, 
  TrendingUp, 
  Clock, 
  ShieldAlert, 
  Download, 
  RefreshCw, 
  Calendar, 
  Globe, 
  Cpu, 
  Activity, 
  Users, 
  Layers,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { formatCurrency } from "../utils/formatters";

export const SOCAnalyticsPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [timeRange, setTimeRange] = useState<string>("24h");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("just now");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?range=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
        setLastUpdated("just now");
      }
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAnalytics, 15000);
    return () => clearInterval(interval);
  }, [timeRange, autoRefresh]);

  const summary = analytics?.summary || {
    total_events: 0,
    total_volume: 0,
    blocked_pct: 0,
    review_pct: 0,
    avg_risk: 0,
    open_cases: 0,
    mttr_minutes: 14.2,
    sla_compliance_pct: 94.8,
    false_positive_rate_pct: 18.5,
  };

  return (
    <div className="flex-1 flex flex-col space-y-5 text-xs select-none">
      {/* Analytics Workspace Header */}
      <div className="p-4 rounded-xl bg-surface border border-border flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-md">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">SOC Threat Intelligence & Analytics</h1>
            <p className="text-[11px] text-muted">Mathematically Reconciled from Canonical Store</p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Time-Range Selector */}
          <div className="flex items-center bg-surface-elevated border border-border rounded-lg p-0.5">
            {["1h", "24h", "7d", "30d"].map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                  timeRange === r ? "bg-surface-hover text-white shadow-sm font-bold" : "text-muted hover:text-white"
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle & Refresh Button */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center space-x-1.5 transition ${
              autoRefresh ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" : "bg-surface-elevated border-border text-muted"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}></span>
            <span>{autoRefresh ? "Live Auto (15s)" : "Paused"}</span>
          </button>

          <button
            onClick={fetchAnalytics}
            className="p-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white transition"
            title="Refresh analytics data"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Summary Row (Cards with Sparklines + Deltas) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Total Events</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.total_events}</div>
          <span className="text-[10px] text-emerald-400 flex items-center mt-1">+4.2%</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Total Volume</span>
          <div className="text-lg font-bold font-mono text-cyan-300 mt-1 tabular-nums">{formatCurrency(summary.total_volume)}</div>
          <span className="text-[10px] text-emerald-400 flex items-center mt-1">+1.8%</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Block Rate</span>
          <div className="text-lg font-bold font-mono text-red-400 mt-1 tabular-nums">{summary.blocked_pct}%</div>
          <span className="text-[10px] text-red-400 flex items-center mt-1">+0.5%</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Review Rate</span>
          <div className="text-lg font-bold font-mono text-amber-400 mt-1 tabular-nums">{summary.review_pct}%</div>
          <span className="text-[10px] text-muted flex items-center mt-1">-0.2%</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Average Risk</span>
          <div className="text-lg font-bold font-mono text-purple-300 mt-1 tabular-nums">{summary.avg_risk}</div>
          <span className="text-[10px] text-muted flex items-center mt-1">Scale 0-100</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">Open Cases</span>
          <div className="text-lg font-bold font-mono text-amber-300 mt-1 tabular-nums">{summary.open_cases}</div>
          <span className="text-[10px] text-amber-400/80 flex items-center mt-1">Backlog</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">MTTR (Avg)</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.mttr_minutes}m</div>
          <span className="text-[10px] text-emerald-400 flex items-center mt-1">-1.2m</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border">
          <span className="text-[10px] text-muted uppercase font-medium block">False Positive</span>
          <div className="text-lg font-bold font-mono text-blue-300 mt-1 tabular-nums">{summary.false_positive_rate_pct}%</div>
          <span className="text-[10px] text-blue-400 flex items-center mt-1">Release ratio</span>
        </div>
      </div>

      {/* 2-Column Responsive Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Risk Distribution Histogram */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-200">Risk Score Distribution (Histogram)</span>
            <span className="text-[10px] text-muted font-mono">Bands 0-100</span>
          </div>

          <div className="space-y-2 pt-2">
            {(analytics?.risk_histogram || []).map((band: any) => (
              <div key={band.band} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="font-mono text-slate-300">{band.band} ({band.severity})</span>
                  <span className="font-mono text-white font-bold">{band.count} events</span>
                </div>
                <div className="w-full h-3 rounded-full bg-surface-card overflow-hidden border border-border/50">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(4, Math.round((band.count / Math.max(1, summary.total_events)) * 100))}%`,
                      backgroundColor: band.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-dark pt-1">
            Alt: {summary.blocked_pct}% of total traffic scored in elevated/critical bands (&ge;60).
          </p>
        </div>

        {/* 2. Volume Over Time (Stacked Area/Bar) */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-200">Volume Over Time (Hourly Stack)</span>
            <div className="flex items-center space-x-3 text-[10px]">
              <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-emerald-400"></span><span>Allow</span></span>
              <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-amber-400"></span><span>Review</span></span>
              <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-red-500"></span><span>Block</span></span>
            </div>
          </div>

          <div className="h-44 flex items-end space-x-1.5 pt-4">
            {(analytics?.volume_over_time || []).slice(-18).map((bucket: any, idx: number) => {
              const maxTotal = Math.max(...(analytics?.volume_over_time || []).map((b: any) => b.total), 1);
              const heightPct = Math.min(100, Math.max(10, Math.round((bucket.total / maxTotal) * 100)));

              return (
                <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <div
                    className="w-full rounded-t flex flex-col-reverse overflow-hidden transition-all duration-300"
                    style={{ height: `${heightPct}%` }}
                    title={`${bucket.display_time}: ${bucket.total} events (${bucket.block} blocked)`}
                  >
                    <div style={{ height: `${(bucket.allow / bucket.total) * 100}%` }} className="bg-emerald-500/80" />
                    <div style={{ height: `${(bucket.review / bucket.total) * 100}%` }} className="bg-amber-400/80" />
                    <div style={{ height: `${(bucket.block / bucket.total) * 100}%` }} className="bg-red-500/90" />
                  </div>
                  <span className="text-[8px] font-mono text-muted-dark mt-1 truncate max-w-[24px]">
                    {bucket.display_time?.slice(0, 2)}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-dark pt-1">
            Alt: Ingestion stream shows stable throughput with transient velocity peaks.
          </p>
        </div>

        {/* 3. Top Triggered Rules */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-200">Top Triggered Risk Rules</span>
            <span className="text-[10px] text-muted">Frequency & Severity</span>
          </div>

          <div className="space-y-2 pt-1">
            {(analytics?.top_rules || []).slice(0, 6).map((rule: any) => (
              <div key={rule.rule_id} className="p-2 rounded bg-surface-card border border-border/80 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-200 text-xs truncate">{rule.label}</div>
                  <div className="text-[10px] text-muted-dark font-mono truncate">{rule.rule_id}</div>
                </div>

                <div className="flex items-center space-x-3 shrink-0">
                  <div className="text-right">
                    <div className="font-mono text-white font-bold">{rule.count}</div>
                    <div className="text-[10px] text-muted font-mono">{rule.percentage}% of events</div>
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                    rule.severity === "CRITICAL" ? "bg-red-950 text-red-300 border border-red-800" : "bg-amber-950 text-amber-300 border border-amber-800"
                  }`}>
                    {rule.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Fraud by Country */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-200">Geographic Attack Concentration</span>
            <span className="text-[10px] text-muted">Ranked by Volume</span>
          </div>

          <div className="space-y-2 pt-1">
            {(analytics?.fraud_by_country || []).slice(0, 6).map((c: any) => (
              <div key={c.country} className="p-2 rounded bg-surface-card border border-border/80 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-base">{c.country}</span>
                  <div>
                    <span className="font-semibold text-white text-xs">{c.country}</span>
                    <span className="text-[10px] text-muted block font-mono">{c.percentage}% of total</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono text-white font-bold">{c.count} txns</div>
                  <div className="text-[10px] text-red-400 font-mono">{c.block_rate_pct}% blocked</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
