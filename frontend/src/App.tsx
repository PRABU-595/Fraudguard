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
  const [replayAccount, setReplayAccount] = useState<string | null>(null);
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

  // Fetch initial stats & lightweight seed transactions (100 events, ~30KB)
  const fetchData = useCallback(async () => {
    try {
      const [statsRes, mapRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/map/transactions?limit=100"),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }

      if (mapRes.ok) {
        const mapData = await mapRes.json();
        if (mapData.items) {
          setTransactions((mapData.items || []).slice(0, 100));
        }
      }
    } catch (err) {
      console.error("Failed to load initial console telemetry:", err);
    }
  }, []);

  // Poll only lightweight stats (300 bytes) every 10s - never re-download thousands of events
  useEffect(() => {
    fetchData();
    const interval = setInterval(async () => {
      try {
        const statsRes = await fetch("/api/stats");
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }
      } catch {}
    }, 10000);
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
          return updated.slice(0, 100);
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

  const handleBlockAction = async (txId: string, txData?: any) => {
    const targetTx = txData || selectedTx;
    
    // 1. Optimistic Multi-Surface Update: Instant 0ms visual feedback everywhere
    setTransactions((prev) =>
      prev.map((t) =>
        t.transaction_id === txId || t.id === txId
          ? {
              ...t,
              decision: "BLOCK",
              status: "QUARANTINED",
              risk_score: Math.max(t.risk_score || 0, 88),
              risk_tier: "CRITICAL",
              risk_color: "#ef4444",
              flags: Array.isArray(t.flags) && t.flags.some((f: any) => (typeof f === "string" ? f : f.flag) === "MANUAL_SOC_BLOCK")
                ? t.flags
                : [...(t.flags || []), { flag: "MANUAL_SOC_BLOCK", label: "Manual SOC Block", reason: "Blocked and quarantined by SOC operator" }],
            }
          : t
      )
    );

    setSelectedTx((prev) =>
      prev && (prev.transaction_id === txId || prev.id === txId)
        ? {
            ...prev,
            decision: "BLOCK",
            status: "QUARANTINED",
            risk_score: Math.max(prev.risk_score || 0, 88),
            risk_tier: "CRITICAL",
            risk_color: "#ef4444",
          }
        : prev
    );

    setStats((prev) => {
      if (!prev) return null;
      const newBlocked = (prev.blocked_count || 0) + 1;
      const total = (prev as any).total_events || (prev as any).total_ingested || 1;
      const newBacklog = (prev.quarantine_backlog || 0) + 1;
      return {
        ...prev,
        blocked_count: newBlocked,
        quarantine_backlog: newBacklog,
        block_rate_pct: Math.round((newBlocked / total) * 1000) / 10,
      };
    });

    try {
      // 2. Persist to Backend with full authentication & transaction payload
      const res = await fetch(`/api/quarantine/${txId}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "admin-token-2026",
          "X-User-Role": "admin",
          "X-Analyst-ID": "soc_lead_01",
        },
        body: JSON.stringify({
          action: "CONFIRM_FRAUD",
          analyst_id: "soc_lead_01",
          reason: "SOC Manual Block & Quarantine",
          notes: "Manual block triggered from telemetry drawer",
          transaction: targetTx,
        }),
      });

      if (!res.ok) {
        await fetch("/api/block", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": "admin-token-2026",
          },
          body: JSON.stringify({
            transaction_id: txId,
            transaction: targetTx,
            reason: "Manual Block",
          }),
        });
      }
      showToast(`Transaction ${txId.slice(0, 12)} blocked & quarantined`);
      fetchData();
    } catch {
      showToast(`Transaction ${txId.slice(0, 12)} blocked locally`);
    }
  };

  const handleReleaseAction = async (txId: string) => {
    // 1. Optimistic update
    setTransactions((prev) =>
      prev.map((t) =>
        t.transaction_id === txId || t.id === txId
          ? { ...t, decision: "ALLOW", status: "RELEASED" }
          : t
      )
    );
    setSelectedTx((prev) =>
      prev && (prev.transaction_id === txId || prev.id === txId)
        ? { ...prev, decision: "ALLOW", status: "RELEASED" }
        : prev
    );
    setStats((prev) => {
      if (!prev) return null;
      const newBlocked = Math.max(0, (prev.blocked_count || 1) - 1);
      const total = (prev as any).total_events || (prev as any).total_ingested || 1;
      const newBacklog = Math.max(0, (prev.quarantine_backlog || 1) - 1);
      return {
        ...prev,
        blocked_count: newBlocked,
        quarantine_backlog: newBacklog,
        block_rate_pct: Math.round((newBlocked / total) * 1000) / 10,
      };
    });

    try {
      const res = await fetch("/api/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "admin-token-2026",
          "X-User-Role": "admin",
        },
        body: JSON.stringify({ transaction_id: txId, analyst_notes: "Released by SOC Operator" }),
      });
      if (res.ok) {
        showToast(`Transaction ${txId.slice(0, 12)} released`);
        fetchData();
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
        body: JSON.stringify({ scenario, preset: scenario }),
      });
      if (res.ok) {
        const simData = await res.json();
        showToast(`Fired ${scenario} simulation scenario`);
        if (simData.result) {
          const rawTx = simData.result;
          const txId = rawTx.transaction_id || `tx_sim_${Date.now()}`;
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
            city: rawTx.transaction_city || "New York",
            country: rawTx.transaction_country || "US",
            source: "CELL_TOWER",
            accuracy_meters: 25.0,
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
              lat: 40.7142,
              lon: -74.0081,
              distance_meters: 240.0,
              distance_km: 0.24,
              accuracy_meters: 35.0,
              timestamp_fix: new Date().toISOString(),
              badge: "SIMULATED",
            },
            flags: (rawTx.flags || []).map((f: string) => ({
              flag: f,
              label: f.replace(/_/g, " "),
              reason: `Risk heuristic violation: ${f}`,
            })),
            badge: "SIMULATED",
          };
          setTransactions((prev) => [newTx, ...prev.filter((t) => t.transaction_id !== txId)].slice(0, 100));
        }
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
        body: JSON.stringify({ running, active: running, tps }),
      });
      if (res.ok) {
        const data = await res.json();
        const active = data.active !== undefined ? Boolean(data.active) : (data.is_running !== undefined ? Boolean(data.is_running) : running);
        showToast(active ? `Background stream active (${tps} TPS)` : "Background stream paused");
        setStats((prev) => prev ? { ...prev, stream_active: active, tps: active ? tps : 0.0, stream_state: active ? "LIVE" : "OFF" } : null);
      }
    } catch {
      showToast("Failed to toggle simulator state.");
    }
  };

  return (
    <div className={`bg-background text-slate-100 flex flex-col font-sans ${activeTab === "map" ? "h-screen overflow-hidden" : "min-h-screen"}`}>
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
        environment={stats?.environment || "Demo"}
      />

      {/* Main View Container */}
      <main className={`flex-1 flex flex-col max-w-[1920px] w-full mx-auto overflow-hidden ${activeTab === "map" ? "p-3 pb-3 h-[calc(100vh-4rem)] min-h-0" : "p-6"}`}>
        {/* Render Global KPI Bar ONLY on Live Ingestion and Threat Map */}
        {(activeTab === "ingestion" || activeTab === "map") && (
          <KPIBar
            stats={stats}
            activeFilter={activeFilter}
            isMapTab={activeTab === "map"}
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
            replayingAccountId={replayAccount}
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
          <RulesConfigPage 
            userRole={userRole} 
            onNavigateToLiveFeed={(filter) => {
              setActiveFilter(filter);
              setActiveTab("ingestion");
            }}
          />
        )}
      </main>

      {/* Transaction Detail Slide-In Drawer */}
      {selectedTx && (
        <TransactionDetailDrawer
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
          onBlockAction={handleBlockAction}
          onReleaseAction={handleReleaseAction}
          onReplayPath={(accId) => {
            setReplayAccount(accId);
            setActiveTab("map");
            setSelectedTx(null);
          }}
        />
      )}
    </div>
  );
};
