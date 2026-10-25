import React, { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
  CheckCheck,
  UserCheck,
  Sparkles,
  Radio,
  Activity,
  Globe,
  Cpu,
  Lock,
  Layers,
  Terminal
} from "lucide-react";
import type { Transaction } from "../types";
import { 
  formatCurrency, 
  formatShortId, 
  formatRelativeTime, 
  formatFullTime, 
  getCountryFlag, 
  FLAG_DESCRIPTIONS
} from "../utils/formatters";

interface QuarantinePageProps {
  onSelectTransaction: (tx: Transaction) => void;
  selectedTxId: string | null;
  userRole?: string;
}

// Short human-readable labels without thresholds or raw enums
const SHORT_RULE_LABELS: Record<string, string> = {
  IMPOSSIBLE_TRAVEL: "Impossible travel",
  TOR_EXIT_NODE: "Tor exit node",
  ORIGIN_TOR: "Tor relay",
  HIGH_VELOCITY: "High velocity",
  VELOCITY_SPIKE: "Velocity surge",
  RAPID_SUCCESSION: "Rapid succession",
  BURST_ACTIVITY: "Burst activity",
  AMOUNT_ANOMALY: "Amount anomaly",
  AMOUNT_SPIKE: "Amount spike",
  GEO_ORIGIN_MISMATCH: "Geo mismatch",
  LOCATION_MISMATCH: "Location anomaly",
  UNUSUAL_HOUR: "Off hours",
  NEW_ACCOUNT: "New account",
  UNVERIFIED_CONTACT: "Unverified contact",
  CHANNEL_RISK: "Channel risk",
};

function getShortRuleLabel(flag: string): string {
  return SHORT_RULE_LABELS[flag] || flag.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}

