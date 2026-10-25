import React, { useState, useEffect, useMemo } from "react";
import { 
  BarChart3, 
  RefreshCw, 
  Globe, 
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Shield,
  Activity,
  Sliders,
  Sparkles
} from "lucide-react";
import { formatCurrency } from "../utils/formatters";

export const SOCAnalyticsPage: React.FC = () => {
  const [analytics, setAnalytics] = useState<any | null>(null);
  const [timeRange, setTimeRange] = useState<string>("24h");
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("just now");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [logScale, setLogScale] = useState<boolean>(false);
  const [geoMetric, setGeoMetric] = useState<"count" | "blocked" | "block_rate_pct">("count");
  const [hoveredBucket, setHoveredBucket] = useState<any | null>(null);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?range=${timeRange}`);
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
        setLastUpdated(new Date().toLocaleTimeString());
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
    blocked_count: 0,
    blocked_pct: 0,
    review_count: 0,
    review_pct: 0,
    allow_count: 0,
    avg_risk: 0,
    open_cases: 0,
    mttr_minutes: 0,
    sla_compliance_pct: 0,
    false_positive_rate_pct: 0,
    release_rate_pct: 0,
    confirmed_fraud_rate_pct: 0,
  };

  const deltas = analytics?.deltas || {};
  const captions = analytics?.captions || {};

  // Mathematical Reconciliation Check
  const riskHistogramSum = useMemo(() => {
    return (analytics?.risk_histogram || []).reduce((acc: number, curr: any) => acc + (curr.count || 0), 0);
  }, [analytics]);

  const volumeSum = useMemo(() => {
    return (analytics?.volume_over_time || []).reduce((acc: number, curr: any) => acc + (curr.total || 0), 0);
  }, [analytics]);

  const isReconciled = summary.total_events > 0 && 
    riskHistogramSum === summary.total_events && 
    volumeSum === summary.total_events;

  // Max bucket for Volume chart
  const maxBucketTotal = useMemo(() => {
    const totals = (analytics?.volume_over_time || []).map((b: any) => b.total || 0);
    return Math.max(...totals, 1);
  }, [analytics]);

  // Sorted Geo List based on selected metric
  const sortedGeo = useMemo(() => {
    const list = [...(analytics?.geographic_activity || [])];
    return list.sort((a, b) => (b[geoMetric] || 0) - (a[geoMetric] || 0));
  }, [analytics, geoMetric]);

  const renderDelta = (delta: number | null | undefined, suffix: string = "%", invertColor: boolean = false) => {
    if (delta === null || delta === undefined) {
      return <span className="text-[10px] text-muted font-mono tracking-tight">—</span>;
    }
    const isPositive = delta > 0;
    const isZero = delta === 0;

    let colorClass = "text-muted";
    if (!isZero) {
      if (invertColor) {
        colorClass = isPositive ? "text-red-400" : "text-emerald-400";
      } else {
        colorClass = isPositive ? "text-emerald-400" : "text-red-400";
      }
    }

    return (
      <span className={`text-[10px] font-mono flex items-center space-x-0.5 ${colorClass}`}>
        {!isZero && (isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
        <span>{isPositive ? `+${delta}` : delta}{suffix} vs prev</span>
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 text-xs select-none">
      {/* Analytics Workspace Header */}
      <div className="p-4 rounded-xl bg-surface border border-border flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-md">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-tight">SOC Threat Intelligence & Analytics</h1>
              {/* Reconciliation Chip */}
              {isReconciled ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center space-x-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  <span>Reconciled · {riskHistogramSum} = {summary.total_events}</span>
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-red-950/80 text-red-300 border border-red-500/40 flex items-center space-x-1">
                  <AlertTriangle className="h-3 w-3 text-red-400" />
                  <span>Variance Detected ({riskHistogramSum} vs {summary.total_events})</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted">Aggregated strictly from the shared canonical transaction store</p>
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

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center space-x-1.5 transition ${
              autoRefresh ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300" : "bg-surface-elevated border-border text-muted"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`}></span>
            <span>{autoRefresh ? "Auto-refresh · 15s" : "Paused"}</span>
          </button>

          {/* Refresh Button */}
          <button
            onClick={fetchAnalytics}
            className="p-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white transition"
            title={`Last updated ${lastUpdated}. Click to refresh.`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary Row (8 Metric Cards with Neutral White Values + Deltas) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Total Events</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.total_events.toLocaleString()}</div>
          <div className="mt-1">{renderDelta(deltas.total_events)}</div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Total Volume</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{formatCurrency(summary.total_volume)}</div>
          <div className="mt-1">{renderDelta(deltas.total_volume)}</div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Block Rate</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.blocked_pct}%</div>
          <div className="mt-1">{renderDelta(deltas.blocked_pct, " pts", true)}</div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Review Rate</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.review_pct}%</div>
          <div className="mt-1">{renderDelta(deltas.review_pct, " pts")}</div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Average Risk</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.avg_risk}</div>
          <div className="mt-1">{renderDelta(deltas.avg_risk, " pts", true)}</div>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Open Cases</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.open_cases}</div>
          <span className="text-[10px] text-muted font-mono mt-1">Quarantine Backlog</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">Mean Time To Review</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.mttr_minutes}m</div>
          <span className="text-[10px] text-muted font-mono mt-1">Closed cases only</span>
        </div>

        <div className="p-3 rounded-xl bg-surface border border-border flex flex-col justify-between">
          <span className="text-[10px] text-muted uppercase font-medium">False Positive</span>
          <div className="text-lg font-bold font-mono text-white mt-1 tabular-nums">{summary.false_positive_rate_pct}%</div>
          <span className="text-[10px] text-muted font-mono mt-1">Released / reviewed</span>
        </div>
      </div>

      {/* Responsive Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Risk Score Distribution Histogram */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-white">Risk Score Distribution</span>
              <span className="text-[10px] text-muted font-mono">Bands 0-100 · {riskHistogramSum} events</span>
            </div>

            <div className="space-y-2.5 pt-3">
              {(analytics?.risk_histogram || []).map((band: any) => {
                const pct = Math.round(((band.count || 0) / Math.max(1, summary.total_events)) * 100);
                return (
                  <div key={band.band} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="font-mono text-slate-300 font-medium">
                        {band.band} ({band.severity})
                      </span>
                      <span className="font-mono text-white font-bold">
                        {band.count} events <span className="text-muted font-normal">({pct}%)</span>
                      </span>
                    </div>
                    <div className="w-full h-3 rounded-full bg-surface-card overflow-hidden border border-border/50">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          backgroundColor: band.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dynamic Caption without hardcoded text */}
          <div 
            className="pt-2 border-t border-border/40 text-[11px] text-slate-400 italic"
            aria-label={captions.risk_histogram || "Risk score distribution across severity tiers."}
          >
            {captions.risk_histogram || `${summary.blocked_pct}% of events scored in critical or elevated bands.`}
          </div>
        </div>

        {/* 2. Volume Over Time (24 Hourly Zero-Filled Buckets) */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-white">Volume Over Time</span>
                <span className="text-[10px] text-muted font-mono">(24 Hourly Buckets)</span>
              </div>
              
              <div className="flex items-center space-x-3">
                {/* Log/Linear Scale Toggle */}
                <button
                  onClick={() => setLogScale(!logScale)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                    logScale 
                      ? "bg-cyan-950/80 border-cyan-500/50 text-cyan-300 font-bold" 
                      : "bg-surface-elevated border-border text-muted hover:text-white"
                  }`}
                  title="Toggle logarithmic scaling"
                >
                  {logScale ? "Log Scale" : "Linear Scale"}
                </button>

                {/* Legend */}
                <div className="flex items-center space-x-2.5 text-[10px]">
                  <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-emerald-400"></span><span className="text-muted">Allow</span></span>
                  <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-amber-400"></span><span className="text-muted">Review</span></span>
                  <span className="flex items-center space-x-1"><span className="h-2 w-2 rounded-full bg-red-500"></span><span className="text-muted">Block</span></span>
                </div>
              </div>
            </div>

            {/* Hovered Bucket Detail Tooltip Strip */}
            <div className="h-5 flex items-center justify-between text-[10px] font-mono text-muted px-1 mt-1">
              {hoveredBucket ? (
                <span>
                  <strong className="text-white">{hoveredBucket.display_time}</strong>: {hoveredBucket.total} total · <span className="text-emerald-400">{hoveredBucket.allow} Allow</span> · <span className="text-amber-400">{hoveredBucket.review} Review</span> · <span className="text-red-400">{hoveredBucket.block} Block</span> {hoveredBucket.is_peak && <span className="text-cyan-300 font-bold">(PEAK)</span>}
                </span>
              ) : (
                <span>Hover over an hourly bucket for exact counts. (Timezone: Local / UTC)</span>
              )}
            </div>

            {/* Chart Area with Simple Y-Axis Scale */}
            <div className="flex space-x-2 pt-1">
              <div className="flex flex-col justify-between text-[9px] font-mono text-muted-dark pb-6 select-none shrink-0 w-6 text-right">
                <span>{maxBucketTotal}</span>
                <span>{Math.round(maxBucketTotal / 2)}</span>
                <span>0</span>
              </div>

              <div className="flex-1 h-44 flex items-end space-x-1 border-b border-border/60 pb-1">
                {(analytics?.volume_over_time || []).map((bucket: any, idx: number) => {
                  let heightPct: number;
                  if (logScale) {
                    const logVal = Math.log10(1 + bucket.total);
                    const logMax = Math.log10(1 + maxBucketTotal);
                    heightPct = logMax > 0 ? Math.min(100, Math.max(8, Math.round((logVal / logMax) * 100))) : 8;
                  } else {
                    heightPct = Math.min(100, Math.max(6, Math.round((bucket.total / maxBucketTotal) * 100)));
                  }

                  const allowPct = bucket.total > 0 ? (bucket.allow / bucket.total) * 100 : 0;
                  const reviewPct = bucket.total > 0 ? (bucket.review / bucket.total) * 100 : 0;
                  const blockPct = bucket.total > 0 ? (bucket.block / bucket.total) * 100 : 0;

                  return (
                    <div 
                      key={idx} 
                      className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
                      onMouseEnter={() => setHoveredBucket(bucket)}
                      onMouseLeave={() => setHoveredBucket(null)}
                    >
                      {bucket.is_peak && (
                        <div className="absolute -top-3 text-[8px] font-mono font-bold text-cyan-300 tracking-tighter">
                          ▲
                        </div>
                      )}
                      <div
                        className={`w-full rounded-t flex flex-col-reverse overflow-hidden transition-all duration-200 ${
                          bucket.is_peak ? "ring-1 ring-cyan-400" : ""
                        }`}
                        style={{ height: `${heightPct}%` }}
                      >
                        <div style={{ height: `${allowPct}%` }} className="bg-emerald-500/80 group-hover:bg-emerald-400 transition" />
                        <div style={{ height: `${reviewPct}%` }} className="bg-amber-400/80 group-hover:bg-amber-300 transition" />
                        <div style={{ height: `${blockPct}%` }} className="bg-red-500/90 group-hover:bg-red-400 transition" />
                      </div>
                      <span className={`text-[8px] font-mono mt-1 truncate max-w-[28px] ${
                        bucket.display_time.includes("·") ? "font-bold text-cyan-300" : "text-muted-dark"
                      }`}>
                        {bucket.display_time}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Dynamic Caption without hardcoded text */}
          <div 
            className="pt-2 border-t border-border/40 text-[11px] text-slate-400 italic"
            aria-label={captions.volume_over_time || "Volume timeline across 24 hourly buckets."}
          >
            {captions.volume_over_time || "24-hour activity pattern zero-filled timeline."}
          </div>
        </div>

        {/* 3. Top Triggered Rules */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-white">Top Triggered Risk Rules</span>
              <span className="text-[10px] text-muted font-mono">Matched against canonical events</span>
            </div>

            <div className="space-y-2 pt-2">
              {(analytics?.top_rules || []).slice(0, 5).map((rule: any) => (
                <div key={rule.rule_id} className="p-2.5 rounded-lg bg-surface-card border border-border/80 flex items-center justify-between hover:border-slate-600 transition">
                  <div className="min-w-0 pr-2">
                    <div className="font-semibold text-slate-200 text-xs truncate">{rule.label}</div>
                    <div className="text-[10px] text-muted truncate">{rule.reason}</div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <div className="text-right">
                      <div className="font-mono text-white font-bold">{rule.count}</div>
                      <div className="text-[10px] text-muted font-mono">{rule.percentage}% of events</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono ${
                      rule.severity === "CRITICAL" 
                        ? "bg-red-950 text-red-300 border border-red-800" 
                        : "bg-amber-950 text-amber-300 border border-amber-800"
                    }`}>
                      {rule.severity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div 
            className="pt-2 border-t border-border/40 text-[11px] text-slate-400 italic"
            aria-label={captions.top_rules || "Security rules triggered across the evaluation dataset."}
          >
            {captions.top_rules || "Top security heuristics driving risk evaluations."}
          </div>
        </div>

        {/* 4. Geographic Activity (Segmented Control: Volume | Blocked | Block Rate) */}
        <div className="p-4 rounded-xl bg-surface border border-border space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center">
              <span className="font-semibold text-white">Geographic Activity</span>
              
              {/* Segmented Toggle */}
              <div className="flex items-center bg-surface-elevated border border-border rounded-lg p-0.5">
                <button
                  onClick={() => setGeoMetric("count")}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                    geoMetric === "count" ? "bg-surface-hover text-white font-bold shadow-sm" : "text-muted hover:text-white"
                  }`}
                >
                  Volume
                </button>
                <button
                  onClick={() => setGeoMetric("blocked")}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                    geoMetric === "blocked" ? "bg-surface-hover text-white font-bold shadow-sm" : "text-muted hover:text-white"
                  }`}
                >
                  Blocked
                </button>
                <button
                  onClick={() => setGeoMetric("block_rate_pct")}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition ${
                    geoMetric === "block_rate_pct" ? "bg-surface-hover text-white font-bold shadow-sm" : "text-muted hover:text-white"
                  }`}
                >
                  Block Rate
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {sortedGeo.slice(0, 5).map((c: any) => (
                <div key={c.country} className="p-2.5 rounded-lg bg-surface-card border border-border/80 flex items-center justify-between hover:border-slate-600 transition">
                  <div className="flex items-center space-x-2.5">
                    <span className="h-6 w-6 rounded-md bg-surface-elevated border border-border flex items-center justify-center font-mono font-bold text-xs text-white">
                      {c.country}
                    </span>
                    <div>
                      <span className="font-semibold text-white text-xs">{c.country}</span>
                      <span className="text-[10px] text-muted block font-mono">{c.percentage}% of total stream</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-white font-bold">
                      {geoMetric === "count" && `${c.count} txns`}
                      {geoMetric === "blocked" && `${c.blocked} blocked`}
                      {geoMetric === "block_rate_pct" && `${c.block_rate_pct}%`}
                    </div>
                    <div className="text-[10px] text-muted font-mono">
                      {geoMetric === "count" ? `${c.block_rate_pct}% blocked` : `${c.count} total txns`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div 
            className="pt-2 border-t border-border/40 text-[11px] text-slate-400 italic"
            aria-label={captions.geographic_activity || "Geographic activity distribution across regional origination endpoints."}
          >
            {captions.geographic_activity || "Origination geographic distribution."}
          </div>
        </div>
      </div>
    </div>
  );
};
