import React, { useState, useEffect } from "react";
import { Search, Activity, Globe, Zap, AlertTriangle, X } from "lucide-react";
import type { Transaction } from "../types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: Transaction[];
  onSelectTransaction: (tx: Transaction) => void;
  setActiveTab: (tab: "ingestion" | "map" | "quarantine") => void;
  onTriggerScenario: (scenario: string) => Promise<void>;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  transactions,
  onSelectTransaction,
  setActiveTab,
  onTriggerScenario,
}) => {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          setQuery("");
        }
      } else if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredTxs = query.trim()
    ? transactions.filter(
        (t) =>
          t.transaction_id.toLowerCase().includes(query.toLowerCase()) ||
          t.account_id.toLowerCase().includes(query.toLowerCase()) ||
          t.city.toLowerCase().includes(query.toLowerCase()) ||
          t.country.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 5)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 px-4">
      <div className="w-full max-w-xl rounded-xl bg-surface-elevated border border-border shadow-2xl overflow-hidden text-xs">
        {/* Search Input Bar */}
        <div className="p-3 border-b border-border flex items-center space-x-2.5">
          <Search className="h-4 w-4 text-cyan-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search transactions, accounts, cities..."
            className="flex-1 bg-transparent text-slate-100 placeholder-muted-dark focus:outline-none text-sm"
          />
          <button onClick={onClose} className="p-1 rounded text-muted hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Command / Search Options */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {/* Quick Navigation Commands */}
          <div className="px-2 py-1 text-[10px] font-semibold text-muted-dark uppercase tracking-wider">
            Navigation
          </div>
          <button
            onClick={() => {
              setActiveTab("ingestion");
              onClose();
            }}
            className="w-full px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center space-x-2 text-slate-200"
          >
            <Activity className="h-3.5 w-3.5 text-cyan-400" />
            <span>Switch to Live Ingestion Feed</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("map");
              onClose();
            }}
            className="w-full px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center space-x-2 text-slate-200"
          >
            <Globe className="h-3.5 w-3.5 text-blue-400" />
            <span>Switch to Threat Map</span>
          </button>

          {/* Adversary Scenario Injections */}
          <div className="px-2 py-1 text-[10px] font-semibold text-muted-dark uppercase tracking-wider pt-2">
            Simulate Attack Scenarios
          </div>
          <button
            onClick={() => {
              onTriggerScenario("IMPOSSIBLE_TRAVEL");
              onClose();
            }}
            className="w-full px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between text-slate-200"
          >
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              <span>Fire Impossible Travel Attack</span>
            </div>
            <span className="text-[10px] text-red-400 font-mono">BLOCK</span>
          </button>
          <button
            onClick={() => {
              onTriggerScenario("TOR");
              onClose();
            }}
            className="w-full px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between text-slate-200"
          >
            <div className="flex items-center space-x-2">
              <Zap className="h-3.5 w-3.5 text-purple-400" />
              <span>Fire Tor Exit Node Relay Attack</span>
            </div>
            <span className="text-[10px] text-red-400 font-mono">BLOCK</span>
          </button>

          {/* Matched Transactions */}
          {filteredTxs.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-dark uppercase tracking-wider pt-2">
                Matching Transactions
              </div>
              {filteredTxs.map((tx) => (
                <button
                  key={tx.transaction_id}
                  onClick={() => {
                    onSelectTransaction(tx);
                    onClose();
                  }}
                  className="w-full px-2.5 py-1.5 rounded hover:bg-surface-hover flex items-center justify-between text-slate-200"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-cyan-300">{tx.transaction_id.slice(0, 12)}</span>
                    <span className="text-muted-dark">•</span>
                    <span>{tx.account_id}</span>
                  </div>
                  <span className="text-muted">{tx.city}, {tx.country}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="p-2 border-t border-border bg-surface-card flex items-center justify-between text-[10px] text-muted">
          <span>Navigate with mouse or keyboard</span>
          <span className="font-mono">ESC to cancel</span>
        </div>
      </div>
    </div>
  );
};