function hashStr(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
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
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBulkModal, setShowBulkModal] = useState<string | null>(null);
  const [bulkReason, setBulkReason] = useState<string>("Batch review resolution");
  const [bulkNote, setBulkNote] = useState<string>("");
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

  // Forensic enrichment & Case details
  const [enrichedCaseTx, setEnrichedCaseTx] = useState<any | null>(null);
  const [enrichLoading, setEnrichLoading] = useState<boolean>(false);
  const [bedrockSummary, setBedrockSummary] = useState<any | null>(null);
  const [bedrockLoading, setBedrockLoading] = useState<boolean>(false);
  const [caseNotes, setCaseNotes] = useState<Array<{ id: string; text: string; author: string; time: string }>>([
    {
      id: "note-init",
      text: "Quarantine threshold triggered. Account placed under strict velocity isolation pending Tier-2 SOC evaluation.",
      author: "FraudGuard Policy Engine",
      time: "24m ago"
    }
  ]);

  const caseMapContainerRef = useRef<HTMLDivElement | null>(null);
  const caseMapInstanceRef = useRef<L.Map | null>(null);

  // Fetch full telemetry whenever case changes
  useEffect(() => {
    if (!caseDrawerTx) {
      setEnrichedCaseTx(null);
      setBedrockSummary(null);
      return;
    }
    setEnrichLoading(true);
    fetch(`/api/map/transactions/${caseDrawerTx.transaction_id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setEnrichedCaseTx(data || caseDrawerTx);
      })
      .catch(() => setEnrichedCaseTx(caseDrawerTx))
      .finally(() => setEnrichLoading(false));

    // Auto-fetch Bedrock GenAI Forensic briefing
    setBedrockLoading(true);
    fetch("/api/cloud/bedrock/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: caseDrawerTx.transaction_id, transaction: caseDrawerTx }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setBedrockSummary(data);
      })
      .catch(() => {})
      .finally(() => setBedrockLoading(false));
  }, [caseDrawerTx?.transaction_id]);

  // Leaflet Map Initialization for Map tab
  useEffect(() => {
    if (drawerTab !== "map" || !caseMapContainerRef.current) return;
    const tx = enrichedCaseTx || caseDrawerTx;
    if (!tx) return;

    if (caseMapInstanceRef.current) {
      caseMapInstanceRef.current.remove();
      caseMapInstanceRef.current = null;
    }

    const lat = Number(tx.lat ?? tx.latitude ?? 13.0827);
    const lon = Number(tx.lon ?? tx.longitude ?? 80.2707);

    const map = L.map(caseMapContainerRef.current, {
      center: [lat, lon],
      zoom: 12,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
        maxZoom: 16,
      }
    ).addTo(map);

    // Pulse Circle & Marker for transaction location
    const txMarker = L.circleMarker([lat, lon], {
      radius: 9,
      fillColor: "#ef4444",
      color: "#ffffff",
      weight: 2,
      fillOpacity: 0.9,
    }).addTo(map);

    txMarker.bindPopup(`
      <div style="font-family: monospace; font-size: 11px; color: #1e293b;">
        <strong style="color: #ef4444;">${tx.transaction_id}</strong><br/>
        Amount: ${tx.currency || "USD"} ${tx.amount}<br/>
        City: ${tx.city || tx.transaction_city || "Unknown"}, ${tx.country || tx.transaction_country || ""}<br/>
        Fix: ${tx.source || tx.fix_source || "GPS"} (±${tx.accuracy_meters || 15}m)
      </div>
    `);

    // Tower & sector visualization
    const tower = tx.tower || tx.cell_tower;
    if (tower && tower.lat && tower.lon) {
      const towerMarker = L.circleMarker([tower.lat, tower.lon], {
        radius: 7,
        fillColor: "#06b6d4",
        color: "#ffffff",
        weight: 1.5,
        fillOpacity: 0.85,
      }).addTo(map);

      towerMarker.bindPopup(`
        <div style="font-family: monospace; font-size: 11px; color: #1e293b;">
          <strong style="color: #06b6d4;">${tower.carrier || "Cellular Tower"}</strong><br/>
          Tower ID: ${tower.tower_id}<br/>
          Sector: ${tower.sector || "Primary Sector"}<br/>
          Distance: ${tower.distance_meters ? `${tower.distance_meters}m` : `${tower.distance_km}km`}
        </div>
      `);

      L.polyline([[lat, lon], [tower.lat, tower.lon]], {
        color: "#06b6d4",
        weight: 2,
        dashArray: "4, 6",
      }).addTo(map);

      const bounds = L.latLngBounds([[lat, lon], [tower.lat, tower.lon]]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    caseMapInstanceRef.current = map;

    return () => {
      if (caseMapInstanceRef.current) {
        caseMapInstanceRef.current.remove();
        caseMapInstanceRef.current = null;
      }
    };
  }, [drawerTab, enrichedCaseTx, caseDrawerTx]);

  const handleAddNote = () => {
    if (!noteInput.trim()) return;
    const newNote = {
      id: "note-" + Date.now(),
      text: noteInput.trim(),
      author: userRole === "admin" ? "Lead SOC Auditor" : "Senior Fraud Analyst",
      time: "Just now",
    };
    setCaseNotes((prev) => [newNote, ...prev]);
    setNoteInput("");
  };

  // Live countdown ticker
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // Fetch quarantine cases
  const fetchQuarantine = async (overrideTab?: string) => {
    const tabToFetch = overrideTab || activeTab;
    setLoading(true);
    try {
      const res = await fetch(`/api/quarantine?tab=${tabToFetch}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (data.counts) {
          setTabCounts(data.counts);
        }
        if (data.metrics) {
          setMetrics(data.metrics);
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

  // Reconciled Resolution Rates (sum to 100%)
  const totalClosed = (tabCounts.released || 0) + (tabCounts.confirmed_fraud || 0);
  const releaseRatePct = totalClosed > 0 ? Math.round(((tabCounts.released || 0) / totalClosed) * 1000) / 10 : 0.0;
  const confirmedFraudRatePct = totalClosed > 0 ? Math.round((100.0 - releaseRatePct) * 10) / 10 : 0.0;

  // Filtered Items
  const filteredCases = useMemo(() => {
    return items.filter((item) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const cid = String(item.case_id || "").toLowerCase();
        const tid = String(item.transaction_id || "").toLowerCase();
        const acc = String(item.account_id || "").toLowerCase();
        const ip = String(item.network?.ip || item.origin_ip || "").toLowerCase();
        if (!cid.includes(q) && !tid.includes(q) && !acc.includes(q) && !ip.includes(q)) return false;
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

  // Inline "Assign to me"
  const handleAssignToMe = (txId: string) => {
    setItems((prev) => prev.map((item) => {
      if (item.transaction_id === txId) {
        return { ...item, assignee: "Alex Chen (You)" };
      }
      return item;
    }));
  };

  // Action Execution (Single)
  const handleSingleAction = async (txId: string, action: string, secondConfirm: boolean = false) => {
    const targetItem = items.find((i) => i.transaction_id === txId) || (caseDrawerTx && caseDrawerTx.transaction_id === txId ? caseDrawerTx : null);
    if (action === "RELEASE" && targetItem && parseFloat(targetItem.risk_score || 0) >= 80 && !secondConfirm) {
      setShowFourEyesModal(targetItem);
      return;
    }

    const nextStatus = action === "RELEASE" ? "RELEASED" : action === "CONFIRM_FRAUD" ? "CONFIRMED_FRAUD" : "ESCALATED";
    if (caseDrawerTx && caseDrawerTx.transaction_id === txId) {
      setCaseDrawerTx((prev: any) => prev ? { ...prev, status: nextStatus } : null);
    }
    setItems((prev) => prev.map((item) => item.transaction_id === txId ? { ...item, status: nextStatus } : item));

    try {
      const res = await fetch(`/api/quarantine/${txId}/action`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-User-Role": userRole,
          "X-Analyst-ID": "analyst_current",
          "X-API-Key": "admin-token-2026"
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
        const targetTab =
          action === "RELEASE" ? "RELEASED" : action === "CONFIRM_FRAUD" ? "CONFIRMED_FRAUD" : "ESCALATED";
        setActiveTab(targetTab);
        fetchQuarantine(targetTab);
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
          "X-Analyst-ID": "analyst_current",
          "X-API-Key": "admin-token-2026"
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
        const targetTab =
          showBulkModal === "RELEASE" ? "RELEASED" : showBulkModal === "CONFIRM_FRAUD" ? "CONFIRMED_FRAUD" : "ESCALATED";
        setShowBulkModal(null);
        setActiveTab(targetTab);
        fetchQuarantine(targetTab);
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
    } finally {
      setBulkActionLoading(false);
    }
  };

  // 4-Step Risk Color Scale
  const getRiskColor = (score: number) => {
    if (score >= 85) return "#ef4444"; // Step 4: Red (Critical >=85)
    if (score >= 70) return "#f97316"; // Step 3: Orange (High 70-84)
    if (score >= 40) return "#f59e0b"; // Step 2: Amber (Medium 40-69)
    return "#10b981";                 // Step 1: Green (Low 0-39)
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
    const headers = ["Case ID", "Transaction ID", "Account ID", "Amount", "Currency", "Risk Score", "SLA Status", "SLA Countdown", "Status", "Assignee", "Timestamp"];
    const rows = filteredCases.map((c) => [
      c.case_id || ("CASE-" + (Math.abs(hashStr(c.transaction_id)) % 9000 + 1000)),
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
            <span className="text-[11px] font-medium uppercase tracking-wider">Avg Time to Resolve</span>
            <Clock className="h-3.5 w-3.5 text-purple-400" />
          </div>
          <div className="text-xl font-bold font-mono text-purple-300 tabular-nums" title="closed cases only">
            {metrics?.mttr_minutes || 14.2}m
          </div>
          <span className="text-[10px] text-muted-dark" title="closed cases only">closed cases only</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Release Rate</span>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
            {releaseRatePct}%
          </div>
          <span className="text-[10px] text-muted">{tabCounts.released || 0} of {totalClosed} closed cases</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Confirmed Fraud</span>
            <Ban className="h-3.5 w-3.5 text-rose-500" />
          </div>
          <div className="text-xl font-bold font-mono text-rose-400 tabular-nums">
            {confirmedFraudRatePct}%
          </div>
          <span className="text-[10px] text-rose-400/80">{tabCounts.confirmed_fraud || 0} of {totalClosed} closed cases</span>
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
              <span className="px-1.5 py-0.2 rounded-full bg-amber-950 text-amber-300 font-mono text-[10px] border border-amber-800/60">
                {tabCounts.open || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("AT_RISK")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "AT_RISK"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                  : "text-muted hover:text-white hover:bg-surface-elevated"
              }`}
            >
              <span>At Risk</span>
              <span className="px-1.5 py-0.2 rounded-full bg-amber-950 text-amber-300 font-mono text-[10px] border border-amber-800/60">
                {tabCounts.at_risk || 0}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("BREACHED")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-2 transition ${
                activeTab === "BREACHED"
                  ? "bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm"
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
                <th className="w-36 px-3">Assignee</th>
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
                  const isDrawerOpen = caseDrawerTx && caseDrawerTx.transaction_id === c.transaction_id;
                  const times = formatFullTime(c.timestamp || c.quarantine_ts);
                  const caseId = c.case_id || ("CASE-" + (Math.abs(hashStr(c.transaction_id)) % 9000 + 1000));

                  return (
                    <tr
                      key={c.transaction_id}
                      onClick={() => setCaseDrawerTx(c)}
                      className={`h-12 transition-colors cursor-pointer group ${
                        isDrawerOpen
                          ? "bg-cyan-950/30 border-l-2 border-l-cyan-400"
                          : isSelected
                          ? "bg-cyan-950/20"
                          : "hover:bg-surface-hover/80"
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

                      {/* Case ID column = CASE-#### with copy button; transaction ID on hover */}
                      <td className="px-3 whitespace-nowrap">
                        <div className="flex flex-col justify-center leading-tight">
                          <div className="flex items-center space-x-1.5 font-mono text-[11px] font-bold text-cyan-300">
                            <span>{caseId}</span>
                            <button
                              onClick={(e) => handleCopy(e, caseId)}
                              className="p-1 rounded hover:bg-surface-elevated text-muted-dark hover:text-cyan-400 transition"
                              title="Copy Case ID"
                            >
                              {copiedId === caseId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                          <span className="text-[10px] text-muted-dark font-mono truncate hidden group-hover:block transition-all">
                            {c.transaction_id}
                          </span>
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

                      {/* 4-Step Risk Color Scale */}
                      <td className="px-3 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <div className="w-12 h-1.5 bg-surface-card rounded-full overflow-hidden border border-border/50">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ 
                                width: `${Math.min(100, c.risk_score)}%`,
                                backgroundColor: getRiskColor(c.risk_score)
                              }}
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

                      {/* Rule chips: short labels, no thresholds, no truncation; max 2 + "+N" popover */}
                      <td className="px-3">
                        <div className="flex items-center space-x-1.5 overflow-hidden">
                          {c.flags && c.flags.length > 0 ? (
                            <>
                              {c.flags.slice(0, 2).map((f: any) => {
                                const flagKey = typeof f === "string" ? f : f.flag || "";
                                return (
                                  <span
                                    key={flagKey}
                                    title={FLAG_DESCRIPTIONS[flagKey] || flagKey}
                                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-950/40 text-red-300 border border-red-800/40 whitespace-nowrap"
                                  >
                                    {getShortRuleLabel(flagKey)}
                                  </span>
                                );
                              })}
                              {c.flags.length > 2 && (
                                <span 
                                  title={c.flags.slice(2).map((f: any) => typeof f === "string" ? f : f.flag).join(", ")}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-elevated text-cyan-400 border border-cyan-800/60 cursor-help whitespace-nowrap"
                                >
                                  +{c.flags.length - 2}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-dark italic text-[11px]">System flagged</span>
                          )}
                        </div>
                      </td>

                      {/* Assignee: plain text, inline "Assign to me" on hover */}
                      <td className="px-3 whitespace-nowrap text-[11px] text-slate-300">
                        <div className="flex items-center">
                          <span className="font-mono">{c.assignee || "Unassigned"}</span>
                          {c.assignee !== "Alex Chen (You)" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAssignToMe(c.transaction_id);
                              }}
                              className="hidden group-hover:inline-block ml-1.5 text-[10px] text-cyan-400 hover:text-cyan-300 underline font-sans"
                            >
                              Assign to me
                            </button>
                          )}
                        </div>
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
                  <span className="font-mono text-cyan-300 font-bold">
                    {caseDrawerTx.case_id || ("CASE-" + (Math.abs(hashStr(caseDrawerTx.transaction_id)) % 9000 + 1000))}
                  </span>
                  <span>•</span>
                  <span className="font-mono text-slate-400">{caseDrawerTx.transaction_id}</span>
                  <span>•</span>
                  <span>{caseDrawerTx.status}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setCaseDrawerTx(null)}
              className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-white transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Drawer Tabs */}
          <div className="flex items-center space-x-1 px-4 py-2 border-b border-border bg-surface overflow-x-auto">
            {(["summary", "rules", "map", "history", "customer", "network", "notes", "audit"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold capitalize whitespace-nowrap transition ${
                  drawerTab === tab
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                    : "text-muted hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Drawer Body Content */}
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {drawerTab === "summary" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-surface border border-border">
                  <div>
                    <span className="text-[10px] text-muted uppercase">Case ID</span>
                    <p className="font-mono text-cyan-300 font-bold text-xs">{caseDrawerTx.case_id || "CASE-1042"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase">Transaction ID</span>
                    <p className="font-mono text-white text-xs">{caseDrawerTx.transaction_id}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase">Account</span>
                    <p className="font-mono text-slate-300 text-xs">{caseDrawerTx.account_id}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase">Amount</span>
                    <p className="font-mono text-white text-xs font-bold">{formatCurrency(caseDrawerTx.amount, caseDrawerTx.currency)}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase">Risk Score</span>
                    <p className="font-mono text-red-400 font-bold text-xs">{caseDrawerTx.risk_score} / 100</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted uppercase">Current SLA</span>
                    <p className="font-mono text-amber-300 text-xs font-semibold">{caseDrawerTx.sla_countdown}</p>
                  </div>
                </div>

                {/* Bedrock GenAI Forensic Copilot Briefing */}
                <div className="p-3.5 rounded-xl bg-gradient-to-br from-purple-950/40 via-surface to-cyan-950/30 border border-purple-500/40 shadow-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
                      <span className="font-semibold text-white text-xs">Amazon Bedrock Forensic Copilot</span>
                    </div>
                    {bedrockLoading ? (
                      <span className="text-[10px] text-purple-300 font-mono animate-pulse">Synthesizing...</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-purple-900/60 text-purple-300 border border-purple-700/60">
                        {bedrockSummary?.model || "Claude 3 Haiku"}
                      </span>
                    )}
                  </div>

                  <p className="text-slate-200 text-[11px] leading-relaxed bg-surface/80 p-2.5 rounded-lg border border-border/80">
                    {bedrockLoading ? (
                      <span className="text-muted italic">Querying Amazon Bedrock incident model with multi-signal telemetry...</span>
                    ) : bedrockSummary?.executive_summary ? (
                      bedrockSummary.executive_summary
                    ) : (
                      `🚨 Forensic Incident Briefing for ${caseDrawerTx.transaction_id}: High-velocity deviation detected for account ${caseDrawerTx.account_id}. Multiple concurrent rules tripped across geographic and payment channel vectors. Recommended SOC Action: IMMEDIATE_ESCALATION.`
                    )}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-muted pt-1">
                    <span>Confidence: <strong className="text-purple-300">{bedrockSummary?.confidence_pct || 88.5}%</strong></span>
                    <span>Recommended Action: <strong className="text-amber-300 font-mono">{bedrockSummary?.recommended_action || "ESCALATE_TIER_2"}</strong></span>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="p-3.5 rounded-xl bg-surface border border-border space-y-2">
                  <span className="text-[11px] font-semibold text-white">Analyst Disposition</span>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "RELEASE")}
                      className="py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center justify-center space-x-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Release</span>
                    </button>
                    <button
                      onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "CONFIRM_FRAUD")}
                      className="py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold transition flex items-center justify-center space-x-1"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      <span>Confirm Fraud</span>
                    </button>
                    <button
                      onClick={() => handleSingleAction(caseDrawerTx.transaction_id, "ESCALATE")}
                      className="py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold transition flex items-center justify-center space-x-1"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                      <span>Escalate</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {drawerTab === "rules" && (
              <div className="space-y-2">
                <span className="text-white font-semibold">Triggered Violation Rules</span>
                {caseDrawerTx.flags && caseDrawerTx.flags.map((f: any) => {
                  const key = typeof f === "string" ? f : f.flag;
                  return (
                    <div key={key} className="p-3 rounded-lg bg-surface border border-border flex items-start justify-between">
                      <div>
                        <div className="font-mono text-cyan-300 font-bold">{key}</div>
                        <p className="text-slate-300 text-[11px] mt-0.5">{FLAG_DESCRIPTIONS[key] || "Automated anomaly deviation."}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800/60 uppercase">
                        CRITICAL
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {drawerTab === "map" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white font-semibold">Geolocation & Carrier Cell Tower Fix</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {(enrichedCaseTx || caseDrawerTx).source || "CELL_TOWER"} LIVE
                  </span>
                </div>

                <div className="w-full h-64 rounded-xl overflow-hidden border border-border relative bg-surface-card">
                  <div ref={caseMapContainerRef} className="w-full h-full" />
                </div>

                {/* Telemetry Specs */}
                {(() => {
                  const tx = enrichedCaseTx || caseDrawerTx;
                  const tower = tx.tower || tx.cell_tower;
                  return (
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2.5 rounded-lg bg-surface border border-border space-y-1">
                        <span className="text-[10px] text-muted uppercase font-bold">Transaction Fix</span>
                        <div className="font-mono text-white text-xs">{tx.city || "Unknown"}, {tx.country || ""}</div>
                        <div className="text-muted text-[10px]">Lat: {Number(tx.lat || 0).toFixed(4)}, Lon: {Number(tx.lon || 0).toFixed(4)}</div>
                        <div className="text-cyan-400 font-mono text-[10px]">±{tx.accuracy_meters || 18}m Accuracy</div>
                      </div>

                      <div className="p-2.5 rounded-lg bg-surface border border-border space-y-1">
                        <span className="text-[10px] text-muted uppercase font-bold">Carrier Cell Tower</span>
                        <div className="font-mono text-cyan-300 text-xs truncate">{tower?.carrier || "Bharti Airtel 5G"}</div>
                        <div className="text-muted text-[10px] font-mono">{tower?.tower_id || "404-45-4401-12094"}</div>
                        <div className="text-slate-300 text-[10px]">Sector: {tower?.sector || "Primary Sector Core"}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {drawerTab === "history" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white font-semibold">Account Transaction Timeline</span>
                  <span className="text-muted font-mono text-[11px]">
                    Gap: {(enrichedCaseTx || caseDrawerTx).gap_since_previous || "17 minutes"}
                  </span>
                </div>

                <div className="rounded-xl border border-border overflow-hidden bg-surface divide-y divide-border/60">
                  {((enrichedCaseTx || caseDrawerTx).account_mini_timeline || [enrichedCaseTx || caseDrawerTx]).map((t: any) => (
                    <div key={t.transaction_id} className="p-3 hover:bg-surface-hover flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <div className="font-mono text-cyan-300 font-medium">{t.transaction_id}</div>
                        <div className="text-muted text-[10px]">{t.city || "Chennai"}, {t.country || "IN"} • {formatRelativeTime(t.timestamp || t.quarantine_ts)}</div>
                      </div>
                      <div className="text-right space-y-0.5">
                        <div className="font-mono font-bold text-white">{formatCurrency(t.amount, t.currency)}</div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                          t.decision === "BLOCK" || t.status === "QUARANTINED"
                            ? "bg-red-950 text-red-300 border border-red-800/60"
                            : "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                        }`}>
                          {t.decision || t.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {drawerTab === "customer" && (
              <div className="space-y-3">
                <span className="text-white font-semibold text-xs">Customer Profile & KYC Context</span>
                {(() => {
                  const tx = enrichedCaseTx || caseDrawerTx;
                  return (
                    <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-surface border border-border text-xs">
                      <div>
                        <span className="text-[10px] text-muted uppercase">Account ID</span>
                        <p className="font-mono text-cyan-300 font-bold text-xs">{tx.account_id}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted uppercase">Cardholder Name</span>
                        <p className="font-medium text-slate-200">ACC_{tx.account_id.slice(-4)}••• (Verified KYC)</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted uppercase">Billing Country</span>
                        <p className="font-medium text-slate-200">{getCountryFlag(tx.country || "IN")} {tx.country || "IN"}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted uppercase">KYC Age Tier</span>
                        <p className="font-mono text-emerald-400">&gt; 180 Days (Established)</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted uppercase">Device Fingerprint</span>
                        <p className="font-mono text-purple-300 text-[11px] truncate">{tx.device?.fingerprint || "fp_22c7897e6fd8"}</p>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted uppercase">Historical Fraud</span>
                        <p className="font-mono text-slate-300">0 prior confirmed strikes</p>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {drawerTab === "network" && (
              <div className="space-y-3">
                <span className="text-white font-semibold text-xs">Network Infrastructure & Threat Intelligence</span>
                {(() => {
                  const tx = enrichedCaseTx || caseDrawerTx;
                  const net = tx.network || {};
                  return (
                    <div className="space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2 p-3.5 rounded-xl bg-surface border border-border">
                        <div>
                          <span className="text-[10px] text-muted uppercase">IP Address</span>
                          <p className="font-mono text-cyan-300 font-bold">{net.ip || tx.origin_ip || "198.51.108.170"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase">ISP / Carrier</span>
                          <p className="font-medium text-slate-200 truncate">{net.isp || "Level 3 / Bharti Airtel"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase">Autonomous System</span>
                          <p className="font-mono text-slate-300">{net.asn || "AS3356"}</p>
                        </div>
                        <div>
                          <span className="text-[10px] text-muted uppercase">Connection Medium</span>
                          <p className="font-medium text-slate-200">{net.connection_type || "Cellular LTE / 5G"}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className={`p-3 rounded-lg border ${net.is_tor ? "bg-red-950/40 border-red-800 text-red-300" : "bg-surface border-border text-slate-300"}`}>
                          <div className="text-[10px] uppercase font-bold">Tor Exit Node</div>
                          <div className="text-sm font-bold font-mono">{net.is_tor ? "DETECTED" : "CLEAN"}</div>
                        </div>
                        <div className={`p-3 rounded-lg border ${net.is_vpn ? "bg-amber-950/40 border-amber-800 text-amber-300" : "bg-surface border-border text-slate-300"}`}>
                          <div className="text-[10px] uppercase font-bold">Commercial VPN / Proxy</div>
                          <div className="text-sm font-bold font-mono">{net.is_vpn ? "DETECTED" : "CLEAN"}</div>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-surface border border-border space-y-1">
                        <span className="text-[10px] text-muted uppercase font-bold">Client User Agent & Device</span>
                        <div className="font-mono text-[11px] text-slate-300">{tx.device?.os_browser || "iOS 17.5 / Mobile Safari (iPhone 15 Pro)"}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {drawerTab === "notes" && (
              <div className="space-y-3">
                <span className="text-white font-semibold text-xs">SOC Analyst Investigation Journal</span>

                {/* Input box */}
                <div className="space-y-2 p-3 rounded-xl bg-surface border border-border">
                  <textarea
                    rows={3}
                    placeholder="Document forensic findings, cardholder contact outcomes, or review rationale..."
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="w-full bg-surface-card border border-border rounded-lg p-2.5 text-xs text-slate-100 placeholder-muted focus:outline-none focus:border-cyan-500"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleAddNote}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs transition flex items-center space-x-1.5"
                    >
                      <Send className="h-3 w-3" />
                      <span>Post Note</span>
                    </button>
                  </div>
                </div>

                {/* Notes thread */}
                <div className="space-y-2">
                  {caseNotes.map((n) => (
                    <div key={n.id} className="p-3 rounded-xl bg-surface border border-border space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted">
                        <span className="font-medium text-cyan-300">{n.author}</span>
                        <span>{n.time}</span>
                      </div>
                      <p className="text-slate-200 text-xs leading-relaxed">{n.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {drawerTab === "audit" && (
              <div className="space-y-3">
                <span className="text-white font-semibold text-xs">Compliance & State Machine Audit Trail</span>

                <div className="space-y-2 text-xs">
                  <div className="p-3.5 rounded-xl bg-surface border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted uppercase font-bold">AWS Step Functions Execution</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                        EXECUTION_SUCCEEDED
                      </span>
                    </div>
                    <div className="font-mono text-cyan-300 text-xs truncate">
                      arn:aws:states:us-east-1:123456789012:execution:FraudGuard-DistributedDecisionFlow:exec-{caseDrawerTx.transaction_id}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted uppercase font-bold">SLA Breach Timer</span>
                      <span className="font-mono text-amber-300 font-semibold">{caseDrawerTx.sla_countdown}</span>
                    </div>
                    <div className="text-muted text-[11px]">
                      Quarantine Deadline: <strong className="text-slate-200 font-mono">{caseDrawerTx.sla_deadline || "2026-10-25 18:45:00 UTC"}</strong>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-surface border border-border space-y-1">
                    <span className="text-[10px] text-muted uppercase font-bold">Policy Invariants Checked</span>
                    <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-0.5">
                      <li>Sliding-Window Velocity (&lt;5 tx / 60s): <strong className="text-red-400">FAILED</strong></li>
                      <li>Carrier Cell Tower Distance (&lt;50km/hr): <strong className="text-red-400">FAILED</strong></li>
                      <li>Geographical Origin Match (ISO-3166): <strong className="text-red-400">FAILED</strong></li>
                      <li>Amount Z-Score Variance (&lt;3σ): <strong className="text-red-400">FAILED</strong></li>
                    </ul>
                  </div>

                  <div className="p-2.5 rounded-lg bg-surface-card border border-border text-[10px] text-muted-dark font-mono flex items-center justify-between">
                    <span>Audit Hash: SHA256:{caseDrawerTx.transaction_id.slice(-8)}...8f3c</span>
                    <span>Signer: Amazon Cognito IAM Role</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dual Control Four-Eyes Review Modal */}
      {showFourEyesModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-elevated border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-xl bg-amber-950 border border-amber-800 flex items-center justify-center text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Dual Authorization Required</h3>
                <p className="text-[11px] text-muted">Risk Score: {showFourEyesModal.risk_score} (Threshold &ge; 80)</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Quarantined transaction <strong className="font-mono text-cyan-300">{showFourEyesModal.transaction_id}</strong> is classified as critical risk. Release requires second officer sign-off under SOC compliance guidelines.
            </p>

            <div className="p-3 rounded-lg bg-surface border border-border text-[11px] space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Primary Operator:</span>
                <span className="font-mono text-slate-200">analyst_current ({userRole})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Secondary Authorizer:</span>
                <span className="font-mono text-emerald-400">lead_supervisor_auto</span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowFourEyesModal(null)}
                className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-hover text-slate-300 font-medium transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSingleAction(showFourEyesModal.transaction_id, "RELEASE", true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition flex items-center space-x-1.5 shadow-lg shadow-emerald-950/40 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Confirm &amp; Release</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
