import React, { useState, useEffect, useMemo, useRef } from "react";
import { 
  ShieldAlert, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  Ban, 
  TrendingUp, 
  Search, 
  SlidersHorizontal, 
  Download, 
  Copy, 
  Check, 
  MoreHorizontal, 
  User, 
  ArrowUp,
  MapPin,
  Wifi,
  FileText,
  AlertOctagon,
  History,
  X,
  Send,
  Eye,
  CheckCheck
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

interface QuarantinePageProps {
  onSelectTransaction: (tx: Transaction) => void;
  selectedTxId: string | null;
  userRole?: string;
}

export const QuarantinePage: React.FC<QuarantinePageProps> = ({
  onSelectTransaction,
  selectedTxId,
  userRole = "analyst",
}) => {
  const [activeTab, setActiveTab] = useState<string>("OPEN");
  const [items, setItems] = useState<any[]>([]);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({
    open: 0,
    at_risk: 0,
    breached: 0,
    escalated: 0,
    released: 0,
    confirmed_fraud: 0,
    all: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkModal, setShowBulkModal] = useState<string | null>(null); // "RELEASE" | "CONFIRM_FRAUD" | "ESCALATE" | "ASSIGN"
  const [bulkReason, setBulkReason] = useState<string>("Batch review resolution");
  const [bulkNote, setBulkNote] = useState<string>("");
  const [bulkAssignee, setBulkAssignee] = useState<string>("soc_lead_01");
  const [bulkActionLoading, setBulkActionLoading] = useState<boolean>(false);
  const [undoToast, setUndoToast] = useState<{ message: string; count: number } | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");

  // Case Drawer & Modals
  const [caseDrawerTx, setCaseDrawerTx] = useState<any | null>(null);
  const [drawerTab, setDrawerTab] = useState<"summary" | "rules" | "map" | "history" | "customer" | "network" | "notes" | "audit">("summary");
  const [noteInput, setNoteInput] = useState<string>("");
  const [showFourEyesModal, setShowFourEyesModal] = useState<any | null>(null);
  const [secondConfirmText, setSecondConfirmText] = useState<string>("");

  // Live countdown ticker (updates every 30s)
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch quarantine cases
  const fetchQuarantine = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quarantine?tab=${activeTab}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (data.counts) {
          setTabCounts(data.counts);
        }
      }
    } catch (err) {
      console.error("Failed to load quarantine cases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuarantine();
  }, [activeTab]);

  // Copy helper
  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filtered Items
  const filteredCases = useMemo(() => {
    return items.filter((item) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const tid = String(item.transaction_id || "").toLowerCase();
        const acc = String(item.account_id || "").toLowerCase();
        const ip = String(item.network?.ip || item.origin_ip || "").toLowerCase();
        if (!tid.includes(q) && !acc.includes(q) && !ip.includes(q)) return false;
      }
      if (riskFilter !== "ALL") {
        const score = parseFloat(item.risk_score || 0);
        if (riskFilter === "HIGH" && score < 80) return false;
        if (riskFilter === "MEDIUM" && (score < 40 || score >= 80)) return false;
        if (riskFilter === "LOW" && score >= 40) return false;
      }
      if (assigneeFilter !== "ALL" && item.assignee !== assigneeFilter) return false;
      return true;
    });
  }, [items, searchQuery, riskFilter, assigneeFilter]);

  // Selection toggle
  const toggleSelectAll = () => {
    if (selectedIds.length === filteredCases.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCases.map((c) => c.transaction_id));
    }
  };

  const toggleSelectOne = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    } else {
      setSelectedIds((prev) => [...prev, id]);
    }
  };

  // Action Execution (Single)
  const handleSingleAction = async (txId: string, action: string, secondConfirm: boolean = false) => {
    const targetItem = items.find((i) => i.transaction_id === txId);
    if (action === "RELEASE" && targetItem && parseFloat(targetItem.risk_score || 0) >= 80 && !secondConfirm) {
      setShowFourEyesModal(targetItem);
      return;
    }

    try {
      const res = await fetch(`/api/quarantine/${txId}/action`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-User-Role": userRole,
          "X-Analyst-ID": "analyst_current"
        },
        body: JSON.stringify({
          action,
          analyst_id: "analyst_current",
          reason: "Manual review queue resolution",
          notes: "Approved via SOC case queue",
          second_confirmation: secondConfirm,
        }),
      });

      if (res.ok) {
        setShowFourEyesModal(null);
        fetchQuarantine();
        if (caseDrawerTx && caseDrawerTx.transaction_id === txId) {
          setCaseDrawerTx((prev: any) => prev ? { ...prev, status: action === "RELEASE" ? "RELEASED" : action === "CONFIRM_FRAUD" ? "CONFIRMED_FRAUD" : "ESCALATED" } : null);
        }
      }
    } catch (err) {
      console.error("Action error:", err);
    }
  };

  // Bulk Action Execution
  const handleExecuteBulk = async () => {
    if (!showBulkModal || selectedIds.length === 0) return;
    setBulkActionLoading(true);

    try {
      const res = await fetch("/api/quarantine/bulk", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-User-Role": userRole,
          "X-Analyst-ID": "analyst_current"
        },
        body: JSON.stringify({
          action: showBulkModal,
          transaction_ids: selectedIds,
          analyst_id: "analyst_current",
          reason: bulkReason,
          notes: bulkNote,
        }),
      });

      const data = await res.json();
      if (res.status === 403) {
        alert(data.message || "Bulk release of high-risk cases requires admin privileges.");
        return;
      }

      if (res.ok) {
        setUndoToast({ message: `Successfully executed ${showBulkModal} on ${selectedIds.length} cases`, count: selectedIds.length });
        setTimeout(() => setUndoToast(null), 10000);
        setSelectedIds([]);
        setShowBulkModal(null);
        fetchQuarantine();
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Add Note to Case Drawer
  const handleAddNote = () => {
    if (!noteInput.trim() || !caseDrawerTx) return;
    const newNote = {
      author: "Analyst Current",
      text: noteInput.trim(),
      timestamp: new Date().toISOString(),
    };
    const updated = {
      ...caseDrawerTx,
      notes_thread: [...(caseDrawerTx.notes_thread || []), newNote],
    };
    setCaseDrawerTx(updated);
    setNoteInput("");
  };

  // SLA pill styling
  const getSlaPill = (status: string, countdown: string, isBreached: boolean) => {
    if (status === "RESOLVED") {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-800 text-slate-300 border border-slate-700">
          Resolved
        </span>
      );
    }
    if (isBreached || status === "BREACHED") {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-950/70 text-red-300 border border-red-800/70 flex items-center space-x-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse"></span>
          <span>{countdown}</span>
        </span>
      );
    }
    if (status === "AT_RISK") {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/70 text-amber-300 border border-amber-800/70 flex items-center space-x-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
          <span>{countdown}</span>
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/70 flex items-center space-x-1">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
        <span>{countdown}</span>
      </span>
    );
  };

  // CSV Export
  const handleExportCSV = () => {
    const headers = ["Case ID", "Account ID", "Amount", "Currency", "Risk Score", "SLA Status", "SLA Countdown", "Status", "Assignee", "Timestamp"];
    const rows = filteredCases.map((c) => [
      c.transaction_id,
      c.account_id,
      c.amount,
      c.currency,
      c.risk_score,
      c.sla_status,
      c.sla_countdown,
      c.status,
      c.assignee,
      c.timestamp
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `fraudguard_quarantine_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 text-xs select-none relative">
      {/* Undo Toast Notification */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-surface-elevated border border-cyan-500/50 shadow-2xl text-xs text-white flex items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center space-x-2">
            <CheckCheck className="h-4 w-4 text-cyan-400" />
            <span>{undoToast.message}</span>
          </div>
          <button
            onClick={() => {
              setUndoToast(null);
              fetchQuarantine();
            }}
            className="px-2.5 py-1 rounded bg-surface hover:bg-surface-hover text-cyan-300 font-bold border border-cyan-500/30 text-[11px]"
          >
            Undo (10s)
          </button>
        </div>
      )}

      {/* Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Open Backlog</span>
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            {tabCounts.open || 0}
          </div>
          <span className="text-[10px] text-muted-dark">Awaiting review</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">SLA Breached</span>
            <AlertOctagon className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div className="text-xl font-bold font-mono text-red-400 tabular-nums">
            {tabCounts.breached || 0}
          </div>
          <span className="text-[10px] text-red-400/80">Action required immediately</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Avg Review Time</span>
            <Clock className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold font-mono text-purple-300 tabular-nums">
            14.2m
          </div>
          <span className="text-[10px] text-emerald-400">-2.1m vs yesterday</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Release Rate</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
            18.5%
          </div>
          <span className="text-[10px] text-muted">False positive resolutions</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Confirmed Fraud</span>
            <Ban className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-bold font-mono text-rose-400 tabular-nums">
            81.5%
          </div>
          <span className="text-[10px] text-rose-400/80">Blocked permanently</span>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-surface rounded-xl border border-border flex flex-col flex-1 overflow-hidden shadow-2xl relative">
        {/* Status Tab Bar */}
        <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-surface-card/60">
          <div className="flex items-center space-x-1.5 overflow-x-auto">
            <button
              onClick={() => setActiveTab("OPEN")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "OPEN"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>Open</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-950 text-amber-400 font-mono text-[10px] border border-amber-800/60">
                {tabCounts.open || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("AT_RISK")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "AT_RISK"
                  ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>At Risk</span>
              <span className="px-1.5 py-0.2 rounded-full bg-yellow-950 text-yellow-400 font-mono text-[10px] border border-yellow-800/60">
                {tabCounts.at_risk || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("BREACHED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "BREACHED"
                  ? "bg-red-500/20 text-red-400 border border-red-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>Breached</span>
              <span className="px-1.5 py-0.2 rounded-full bg-red-950 text-red-300 font-mono text-[10px] border border-red-800/60">
                {tabCounts.breached || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("ESCALATED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "ESCALATED"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>Escalated</span>
              <span className="px-1.5 py-0.2 rounded-full bg-purple-950 text-purple-300 font-mono text-[10px] border border-purple-800/60">
                {tabCounts.escalated || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("RELEASED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "RELEASED"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>Released</span>
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-950 text-emerald-300 font-mono text-[10px] border border-emerald-800/60">
                {tabCounts.released || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("CONFIRMED_FRAUD")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "CONFIRMED_FRAUD"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>Confirmed Fraud</span>
              <span className="px-1.5 py-0.2 rounded-full bg-rose-950 text-rose-300 font-mono text-[10px] border border-rose-800/60">
                {tabCounts.confirmed_fraud || 0}
              </span>
            </button>
          </div>

          {/* Search & Export Actions */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-surface-elevated border border-border rounded-lg px-2.5 py-1">
              <Search className="h-3.5 w-3.5 text-muted-dark mr-1.5" />
              <input
                type="text"
                placeholder="Search case, account, IP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-slate-100 placeholder-muted-dark focus:outline-none w-44 text-xs"
              />
            </div>

            <button
              onClick={handleExportCSV}
              className="px-2.5 py-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white flex items-center space-x-1.5 transition"
            >
              <Download className="h-3 w-3" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Floating Bulk Actions Bar */}
        {selectedIds.length > 0 && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-surface-elevated border border-cyan-500/50 shadow-2xl flex items-center space-x-4 animate-fade-in">
            <span className="font-mono text-cyan-300 font-bold text-xs">
              {selectedIds.length} case{selectedIds.length > 1 ? "s" : ""} selected
            </span>

            <div className="h-4 w-px bg-border"></div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowBulkModal("RELEASE")}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
              >
                Release
              </button>
              <button
                onClick={() => setShowBulkModal("CONFIRM_FRAUD")}
                className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-semibold transition"
              >
                Confirm Fraud
              </button>
              <button
                onClick={() => setShowBulkModal("ESCALATE")}
                className="px-2.5 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold transition"
              >
                Escalate
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="px-2 py-1 rounded hover:bg-surface text-muted hover:text-white transition"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Table Body */}
        <div className="flex-1 overflow-auto divide-y divide-border/60">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 z-20 bg-surface-card border-b border-border shadow-md select-none">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-dark h-9">
                <th className="w-10 px-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === filteredCases.length}
                    onChange={toggleSelectAll}
                    className="rounded accent-cyan-400"
                  />
                </th>
                <th className="w-36 px-3">Case ID</th>
                <th className="w-32 px-3">Account</th>
                <th className="w-28 px-3 text-right">Amount</th>
                <th className="w-28 px-3">Risk</th>
                <th className="w-36 px-3">SLA Status</th>
                <th className="px-3">Rule Violations</th>
                <th className="w-28 px-3">Assignee</th>
                <th className="w-24 px-3">Age</th>
                <th className="w-28 px-3 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/40 text-xs">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-muted">
                    <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-slate-600" />
                    <p className="font-medium text-slate-300">No cases found matching current view.</p>
                  </td>
                </tr>
              ) : (
                filteredCases.map((c) => {
                  const isSelected = selectedIds.includes(c.transaction_id);
                  const times = formatFullTime(c.timestamp || c.quarantine_ts);

                  return (
                    <tr
                      key={c.transaction_id}
                      onClick={() => setCaseDrawerTx(c)}
                      className={`h-12 transition-colors cursor-pointer group ${
                        isSelected ? "bg-cyan-950/20" : "hover:bg-surface-hover/70"
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 text-center" onClick={(e) => toggleSelectOne(e, c.transaction_id)}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded accent-cyan-400"
                        />
                      </td>

                      {/* Case Short ID + Copy */}
                      <td className="px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5 font-mono text-[11px] text-cyan-300">
                          <span>{formatShortId(c.transaction_id)}</span>
                          <button
                            onClick={(e) => handleCopy(e, c.transaction_id)}
                            className="p-1 rounded hover:bg-surface-elevated text-muted-dark hover:text-cyan-400 transition"
                            title="Copy full case ID"
                          >
                            {copiedId === c.transaction_id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                      </td>

                      {/* Account */}
                      <td className="px-3 whitespace-nowrap font-mono text-[11px] text-slate-300 truncate max-w-[120px]">
                        {c.account_id}
                      </td>

                      {/* Amount */}
                      <td className="px-3 whitespace-nowrap text-right font-mono font-medium text-white tabular-nums">
                        {formatCurrency(c.amount, c.currency)}
                      </td>

                      {/* Risk */}
                      <td className="px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="w-12 h-1.5 bg-surface-card rounded-full overflow-hidden border border-border/50">
                            <div
                              className={`h-full rounded-full ${
                                c.risk_score >= 80 ? "bg-red-500" : c.risk_score >= 40 ? "bg-amber-400" : "bg-emerald-400"
                              }`}
                              style={{ width: `${Math.min(100, c.risk_score)}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] font-semibold text-slate-200 tabular-nums">
                            {Math.round(c.risk_score)}
                          </span>
                        </div>
                      </td>

                      {/* SLA */}
                      <td className="px-3 whitespace-nowrap">
                        {getSlaPill(c.sla_status || "ON_TRACK", c.sla_countdown || "No SLA", c.is_sla_breached)}
                      </td>

                      {/* Reasons */}
                      <td className="px-3">
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          {c.flags && c.flags.length > 0 ? (
                            <>
                              {c.flags.slice(0, 2).map((f: any) => (
                                <span
                                  key={f.flag || f}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-950/40 text-red-300 border border-red-800/40 truncate max-w-[130px]"
                                >
                                  {getHumanSignalLabel(f.flag || f)}
                                </span>
                              ))}
                              {c.flags.length > 2 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-elevated text-cyan-400 border border-cyan-800/60">
                                  +{c.flags.length - 2}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-dark italic text-[11px]">System flagged</span>
                          )}
                        </div>
                      </td>

                      {/* Assignee */}
                      <td className="px-3 whitespace-nowrap font-mono text-[11px] text-slate-300">
                        <span className="px-1.5 py-0.5 rounded bg-surface-elevated border border-border">
                          {c.assignee || "Unassigned"}
                        </span>
                      </td>

                      {/* Age */}
                      <td className="px-3 whitespace-nowrap text-muted text-[11px]">
                        <span title={`UTC: ${times.utc}\nLocal: ${times.local}`} className="cursor-help">
                          {formatRelativeTime(c.quarantine_ts || c.timestamp)}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            onClick={() => setCaseDrawerTx(c)}
                            className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 font-medium transition"
                          >
                            Review
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Case Drawer with 8 Tabs */}
      {caseDrawerTx && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] lg:w-[600px] bg-surface-elevated/95 backdrop-blur-md border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden text-xs">
          {/* Header */}
          <div className="h-14 border-b border-border px-5 flex items-center justify-between bg-surface-card/60">
            <div className="flex items-center space-x-2.5">
              <div className="h-7 w-7 rounded bg-amber-950 border border-amber-800/60 flex items-center justify-center">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-tight">Case Investigation</h2>
                <div className="flex items-center space-x-2 text-[10px] text-muted">
                  <span className="font-mono text-cyan-300">{caseDrawerTx.transaction_id}</span>
                  <span>•</span>
                  <span>{caseDrawerTx.status}</span>
                </div>
              </div>
            </div>

            <button onClick={() => setCaseDrawerTx(null)} className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="px-5 border-b border-border flex items-center space-x-4 bg-surface overflow-x-auto text-muted text-[11px] font-medium">
            <button
              onClick={() => setDrawerTab("summary")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "summary" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Summary
            </button>
            <button
              onClick={() => setDrawerTab("rules")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "rules" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Why Blocked
            </button>
            <button
              onClick={() => setDrawerTab("customer")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "customer" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Customer
            </button>
            <button
              onClick={() => setDrawerTab("network")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "network" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Network
            </button>
            <button
              onClick={() => setDrawerTab("notes")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "notes" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Notes
            </button>
            <button
              onClick={() => setDrawerTab("audit")}
              className={`py-2.5 border-b-2 transition ${drawerTab === "audit" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
            >
              Audit Log
            </button>
          </div>

          {/* Drawer Body Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {drawerTab === "summary" && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-surface border border-border">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-muted">Total Transaction Amount</span>
                    <span className="text-xl font-bold font-mono text-white">
                      {formatCurrency(caseDrawerTx.amount, caseDrawerTx.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[11px] pt-2 border-t border-border/60">
                    <span className="text-muted">Calculated Risk Score:</span>
                    <span className="font-mono font-bold text-red-400">{caseDrawerTx.risk_score} / 100</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-surface border border-border space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted">Account ID:</span>
                    <span className="font-mono text-cyan-300">{caseDrawerTx.account_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Location:</span>
                    <span className="text-slate-200">{caseDrawerTx.transaction_city || caseDrawerTx.city}, {caseDrawerTx.transaction_country || caseDrawerTx.country}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">SLA Deadline:</span>
                    <span className="font-mono text-slate-300">{caseDrawerTx.sla_deadline || "60m from fix"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Current Assignee:</span>
                    <span className="font-mono text-white">{caseDrawerTx.assignee || "Unassigned"}</span>
                  </div>
                </div>
              </div>
            )}

            {drawerTab === "rules" && (
              <div className="space-y-2">
                <p className="text-muted text-[11px] mb-2">Score breakdown and triggered heuristic rules:</p>
                {(caseDrawerTx.flags || []).map((f: any) => (
                  <div key={f.flag || f} className="p-3 rounded-lg bg-surface border border-red-900/50 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-red-400 font-mono text-[11px]">{getHumanSignalLabel(f.flag || f)}</span>
                      <span className="text-[10px] px-1 rounded bg-red-950 text-red-300 border border-red-800">Triggered</span>
                    </div>
                    <p className="text-[10px] text-slate-300">{f.reason || "Algorithm heuristic rule deviation detected."}</p>
                  </div>
                ))}
              </div>
            )}

            {drawerTab === "notes" && (
              <div className="flex flex-col h-full space-y-3">
                <div className="flex-1 space-y-2">
                  {(caseDrawerTx.notes_thread || []).map((n: any, idx: number) => (
                    <div key={idx} className="p-2.5 rounded bg-surface border border-border space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="font-semibold text-cyan-300">{n.author}</span>
                        <span className="text-muted-dark">{formatRelativeTime(n.timestamp)}</span>
                      </div>
                      <p className="text-slate-200 text-[11px]">{n.text}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center space-x-2 pt-2 border-t border-border">
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Add an analyst note..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-border text-white text-xs focus:outline-none focus:border-cyan-500"
                    onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                  />
                  <button
                    onClick={handleAddNote}
                    className="p-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {drawerTab === "audit" && (
              <div className="space-y-2">
                <div className="p-2.5 rounded bg-surface border border-border text-[11px] space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="font-semibold text-emerald-400">Transaction Quarantined</span>
                    <span className="text-muted-dark">{formatRelativeTime(caseDrawerTx.quarantine_ts || caseDrawerTx.timestamp)}</span>
                  </div>
                  <p className="text-slate-300">Automatic system quarantine triggered by heuristic risk engine.</p>
                </div>
              </div>
            )}
          </div>

          {/* Sticky Drawer Action Bar */}
          <div className="p-4 border-t border-border bg-surface-card flex items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "RELEASE")}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition"
              >
                Release Case
              </button>
              <button
                onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "CONFIRM_FRAUD")}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
              >
                Confirm Fraud
              </button>
              <button
                onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "ESCALATE")}
                className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition"
              >
                Escalate
              </button>
            </div>

            <button
              onClick={() => setCaseDrawerTx(null)}
              className="px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Two-step four-eyes approval modal for risk >= 80 */}
      {showFourEyesModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-elevated border border-red-500/50 shadow-2xl p-5 space-y-4">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Secondary Approval Required</h3>
                <p className="text-[11px] text-muted">High-risk transaction (Risk Score: {showFourEyesModal.risk_score})</p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/40 text-red-200 text-xs">
              This case scored ≥ 80. Releasing high-risk transactions requires mandatory secondary confirmation.
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-300">Type CONFIRM to authorize release:</label>
              <input
                type="text"
                value={secondConfirmText}
                onChange={(e) => setSecondConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full px-3 py-1.5 rounded bg-surface border border-border text-white text-xs font-mono uppercase"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowFourEyesModal(null)}
                className="px-3 py-1.5 rounded bg-surface hover:bg-surface-hover text-muted"
              >
                Cancel
              </button>
              <button
                disabled={secondConfirmText.trim().toUpperCase() !== "CONFIRM"}
                onClick={() => handleSingleAction(showFourEyesModal.transaction_id, "RELEASE", true)}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold"
              >
                Authorize Release
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Summary Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-surface-elevated border border-border shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Confirm Bulk Action: {showBulkModal}</h3>

            <div className="p-3 rounded-lg bg-surface border border-border space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Selected Cases:</span>
                <span className="font-mono text-white font-bold">{selectedIds.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Operator Role:</span>
                <span className="font-mono text-cyan-300 uppercase">{userRole}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] text-muted block">Resolution Reason:</label>
              <select
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded bg-surface border border-border text-white text-xs"
              >
                <option value="Batch false-positive review">Batch false-positive review</option>
                <option value="Confirmed credential stuffing cluster">Confirmed credential stuffing cluster</option>
                <option value="Escalation to Tier-2 Fraud Ring Unit">Escalation to Tier-2 Fraud Ring Unit</option>
                <option value="Manual risk clearance">Manual risk clearance</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setShowBulkModal(null)} className="px-3 py-1.5 rounded bg-surface text-muted">
                Cancel
              </button>
              <button
                onClick={handleExecuteBulk}
                disabled={bulkActionLoading}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
              >
                {bulkActionLoading ? "Processing..." : `Execute ${showBulkModal}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
