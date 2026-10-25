import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { 
  MapPin, 
  Radio, 
  Navigation, 
  RefreshCw, 
  Search,
  Compass
} from "lucide-react";
import type { Transaction } from "../types";
import { formatCurrency } from "../utils/formatters";

interface ThreatMapProps {
  transactions: Transaction[];
  onSelectTransaction: (tx: Transaction) => void;
  selectedTxId: string | null;
  latestTxId: string | null;
}

export const ThreatMap: React.FC<ThreatMapProps> = ({
  transactions,
  onSelectTransaction,
  selectedTxId,
  latestTxId,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Layer groups refs
  const txMarkersLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const cellTowersLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const travelPathsLayerRef = useRef<L.LayerGroup>(L.layerGroup());

  // Filter States
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [countryFilter, setCountryFilter] = useState<string>("ALL");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [accountSearch, setAccountSearch] = useState<string>("");
  const [blockedOnly, setBlockedOnly] = useState<boolean>(false);
  const [autoFlyTo, setAutoFlyTo] = useState<boolean>(false);

  // Layer Visibility Toggles
  const [showTransactions, setShowTransactions] = useState<boolean>(true);
  const [showCellTowers, setShowCellTowers] = useState<boolean>(true);
  const [showTravelPaths, setShowTravelPaths] = useState<boolean>(true);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (blockedOnly && t.decision !== "BLOCK" && t.status !== "QUARANTINED") return false;
      if (riskFilter !== "ALL") {
        if (riskFilter === "BLOCK" && t.decision !== "BLOCK") return false;
        if (riskFilter === "REVIEW" && t.decision !== "REVIEW_QUEUE") return false;
        if (riskFilter === "ALLOW" && t.decision !== "ALLOW") return false;
      }
      if (countryFilter !== "ALL" && t.country.toUpperCase() !== countryFilter.toUpperCase()) return false;
      if (channelFilter !== "ALL" && t.channel.toUpperCase() !== channelFilter.toUpperCase()) return false;
      if (accountSearch && !t.account_id.toLowerCase().includes(accountSearch.toLowerCase())) return false;
      return true;
    });
  }, [transactions, riskFilter, countryFilter, channelFilter, accountSearch, blockedOnly]);

  // Unique country list for filter
  const countries = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => t.country && set.add(t.country.toUpperCase()));
    return Array.from(set).sort();
  }, [transactions]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return; // already initialized

    // Create Leaflet instance centered at global view
    const map = L.map(mapContainerRef.current, {
      center: [25.0, 10.0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
    });

    // Zoom control at bottom right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // CartoDB Dark Matter Tiles (High quality SOC dark basemap)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Add layer groups to map
    txMarkersLayerRef.current.addTo(map);
    cellTowersLayerRef.current.addTo(map);
    travelPathsLayerRef.current.addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Layers & Markers when filtered transactions change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous items
    txMarkersLayerRef.current.clearLayers();
    cellTowersLayerRef.current.clearLayers();
    travelPathsLayerRef.current.clearLayers();

    const bounds = L.latLngBounds([]);

    // 1. Plot Transaction Markers
    if (showTransactions) {
      filteredTransactions.forEach((tx) => {
        if (!tx.lat || !tx.lon) return;
        const latLng = L.latLng(tx.lat, tx.lon);
        bounds.extend(latLng);

        const isBlock = tx.decision === "BLOCK" || tx.status === "QUARANTINED";
        const isReview = tx.decision === "REVIEW_QUEUE";
        const color = isBlock ? "#ef4444" : isReview ? "#f59e0b" : "#10b981";
        const isLatest = latestTxId === tx.transaction_id;
        const isSelected = selectedTxId === tx.transaction_id;

        // Create interactive pulse marker
        const marker = L.circleMarker(latLng, {
          radius: isSelected ? 9 : isLatest ? 8 : 6,
          fillColor: color,
          color: isSelected ? "#ffffff" : isLatest ? "#38bdf8" : "#080c14",
          weight: isSelected ? 3 : isLatest ? 2.5 : 1.5,
          opacity: 1,
          fillOpacity: 0.85,
        });

        // Hover tooltip
        marker.bindTooltip(
          `<div class="text-xs p-1">
            <div class="font-bold flex items-center justify-between gap-2">
              <span class="text-cyan-400 font-mono">${tx.transaction_id.slice(0, 10)}</span>
              <span class="font-bold" style="color: ${color}">${tx.decision}</span>
            </div>
            <div class="text-[11px] text-slate-300 mt-0.5">${tx.city}, ${tx.country}</div>
            <div class="text-white font-mono font-medium">${formatCurrency(tx.amount, tx.currency)}</div>
          </div>`,
          { direction: "top", offset: [0, -6], opacity: 0.95 }
        );

        marker.on("click", () => {
          onSelectTransaction(tx);
        });

        txMarkersLayerRef.current.addLayer(marker);

        // 2. Plot Cell Tower if active
        if (showCellTowers && tx.tower && tx.tower.lat && tx.tower.lon) {
          const towerLatLng = L.latLng(tx.tower.lat, tx.tower.lon);

          // Purple tower pin marker
          const towerMarker = L.circleMarker(towerLatLng, {
            radius: 4.5,
            fillColor: "#a855f7",
            color: "#d8b4fe",
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.85,
          });

          towerMarker.bindTooltip(
            `<div class="text-xs p-1">
              <div class="text-purple-300 font-bold font-mono">📡 Cell Tower ${tx.tower.tower_id}</div>
              <div class="text-slate-200">${tx.tower.carrier}</div>
              <div class="text-[10px] text-muted">Dist: ${tx.tower.distance_meters}m • Accuracy: ${tx.tower.accuracy_meters}m</div>
            </div>`,
            { direction: "top", offset: [0, -4] }
          );

          towerMarker.on("click", () => onSelectTransaction(tx));
          cellTowersLayerRef.current.addLayer(towerMarker);

          // Accuracy radius circle around tower
          const accuracyCircle = L.circle(towerLatLng, {
            radius: Math.max(30, tx.tower.accuracy_meters || 50),
            color: "#a855f7",
            weight: 1,
            dashArray: "2, 4",
            fillColor: "#a855f7",
            fillOpacity: 0.08,
          });
          cellTowersLayerRef.current.addLayer(accuracyCircle);

          // Dashed line from tower to transaction coordinate fix
          const towerLine = L.polyline([towerLatLng, latLng], {
            color: "#c084fc",
            weight: 1.25,
            dashArray: "3, 6",
            opacity: 0.65,
          });
          cellTowersLayerRef.current.addLayer(towerLine);
        }
      });
    }

    // 3. Plot Consecutive Travel Paths per Account
    if (showTravelPaths) {
      // Group transactions by account
      const byAccount: Record<string, Transaction[]> = {};
      filteredTransactions.forEach((tx) => {
        if (!byAccount[tx.account_id]) byAccount[tx.account_id] = [];
        byAccount[tx.account_id].push(tx);
      });

      Object.entries(byAccount).forEach(([accountId, accountTxs]) => {
        if (accountTxs.length < 2) return;
        // Sort chronologically ascending
        accountTxs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        for (let i = 0; i < accountTxs.length - 1; i++) {
          const t1 = accountTxs[i];
          const t2 = accountTxs[i + 1];
          if (!t1.lat || !t1.lon || !t2.lat || !t2.lon) continue;

          const p1 = L.latLng(t1.lat, t1.lon);
          const p2 = L.latLng(t2.lat, t2.lon);

          // Calculate distance in km
          const distKm = Math.round((p1.distanceTo(p2) / 1000.0) * 10) / 10;
          const time1 = new Date(t1.timestamp).getTime();
          const time2 = new Date(t2.timestamp).getTime();
          const minutesDelta = Math.max(0.1, (time2 - time1) / (1000 * 60));
          const speedKmh = Math.round((distKm / (minutesDelta / 60)) * 10) / 10;

          const isImpossibleTravel = speedKmh > 900.0 && distKm > 300.0;

          // Draw polyline
          const polyline = L.polyline([p1, p2], {
            color: isImpossibleTravel ? "#ef4444" : "#38bdf8",
            weight: isImpossibleTravel ? 3.5 : 2,
            dashArray: isImpossibleTravel ? "6, 6" : undefined,
            opacity: isImpossibleTravel ? 0.95 : 0.6,
          });

          // Polyline Tooltip
          polyline.bindTooltip(
            `<div class="text-xs p-1">
              <div class="font-bold flex items-center justify-between gap-2">
                <span class="font-mono text-cyan-400">${accountId}</span>
                ${isImpossibleTravel ? '<span class="text-red-400 font-bold animate-pulse">IMPOSSIBLE TRAVEL</span>' : '<span class="text-emerald-400 font-bold">NORMAL HOP</span>'}
              </div>
              <div class="text-slate-300 mt-1">
                ${distKm.toLocaleString()} km in ${Math.round(minutesDelta)} min
              </div>
              <div class="font-mono font-bold ${isImpossibleTravel ? "text-red-400 text-sm" : "text-white"}">
                ${Math.round(speedKmh).toLocaleString()} km/h
              </div>
            </div>`,
            { sticky: true }
          );

          travelPathsLayerRef.current.addLayer(polyline);
        }
      });
    }

    // Auto-fit bounds on initial load if markers exist
    if (bounds.isValid() && bounds.getNorthEast() && !selectedTxId) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [filteredTransactions, showTransactions, showCellTowers, showTravelPaths, latestTxId, selectedTxId, onSelectTransaction]);

  // Handle Auto Fly-To incoming transactions
  useEffect(() => {
    if (!autoFlyTo || !latestTxId || !mapRef.current) return;
    const latestTx = transactions.find((t) => t.transaction_id === latestTxId);
    if (latestTx && latestTx.lat && latestTx.lon) {
      mapRef.current.flyTo([latestTx.lat, latestTx.lon], 7, { duration: 1.2 });
    }
  }, [latestTxId, autoFlyTo, transactions]);

  // Reset View
  const handleResetView = () => {
    if (!mapRef.current) return;
    mapRef.current.setView([25.0, 10.0], 3);
  };

  return (
    <div className="relative w-full h-[calc(100vh-8.5rem)] rounded-xl border border-border overflow-hidden bg-background shadow-2xl flex flex-col">
      {/* Top Map Filter & Layer Toolbar */}
      <div className="absolute top-3 left-3 right-3 z-[1000] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Filters Group (Pointer events enabled on bar) */}
        <div className="bg-surface/90 backdrop-blur border border-border rounded-xl p-2 shadow-xl flex flex-wrap items-center gap-2 pointer-events-auto text-xs">
          {/* Risk Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-dark font-medium text-[11px] uppercase tracking-wider">Risk:</span>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded px-2 py-1 text-slate-200 font-medium focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Risk Tiers</option>
              <option value="BLOCK">Blocked Only</option>
              <option value="REVIEW">Review Queue</option>
              <option value="ALLOW">Allow Only</option>
            </select>
          </div>

          {/* Country Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-dark font-medium text-[11px] uppercase tracking-wider">Country:</span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded px-2 py-1 text-slate-200 font-medium focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">Worldwide (18+ Cities)</option>
              {countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Channel Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-muted-dark font-medium text-[11px] uppercase tracking-wider">Channel:</span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded px-2 py-1 text-slate-200 font-medium focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Channels</option>
              <option value="MOBILE_APP">Mobile App</option>
              <option value="ONLINE_WEB">Online Web</option>
              <option value="POS">Point of Sale</option>
              <option value="WIRE">Wire Transfer</option>
            </select>
          </div>

          {/* Account Search */}
          <div className="flex items-center bg-surface-elevated border border-border rounded px-2 py-1">
            <Search className="h-3 w-3 text-muted-dark mr-1" />
            <input
              type="text"
              placeholder="Account ID..."
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none w-24 text-xs font-mono"
            />
          </div>

          {/* "Blocked Only" Quick Toggle */}
          <label className="flex items-center space-x-1.5 cursor-pointer ml-1 text-slate-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={blockedOnly}
              onChange={(e) => setBlockedOnly(e.target.checked)}
              className="rounded accent-red-500"
            />
            <span className="font-semibold text-red-400">Blocked Only</span>
          </label>

          {/* Counter badge */}
          <div className="px-2 py-0.5 rounded bg-surface-card border border-border text-[11px] font-mono text-cyan-300">
            {filteredTransactions.length} shown / {transactions.length} total
          </div>
        </div>

        {/* Right Controls: Layer Toggles & Fly-To */}
        <div className="bg-surface/90 backdrop-blur border border-border rounded-xl p-2 shadow-xl flex items-center space-x-2 pointer-events-auto text-xs">
          {/* Layer Toggles */}
          <button
            onClick={() => setShowTransactions(!showTransactions)}
            className={`px-2 py-1 rounded flex items-center space-x-1.5 transition ${
              showTransactions ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted hover:text-white"
            }`}
          >
            <MapPin className="h-3 w-3" />
            <span>Txns</span>
          </button>

          <button
            onClick={() => setShowCellTowers(!showCellTowers)}
            className={`px-2 py-1 rounded flex items-center space-x-1.5 transition ${
              showCellTowers ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "text-muted hover:text-white"
            }`}
          >
            <Radio className="h-3 w-3" />
            <span>Cell Towers</span>
          </button>

          <button
            onClick={() => setShowTravelPaths(!showTravelPaths)}
            className={`px-2 py-1 rounded flex items-center space-x-1.5 transition ${
              showTravelPaths ? "bg-blue-500/20 text-blue-300 border border-blue-500/40" : "text-muted hover:text-white"
            }`}
          >
            <Navigation className="h-3 w-3" />
            <span>Travel Paths</span>
          </button>

          {/* Fly-To Toggle */}
          <button
            onClick={() => setAutoFlyTo(!autoFlyTo)}
            className={`px-2 py-1 rounded flex items-center space-x-1.5 transition ${
              autoFlyTo ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-muted hover:text-white"
            }`}
            title="Auto-center on incoming SSE transactions"
          >
            <Compass className="h-3 w-3" />
            <span>Fly-To Live</span>
          </button>

          {/* Reset View */}
          <button
            onClick={handleResetView}
            className="p-1.5 rounded hover:bg-surface-elevated text-muted hover:text-white transition"
            title="Reset to global view"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Main Leaflet Map View */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Bottom Map Legend */}
      <div className="absolute bottom-4 left-4 z-[1000] bg-surface/90 backdrop-blur border border-border rounded-xl p-2.5 shadow-xl text-[11px] space-y-1.5 select-none">
        <span className="font-semibold text-slate-200 block text-[10px] uppercase tracking-wider mb-1">Threat Legend</span>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
            <span className="text-slate-300">ALLOW</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
            <span className="text-slate-300">REVIEW</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span>
            <span className="text-slate-300 font-bold">BLOCK</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-purple-400"></span>
            <span className="text-purple-300">Cell Tower</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-0.5 w-4 bg-red-500 inline-block"></span>
            <span className="text-red-400 font-medium">&gt;900 km/h Travel</span>
          </div>
        </div>
      </div>
    </div>
  );
};
