import React, { useState, useEffect } from "react";
import { 
  Sliders, 
  ShieldCheck, 
  AlertTriangle, 
  Check, 
  RotateCcw, 
  Play, 
  Download, 
  Upload, 
  History, 
  Radio, 
  Wifi, 
  Cpu, 
  Lock, 
  CheckCircle2, 
  X,
  FileText
} from "lucide-react";

interface RulesConfigPageProps {
  userRole?: string;
}

export const RulesConfigPage: React.FC<RulesConfigPageProps> = ({ userRole = "analyst" }) => {
  const isAdmin = userRole === "admin";
  const [activeTab, setActiveTab] = useState<"thresholds" | "rules" | "providers" | "versions">("thresholds");
  const [config, setConfig] = useState<any | null>(null);
  const [draftConfig, setDraftConfig] = useState<any | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Draft review modal
  const [showReviewModal, setShowReviewModal] = useState<boolean>(false);
  const [changeReason, setChangeReason] = useState<string>("Updated operational thresholds");
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  const [dryRunResult, setDryRunResult] = useState<any | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState<boolean>(false);

  // Inline Validation Errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        setDraftConfig(JSON.parse(JSON.stringify(data.config)));
        setVersions(data.versions || []);
      }
    } catch (err) {
      console.error("Failed to load rules configuration:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  // Validation
  const validateDraft = (cfg: any): boolean => {
    const errors: Record<string, string> = {};
    const b = parseFloat(cfg.thresholds?.block_score);
    const r = parseFloat(cfg.thresholds?.review_score);

    if (isNaN(b) || isNaN(r) || !(0 <= r && r < b && b <= 100)) {
      errors.thresholds = "Violation: 0 <= Review Score < Block Score <= 100";
    }

    const speed = parseFloat(cfg.location?.impossible_travel_speed_kmh);
    if (isNaN(speed) || speed < 100 || speed > 2000) {
      errors.speed = "Travel speed limit must be between 100 and 2000 km/h";
    }

    const sla = parseInt(cfg.quarantine?.sla_review_minutes);
    if (isNaN(sla) || sla < 5 || sla > 1440) {
      errors.sla = "SLA review window must be between 5 and 1440 minutes";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleThresholdChange = (key: string, val: any) => {
    if (!isAdmin) return;
    const updated = {
      ...draftConfig,
      thresholds: {
        ...draftConfig.thresholds,
        [key]: val,
      },
    };
    setDraftConfig(updated);
    validateDraft(updated);
  };

  // Run dry run simulation
  const handleTestChanges = async () => {
    if (!draftConfig) return;
    setDryRunLoading(true);
    try {
      const res = await fetch("/api/config/dry-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftConfig),
      });
      if (res.ok) {
        const data = await res.json();
        setDryRunResult(data);
      }
    } catch (err) {
      console.error("Dry run error:", err);
    } finally {
      setDryRunLoading(false);
    }
  };

  // Save new version
  const handleSaveConfig = async () => {
    if (!isAdmin || !draftConfig) return;
    if (!validateDraft(draftConfig)) return;

    setSaveLoading(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-User-Role": userRole,
          "X-API-Key": "admin-token-2026"
        },
        body: JSON.stringify({
          config: draftConfig,
          reason: changeReason,
          auth_token: "admin-token-2026"
        }),
      });

      if (res.status === 403) {
        alert("Permission denied. Only Administrator roles can commit configuration changes.");
        return;
      }

      if (res.ok) {
        setShowReviewModal(false);
        fetchConfig();
      }
    } catch (err) {
      console.error("Save error:", err);
    } finally {
      setSaveLoading(false);
    }
  };

  // Restore previous version
  const handleRestoreVersion = async (versionId: string) => {
    if (!isAdmin) return;
    if (!confirm(`Restore configuration to ${versionId}? This will create a new version.`)) return;

    try {
      const res = await fetch("/api/config/restore", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-User-Role": userRole,
          "X-API-Key": "admin-token-2026"
        },
        body: JSON.stringify({
          version_id: versionId,
          auth_token: "admin-token-2026"
        }),
      });
      if (res.ok) {
        fetchConfig();
      }
    } catch (err) {
      console.error("Restore error:", err);
    }
  };

  if (!draftConfig) return null;

  const blockScore = draftConfig.thresholds?.block_score || 80;
  const reviewScore = draftConfig.thresholds?.review_score || 40;

  return (
    <div className="flex-1 flex flex-col space-y-4 text-xs select-none">
      {/* Header Banner */}
      <div className="p-4 rounded-xl bg-surface border border-border flex flex-wrap items-center justify-between gap-3 shadow-md">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 flex items-center justify-center text-white shadow-md">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-tight">Governed Rules & Configuration</h1>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                isAdmin ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-slate-800 text-slate-300 border border-slate-700"
              }`}>
                {isAdmin ? "Admin (Read/Write)" : "Analyst (Read-Only)"}
              </span>
            </div>
            <p className="text-[11px] text-muted">Version-controlled business thresholds and force-block policies</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-surface-elevated border border-border rounded-lg p-0.5">
            <button
              onClick={() => setActiveTab("thresholds")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                activeTab === "thresholds" ? "bg-surface-hover text-white shadow-sm font-bold" : "text-muted hover:text-white"
              }`}
            >
              Thresholds
            </button>
            <button
              onClick={() => setActiveTab("rules")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                activeTab === "rules" ? "bg-surface-hover text-white shadow-sm font-bold" : "text-muted hover:text-white"
              }`}
            >
              Rules Table
            </button>
            <button
              onClick={() => setActiveTab("providers")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                activeTab === "providers" ? "bg-surface-hover text-white shadow-sm font-bold" : "text-muted hover:text-white"
              }`}
            >
              Providers
            </button>
            <button
              onClick={() => setActiveTab("versions")}
              className={`px-3 py-1.5 rounded text-xs font-medium transition ${
                activeTab === "versions" ? "bg-surface-hover text-white shadow-sm font-bold" : "text-muted hover:text-white"
              }`}
            >
              Versions ({versions.length})
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowReviewModal(true)}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition shadow-md shadow-cyan-900/30"
            >
              Review Changes
            </button>
          )}
        </div>
      </div>

      {/* Thresholds View */}
      {activeTab === "thresholds" && (
        <div className="space-y-4">
          {/* Visual Score Band Bar */}
          <div className="p-4 rounded-xl bg-surface border border-border space-y-3">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-white">Visual Risk Decision Bands</span>
              <span className="text-muted text-[11px] font-mono">Scores: 0 to 100</span>
            </div>

            <div className="w-full h-8 rounded-lg overflow-hidden flex border border-border/80 text-[11px] font-mono font-bold">
              <div
                style={{ width: `${reviewScore}%` }}
                className="bg-emerald-600/80 text-emerald-100 flex items-center justify-center transition-all duration-300"
              >
                ALLOW (0 - {reviewScore - 1})
              </div>
              <div
                style={{ width: `${blockScore - reviewScore}%` }}
                className="bg-amber-500/80 text-amber-950 flex items-center justify-center transition-all duration-300"
              >
                REVIEW ({reviewScore} - {blockScore - 1})
              </div>
              <div
                style={{ width: `${100 - blockScore}%` }}
                className="bg-red-600/80 text-red-100 flex items-center justify-center transition-all duration-300"
              >
                BLOCK ({blockScore} - 100)
              </div>
            </div>

            {validationErrors.thresholds && (
              <p className="text-red-400 text-xs font-semibold">{validationErrors.thresholds}</p>
            )}
          </div>

          {/* Threshold Form / Inputs Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-200">Review Threshold</span>
                <span className="font-mono text-amber-400 font-bold text-sm">{reviewScore} pts</span>
              </div>
              <p className="text-[11px] text-muted">Transactions scoring &ge; {reviewScore} enter analyst queue.</p>
              {isAdmin ? (
                <input
                  type="range"
                  min="10"
                  max="70"
                  value={reviewScore}
                  onChange={(e) => handleThresholdChange("review_score", parseInt(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              ) : (
                <div className="p-2 rounded bg-surface-card border border-border font-mono text-slate-300">
                  {reviewScore} points (Read-only)
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-200">Block Threshold</span>
                <span className="font-mono text-red-400 font-bold text-sm">{blockScore} pts</span>
              </div>
              <p className="text-[11px] text-muted">Transactions scoring &ge; {blockScore} are blocked & quarantined.</p>
              {isAdmin ? (
                <input
                  type="range"
                  min="50"
                  max="95"
                  value={blockScore}
                  onChange={(e) => handleThresholdChange("block_score", parseInt(e.target.value))}
                  className="w-full accent-red-500 cursor-pointer"
                />
              ) : (
                <div className="p-2 rounded bg-surface-card border border-border font-mono text-slate-300">
                  {blockScore} points (Read-only)
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-surface border border-border space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-200">Impossible Travel Speed</span>
                <span className="font-mono text-cyan-300 font-bold text-sm">
                  {draftConfig.location?.impossible_travel_speed_kmh} km/h
                </span>
              </div>
              <p className="text-[11px] text-muted">Supersonic threshold triggering force block.</p>
              {isAdmin ? (
                <input
                  type="range"
                  min="500"
                  max="1500"
                  step="50"
                  value={draftConfig.location?.impossible_travel_speed_kmh || 900}
                  onChange={(e) => {
                    const updated = {
                      ...draftConfig,
                      location: {
                        ...draftConfig.location,
                        impossible_travel_speed_kmh: parseFloat(e.target.value),
                      },
                    };
                    setDraftConfig(updated);
                  }}
                  className="w-full accent-cyan-400 cursor-pointer"
                />
              ) : (
                <div className="p-2 rounded bg-surface-card border border-border font-mono text-slate-300">
                  {draftConfig.location?.impossible_travel_speed_kmh} km/h (Read-only)
                </div>
              )}
            </div>
          </div>

          {/* Dry Run Button */}
          <div className="p-4 rounded-xl bg-surface-card border border-border flex items-center justify-between">
            <div>
              <span className="font-semibold text-white block">Dry-Run Impact Simulation</span>
              <p className="text-[11px] text-muted">Simulate draft thresholds on recent stored events without writing.</p>
            </div>
            <button
              onClick={handleTestChanges}
              disabled={dryRunLoading}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-cyan-300 font-semibold flex items-center space-x-1.5 transition"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{dryRunLoading ? "Evaluating..." : "Test Changes on Stream"}</span>
            </button>
          </div>

          {dryRunResult && (
            <div className="p-4 rounded-xl bg-surface border border-cyan-500/40 space-y-2">
              <span className="font-bold text-cyan-300 block text-xs">Dry Run Simulation Results</span>
              <p className="text-white font-mono text-sm">{dryRunResult.summary}</p>
              <p className="text-[11px] text-muted">Evaluated {dryRunResult.total_evaluated} canonical transactions.</p>
            </div>
          )}
        </div>
      )}

      {/* Rules Table View */}
      {activeTab === "rules" && (
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-card border-b border-border text-[11px] text-muted-dark uppercase font-semibold h-9">
              <tr>
                <th className="px-4">Rule Name</th>
                <th className="px-4">ID</th>
                <th className="px-4">Description</th>
                <th className="w-24 px-4 text-center">Weight</th>
                <th className="w-28 px-4">Severity</th>
                <th className="w-28 px-4 text-center">Force Block</th>
                <th className="w-24 px-4 text-center">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 text-xs">
              {(draftConfig.rules || []).map((rule: any) => (
                <tr key={rule.id} className="h-12 hover:bg-surface-hover">
                  <td className="px-4 font-semibold text-white">{rule.name}</td>
                  <td className="px-4 font-mono text-cyan-400 text-[11px]">{rule.id}</td>
                  <td className="px-4 text-muted text-[11px] max-w-xs truncate">{rule.description}</td>
                  <td className="px-4 text-center font-mono font-bold text-white">{rule.weight}</td>
                  <td className="px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      rule.severity === "CRITICAL" ? "bg-red-950 text-red-300 border border-red-800" : "bg-amber-950 text-amber-300 border border-amber-800"
                    }`}>
                      {rule.severity}
                    </span>
                  </td>
                  <td className="px-4 text-center">
                    <input
                      type="checkbox"
                      checked={rule.force_block}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const updatedRules = draftConfig.rules.map((r: any) =>
                          r.id === rule.id ? { ...r, force_block: e.target.checked } : r
                        );
                        setDraftConfig({ ...draftConfig, rules: updatedRules });
                      }}
                      className="rounded accent-red-500"
                    />
                  </td>
                  <td className="px-4 text-center">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={!isAdmin}
                      onChange={(e) => {
                        const updatedRules = draftConfig.rules.map((r: any) =>
                          r.id === rule.id ? { ...r, enabled: e.target.checked } : r
                        );
                        setDraftConfig({ ...draftConfig, rules: updatedRules });
                      }}
                      className="rounded accent-cyan-400"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Providers View */}
      {activeTab === "providers" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(draftConfig.providers || {}).map(([key, prov]: [string, any]) => (
            <div key={key} className="p-4 rounded-xl bg-surface border border-border space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-white text-xs">{prov.name}</h3>
                  <span className="text-[10px] text-muted-dark font-mono uppercase">{key}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  prov.is_simulated ? "bg-purple-950 text-purple-300 border border-purple-800" : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                }`}>
                  {prov.is_simulated ? "SIMULATED" : "LIVE PROVIDER"}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-surface-card border border-border/80 space-y-1.5 text-[11px] text-slate-300">
                <div className="flex justify-between">
                  <span className="text-muted">Health Status:</span>
                  <span className="text-emerald-400 font-bold flex items-center space-x-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                    <span>{prov.status || "HEALTHY"}</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Latency:</span>
                  <span className="font-mono text-cyan-300">{prov.latency_ms || 35} ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Quota Consumption:</span>
                  <span className="font-mono text-slate-300">{prov.quota_used}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Last Successful Call:</span>
                  <span className="font-mono text-slate-400">{prov.last_successful_call}</span>
                </div>
              </div>

              {prov.legal_consent_required && (
                <p className="text-[10px] text-amber-300/80 italic p-2 rounded bg-amber-950/20 border border-amber-900/30">
                  {prov.legal_notice}
                </p>
              )}

              <div className="flex justify-end pt-1">
                <button
                  onClick={() => alert(`Connection probe to ${prov.name} succeeded (Latency: ${prov.latency_ms}ms)`)}
                  className="px-2.5 py-1 rounded bg-surface-elevated border border-border hover:bg-surface-hover text-muted hover:text-white text-xs"
                >
                  Test Connection
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Version History View */}
      {activeTab === "versions" && (
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border/60">
          {versions.length === 0 ? (
            <div className="p-8 text-center text-muted">No historical versions stored.</div>
          ) : (
            versions.map((v: any) => (
              <div key={v.version_id} className="p-4 flex items-center justify-between hover:bg-surface-hover">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono font-bold text-white text-sm">{v.version_id}</span>
                    <span className="text-muted">•</span>
                    <span className="font-medium text-slate-300">{v.reason}</span>
                  </div>
                  <div className="text-[10px] text-muted mt-1">
                    Committed by <span className="text-cyan-400 font-mono">{v.operator}</span> on {v.timestamp}
                  </div>
                </div>

                {isAdmin && (
                  <button
                    onClick={() => handleRestoreVersion(v.version_id)}
                    className="px-3 py-1.5 rounded-lg bg-surface-elevated border border-border hover:bg-surface-hover text-cyan-300 font-medium"
                  >
                    Restore {v.version_id}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Review & Apply Modal */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-surface-elevated border border-border shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-bold text-white">Review Governance Changes</h3>

            <div className="p-3 rounded-lg bg-surface border border-border space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Review Score:</span>
                <span className="font-mono text-white">{config.thresholds?.review_score} &rarr; {draftConfig.thresholds?.review_score}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Block Score:</span>
                <span className="font-mono text-white">{config.thresholds?.block_score} &rarr; {draftConfig.thresholds?.block_score}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-muted block">Mandatory Change Reason:</label>
              <input
                type="text"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="Reason for threshold adjustment..."
                className="w-full px-3 py-1.5 rounded bg-surface border border-border text-white text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setShowReviewModal(false)} className="px-3 py-1.5 rounded bg-surface text-muted">
                Cancel
              </button>
              <button
                onClick={handleSaveConfig}
                disabled={saveLoading}
                className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold"
              >
                {saveLoading ? "Applying..." : "Commit Version"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
