import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { KPIBar } from "./components/KPIBar";
import { LiveIngestionTable } from "./components/LiveIngestionTable";
import { ThreatMap } from "./components/ThreatMap";
import { QuarantinePage } from "./components/QuarantinePage";
import { AccountRegistryPage } from "./components/AccountRegistryPage";
import { SOCAnalyticsPage } from "./components/SOCAnalyticsPage";
import { RulesConfigPage } from "./components/RulesConfigPage";
import { TransactionDetailDrawer } from "./components/TransactionDetailDrawer";
import { CommandPalette } from "./components/CommandPalette";
import type { Transaction, SystemStats } from "./types";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"ingestion" | "map" | "quarantine" | "accounts" | "analytics" | "config">("ingestion");
  const [userRole, setUserRole] = useState<string>("analyst");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [latestTxId, setLatestTxId] = useState<string | null>(null);
  const [newEventsCount, setNewEventsCount] = useState<number>(0);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<{ key: string; val: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const reconnectAttemptRef = useRef<number>(0);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Fetch initial stats & transactions
  const fetchData = useCallback(async () => {
    try {
      const [statsRes, mapRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/map/transactions?limit=400"),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (mapRes.ok) {
        const mapData = await mapRes.json();
        if (mapData.items) {
          setTransactions(mapData.items);
        }
      }
    } catch (err) {
      console.error("Failed to load initial console telemetry:", err);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Connect SSE
  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      reconnectAttemptRef.current = 0;
      setStats((prev) => prev ? { ...prev, stream_state: "LIVE", stream_active: true } : null);
    };

    es.addEventListener("transaction", (event: MessageEvent) => {
      try {
        const rawTx = JSON.parse(event.data);
        const txId = rawTx.transaction_id || rawTx.txn_id || `tx_${Date.now()}`;

        const newTx: Transaction = {
          id: txId,
          transaction_id: txId,
          account_id: rawTx.account_id || rawTx.source_account || "acc_sim",
          destination_account: rawTx.destination_account || "acc_merch_direct",
          amount: parseFloat(rawTx.amount || 0),
          currency: rawTx.currency || "USD",
          status: rawTx.status || (rawTx.decision === "BLOCK" ? "QUARANTINED" : "APPROVED"),
          decision: rawTx.decision || "ALLOW",
          risk_score: parseFloat(rawTx.risk_score || rawTx.score || 0),
          risk_tier: rawTx.risk_score >= 80 ? "CRITICAL" : rawTx.risk_score >= 40 ? "ELEVATED" : "NOMINAL",
          risk_color: rawTx.risk_score >= 80 ? "#ef4444" : rawTx.risk_score >= 40 ? "#f59e0b" : "#10b981",
          lat: rawTx.lat || 40.7128,
          lon: rawTx.lon || -74.0060,
          city: rawTx.transaction_city || (rawTx.origin || {}).city || "New York",
          country: rawTx.transaction_country || (rawTx.origin || {}).country || "US",
          source: rawTx.fix_source || "CELL_TOWER",
          accuracy_meters: rawTx.accuracy_meters || 25.0,
          timestamp: rawTx.timestamp || new Date().toISOString(),
          counterparty: rawTx.counterparty || "Direct Payment Processing",
          merchant_category: rawTx.merchant_category || "General Services",
          channel: rawTx.channel || "MOBILE_APP",
          tower: rawTx.cell_tower || {
            tower_id: "310-410-4821-29401",
            carrier: "AT&T Mobility",
            mcc: 310,
            mnc: 410,
            lac: 4821,
            cid: 29401,
            lat: rawTx.lat || 40.7142,
            lon: rawTx.lon || -74.0081,
            distance_meters: 240.0,
            distance_km: 0.24,
            accuracy_meters: 35.0,
            timestamp_fix: rawTx.timestamp || new Date().toISOString(),
            badge: "SIMULATED",
          },
          flags: (rawTx.flags || []).map((f: string) => ({
            flag: f,
            label: f.replace(/_/g, " "),
            reason: `Risk heuristic violation: ${f}`,
          })),
          badge: "SIMULATED",
        };

        setLatestTxId(txId);
        setNewEventsCount((prev) => prev + 1);

        setTransactions((prev) => {
          const updated = [newTx, ...prev.filter((t) => t.transaction_id !== txId)];
          return updated.slice(0, 800);
        });

        setStats((prev) => {
          if (!prev) return null;
          const isBlocked = newTx.decision === "BLOCK" || newTx.status === "QUARANTINED";
          const newTotal = prev.total_events + 1;
          const newBlocked = prev.blocked_count + (isBlocked ? 1 : 0);
          return {
            ...prev,
            total_events: newTotal,
            total_processed: newTotal,
            blocked_count: newBlocked,
            block_rate_pct: Math.round((newBlocked / newTotal) * 1000) / 10,
            quarantine_backlog: prev.quarantine_backlog + (isBlocked ? 1 : 0),
          };
        });
      } catch (err) {
        console.error("Error parsing incoming SSE transaction:", err);
      }
    });

    es.onerror = () => {
      es.close();
      const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttemptRef.current));
      reconnectAttemptRef.current += 1;
      setStats((prev) => prev ? { ...prev, stream_state: "RECONNECTING" } : null);
      reconnectTimeoutRef.current = setTimeout(connectSSE, delay);
    };
  }, []);

  useEffect(() => {
    connectSSE();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connectSSE]);

  const handleSelectTransaction = async (tx: Transaction) => {
    setSelectedTx(tx);
    try {
      const res = await fetch(`/api/map/transactions/${tx.transaction_id}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedTx(detail);
      }
    } catch {
      // Keep optimistic
    }
  };

  const handleBlockAction = async (txId: string) => {
    try {
      const res = await fetch(`/api/quarantine/${txId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONFIRM_FRAUD", analyst_id: "soc_lead_01", reason: "SOC Manual Block" }),
      });
      if (res.ok) {
        showToast(`Transaction ${txId.slice(0, 10)} blocked`);
        fetchData();
        if (selectedTx && selectedTx.transaction_id === txId) {
          setSelectedTx((prev) => prev ? { ...prev, decision: "BLOCK", status: "QUARANTINED" } : null);
        }
      }
    } catch {
      showToast("Failed to execute block action.");
    }
  };

  const handleReleaseAction = async (txId: string) => {
    try {
      const res = await fetch("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: txId, analyst_notes: "Released by SOC Operator" }),
      });
      if (res.ok) {
        showToast(`Transaction ${txId.slice(0, 10)} released`);
        fetchData();
        if (selectedTx && selectedTx.transaction_id === txId) {
          setSelectedTx((prev) => prev ? { ...prev, decision: "ALLOW", status: "RELEASED" } : null);
        }
      }
    } catch {
      showToast("Failed to execute release action.");
    }
  };

  const handleTriggerScenario = async (scenario: string) => {
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      if (res.ok) {
        showToast(`Fired ${scenario} simulation scenario`);
        fetchData();
      }
    } catch {
      showToast("Failed to inject simulation scenario.");
    }
  };

  const handleToggleSimulator = async (running: boolean, tps: number) => {
    try {
      const res = await fetch("/api/simulator/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running, tps }),
      });
      if (res.ok) {
        await res.json();
        showToast(running ? `Background stream active (${tps} TPS)` : "Background stream paused");
        setStats((prev) => prev ? { ...prev, stream_active: running, tps: running ? tps : 0.0, stream_state: running ? "LIVE" : "OFF" } : null);
      }
    } catch {
      showToast("Failed to toggle simulator state.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col font-sans">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg bg-surface-card border border-cyan-500/50 shadow-2xl text-xs font-medium text-cyan-200 flex items-center space-x-2 animate-fade-in">
          <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Global Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        transactions={transactions}
        onSelectTransaction={handleSelectTransaction}
        setActiveTab={setActiveTab}
        onTriggerScenario={handleTriggerScenario}
      />

      {/* Application Header */}
      <Header
        stats={stats}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onTriggerScenario={handleTriggerScenario}
        onToggleSimulator={handleToggleSimulator}
        userRole={userRole}
        setUserRole={setUserRole}
      />

      {/* Main View Container */}
      <main className="flex-1 p-6 flex flex-col max-w-[1920px] w-full mx-auto overflow-hidden">
        {/* Render Global KPI Bar ONLY on Live Ingestion and Threat Map */}
        {(activeTab === "ingestion" || activeTab === "map") && (
          <KPIBar
            stats={stats}
            activeFilter={activeFilter}
            onFilterClick={(key, val) => {
              if (activeFilter?.val === val) {
                setActiveFilter(null);
              } else {
                setActiveFilter({ key, val });
              }
            }}
          />
        )}

        {/* View Switch */}
        {activeTab === "ingestion" && (
          <LiveIngestionTable
            transactions={transactions}
            onSelectTransaction={handleSelectTransaction}
            selectedTxId={selectedTx?.transaction_id || null}
            newEventsCount={newEventsCount}
            onClearNewEventsCount={() => setNewEventsCount(0)}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          />
        )}

        {activeTab === "map" && (
          <ThreatMap
            transactions={transactions}
            onSelectTransaction={handleSelectTransaction}
            selectedTxId={selectedTx?.transaction_id || null}
            latestTxId={latestTxId}
          />
        )}

        {activeTab === "quarantine" && (
          <QuarantinePage
            onSelectTransaction={handleSelectTransaction}
            selectedTxId={selectedTx?.transaction_id || null}
            userRole={userRole}
          />
        )}

        {activeTab === "accounts" && (
          <AccountRegistryPage
            onSelectTransaction={handleSelectTransaction}
            userRole={userRole}
          />
        )}

        {activeTab === "analytics" && (
          <SOCAnalyticsPage />
        )}

        {activeTab === "config" && (
          <RulesConfigPage userRole={userRole} />
        )}
      </main>

      {/* Transaction Detail Slide-In Drawer */}
      {selectedTx && (
        <TransactionDetailDrawer
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onBlockAction={handleBlockAction}
          onReleaseAction={handleReleaseAction}
          onReplayPath={() => setActiveTab("map")}
        />
      )}
    </div>
  );
};
