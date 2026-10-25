import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Copy, 
  Check, 
  Smartphone, 
  Globe, 
  CreditCard, 
  ArrowRightLeft, 
  SlidersHorizontal, 
  Download, 
  ChevronDown,
  Shield,
  ArrowUp
} from "lucide-react";
import type { Transaction } from "../types";
import { 
  formatCurrency, 
  formatShortId, 
  formatRelativeTime, 
  formatFullTime, 
  getCountryFlag, 
  getHumanSignalLabel 
} from "../utils/formatters";

interface LiveIngestionTableProps {
  transactions: Transaction[];
  onSelectTransaction: (tx: Transaction) => void;
  selectedTxId: string | null;
  newEventsCount: number;
  onClearNewEventsCount: () => void;
  activeFilter: { key: string; val: string } | null;
  onFilterChange: (filter: { key: string; val: string } | null) => void;
}

export const LiveIngestionTable: React.FC<LiveIngestionTableProps> = ({
  transactions,
  onSelectTransaction,
  selectedTxId,
  newEventsCount,
  onClearNewEventsCount,
  activeFilter,
  onFilterChange,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [activeOverflowId, setActiveOverflowId] = useState<string | null>(null);
  const [showColumnChooser, setShowColumnChooser] = useState(false);
  
  const [visibleColumns, setVisibleColumns] = useState({
    time: true,
    txId: true,
    account: true,
    amount: true,
    channel: true,
    origin: true,
    risk: true,
    decision: true,
    signals: true,
  });

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Copy helper with feedback
  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filtered dataset
  const filteredData = useMemo(() => {
    if (!activeFilter || activeFilter.key === "all") return transactions;
    if (activeFilter.key === "decision") {
      return transactions.filter(t => t.decision.toUpperCase() === activeFilter.val.toUpperCase());
    }
    if (activeFilter.key === "status") {
      return transactions.filter(t => t.status.toUpperCase() === activeFilter.val.toUpperCase());
    }
    if (activeFilter.key === "sla") {
      return transactions.filter(t => (t as any).is_sla_breached === true || t.decision === "BLOCK");
    }
    if (activeFilter.key === "high_value") {
      return transactions.filter(t => t.amount >= 500);
    }
    return transactions;
  }, [transactions, activeFilter]);

  // Keyboard navigation (j/k to move, Enter to open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if inside an input
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(filteredData.length - 1, prev + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === "Enter") {
        if (filteredData[selectedIndex]) {
          onSelectTransaction(filteredData[selectedIndex]);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredData, selectedIndex, onSelectTransaction]);

  // CSV Export
  const handleExportCSV = () => {
    const headers = ["Timestamp", "Transaction ID", "Account ID", "Amount", "Currency", "Channel", "Country", "City", "Risk Score", "Decision", "Signals"];
    const rows = filteredData.map(t => [
      t.timestamp,
      t.transaction_id,
      t.account_id,
      t.amount,
      t.currency,
      t.channel,
      t.country,
      t.city,
      t.risk_score,
      t.decision,
      t.flags.map(f => f.flag).join("; ")
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `fraudguard_events_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const scrollToTop = () => {
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
    onClearNewEventsCount();
  };

  const getChannelIcon = (channel: string) => {
    switch (channel.toUpperCase()) {
      case "MOBILE_APP":
        return <Smartphone className="h-3.5 w-3.5 text-cyan-400" />;
      case "ONLINE_WEB":
        return <Globe className="h-3.5 w-3.5 text-blue-400" />;
      case "POS":
        return <CreditCard className="h-3.5 w-3.5 text-emerald-400" />;
      default:
        return <ArrowRightLeft className="h-3.5 w-3.5 text-purple-400" />;
    }
  };

  const getRiskScoreColor = (score: number, decision: string) => {
    if (decision === "BLOCK" || score >= 80) return "text-red-400 bg-red-950/60 border-red-800/60";
    if (decision === "REVIEW_QUEUE" || score >= 40) return "text-amber-400 bg-amber-950/60 border-amber-800/60";
    return "text-emerald-400 bg-emerald-950/60 border-emerald-800/60";
  };

  const rowHeightClass = density === "comfortable" ? "h-12" : "h-10";

  return (
    <div className="bg-surface rounded-xl border border-border flex flex-col flex-1 overflow-hidden shadow-2xl relative">
      {/* Table Toolbar */}
      <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs bg-surface-card/60">
        {/* Saved Filter Views */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
          <span className="text-muted-dark font-mono text-[11px] uppercase tracking-wider mr-1">Views:</span>
          
          <button
            onClick={() => onFilterChange(null)}
            className={`px-2.5 py-1 rounded text-xs transition ${
              !activeFilter
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-medium"
                : "text-muted hover:text-white hover:bg-surface-elevated"
            }`}
          >
            All Stream ({transactions.length})
          </button>

          <button
            onClick={() => onFilterChange({ key: "decision", val: "BLOCK" })}
            className={`px-2.5 py-1 rounded text-xs transition ${
              activeFilter?.val === "BLOCK"
                ? "bg-red-500/20 text-red-400 border border-red-500/40 font-medium"
                : "text-muted hover:text-white hover:bg-surface-elevated"
            }`}
          >
            Blocked Only
          </button>

          <button
            onClick={() => onFilterChange({ key: "status", val: "QUARANTINED" })}
            className={`px-2.5 py-1 rounded text-xs transition ${
              activeFilter?.val === "QUARANTINED"
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/40 font-medium"
                : "text-muted hover:text-white hover:bg-surface-elevated"
            }`}
          >
            Quarantine Backlog
          </button>

          <button
            onClick={() => onFilterChange({ key: "high_value", val: "500" })}
            className={`px-2.5 py-1 rounded text-xs transition ${
              activeFilter?.key === "high_value"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 font-medium"
                : "text-muted hover:text-white hover:bg-surface-elevated"
            }`}
          >
            High Value (&gt;$500)
          </button>
        </div>

        {/* Right Actions: Density, Columns & CSV */}
        <div className="flex items-center space-x-2">
          {/* Density Toggle */}
          <div className="flex items-center bg-surface-elevated border border-border rounded-md p-0.5">
            <button
              onClick={() => setDensity("compact")}
              className={`px-2 py-0.5 rounded text-[11px] transition ${
                density === "compact" ? "bg-surface-hover text-white shadow-sm" : "text-muted hover:text-slate-200"
              }`}
            >
              Compact
            </button>
            <button
              onClick={() => setDensity("comfortable")}
              className={`px-2 py-0.5 rounded text-[11px] transition ${
                density === "comfortable" ? "bg-surface-hover text-white shadow-sm" : "text-muted hover:text-slate-200"
              }`}
            >
              Comfortable
            </button>
          </div>

          {/* Column Chooser */}
          <div className="relative">
            <button
              onClick={() => setShowColumnChooser(!showColumnChooser)}
              className="px-2.5 py-1 rounded-md bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white flex items-center space-x-1.5 transition"
            >
              <SlidersHorizontal className="h-3 w-3" />
              <span>Columns</span>
              <ChevronDown className="h-3 w-3" />
            </button>

            {showColumnChooser && (
              <div className="absolute right-0 mt-1.5 w-48 rounded-lg bg-surface-elevated border border-border shadow-xl p-2.5 z-50 text-xs space-y-1.5">
                <span className="text-[10px] uppercase font-bold text-muted-dark block mb-1">Display Columns</span>
                {Object.entries(visibleColumns).map(([key, val]) => (
                  <label key={key} className="flex items-center space-x-2 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                      className="rounded accent-cyan-400"
                    />
                    <span className="capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* CSV Export */}
          <button
            onClick={handleExportCSV}
            className="px-2.5 py-1 rounded-md bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white flex items-center space-x-1.5 transition"
          >
            <Download className="h-3 w-3" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Floating "New Events" Pill */}
      {newEventsCount > 0 && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 animate-bounce">
          <button
            onClick={scrollToTop}
            className="px-3.5 py-1.5 rounded-full bg-cyan-500 text-slate-950 font-semibold text-xs shadow-lg shadow-cyan-500/40 flex items-center space-x-1.5 border border-cyan-300"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            <span>{newEventsCount} new events received</span>
          </button>
        </div>
      )}

      {/* Virtualized/Scrollable Table Body with Sticky Header */}
      <div 
        ref={tableContainerRef} 
        className="flex-1 overflow-auto divide-y divide-border/60 relative focus:outline-none"
        tabIndex={0}
      >
        <table className="w-full text-left border-collapse table-fixed">
          {/* Sticky Table Header */}
          <thead className="sticky top-0 z-20 bg-surface-card border-b border-border shadow-md">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-dark h-9 select-none">
              <th className="w-1.5 p-0"></th>
              {visibleColumns.time && <th className="w-28 px-3.5">Time</th>}
              {visibleColumns.txId && <th className="w-36 px-3.5">Transaction</th>}
              {visibleColumns.account && <th className="w-32 px-3.5">Account</th>}
              {visibleColumns.amount && <th className="w-28 px-3.5 text-right">Amount</th>}
              {visibleColumns.channel && <th className="w-32 px-3.5 hidden xl:table-cell">Channel</th>}
              {visibleColumns.origin && <th className="w-36 px-3.5">Origin</th>}
              {visibleColumns.risk && <th className="w-28 px-3.5">Risk Score</th>}
              {visibleColumns.decision && <th className="w-28 px-3.5">Decision</th>}
              {visibleColumns.signals && <th className="px-3.5">Triggered Signals</th>}
            </tr>
          </thead>

          {/* Table Rows */}
          <tbody className="divide-y divide-border/40 text-xs">
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-muted">
                  <Shield className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                  <p className="font-medium text-slate-300">No transactions match current view.</p>
                  <p className="text-[11px] text-muted-dark mt-1">Try clearing filters or triggering simulator events.</p>
                </td>
              </tr>
            ) : (
              filteredData.map((tx, idx) => {
                const isSelected = selectedTxId === tx.transaction_id || selectedIndex === idx;
                const isBlock = tx.decision === "BLOCK" || tx.status === "QUARANTINED";
                const times = formatFullTime(tx.timestamp);

                return (
                  <tr
                    key={tx.transaction_id || idx}
                    onClick={() => {
                      setSelectedIndex(idx);
                      onSelectTransaction(tx);
                    }}
                    className={`${rowHeightClass} transition-colors cursor-pointer group select-none ${
                      isSelected 
                        ? "bg-cyan-950/30" 
                        : "hover:bg-surface-hover/70"
                    }`}
                  >
                    {/* Left BLOCK color stripe */}
                    <td className={`p-0 w-1.5 ${isBlock ? "bg-red-500" : isSelected ? "bg-cyan-500" : "bg-transparent"}`} />

                    {/* 1. Time */}
                    {visibleColumns.time && (
                      <td className="px-3.5 whitespace-nowrap text-muted group-hover:text-slate-200">
                        <span 
                          title={`UTC: ${times.utc}\nLocal: ${times.local}`}
                          className="font-mono text-[11px] underline decoration-dotted decoration-border/80 cursor-help"
                        >
                          {formatRelativeTime(tx.timestamp)}
                        </span>
                      </td>
                    )}

                    {/* 2. Transaction ID + Copy */}
                    {visibleColumns.txId && (
                      <td className="px-3.5 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5 font-mono text-[11px] text-cyan-300">
                          <span>{formatShortId(tx.transaction_id)}</span>
                          <button
                            onClick={(e) => handleCopy(e, tx.transaction_id)}
                            className="p-1 rounded hover:bg-surface-elevated text-muted-dark hover:text-cyan-400 transition"
                            title="Copy full transaction ID"
                          >
                            {copiedId === tx.transaction_id ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>
                    )}

                    {/* 3. Account */}
                    {visibleColumns.account && (
                      <td className="px-3.5 whitespace-nowrap font-mono text-[11px] text-slate-300 truncate max-w-[120px]">
                        {tx.account_id}
                      </td>
                    )}

                    {/* 4. Amount */}
                    {visibleColumns.amount && (
                      <td className="px-3.5 whitespace-nowrap text-right font-mono font-medium text-white tabular-nums">
                        {formatCurrency(tx.amount, tx.currency)}
                      </td>
                    )}

                    {/* 5. Channel */}
                    {visibleColumns.channel && (
                      <td className="px-3.5 whitespace-nowrap hidden xl:table-cell">
                        <div className="flex items-center space-x-1.5 text-muted">
                          {getChannelIcon(tx.channel)}
                          <span className="capitalize">{tx.channel.replace(/_/g, " ").toLowerCase()}</span>
                        </div>
                      </td>
                    )}

                    {/* 6. Origin */}
                    {visibleColumns.origin && (
                      <td className="px-3.5 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5 text-slate-200">
                          <span className="text-sm leading-none">{getCountryFlag(tx.country)}</span>
                          <span className="truncate max-w-[100px]">{tx.city}</span>
                        </div>
                      </td>
                    )}

                    {/* 7. Risk Score */}
                    {visibleColumns.risk && (
                      <td className="px-3.5 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="w-12 h-1.5 bg-surface-card rounded-full overflow-hidden border border-border/50">
                            <div
                              className={`h-full rounded-full ${
                                tx.risk_score >= 80 ? "bg-red-500" : tx.risk_score >= 40 ? "bg-amber-400" : "bg-emerald-400"
                              }`}
                              style={{ width: `${Math.min(100, tx.risk_score)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] font-semibold text-slate-200 tabular-nums">
                            {Math.round(tx.risk_score)}
                          </span>
                        </div>
                      </td>
                    )}

                    {/* 8. Decision */}
                    {visibleColumns.decision && (
                      <td className="px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-wide border ${
                            getRiskScoreColor(tx.risk_score, tx.decision)
                          }`}
                        >
                          {tx.decision}
                        </span>
                      </td>
                    )}

                    {/* 9. Signals (Max 2 chips + overflow) */}
                    {visibleColumns.signals && (
                      <td className="px-3.5">
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          {tx.flags.length === 0 ? (
                            <span className="text-muted-dark text-[11px] italic">Clean baseline</span>
                          ) : (
                            <>
                              {tx.flags.slice(0, 2).map((f) => (
                                <span
                                  key={f.flag}
                                  title={f.reason}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap truncate max-w-[140px] border ${
                                    f.flag.includes("TRAVEL") || f.flag.includes("TOR")
                                      ? "bg-red-950/40 text-red-300 border-red-800/40"
                                      : "bg-slate-800 text-slate-300 border-border"
                                  }`}
                                >
                                  {getHumanSignalLabel(f.flag)}
                                </span>
                              ))}

                              {tx.flags.length > 2 && (
                                <div className="relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveOverflowId(activeOverflowId === tx.transaction_id ? null : tx.transaction_id);
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-elevated text-cyan-400 border border-cyan-800/60 hover:bg-surface-hover"
                                  >
                                    +{tx.flags.length - 2}
                                  </button>

                                  {activeOverflowId === tx.transaction_id && (
                                    <div 
                                      onClick={(e) => e.stopPropagation()}
                                      className="absolute left-0 bottom-full mb-1 w-64 rounded-lg bg-surface-card border border-border p-2 shadow-2xl z-50 text-xs space-y-1"
                                    >
                                      <p className="font-semibold text-slate-200 text-[11px] mb-1">Additional Risk Signals</p>
                                      {tx.flags.slice(2).map((f) => (
                                        <div key={f.flag} className="p-1 rounded bg-surface border border-border/60">
                                          <div className="font-medium text-amber-300 text-[10px]">{getHumanSignalLabel(f.flag)}</div>
                                          <div className="text-[9px] text-muted-dark leading-tight mt-0.5">{f.reason}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Status Bar */}
      <div className="h-8 border-t border-border bg-surface-card px-4 flex items-center justify-between text-[11px] text-muted select-none">
        <div className="flex items-center space-x-4">
          <span>Showing {filteredData.length} of {transactions.length} transactions</span>
          <span className="hidden sm:inline-block text-border">|</span>
          <span className="hidden sm:inline-block font-mono text-muted-dark">Use j/k to navigate, Enter to inspect</span>
        </div>
        <div className="flex items-center space-x-2 font-mono text-[10px]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          <span>Buffer: In-Memory Ring Store</span>
        </div>
      </div>
    </div>
  );
};
