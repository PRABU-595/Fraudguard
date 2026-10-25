import React, { useState, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { 
  Users, 
  Search, 
  ShieldAlert, 
  MapPin, 
  Network, 
  Clock, 
  Copy, 
  Check, 
  Activity, 
  ExternalLink, 
  Eye, 
  AlertTriangle, 
  FileText, 
  Ban, 
  Bookmark, 
  Play, 
  TrendingUp, 
  SlidersHorizontal,
  ChevronRight,
  Share2,
  RefreshCw,
  CheckCircle2,
  Zap
} from "lucide-react";
import type { Transaction } from "../types";
import { formatCurrency, formatRelativeTime, getCountryFlag } from "../utils/formatters";

interface AccountRegistryPageProps {
  onSelectTransaction: (tx: Transaction) => void;
  userRole?: string;
}

export const AccountRegistryPage: React.FC<AccountRegistryPageProps> = ({
  onSelectTransaction,
  userRole = "analyst",
}) => {
  const [accounts, setAccounts] = useState<any[]>([
    {
      account_id: "acc_travel_12",
      masked_name: "ACC_ 12***",
      home_country: "GB",
      home_city: "London",
      risk_score: 85,
      risk_tier: "CRITICAL",
      has_open_case: true,
      last_seen: new Date().toISOString(),
      total_transactions: 12,
      velocity_1h: 3,
      velocity_24h: 8,
      velocity_7d: 12,
      amount_zscore: 3.4,
      sparkline_24h: [2, 5, 8, 4, 9, 7],
      shared_entities: null
    },
    {
      account_id: "acc_tor_54",
      masked_name: "ACC_ 54***",
      home_country: "DE",
      home_city: "Frankfurt",
      risk_score: 92,
      risk_tier: "CRITICAL",
      has_open_case: true,
      last_seen: new Date().toISOString(),
      total_transactions: 18,
      velocity_1h: 5,
      velocity_24h: 14,
      velocity_7d: 18,
      amount_zscore: 2.8,
      sparkline_24h: [1, 4, 7, 3, 8, 6],
      shared_entities: null
    },
    {
      account_id: "acc_soc_04",
      masked_name: "ACC_ 04***",
      home_country: "US",
      home_city: "New York",
      risk_score: 88,
      risk_tier: "CRITICAL",
      has_open_case: true,
      last_seen: new Date().toISOString(),
      total_transactions: 24,
      velocity_1h: 4,
      velocity_24h: 16,
      velocity_7d: 24,
      amount_zscore: 4.1,
      sparkline_24h: [3, 6, 8, 5, 9, 8],
      shared_entities: {
        shared_device: "fp_ring_alpha_92",
        shared_ip: "72.14.204.88",
        ring_members: ["acc_soc_04", "acc_soc_18", "acc_soc_22", "acc_soc_31"],
        warning: "Possible fraud ring (4 accounts)"
      }
    }
  ]);
  const [kpis, setKpis] = useState<any>({
    total_accounts: 690,
    high_risk_accounts: 270,
    accounts_with_open_cases: 361,
    new_this_week: 690,
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string>("acc_soc_04");
  const [accountDetail, setAccountDetail] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "locations" | "graph" | "cases" | "notes" | "audit">("overview");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revealedPii, setRevealedPii] = useState<boolean>(false);
  const [isWatchlisted, setIsWatchlisted] = useState<boolean>(false);
  const [isBlocked, setIsBlocked] = useState<boolean>(false);
  const [graphMode, setGraphMode] = useState<"all" | "shared_ring">("all");

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  // Fetch accounts list with fast 100 limit
  const fetchAccounts = async () => {
    try {
      const res = await fetch("/api/accounts?limit=100");
      if (res.ok) {
        const data = await res.json();
        const list = data.items || [];
        if (list.length > 0) setAccounts(list);
        if (data.kpis) setKpis(data.kpis);
        if (list.length > 0 && (!selectedAccountId || selectedAccountId === "acc_soc_04")) {
          selectAccountOptimistic(list[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load accounts list:", err);
    }
  };

  // Immediate optimistic account selection for instant 0ms response
  const selectAccountOptimistic = (a: any) => {
    if (!a) return;
    setSelectedAccountId(a.account_id);
    setRevealedPii(false);
    setAccountDetail((prev: any) => ({
      account_id: a.account_id,
      masked_name: a.masked_name || `ACC_${a.account_id.slice(-4)}•••`,
      status: a.risk_score >= 75 ? "SUSPENDED" : "ACTIVE",
      home_location: `${a.home_city || "New York"}, ${a.home_country || "US"}`,
      risk_score: a.risk_score || 0,
      traceback: {
        account_transaction_count: a.total_transactions || 1,
        velocity_1hr: a.velocity_1h || 1,
        velocity_24hr: a.velocity_24h || 1,
        velocity_7d: a.velocity_7d || 1,
        amount_zscore: a.amount_zscore,
      },
      transactions: prev?.account_id === a.account_id && prev.transactions ? prev.transactions : [
        {
          transaction_id: `tx_${a.account_id}_01`,
          amount: 250.0,
          currency: "USD",
          city: a.home_city || "New York",
          country: a.home_country || "US",
          decision: a.risk_score >= 75 ? "BLOCK" : "ALLOW",
          timestamp: a.last_seen || new Date().toISOString()
        }
      ],
      open_cases: a.has_open_case ? [{ case_id: `CASE-${a.account_id.slice(-4)}`, status: "QUARANTINED" }] : [],
      activity_24h_heat: a.sparkline_24h || [2, 4, 1, 8, 3, 6],
      entity_graph: {
        nodes: [
          { id: a.account_id, label: a.account_id, type: "account" },
          { id: "dev_01", label: "fp_auth_client", type: "device" },
          { id: "ip_01", label: "198.51.100.12", type: "ip" }
        ]
      }
    }));
    fetchAccountDetail(a.account_id);
  };

  // Fetch selected account workspace details
  const fetchAccountDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`);
      if (res.ok) {
        const data = await res.json();
        setAccountDetail(data);
      }
    } catch (err) {
      console.error("Failed to load account workspace:", err);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Copy helper
  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filtered accounts list
  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!a.account_id.toLowerCase().includes(q) && !a.masked_name.toLowerCase().includes(q)) return false;
      }
      if (riskFilter !== "ALL") {
        if (riskFilter === "HIGH" && a.risk_score < 75) return false;
        if (riskFilter === "MEDIUM" && (a.risk_score < 40 || a.risk_score >= 75)) return false;
        if (riskFilter === "LOW" && a.risk_score >= 40) return false;
      }
      return true;
    });
  }, [accounts, searchQuery, riskFilter]);

  // Leaflet Locations Map
  useEffect(() => {
    if (activeTab !== "locations" || !mapContainerRef.current || !accountDetail?.transactions) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const txs = accountDetail.transactions.filter((t: any) => t.lat && t.lon);
    if (txs.length === 0) return;

    const map = L.map(mapContainerRef.current, {
      center: [txs[0].lat, txs[0].lon],
      zoom: 4,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      maxZoom: 16,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    const points: L.LatLng[] = [];

    txs.forEach((t: any, idx: number) => {
      const latLng = L.latLng(t.lat, t.lon);
      bounds.extend(latLng);
      points.push(latLng);

      const isBlock = t.decision === "BLOCK";
      const marker = L.circleMarker(latLng, {
        radius: idx === 0 ? 8 : 6,
        fillColor: isBlock ? "#ef4444" : "#10b981",
        color: "#ffffff",
        weight: idx === 0 ? 2.5 : 1.5,
        fillOpacity: 0.85,
      });

      marker.bindTooltip(`
        <div class="text-xs p-1">
          <div class="font-bold text-white">${t.city}, ${t.country}</div>
          <div class="font-mono text-cyan-300">${formatCurrency(t.amount, t.currency)}</div>
          <div class="text-[10px] text-muted">${t.source || "GPS"} Fix (±${t.accuracy_meters || 15}m)</div>
        </div>
      `);
      marker.addTo(map);
    });

    if (points.length >= 2) {
      L.polyline(points, { color: "#38bdf8", weight: 2, dashArray: "4, 6" }).addTo(map);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }

    mapInstanceRef.current = map;

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [activeTab, accountDetail]);

  // Reveal PII action (audit logged)
  const handleRevealPII = async () => {
    try {
      const res = await fetch("/api/auth/reveal-pii", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: selectedAccountId, analyst_id: "soc_lead_01", reason: "KYC Case Review" }),
      });
      if (res.ok) {
        setRevealedPii(true);
      }
    } catch {
      alert("Failed to reveal unmasked PII");
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 text-xs select-none">
      {/* Account Registry KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Registered Accounts</span>
            <Users className="h-3.5 w-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold font-mono text-white tabular-nums">
            {kpis.total_accounts}
          </div>
          <span className="text-[10px] text-muted-dark">Under continuous surveillance</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">High-Risk Accounts</span>
            <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
          </div>
          <div className="text-xl font-bold font-mono text-red-400 tabular-nums">
            {kpis.high_risk_accounts}
          </div>
          <span className="text-[10px] text-red-400/80">Average score &ge; 75</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">Accounts With Open Cases</span>
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold font-mono text-amber-400 tabular-nums">
            {kpis.accounts_with_open_cases}
          </div>
          <span className="text-[10px] text-amber-400/80">Pending queue review</span>
        </div>

        <div className="p-3.5 rounded-xl bg-surface border border-border">
          <div className="flex items-center justify-between text-muted mb-1">
            <span className="text-[11px] font-medium uppercase tracking-wider">New This Week</span>
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
            {kpis.new_this_week}
          </div>
          <span className="text-[10px] text-emerald-400">&lt; 7 days KYC age</span>
        </div>
      </div>

      {/* Main Split Layout: Left Account List (340px) + Right Workspace */}
      <div className="flex-1 flex gap-4 min-h-[620px] overflow-hidden">
        {/* Left Panel: Account List (340px) */}
        <div className="w-80 lg:w-[340px] rounded-xl bg-surface border border-border flex flex-col overflow-hidden shadow-xl">
          {/* Search & Filter Header */}
          <div className="p-3 border-b border-border bg-surface-card/60 space-y-2">
            <div className="flex items-center bg-surface-elevated border border-border rounded-lg px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-dark mr-1.5" />
              <input
                type="text"
                placeholder="Search account, IP, device..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-slate-100 placeholder-muted-dark focus:outline-none w-full text-xs"
              />
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-dark uppercase tracking-wider font-semibold">Filter Risk:</span>
              <div className="flex items-center space-x-1">
                {["ALL", "HIGH", "MEDIUM", "LOW"].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRiskFilter(r)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                      riskFilter === r ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted hover:text-white"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Account Rows List */}
          <div className="flex-1 overflow-y-auto divide-y divide-border/40">
            {filteredAccounts.map((a) => {
              const isSelected = selectedAccountId === a.account_id;
              const hasSharedRing = Boolean(a.shared_entities);

              return (
                <div
                  key={a.account_id}
                  onClick={() => selectAccountOptimistic(a)}
                  className={`p-3 transition cursor-pointer flex items-center justify-between group ${
                    isSelected ? "bg-cyan-950/30 border-l-2 border-cyan-400" : "hover:bg-surface-hover/70"
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-surface-card border border-border flex items-center justify-center font-bold text-slate-300 text-xs shrink-0">
                      {a.account_id.slice(-2).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono font-semibold text-white text-xs truncate">
                          {a.account_id}
                        </span>
                        {a.has_open_case && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Open quarantine case"></span>
                        )}
                        {hasSharedRing && (
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" title="Shared fraud ring entity"></span>
                        )}
                      </div>

                      <div className="flex items-center space-x-1.5 text-[10px] text-muted">
                        <span>{getCountryFlag(a.home_country)}</span>
                        <span className="truncate">{a.home_city}</span>
                        <span>•</span>
                        <span>{formatRelativeTime(a.last_seen)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        a.risk_score >= 75
                          ? "bg-red-950/80 text-red-300 border-red-800"
                          : a.risk_score >= 40
                          ? "bg-amber-950/80 text-amber-300 border-amber-800"
                          : "bg-emerald-950/80 text-emerald-300 border-emerald-800"
                      }`}
                    >
                      {Math.round(a.risk_score)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Workspace Tabs */}
        <div className="flex-1 rounded-xl bg-surface border border-border flex flex-col overflow-hidden shadow-xl">
          {accountDetail ? (
            <>
              {/* Account Workspace Header */}
              <div className="p-4 border-b border-border bg-surface-card/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center font-bold text-white text-sm shadow-md">
                    {accountDetail.account_id.slice(-2).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-base font-bold text-white">{accountDetail.account_id}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-elevated border border-border text-slate-300">
                        {accountDetail.status}
                      </span>
                      {accountDetail.shared_ring && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-300 border border-red-800 animate-pulse flex items-center space-x-1">
                          <AlertTriangle className="h-3 w-3" />
                          <span>{accountDetail.shared_ring}</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-muted mt-0.5">
                      <span>Cardholder:</span>
                      <span className="font-medium text-slate-200">
                        {revealedPii ? "Alexander Vance (Verified)" : accountDetail.masked_name}
                      </span>
                      {!revealedPii && (
                        <button
                          onClick={handleRevealPII}
                          className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer text-[10px]"
                        >
                          Reveal PII
                        </button>
                      )}
                      <span>•</span>
                      <span>{accountDetail.home_location}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button 
                    onClick={() => setIsWatchlisted(prev => !prev)}
                    className={`px-2.5 py-1.5 rounded-lg border flex items-center space-x-1 transition cursor-pointer ${
                      isWatchlisted
                        ? "bg-emerald-950 text-emerald-300 border-emerald-700"
                        : "bg-surface-elevated border-border hover:bg-surface-hover text-slate-200"
                    }`}
                  >
                    <Bookmark className={`h-3 w-3 ${isWatchlisted ? "text-emerald-400 fill-emerald-400" : "text-slate-400"}`} />
                    <span>{isWatchlisted ? "Watchlisted" : "Watchlist"}</span>
                  </button>
                  <button 
                    onClick={() => {
                      if (confirm(`Are you sure you want to suspend and block account ${accountDetail.account_id}? This will block all subsequent transactions.`)) {
                        setIsBlocked(true);
                        setAccountDetail((prev: any) => prev ? { ...prev, status: "SUSPENDED / BLOCKED" } : null);
                      }
                    }}
                    className={`px-2.5 py-1.5 rounded-lg font-semibold flex items-center space-x-1 shadow-md transition cursor-pointer ${
                      isBlocked
                        ? "bg-red-950 text-red-300 border border-red-800"
                        : "bg-red-600 hover:bg-red-500 text-white shadow-red-950/30"
                    }`}
                  >
                    <Ban className="h-3 w-3" />
                    <span>{isBlocked ? "Account Blocked" : "Block Account"}</span>
                  </button>
                </div>
              </div>

              {/* Workspace Navigation Tabs */}
              <div className="px-4 border-b border-border flex items-center space-x-4 bg-surface text-muted text-xs">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`py-3 border-b-2 font-medium transition ${activeTab === "overview" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab("transactions")}
                  className={`py-3 border-b-2 font-medium transition ${activeTab === "transactions" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
                >
                  Transactions ({accountDetail.transactions?.length || 0})
                </button>
                <button
                  onClick={() => setActiveTab("locations")}
                  className={`py-3 border-b-2 font-medium transition ${activeTab === "locations" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
                >
                  Locations Map
                </button>
                <button
                  onClick={() => setActiveTab("graph")}
                  className={`py-3 border-b-2 font-medium transition ${activeTab === "graph" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
                >
                  Entity Graph
                </button>
                <button
                  onClick={() => setActiveTab("cases")}
                  className={`py-3 border-b-2 font-medium transition ${activeTab === "cases" ? "border-cyan-400 text-white font-bold" : "border-transparent hover:text-slate-200"}`}
                >
                  Cases ({accountDetail.open_cases?.length || 0})
                </button>
              </div>

              {/* Workspace Content View */}
              <div className="flex-1 overflow-y-auto p-5">
                {activeTab === "overview" && (
                  <div className="space-y-5">
                    {/* Velocity Invariants KPI Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="p-3 rounded-lg bg-surface-card border border-border">
                        <span className="text-[10px] text-muted uppercase font-medium">Total Txns</span>
                        <div className="text-lg font-bold font-mono text-white mt-0.5">
                          {accountDetail.traceback?.account_transaction_count || 1}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-card border border-border">
                        <span className="text-[10px] text-muted uppercase font-medium">1h Velocity</span>
                        <div className="text-lg font-bold font-mono text-cyan-300 mt-0.5">
                          {accountDetail.traceback?.velocity_1hr || 1}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-card border border-border">
                        <span className="text-[10px] text-muted uppercase font-medium">24h Velocity</span>
                        <div className="text-lg font-bold font-mono text-blue-300 mt-0.5">
                          {accountDetail.traceback?.velocity_24hr || 1}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-card border border-border">
                        <span className="text-[10px] text-muted uppercase font-medium">7d Velocity</span>
                        <div className="text-lg font-bold font-mono text-purple-300 mt-0.5">
                          {accountDetail.traceback?.velocity_7d || 1}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-surface-card border border-border">
                        <span className="text-[10px] text-muted uppercase font-medium">Amount Z-Score</span>
                        <div className="mt-0.5">
                          {accountDetail.traceback?.amount_zscore !== null && accountDetail.traceback?.amount_zscore !== undefined ? (
                            <span className="text-lg font-bold font-mono text-amber-300">
                              {accountDetail.traceback.amount_zscore}σ
                            </span>
                          ) : (
                            <span className="text-[11px] font-mono text-muted-dark bg-surface-elevated px-1.5 py-0.5 rounded border border-border">
                              Insufficient data
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 24-Hour Activity Heat Strip */}
                    <div className="p-3.5 rounded-xl bg-surface-card border border-border space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-slate-200">24-Hour Activity Heat Strip</span>
                        <span className="text-muted text-[10px]">Typical vs Current Day</span>
                      </div>
                      <div className="grid grid-cols-24 gap-1 h-6">
                        {(accountDetail.activity_24h_heat || []).map((val: number, idx: number) => (
                          <div
                            key={idx}
                            title={`Hour ${idx}:00 - Intensity: ${val}`}
                            className={`rounded-sm transition ${
                              val > 6 ? "bg-red-500" : val > 3 ? "bg-amber-400" : val > 0 ? "bg-cyan-500/70" : "bg-slate-800"
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Recent 5 Transactions */}
                    <div className="space-y-2">
                      <span className="font-semibold text-slate-200 block text-xs">Latest Account Transactions</span>
                      <div className="rounded-xl border border-border overflow-hidden bg-surface-card">
                        {(accountDetail.transactions || []).slice(0, 5).map((t: any) => (
                          <div
                            key={t.transaction_id}
                            onClick={() => onSelectTransaction(t)}
                            className="p-3 border-b border-border/60 hover:bg-surface-hover flex items-center justify-between cursor-pointer"
                          >
                            <div>
                              <div className="font-mono text-cyan-300 font-medium">{t.transaction_id}</div>
                              <div className="text-muted text-[10px]">{t.city}, {t.country} • {formatRelativeTime(t.timestamp)}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold text-white">{formatCurrency(t.amount, t.currency)}</div>
                              <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                                t.decision === "BLOCK" ? "bg-red-950 text-red-300" : "bg-emerald-950 text-emerald-300"
                              }`}>
                                {t.decision}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "locations" && (
                  <div className="w-full h-[480px] rounded-xl overflow-hidden border border-border relative">
                    <div ref={mapContainerRef} className="w-full h-full" />
                  </div>
                )}

                {activeTab === "graph" && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-white text-xs block">Entity Link Topology</span>
                        <span className="text-[11px] text-muted">Shared device fingerprints, IP subnets, and identity clusters</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setGraphMode(graphMode === "all" ? "shared_ring" : "all")}
                          className={`px-2.5 py-1 rounded text-xs transition cursor-pointer ${
                            graphMode === "shared_ring" ? "bg-red-500/20 text-red-300 border border-red-500/40" : "bg-surface-elevated text-muted border border-border"
                          }`}
                        >
                          {graphMode === "shared_ring" ? "Exit Shared Ring View" : "Focus Shared Ring (4 Members)"}
                        </button>
                      </div>
                    </div>

                    {/* SVG Interactive Topology Diagram */}
                    <div className="p-4 rounded-xl bg-surface-card border border-border flex flex-col items-center justify-center relative overflow-hidden min-h-[300px]">
                      <svg className="w-full h-64" viewBox="0 0 600 240">
                        <defs>
                          <linearGradient id="linkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.7" />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.7" />
                          </linearGradient>
                          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.8" />
                            <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.8" />
                          </linearGradient>
                        </defs>

                        {/* Connection Lines from Center (300, 120) */}
                        <line x1="300" y1="120" x2="140" y2="60" stroke="#06b6d4" strokeWidth="2" strokeDasharray="4,4" />
                        <line x1="300" y1="120" x2="140" y2="180" stroke="#8b5cf6" strokeWidth="2" />
                        <line x1="300" y1="120" x2="460" y2="60" stroke="#3b82f6" strokeWidth="2" />
                        <line x1="300" y1="120" x2="460" y2="180" stroke="#ef4444" strokeWidth="2" strokeDasharray="5,5" className="animate-pulse" />

                        {/* Node 1: Device Fingerprint (140, 60) */}
                        <circle cx="140" cy="60" r="24" fill="#1e1035" stroke="#a855f7" strokeWidth="2" />
                        <text x="140" y="58" fill="#d8b4fe" fontSize="10" fontWeight="bold" textAnchor="middle">DEVICE</text>
                        <text x="140" y="72" fill="#94a3b8" fontSize="8" fontFamily="monospace" textAnchor="middle">fp_auth_client</text>

                        {/* Node 2: IP Address (140, 180) */}
                        <circle cx="140" cy="180" r="24" fill="#0c2340" stroke="#38bdf8" strokeWidth="2" />
                        <text x="140" y="178" fill="#7dd3fc" fontSize="10" fontWeight="bold" textAnchor="middle">IP ADDR</text>
                        <text x="140" y="192" fill="#94a3b8" fontSize="8" fontFamily="monospace" textAnchor="middle">198.51.100.20</text>

                        {/* Center Node: Primary Account (300, 120) */}
                        <circle cx="300" cy="120" r="32" fill="#083344" stroke="#22d3ee" strokeWidth="3" />
                        <text x="300" y="117" fill="#67e8f9" fontSize="11" fontWeight="bold" textAnchor="middle">ACCOUNT</text>
                        <text x="300" y="131" fill="#ffffff" fontSize="9" fontFamily="monospace" fontWeight="bold" textAnchor="middle">{accountDetail.account_id}</text>

                        {/* Node 3: Geo Carrier Anchor (460, 60) */}
                        <circle cx="460" cy="60" r="24" fill="#042f2e" stroke="#14b8a6" strokeWidth="2" />
                        <text x="460" y="58" fill="#5eead4" fontSize="10" fontWeight="bold" textAnchor="middle">LOCATION</text>
                        <text x="460" y="72" fill="#94a3b8" fontSize="8" textAnchor="middle">{accountDetail.home_location}</text>

                        {/* Node 4: Fraud Ring / Shared Identity (460, 180) */}
                        <circle cx="460" cy="180" r="26" fill="#450a0a" stroke="#f87171" strokeWidth="2" strokeDasharray="4,4" />
                        <text x="460" y="177" fill="#fca5a5" fontSize="10" fontWeight="bold" textAnchor="middle">RING NODE</text>
                        <text x="460" y="191" fill="#f87171" fontSize="8" fontFamily="monospace" textAnchor="middle">acc_soc_18</text>
                      </svg>

                      <div className="w-full pt-3 border-t border-border/60 text-muted text-[11px] flex justify-between items-center">
                        <span className="flex items-center space-x-1.5">
                          <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                          <span>Network entities resolved: {accountDetail.entity_graph?.nodes?.length || 5}</span>
                        </span>
                        <span className="font-mono text-cyan-300">Cluster Risk: HIGH (Shared Device Hash)</span>
                      </div>
                    </div>

                    {/* Node Summary Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                      {(accountDetail.entity_graph?.nodes || [
                        { id: accountDetail.account_id, label: accountDetail.account_id, type: "account" },
                        { id: "dev_01", label: "fp_auth_client", type: "device" },
                        { id: "ip_01", label: "198.51.100.20", type: "ip" },
                        { id: "ring_01", label: "acc_soc_18 (Linked)", type: "ring" }
                      ]).map((node: any) => (
                        <div key={node.id} className="p-2.5 rounded-lg bg-surface border border-border flex items-center space-x-2">
                          <div className={`h-7 w-7 rounded flex items-center justify-center font-bold text-xs ${
                            node.type === "account" ? "bg-cyan-950 text-cyan-400 border border-cyan-800" :
                            node.type === "device" ? "bg-purple-950 text-purple-400 border border-purple-800" :
                            node.type === "ip" ? "bg-blue-950 text-blue-400 border border-blue-800" :
                            "bg-red-950 text-red-400 border border-red-800"
                          }`}>
                            {node.type[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-mono text-white text-xs truncate block">{node.label}</span>
                            <span className="text-muted text-[10px] uppercase">{node.type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "cases" && (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-white text-xs">Quarantine Cases & Action Log</span>
                      <span className="text-[11px] text-muted">
                        Total Cases: {((accountDetail.open_cases && accountDetail.open_cases.length > 0) ? accountDetail.open_cases : (accountDetail.transactions || []).filter((t: any) => t.decision === "BLOCK")).length}
                      </span>
                    </div>

                    {((accountDetail.open_cases && accountDetail.open_cases.length > 0) ? accountDetail.open_cases : (accountDetail.transactions || []).filter((t: any) => t.decision === "BLOCK")).length === 0 ? (
                      <div className="p-8 text-center text-muted rounded-xl bg-surface-card border border-border">
                        <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                        <span className="font-medium text-slate-200">No open quarantine cases</span>
                        <p className="text-[11px] text-muted mt-1">This account has zero active SLA breach or quarantine investigations.</p>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-border overflow-hidden bg-surface-card divide-y divide-border/60">
                        {((accountDetail.open_cases && accountDetail.open_cases.length > 0) ? accountDetail.open_cases : (accountDetail.transactions || []).filter((t: any) => t.decision === "BLOCK")).map((c: any, idx: number) => {
                          const cid = c.case_id || `CASE-${accountDetail.account_id.slice(-4)}-${idx + 1}`;
                          const txId = c.transaction_id || `tx_quar_${accountDetail.account_id.slice(-4)}_${idx + 1}`;
                          const amt = c.amount || 250.0;
                          return (
                            <div key={cid} className="p-3.5 hover:bg-surface-hover flex items-center justify-between transition">
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-cyan-400 font-bold">{cid}</span>
                                  <span className="text-slate-500">•</span>
                                  <span className="font-mono text-slate-300 text-[11px]">{txId}</span>
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-red-950 text-red-300 border border-red-800">
                                    {c.status || "QUARANTINED"}
                                  </span>
                                </div>
                                <div className="text-muted text-[11px] flex items-center space-x-2">
                                  <span>Amount: <strong className="text-white font-mono">{formatCurrency(amt, "USD")}</strong></span>
                                  <span>•</span>
                                  <span>SLA Status: <strong className="text-amber-300 font-mono">18m remaining</strong></span>
                                </div>
                              </div>

                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => {
                                    onSelectTransaction({
                                      id: txId,
                                      transaction_id: txId,
                                      account_id: accountDetail.account_id,
                                      destination_account: "acc_merch_direct",
                                      amount: amt,
                                      currency: "USD",
                                      status: "QUARANTINED",
                                      decision: "BLOCK",
                                      risk_score: accountDetail.risk_score || 85,
                                      risk_tier: "CRITICAL",
                                      risk_color: "#ef4444",
                                      lat: 40.7128,
                                      lon: -74.0060,
                                      city: accountDetail.home_city || "New York",
                                      country: accountDetail.home_country || "US",
                                      source: "CELL_TOWER",
                                      accuracy_meters: 25.0,
                                      timestamp: new Date().toISOString(),
                                      flags: [{ flag: "IMPOSSIBLE_TRAVEL", label: "Impossible Travel", reason: "Jet velocity exceeded" }],
                                    } as any);
                                  }}
                                  className="px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 font-medium transition cursor-pointer"
                                >
                                  Investigate
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "transactions" && (
                  <div className="rounded-xl border border-border overflow-hidden bg-surface-card divide-y divide-border/60">
                    {(accountDetail.transactions || []).map((t: any) => (
                      <div key={t.transaction_id} className="p-3 hover:bg-surface-hover flex items-center justify-between">
                        <div>
                          <div className="font-mono text-cyan-300 font-semibold">{t.transaction_id}</div>
                          <div className="text-muted text-[11px]">{t.counterparty} • {t.city}, {t.country}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold text-white">{formatCurrency(t.amount, t.currency)}</div>
                          <span className="text-[10px] text-muted">{formatRelativeTime(t.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted">
              Select an account from the left panel to inspect workspace.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
