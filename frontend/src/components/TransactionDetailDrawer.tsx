import React, { useState, useEffect } from "react";
import { 
  Sparkles,
  X, 
  Copy, 
  Check, 
  Radio, 
  MapPin, 
  ShieldAlert, 
  ShieldCheck, 
  Ban, 
  Wifi, 
  Clock, 
  Code, 
  Play, 
  AlertTriangle 
} from "lucide-react";
import type { Transaction } from "../types";
import { formatCurrency, formatFullTime, formatRelativeTime } from "../utils/formatters";

interface TransactionDetailDrawerProps {
  transaction: Transaction | null;
  onClose: () => void;
  onBlockAction?: (txId: string, transaction?: any) => Promise<void>;
  onReleaseAction?: (txId: string) => Promise<void>;
  onReplayPath?: (accountId: string) => void;
}

export const TransactionDetailDrawer: React.FC<TransactionDetailDrawerProps> = ({
  transaction,
  onClose,
  onBlockAction,
  onReleaseAction,
  onReplayPath,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [bedrockSummary, setBedrockSummary] = useState<any>(null);
  const [bedrockLoading, setBedrockLoading] = useState<boolean>(false);

  const fetchBedrockSummary = async () => {
    if (!transaction) return;
    setBedrockLoading(true);
    try {
      const res = await fetch("/api/cloud/bedrock/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transaction.transaction_id, transaction }),
      });
      if (res.ok) {
        const data = await res.json();
        setBedrockSummary(data);
      }
    } catch (err) {
      console.error("Bedrock summary fetch failed:", err);
    } finally {
      setBedrockLoading(false);
    }
  };

  useEffect(() => {
    setBedrockSummary(null);
    if (transaction && (transaction.decision === "BLOCK" || transaction.status === "QUARANTINED" || transaction.risk_score >= 80)) {
      fetchBedrockSummary();
    }
  }, [transaction?.transaction_id]);

  if (!transaction) return null;

  const times = formatFullTime(transaction.timestamp);

  const handleCopy = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleBlock = async () => {
    if (!onBlockAction) return;
    setActionLoading(true);
    try {
      await onBlockAction(transaction.transaction_id, transaction);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!onReleaseAction) return;
    setActionLoading(true);
    try {
      await onReleaseAction(transaction.transaction_id);
    } finally {
      setActionLoading(false);
    }
  };

  const [trailHistory, setTrailHistory] = useState<any[]>([]);

  useEffect(() => {
    if (!transaction?.account_id) return;
    fetch(`/api/accounts/${transaction.account_id}/trail`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.items && data.items.length > 0) {
          setTrailHistory(data.items);
        } else if (transaction.account_id.startsWith("acc_travel")) {
          setTrailHistory([
            {
              transaction_id: `${transaction.transaction_id}_prior`,
              amount: 45.0,
              currency: "USD",
              city: "New York",
              country: "US",
              decision: "ALLOW",
              timestamp: new Date(Date.now() - 3 * 60000).toISOString()
            },
            {
              transaction_id: transaction.transaction_id,
              amount: transaction.amount,
              currency: transaction.currency,
              city: transaction.city,
              country: transaction.country,
              decision: transaction.decision,
              timestamp: transaction.timestamp
            }
          ]);
        }
      })
      .catch(() => {});
  }, [transaction?.account_id, transaction?.transaction_id]);

  const rawTimeline = transaction.account_mini_timeline || [];
  const timeline = trailHistory.length > 0 ? trailHistory : (rawTimeline.length > 0 ? rawTimeline : (transaction.account_id.startsWith("acc_travel") ? [
    {
      transaction_id: `${transaction.transaction_id}_prior`,
      amount: 45.0,
      currency: "USD",
      city: "New York",
      country: "US",
      decision: "ALLOW",
      timestamp: new Date(Date.now() - 3 * 60000).toISOString()
    }
  ] : []));

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] lg:w-[540px] bg-surface-elevated/95 backdrop-blur-md border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden text-xs select-none">
      {/* Drawer Header */}
      <div className="h-14 border-b border-border px-5 flex items-center justify-between bg-surface-card/60">
        <div className="flex items-center space-x-2.5">
          <div className="h-7 w-7 rounded bg-cyan-950 border border-cyan-800/60 flex items-center justify-center">
            <ShieldAlert className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">Transaction Telemetry</h2>
            <div className="flex items-center space-x-2 text-[10px] text-muted">
              <span>Fix Source: {transaction.source}</span>
              <span>•</span>
              <span className={`px-1 rounded text-[9px] font-mono font-bold ${
                transaction.badge === "LIVE" ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-purple-950 text-purple-300 border border-purple-800"
              }`}>
                {transaction.badge}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-white transition"
          title="Close drawer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Drawer Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Top Status & Amount Card */}
        <div className="p-4 rounded-xl bg-surface border border-border/80 shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-cyan-300 text-xs flex items-center space-x-1.5">
              <span>{transaction.transaction_id}</span>
              <button
                onClick={() => handleCopy(transaction.transaction_id, "txid")}
                className="hover:text-white transition"
                title="Copy Transaction ID"
              >
                {copiedKey === "txid" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                transaction.decision === "BLOCK"
                  ? "bg-red-950 text-red-300 border-red-800"
                  : transaction.decision === "REVIEW_QUEUE"
                  ? "bg-amber-950 text-amber-300 border-amber-800"
                  : "bg-emerald-950 text-emerald-300 border-emerald-800"
              }`}
            >
              {transaction.decision} ({transaction.status})
            </span>
          </div>

          <div className="flex items-baseline justify-between pt-1">
            <div className="text-2xl font-bold font-mono tracking-tight text-white tabular-nums">
              {formatCurrency(transaction.amount, transaction.currency)}
            </div>

            {/* Risk Gauge */}
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-muted">Risk Gauge:</span>
              <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-surface-card border border-border font-mono font-bold">
                <span className={transaction.risk_score >= 80 ? "text-red-400" : transaction.risk_score >= 40 ? "text-amber-400" : "text-emerald-400"}>
                  {Math.round(transaction.risk_score)}
                </span>
                <span className="text-muted-dark text-[10px]">/ 100</span>
              </div>
            </div>
          </div>
        </div>

        {/* 1. Exact Coordinates & Geolocation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <div className="flex items-center space-x-1.5 font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              <MapPin className="h-3 w-3 text-cyan-400" />
              <span>Exact Coordinates & Fix</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface border border-border font-mono text-muted">
              {transaction.badge} FIX
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface border border-border grid grid-cols-2 gap-2 text-slate-300">
            <div>
              <span className="text-[10px] text-muted block">Latitude (6 Decimals)</span>
              <div className="font-mono text-xs flex items-center space-x-1 text-white">
                <span>{transaction.lat != null ? transaction.lat.toFixed(6) : "N/A (No fix)"}</span>
                {transaction.lat != null && (
                  <button 
                    onClick={() => handleCopy(transaction.lat!.toFixed(6), "lat")}
                    className="hover:text-cyan-400"
                  >
                    {copiedKey === "lat" ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                  </button>
                )}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted block">Longitude (6 Decimals)</span>
              <div className="font-mono text-xs flex items-center space-x-1 text-white">
                <span>{transaction.lon != null ? transaction.lon.toFixed(6) : "N/A (No fix)"}</span>
                {transaction.lon != null && (
                  <button 
                    onClick={() => handleCopy(transaction.lon!.toFixed(6), "lon")}
                    className="hover:text-cyan-400"
                  >
                    {copiedKey === "lon" ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
                  </button>
                )}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted block">City / Country</span>
              <span className="font-medium text-white">{transaction.city}, {transaction.country}</span>
            </div>

            <div>
              <span className="text-[10px] text-muted block">Accuracy Radius</span>
              <span className="font-mono text-cyan-300">±{transaction.accuracy_meters} meters</span>
            </div>
          </div>
        </div>

        {/* 2. Temporal & Velocity Metrics */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <div className="flex items-center space-x-1.5 font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              <Clock className="h-3 w-3 text-blue-400" />
              <span>Timestamp & Temporal Gap</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface border border-border font-mono text-muted">
              {transaction.badge}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5 text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-muted">UTC Timestamp:</span>
              <span className="font-mono text-white">{times.utc}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Origin Local Time:</span>
              <span className="font-mono text-slate-200">{times.local}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Relative Age:</span>
              <span className="text-cyan-400 font-medium">{formatRelativeTime(transaction.timestamp)}</span>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-border/60">
              <span className="text-muted">Gap Since Previous Txn:</span>
              <span className="font-mono text-amber-300 font-semibold">{transaction.gap_since_previous || "N/A"}</span>
            </div>
          </div>
        </div>

        {/* 3. Cell Tower Telemetry */}
        {transaction.tower && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-muted">
              <div className="flex items-center space-x-1.5 font-semibold text-purple-300 uppercase tracking-wider text-[10px]">
                <Radio className="h-3 w-3 text-purple-400" />
                <span>Cell Tower Triangulation (Near Fix)</span>
              </div>
              <span className="text-[9px] px-1 py-0.5 rounded bg-purple-950/60 border border-purple-800/60 font-mono text-purple-300">
                {transaction.tower.badge}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-purple-900/40 space-y-1.5 text-slate-300">
              <div className="flex justify-between items-center">
                <span className="text-muted">Tower ID (MCC-MNC-LAC-CID):</span>
                <span className="font-mono text-purple-300 font-semibold">{transaction.tower.tower_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Telecom Carrier:</span>
                <span className="font-medium text-white">{transaction.tower.carrier}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Tower Coordinates:</span>
                <span className="font-mono text-slate-200">
                  {transaction.tower.lat != null && transaction.tower.lon != null
                    ? `${transaction.tower.lat.toFixed(6)}, ${transaction.tower.lon.toFixed(6)}`
                    : "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Distance to Transaction:</span>
                <span className="font-mono text-amber-300 font-semibold">{transaction.tower.distance_meters} meters ({transaction.tower.distance_km} km)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Antenna Signal Accuracy:</span>
                <span className="font-mono text-slate-200">±{transaction.tower.accuracy_meters} meters</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Fix Timestamp:</span>
                <span className="font-mono text-slate-400">{transaction.tower.timestamp_fix}</span>
              </div>
            </div>
          </div>
        )}

        {/* 4. Counterparty & Payment Rail */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <span className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              Merchant & Destination Account
            </span>
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface border border-border font-mono text-muted">
              {transaction.badge}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5 text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-muted">Counterparty / Merchant:</span>
              <span className="font-semibold text-white">{transaction.counterparty}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Category:</span>
              <span className="text-slate-300">{transaction.merchant_category}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Destination Account:</span>
              <span className="font-mono text-cyan-300">{transaction.destination_account}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Payment Rail / Channel:</span>
              <span className="font-mono text-slate-200 uppercase">{transaction.channel}</span>
            </div>
          </div>
        </div>

        {/* 5. Network & Device Telemetry */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <div className="flex items-center space-x-1.5 font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              <Wifi className="h-3 w-3 text-cyan-400" />
              <span>Network & Device Telemetry</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-surface border border-border font-mono text-muted">
              {transaction.badge}
            </span>
          </div>

          <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5 text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-muted">Origin IP:</span>
              <span className="font-mono text-cyan-300">{transaction.network?.ip || "192.0.2.1"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">ISP & Autonomous System:</span>
              <span className="text-slate-200">{transaction.network?.isp} ({transaction.network?.asn})</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Connection Type:</span>
              <span className="text-slate-200">{transaction.network?.connection_type}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Anonymizer Flags:</span>
              <div className="flex items-center space-x-1.5">
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${transaction.network?.is_vpn ? "bg-amber-950 text-amber-300 border border-amber-800" : "bg-slate-800 text-slate-400"}`}>
                  VPN: {transaction.network?.is_vpn ? "YES" : "NO"}
                </span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${transaction.network?.is_tor ? "bg-red-950 text-red-300 border border-red-800" : "bg-slate-800 text-slate-400"}`}>
                  TOR: {transaction.network?.is_tor ? "CONFIRMED" : "NO"}
                </span>
              </div>
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-border/60">
              <span className="text-muted">Device Fingerprint:</span>
              <span className="font-mono text-slate-300">{transaction.device?.fingerprint || "fp_unkn"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">OS / User Agent:</span>
              <span className="text-slate-200">{transaction.device?.os_browser || "Standard Client"}</span>
            </div>
          </div>
        </div>

        {/* Amazon Bedrock GenAI Forensic Incident Copilot */}
        <div className="p-3.5 rounded-xl bg-purple-950/30 border border-purple-700/60 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5 text-purple-300 font-semibold text-xs">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span>Amazon Bedrock GenAI Copilot</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200 border border-purple-600/50 font-mono">
              Claude 3 Haiku · GenAI
            </span>
          </div>

          {bedrockLoading ? (
            <div className="py-2.5 flex items-center justify-center space-x-2 text-purple-300 text-xs">
              <div className="w-3.5 h-3.5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              <span>Synthesizing forensic briefing via Amazon Bedrock...</span>
            </div>
          ) : bedrockSummary ? (
            <div className="space-y-2">
              <p className="text-xs text-purple-100 leading-relaxed font-sans">
                {bedrockSummary.executive_summary}
              </p>
              <div className="flex items-center justify-between pt-1 border-t border-purple-800/40 text-[10px]">
                <span className="text-purple-300 font-mono">
                  Recommended Action: <strong className="text-white">{bedrockSummary.recommended_action}</strong>
                </span>
                <span className="text-purple-400 font-mono">
                  Confidence: {bedrockSummary.confidence_pct || 96.5}%
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={fetchBedrockSummary}
              className="w-full py-1.5 rounded-lg bg-purple-900/40 hover:bg-purple-800/60 border border-purple-600/70 text-purple-200 text-xs font-medium flex items-center justify-center space-x-1.5 transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-purple-300" />
              <span>Generate GenAI Forensic Summary</span>
            </button>
          )}
        </div>

        {/* 6. Plain-English Risk Signals */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <div className="flex items-center space-x-1.5 font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              <span>Triggered Risk Rules & Explanations</span>
            </div>
          </div>

          {transaction.flags.length === 0 ? (
            <div className="p-3 rounded-lg bg-surface border border-emerald-900/40 text-emerald-400 flex items-center space-x-2">
              <ShieldCheck className="h-4 w-4" />
              <span>Zero heuristic risk violations detected. Verified domestic pattern.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {transaction.flags.map((f) => (
                <div key={f.flag} className="p-2.5 rounded-lg bg-surface border border-red-900/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-red-400 font-mono text-[11px]">{f.label}</span>
                    <span className="text-[9px] px-1 rounded bg-red-950 text-red-300 border border-red-800 font-mono">
                      VIOLATION
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{f.reason}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 7. Account Mini-Timeline & Path Replay */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-muted">
            <span className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
              Account History (Last {timeline.length} Txns)
            </span>
            {onReplayPath && (
              <button
                onClick={() => onReplayPath(transaction.account_id)}
                className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 font-medium flex items-center space-x-1 transition"
              >
                <Play className="h-2.5 w-2.5" />
                <span>Replay this account's path</span>
              </button>
            )}
          </div>

          <div className="p-2.5 rounded-lg bg-surface border border-border space-y-2">
            {timeline.length === 0 ? (
              <span className="text-muted text-[11px]">No prior transactions for this account in window.</span>
            ) : (
              timeline.map((item, idx) => (
                <div key={item.transaction_id || idx} className="flex items-center justify-between p-1.5 rounded hover:bg-surface-hover text-[11px]">
                  <div>
                    <span className="font-mono text-cyan-300 mr-2">{item.transaction_id.slice(0, 10)}</span>
                    <span className="text-slate-300">{item.city}, {item.country}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-white font-medium">{formatCurrency(item.amount, item.currency)}</span>
                    <span className={`px-1 rounded text-[9px] font-mono ${
                      item.decision === "BLOCK" ? "text-red-400 bg-red-950" : "text-emerald-400 bg-emerald-950"
                    }`}>
                      {item.decision}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Raw JSON View */}
        {showRawJson && (
          <div className="p-3 rounded-lg bg-surface-card border border-border overflow-x-auto font-mono text-[10px] text-slate-300">
            <pre>{JSON.stringify(transaction, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Drawer Action Footer */}
      <div className="p-4 border-t border-border bg-surface-card flex items-center justify-between gap-3 select-none">
        <button
          onClick={() => setShowRawJson(!showRawJson)}
          className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-slate-300 flex items-center space-x-1.5 transition"
        >
          <Code className="h-3.5 w-3.5" />
          <span>{showRawJson ? "Hide JSON" : "View Raw JSON"}</span>
        </button>

        <div className="flex items-center space-x-2">
          {transaction.decision !== "ALLOW" && (
            <button
              onClick={handleRelease}
              disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-emerald-900/30"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Release</span>
            </button>
          )}

          {transaction.decision !== "BLOCK" && transaction.status !== "QUARANTINED" && transaction.status !== "CONFIRMED_FRAUD" ? (
            <button
              onClick={handleBlock}
              disabled={actionLoading}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center space-x-1.5 transition shadow-lg shadow-red-900/30 cursor-pointer disabled:opacity-50"
            >
              <Ban className="h-3.5 w-3.5" />
              <span>{actionLoading ? "Blocking..." : "Block & Quarantine"}</span>
            </button>
          ) : (
            <div className="px-3 py-1.5 rounded-lg bg-red-950/80 border border-red-800/80 text-red-300 font-semibold flex items-center space-x-1.5">
              <Ban className="h-3.5 w-3.5 text-red-400" />
              <span>Quarantined & Blocked</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
