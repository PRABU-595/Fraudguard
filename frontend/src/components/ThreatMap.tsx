import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat";
import { 
  MapPin, 
  Radio, 
  Navigation, 
  RefreshCw, 
  Search,
  Compass,
  Play,
  Pause,
  Layers,
  Flame,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info
} from "lucide-react";
import type { Transaction } from "../types";
import { formatCurrency, formatShortId } from "../utils/formatters";

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

  // Layers & Clusters
  const clusterGroupRef = useRef<any>(null);
  const cellTowersLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const travelPathsLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const heatLayerRef = useRef<any>(null);
  const geoJsonLayerRef = useRef<L.GeoJSON | null>(null);

  // Tile Config & Error States
  const [tileError, setTileError] = useState<boolean>(false);
  const [tileConfig, setTileConfig] = useState<{ url: string; attribution: string }>({
    url: (import.meta as any).env?.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: (import.meta as any).env?.VITE_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });

  // Filter States
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [countryFilter, setCountryFilter] = useState<string>("ALL");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [accountSearch, setAccountSearch] = useState<string>("");
  const [blockedOnly, setBlockedOnly] = useState<boolean>(false);
  const [autoFlyTo, setAutoFlyTo] = useState<boolean>(false);

  // Layer Visibility Toggles
  const [showCellTowers, setShowCellTowers] = useState<boolean>(true);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(true);

  // Time Slider & Playback
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(100);

  // Hovered account for travel path
  const [hoveredAccountId, setHoveredAccountId] = useState<string | null>(null);

  // Fetch tile config from backend API
  useEffect(() => {
    fetch("/api/map/config")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.tile_url) {
          setTileConfig({
            url: data.tile_url,
            attribution: data.tile_attribution || '&copy; OpenStreetMap contributors'
          });
        }
      })
      .catch(() => {});
  }, []);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    let result = transactions.filter((t) => {
      if (blockedOnly && t.decision !== "BLOCK" && t.status !== "QUARANTINED") return false;
      if (riskFilter !== "ALL") {
        if (riskFilter === "BLOCK" && t.decision !== "BLOCK") return false;
        if (riskFilter === "REVIEW" && t.decision !== "REVIEW_QUEUE" && t.decision !== "REVIEW") return false;
        if (riskFilter === "ALLOW" && t.decision !== "ALLOW") return false;
      }
      if (countryFilter !== "ALL" && t.country.toUpperCase() !== countryFilter.toUpperCase()) return false;
      if (channelFilter !== "ALL" && t.channel.toUpperCase() !== channelFilter.toUpperCase()) return false;
      if (accountSearch && !t.account_id.toLowerCase().includes(accountSearch.toLowerCase())) return false;
      return true;
    });

    // Time slider cutoff
    if (result.length > 0 && playbackIndex < 100) {
      const maxCount = Math.max(1, Math.floor((result.length * playbackIndex) / 100));
      result = result.slice(0, maxCount);
    }

    return result;
  }, [transactions, riskFilter, countryFilter, channelFilter, accountSearch, blockedOnly, playbackIndex]);

  // Unique country list for filter
  const countries = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach((t) => t.country && set.add(t.country.toUpperCase()));
    return Array.from(set).sort();
  }, [transactions]);

  // Selected account ID
  const selectedAccount = useMemo(() => {
    if (hoveredAccountId) return hoveredAccountId;
    if (!selectedTxId) return null;
    const tx = transactions.find((t) => t.transaction_id === selectedTxId);
    return tx ? tx.account_id : null;
  }, [selectedTxId, hoveredAccountId, transactions]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    // Create Leaflet instance
    const map = L.map(mapContainerRef.current, {
      center: [25.0, 10.0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
    });
    mapRef.current = map;

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Create custom pane for cell towers under markerPane (zIndex 350)
    map.createPane("towersPane");
    const towersPane = map.getPane("towersPane");
    if (towersPane) {
      towersPane.style.zIndex = "350";
    }

    // Load fallback country outlines GeoJSON
    fetch("/world_countries.json")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && mapRef.current) {
          geoJsonLayerRef.current = L.geoJSON(data, {
            style: {
              fillColor: "#0f172a",
              weight: 1,
              color: "#334155",
              fillOpacity: 0.6,
            }
          }).addTo(mapRef.current);
        }
      })
      .catch(() => {});

    // Add Tile Layer with CSS dark filter
    const tileLayer = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      maxZoom: 19,
      className: "soc-dark-tile-filter",
    });

    tileLayer.on("tileerror", () => {
      setTileError(true);
    });

    tileLayer.addTo(map);

    // Initialize marker cluster group with canvas renderer and worst-decision coloring
    const clusterGroup = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const markers = cluster.getAllChildMarkers();
        let worst = "ALLOW";
        for (const m of markers) {
          const dec = m.options.decision;
          if (dec === "BLOCK") {
            worst = "BLOCK";
            break;
          }
          if (dec === "REVIEW_QUEUE" || dec === "REVIEW") {
            worst = "REVIEW";
          }
        }
        const color = worst === "BLOCK" ? "#ef4444" : worst === "REVIEW" ? "#f59e0b" : "#10b981";
        return L.divIcon({
          html: `<div style="background:${color}dd; border: 2px solid ${color}; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 12px; box-shadow: 0 0 10px ${color}88;">${markers.length}</div>`,
          className: "custom-cluster-icon",
          iconSize: [34, 34],
        });
      }
    });

    clusterGroupRef.current = clusterGroup;
    map.addLayer(clusterGroup);
    map.addLayer(cellTowersLayerRef.current);
    map.addLayer(travelPathsLayerRef.current);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update Markers & Clusters when filtered transactions change
  useEffect(() => {
    if (!mapRef.current || !clusterGroupRef.current) return;

    clusterGroupRef.current.clearLayers();
    cellTowersLayerRef.current.clearLayers();

    const canvasRenderer = L.canvas();
    const newMarkers: L.CircleMarker[] = [];

    // Distinct purple cell tower SVG icon
    const towerIcon = L.divIcon({
      className: "cell-tower-custom-icon",
      html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:#581c87;border:1.5px solid #a855f7;box-shadow:0 0 8px rgba(168,85,247,0.6);"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f3e8ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M7 7l5-5 5 5M4 14h16M2 22h20M9 18l3-3 3 3"/></svg></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    filteredTransactions.forEach((tx) => {
      const isBlock = tx.decision === "BLOCK" || tx.status === "QUARANTINED";
      const isReview = tx.decision === "REVIEW_QUEUE" || tx.decision === "REVIEW";
      const color = isBlock ? "#ef4444" : isReview ? "#f59e0b" : "#10b981";
      const radius = Math.max(6, Math.min(18, 6 + Math.log10(Math.max(1, tx.amount)) * 3));

      // Transaction Circle Marker
      const marker = L.circleMarker([tx.lat, tx.lon], {
        radius,
        fillColor: color,
        color: tx.transaction_id === selectedTxId ? "#ffffff" : color,
        weight: tx.transaction_id === selectedTxId ? 3 : 1.5,
        opacity: 1,
        fillOpacity: 0.85,
        renderer: canvasRenderer,
      } as any);

      (marker as any).options.decision = isBlock ? "BLOCK" : isReview ? "REVIEW" : "ALLOW";

      // Popup
      marker.bindTooltip(`
        <div style="font-family:monospace; font-size:11px;">
          <b>${tx.transaction_id}</b><br/>
          Amount: ${formatCurrency(tx.amount, tx.currency)}<br/>
          Risk: ${Math.round(tx.risk_score)} (${tx.decision})<br/>
          Location: ${tx.city}, ${tx.country}
        </div>
      `, { direction: "top", offset: [0, -10] });

      marker.on("click", () => {
        onSelectTransaction(tx);
      });

      marker.on("mouseover", () => {
        setHoveredAccountId(tx.account_id);
      });

      marker.on("mouseout", () => {
        setHoveredAccountId(null);
      });

      newMarkers.push(marker);

      // Distinct Purple Cell Tower (drawn on custom towersPane with lower zIndex under markers)
      if (showCellTowers && tx.cell_tower) {
        const ct = tx.cell_tower;
        const towerMarker = L.marker([ct.lat, ct.lon], {
          icon: towerIcon,
          pane: "towersPane"
        });

        towerMarker.bindTooltip(`
          <div style="font-family:monospace; font-size:11px;">
            <b>Cell Tower: ${ct.tower_id}</b><br/>
            Carrier: ${ct.carrier || "TeleCom"}<br/>
            Accuracy: ${ct.accuracy_meters || 450}m
          </div>
        `, { direction: "top" });

        // Dashed connector line from cell tower to transaction
        const connector = L.polyline([[ct.lat, ct.lon], [tx.lat, tx.lon]], {
          color: "#a855f7",
          weight: 1.5,
          dashArray: "4, 4",
          opacity: 0.7,
          pane: "towersPane"
        });

        // Tower accuracy circle
        const accuracyCircle = L.circle([ct.lat, ct.lon], {
          radius: ct.accuracy_meters || 450,
          color: "#9333ea",
          weight: 1,
          fillColor: "#a855f7",
          fillOpacity: 0.12,
          pane: "towersPane"
        });

        cellTowersLayerRef.current.addLayer(towerMarker);
        cellTowersLayerRef.current.addLayer(connector);
        cellTowersLayerRef.current.addLayer(accuracyCircle);
      }
    });

    clusterGroupRef.current.addLayers(newMarkers);

    // Auto-fit bounds on load or filter change
    if (newMarkers.length > 0 && mapRef.current) {
      const bounds = L.latLngBounds(newMarkers.map((m) => m.getLatLng()));
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [filteredTransactions, showCellTowers, selectedTxId]);

  // Update Travel Paths ONLY for the selected account (or hovered account)
  useEffect(() => {
    if (!mapRef.current) return;
    travelPathsLayerRef.current.clearLayers();

    if (!selectedAccount) return;

    // Filter transactions belonging to this account and sort chronologically
    const accountTxs = transactions
      .filter((t) => t.account_id === selectedAccount)
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

    if (accountTxs.length < 2) return;

    for (let i = 0; i < accountTxs.length - 1; i++) {
      const t1 = accountTxs[i];
      const t2 = accountTxs[i + 1];

      // Haversine distance
      const lat1 = t1.lat * (Math.PI / 180);
      const lon1 = t1.lon * (Math.PI / 180);
      const lat2 = t2.lat * (Math.PI / 180);
      const lon2 = t2.lon * (Math.PI / 180);
      const dlat = lat2 - lat1;
      const dlon = lon2 - lon1;
      const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
      const d_km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Time gap
      const d1 = new Date(t1.timestamp || "");
      const d2 = new Date(t2.timestamp || "");
      const minutes = Math.max(1, (d2.getTime() - d1.getTime()) / (1000 * 60));
      const speed = d_km / (minutes / 60);

      const isImpossible = speed > 900;

      // Draw polyline
      const line = L.polyline([[t1.lat, t1.lon], [t2.lat, t2.lon]], {
        color: isImpossible ? "#ef4444" : "#64748b",
        weight: isImpossible ? 3 : 2,
        dashArray: isImpossible ? "6, 6" : undefined,
        className: isImpossible ? "animate-pulse" : undefined,
      });

      // Midpoint marker with label & arrowhead
      const midLat = (t1.lat + t2.lat) / 2;
      const midLon = (t1.lon + t2.lon) / 2;

      const labelHtml = isImpossible
        ? `<div class="px-2 py-0.5 rounded bg-red-950 border border-red-500 text-red-200 text-[10px] font-mono font-bold shadow-lg flex items-center space-x-1 whitespace-nowrap">
            <span>🚨 IMPOSSIBLE TRAVEL: ${Math.round(d_km)}km · ${Math.round(minutes)}m · ${Math.round(speed)}km/h</span>
          </div>`
        : `<div class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 text-[10px] font-mono shadow-md whitespace-nowrap">
            <span>${Math.round(d_km)}km · ${Math.round(minutes)}m · ${Math.round(speed)}km/h</span>
          </div>`;

      const midMarker = L.marker([midLat, midLon], {
        icon: L.divIcon({
          html: labelHtml,
          className: "travel-path-label",
          iconAnchor: [50, 10],
        })
      });

      travelPathsLayerRef.current.addLayer(line);
      travelPathsLayerRef.current.addLayer(midMarker);
    }
  }, [selectedAccount, transactions]);

  // Update Heatmap Layer Toggle
  useEffect(() => {
    if (!mapRef.current) return;

    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    if (showHeatmap && filteredTransactions.length > 0) {
      const heatPoints = filteredTransactions.map((t) => [t.lat, t.lon, Math.max(0.2, t.risk_score / 100)]);
      heatLayerRef.current = (L as any).heatLayer(heatPoints, {
        radius: 25,
        blur: 15,
        maxZoom: 16,
        gradient: { 0.4: "#3b82f6", 0.65: "#f59e0b", 1.0: "#ef4444" },
      }).addTo(mapRef.current);
    }
  }, [showHeatmap, filteredTransactions]);

  // Auto Fly-To on latest incoming SSE transaction
  useEffect(() => {
    if (!autoFlyTo || !latestTxId || !mapRef.current) return;
    const latest = transactions.find((t) => t.transaction_id === latestTxId);
    if (latest) {
      mapRef.current.flyTo([latest.lat, latest.lon], 8, { duration: 1.2 });
    }
  }, [latestTxId, autoFlyTo, transactions]);

  // Time playback ticker
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setPlaybackIndex((prev) => {
        if (prev >= 100) return 10;
        return prev + 10;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  const handleResetView = () => {
    if (mapRef.current) {
      mapRef.current.setView([25.0, 10.0], 3);
    }
  };

  return (
    <div className="flex-1 min-h-[550px] h-full flex flex-col relative rounded-xl overflow-hidden border border-border shadow-2xl bg-[#080c14]">
      {/* Non-blocking Tile Unavailable Fallback Banner */}
      {tileError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-lg bg-amber-950/90 border border-amber-600/80 text-amber-200 text-xs flex items-center space-x-2 shadow-2xl backdrop-blur-md animate-fade-in">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>Map tiles unavailable - check MAP_TILE_URL. Showing offline country vector boundaries.</span>
        </div>
      )}

      {/* Top Filter & Layers Control Bar */}
      <div className="p-3 bg-surface-card/90 backdrop-blur-md border-b border-border z-20 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Left Filter Controls */}
        <div className="flex items-center space-x-2.5 overflow-x-auto">
          {/* Risk Level Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-semibold text-muted uppercase">Risk:</span>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded-md px-2 py-1 text-slate-200 text-xs focus:outline-none"
            >
              <option value="ALL">All Risk Tiers</option>
              <option value="BLOCK">Blocked Only</option>
              <option value="REVIEW">Review Queue</option>
              <option value="ALLOW">Allow Only</option>
            </select>
          </div>

          {/* Country Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-semibold text-muted uppercase">Country:</span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded-md px-2 py-1 text-slate-200 text-xs focus:outline-none"
            >
              <option value="ALL">Worldwide (18+ Cities)</option>
              {countries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Channel Filter */}
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-semibold text-muted uppercase">Channel:</span>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="bg-surface-elevated border border-border rounded-md px-2 py-1 text-slate-200 text-xs focus:outline-none"
            >
              <option value="ALL">All Channels</option>
              <option value="MOBILE_APP">Mobile App</option>
              <option value="ONLINE_WEB">Online Web</option>
              <option value="POS">Point of Sale</option>
              <option value="WIRE">Wire Transfer</option>
            </select>
          </div>

          {/* Account Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Account ID..."
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              className="bg-surface-elevated border border-border rounded-md pl-2.5 pr-6 py-1 text-xs text-slate-200 placeholder-muted-dark w-28 focus:w-36 transition-all focus:outline-none"
            />
          </div>

          {/* Blocked Only Toggle */}
          <label className="flex items-center space-x-1.5 cursor-pointer text-muted hover:text-slate-200">
            <input
              type="checkbox"
              checked={blockedOnly}
              onChange={(e) => setBlockedOnly(e.target.checked)}
              className="rounded accent-red-500"
            />
            <span>Blocked Only</span>
          </label>
        </div>

        {/* Right Counters & Layer Toggles */}
        <div className="flex items-center space-x-2">
          {/* Live Counter */}
          <span className="px-2 py-1 rounded bg-surface-elevated font-mono text-[11px] text-cyan-300 border border-border">
            <b className="text-white">{filteredTransactions.length}</b> shown / {transactions.length} total
          </span>

          {/* Cell Towers Toggle */}
          <button
            onClick={() => setShowCellTowers(!showCellTowers)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              showCellTowers
                ? "bg-purple-950/60 text-purple-300 border border-purple-800/60"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
          >
            <Radio className="h-3 w-3" />
            <span>Cell Towers</span>
          </button>

          {/* Heatmap Toggle */}
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              showHeatmap
                ? "bg-red-950/60 text-red-300 border border-red-800/60"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
          >
            <Flame className="h-3 w-3 text-red-400" />
            <span>Heatmap</span>
          </button>

          {/* Auto Fly-to Toggle */}
          <button
            onClick={() => setAutoFlyTo(!autoFlyTo)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              autoFlyTo
                ? "bg-cyan-950/60 text-cyan-300 border border-cyan-800/60"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
            title="Auto-center on incoming SSE transactions"
          >
            <Navigation className="h-3 w-3" />
            <span>Fly-To Live</span>
          </button>

          {/* Reset View */}
          <button
            onClick={handleResetView}
            className="p-1.5 rounded bg-surface-elevated hover:bg-surface-hover border border-border text-muted hover:text-white transition"
            title="Reset to global view"
          >
            <Compass className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Leaflet Map Canvas */}
      <div 
        ref={mapContainerRef} 
        className="flex-1 w-full h-full relative z-10 bg-[#080c14]"
      />

      {/* Bottom Timeline Playback Slider Bar */}
      <div className="absolute bottom-4 left-6 right-20 z-20 px-4 py-2.5 rounded-xl bg-surface-card/90 backdrop-blur-md border border-border shadow-2xl flex items-center space-x-4 text-xs">
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/40 transition shrink-0"
          title={isPlaying ? "Pause timeline replay" : "Play timeline replay"}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>

        <span className="text-[11px] font-mono text-muted whitespace-nowrap shrink-0">Time Horizon</span>

        <input
          type="range"
          min="10"
          max="100"
          step="5"
          value={playbackIndex}
          onChange={(e) => setPlaybackIndex(parseInt(e.target.value))}
          className="flex-1 accent-cyan-400 h-1.5 bg-surface-elevated rounded cursor-pointer"
        />

        <span className="font-mono text-cyan-300 text-[11px] shrink-0">
          {playbackIndex}% ({filteredTransactions.length} events)
        </span>
      </div>

      {/* Collapsible Threat Map Legend Card */}
      <div className="absolute bottom-16 right-6 z-20">
        <div className="rounded-xl bg-surface-card/90 backdrop-blur-md border border-border shadow-2xl overflow-hidden transition-all text-xs">
          <div 
            onClick={() => setShowLegend(!showLegend)}
            className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-surface-elevated space-x-3 select-none"
          >
            <div className="flex items-center space-x-1.5 text-slate-200 font-semibold text-[11px]">
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              <span>Map Legend</span>
            </div>
            {showLegend ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronUp className="h-3.5 w-3.5 text-muted" />}
          </div>

          {showLegend && (
            <div className="px-3.5 pb-3 pt-1 space-y-2 border-t border-border/60 text-[11px]">
              {/* Decision Colors */}
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Transaction Risk</p>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
                  <span className="text-slate-300">Allow (0 - 39)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50"></span>
                  <span className="text-slate-300">Review Queue (40 - 79)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50"></span>
                  <span className="text-slate-300">Block / Quarantine (80 - 100)</span>
                </div>
              </div>

              {/* Cell Tower & Travel Path */}
              <div className="space-y-1 pt-1 border-t border-border/40">
                <p className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Telemetry Layers</p>
                <div className="flex items-center space-x-2">
                  <div className="w-3.5 h-3.5 rounded bg-purple-900 border border-purple-500 flex items-center justify-center">
                    <Radio className="h-2.5 w-2.5 text-purple-200" />
                  </div>
                  <span className="text-slate-300">Cell Tower (Carrier Pin)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-4 h-0.5 bg-red-500 inline-block border-b border-dashed border-red-300"></span>
                  <span className="text-red-300 font-bold">&gt;900 km/h Impossible</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-4 h-0.5 bg-slate-500 inline-block"></span>
                  <span className="text-slate-400">Normal Travel Path</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
