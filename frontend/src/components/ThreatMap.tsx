import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.heat";
import worldCountriesGeoJson from "../assets/world_countries.json";
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
  Info,
  X,
  ExternalLink,
  Shield,
  EyeOff
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

  // Zoom & Tile States
  const [currentZoom, setCurrentZoom] = useState<number>(3);
  const [tileError, setTileError] = useState<boolean>(false);
  const [tileConfig, setTileConfig] = useState<{ url: string; attribution: string }>({
    url: (import.meta as any).env?.VITE_MAP_TILE_URL || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: (import.meta as any).env?.VITE_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });

  // Track initial auto-fit and filter change to prevent zoom-in rubberbanding
  const initialFitDoneRef = useRef<boolean>(false);
  const prevCountryFilterRef = useRef<string>("ALL");

  // Focus Regions for instant escape & region jump
  const focusRegions = useMemo(() => [
    { label: "World", icon: "🌐", center: [20.0, 0.0] as [number, number], zoom: 2.5 },
    { label: "India", icon: "🇮🇳", center: [21.5, 78.9] as [number, number], zoom: 5 },
    { label: "US", icon: "🇺🇸", center: [38.0, -96.0] as [number, number], zoom: 4 },
    { label: "Europe", icon: "🇪🇺", center: [50.0, 10.0] as [number, number], zoom: 4 },
    { label: "Asia", icon: "🌏", center: [22.0, 115.0] as [number, number], zoom: 4 },
  ], []);

  // Dynamic Config-Driven Thresholds (Loaded from active rules config)
  const [thresholds, setThresholds] = useState<{ review_score: number; block_score: number }>({
    review_score: 40,
    block_score: 80,
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

  // Hidden transactions modal state
  const [showHiddenModal, setShowHiddenModal] = useState<boolean>(false);
  const [hiddenSearch, setHiddenSearch] = useState<string>("");

  // Time Slider & Playback
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackIndex, setPlaybackIndex] = useState<number>(100);

  // Hovered account for travel path
  const [hoveredAccountId, setHoveredAccountId] = useState<string | null>(null);

  // Minimum zoom level for carrier towers (level 5+ displays towers across regional and city views)
  const MIN_TOWER_ZOOM = 5;

  // Fetch tile & thresholds config from backend API
  useEffect(() => {
    fetch("/api/map/config")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          if (data.tile_url) {
            setTileConfig({
              url: data.tile_url,
              attribution: data.tile_attribution || '&copy; OpenStreetMap contributors'
            });
          }
          if (data.thresholds) {
            setThresholds({
              review_score: Number(data.thresholds.review_score || 40),
              block_score: Number(data.thresholds.block_score || 80),
            });
          }
        }
      })
      .catch(() => {});
  }, []);

  // Partition all transactions into coordinates vs missing coordinates
  const { transactionsWithCoords, transactionsWithoutCoords } = useMemo(() => {
    const withCoords: Transaction[] = [];
    const withoutCoords: Transaction[] = [];

    for (const t of transactions) {
      const hasValidCoords = t.lat != null && t.lon != null && 
        !isNaN(t.lat) && !isNaN(t.lon) && 
        !(t.lat === 0 && t.lon === 0 && (!t.city || t.city === "Unknown" || t.city === "Unspecified"));

      if (hasValidCoords) {
        withCoords.push(t);
      } else {
        withoutCoords.push(t);
      }
    }

    return { transactionsWithCoords: withCoords, transactionsWithoutCoords: withoutCoords };
  }, [transactions]);

  // Filter transactions with coordinates based on user criteria
  const filteredWithCoords = useMemo(() => {
    let result = transactionsWithCoords.filter((t) => {
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
  }, [transactionsWithCoords, riskFilter, countryFilter, channelFilter, accountSearch, blockedOnly, playbackIndex]);

  // Filtered hidden transactions for the modal
  const filteredHiddenList = useMemo(() => {
    if (!hiddenSearch.trim()) return transactionsWithoutCoords;
    const q = hiddenSearch.toLowerCase();
    return transactionsWithoutCoords.filter((t) => 
      t.transaction_id.toLowerCase().includes(q) ||
      t.account_id.toLowerCase().includes(q) ||
      t.channel.toLowerCase().includes(q) ||
      t.decision.toLowerCase().includes(q)
    );
  }, [transactionsWithoutCoords, hiddenSearch]);

  // Total and Count Identity
  const totalEvents = transactions.length;
  const shownCount = filteredWithCoords.length;
  const hiddenCount = Math.max(0, totalEvents - shownCount);

  // Unique country list for filter
  const countries = useMemo(() => {
    const set = new Set<string>();
    transactionsWithCoords.forEach((t) => t.country && set.add(t.country.toUpperCase()));
    return Array.from(set).sort();
  }, [transactionsWithCoords]);

  // Count unique cell towers in current view
  const towerCount = useMemo(() => {
    const towerIds = new Set<string>();
    filteredWithCoords.forEach((t) => {
      const id = t.cell_tower?.tower_id || t.tower?.tower_id;
      if (id) towerIds.add(id);
    });
    return towerIds.size;
  }, [filteredWithCoords]);

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

    // Create Leaflet instance with global boundary restrictions and world wrap jump
    const map = L.map(mapContainerRef.current, {
      center: [20.0, 0.0],
      zoom: 2.5,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      worldCopyJump: true,
      maxBounds: [[-85, -210], [85, 210]],
      maxBoundsViscosity: 0.95,
    });
    mapRef.current = map;

    // Position Zoom Controls at Top Right so they never collide with bottom playback
    L.control.zoom({ position: "topright" }).addTo(map);

    // Track zoom events
    map.on("zoomend", () => {
      setCurrentZoom(map.getZoom());
    });

    // Create custom pane for cell towers under markerPane (zIndex 350)
    map.createPane("towersPane");
    const towersPane = map.getPane("towersPane");
    if (towersPane) {
      towersPane.style.zIndex = "350";
    }

    // Create custom pane for heatmap overlay (zIndex 450)
    map.createPane("heatmapPane");
    const heatmapPane = map.getPane("heatmapPane");
    if (heatmapPane) {
      heatmapPane.style.zIndex = "450";
    }

    // CartoDB Dark Matter tiles natively draw dark borders & continents; GeoJSON bypassed for instant 0ms mount

    // Add Tile Layer with Edge CDN subdomains & high-performance buffer caching
    const tileLayer = L.tileLayer(tileConfig.url, {
      attribution: tileConfig.attribution,
      subdomains: "abcd",
      minZoom: 2,
      maxZoom: 19,
      noWrap: false,
      keepBuffer: 8,
      updateWhenIdle: true,
    });

    tileLayer.on("tileerror", () => {
      setTileError(true);
    });

    tileLayer.addTo(map);

    // Initialize marker cluster group with Donut cluster icons and hover proportions
    const clusterGroup = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster: any) => {
        const markers = cluster.getAllChildMarkers();
        const total = markers.length;
        let allowCount = 0;
        let reviewCount = 0;
        let blockCount = 0;

        for (const m of markers) {
          const dec = (m.options.decision || "ALLOW").toUpperCase();
          if (dec === "BLOCK") blockCount++;
          else if (dec === "REVIEW" || dec === "REVIEW_QUEUE") reviewCount++;
          else allowCount++;
        }

        const allowPct = Math.round((allowCount / total) * 100);
        const reviewPct = Math.round((reviewCount / total) * 100);
        const blockPct = Math.round((blockCount / total) * 100);

        // Coloring Rule: 0-10% green, 10-30% amber, 30%+ red. Never color red from a single block.
        const isRed = blockCount > 1 && blockPct >= 30;
        const isAmber = !isRed && (blockPct >= 10 || reviewPct >= 20 || blockCount === 1);
        const clusterColor = isRed ? "#ef4444" : isAmber ? "#f59e0b" : "#10b981";

        // Proportions for conic-gradient donut ring
        const degAllow = Math.round((allowCount / total) * 360);
        const degReview = Math.round(degAllow + (reviewCount / total) * 360);

        const tooltipText = `${total} events: ${allowPct}% allow, ${reviewPct}% review, ${blockPct}% block`;
        const size = Math.max(36, Math.min(52, 34 + Math.log10(total) * 9));
        const innerSize = size - 8;

        const html = `
          <div title="${tooltipText}" style="
            width: ${size}px;
            height: ${size}px;
            border-radius: 50%;
            background: conic-gradient(
              #10b981 0deg ${degAllow}deg,
              #f59e0b ${degAllow}deg ${degReview}deg,
              #ef4444 ${degReview}deg 360deg
            );
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 12px ${clusterColor}99;
            cursor: pointer;
            transition: transform 0.15s ease;
          ">
            <div style="
              width: ${innerSize}px;
              height: ${innerSize}px;
              border-radius: 50%;
              background: #080c14;
              border: 2px solid ${clusterColor};
              display: flex;
              align-items: center;
              justify-content: center;
              color: #ffffff;
              font-weight: 700;
              font-family: monospace;
              font-size: ${size > 42 ? 12 : 11}px;
            ">
              ${total}
            </div>
          </div>
        `;

        return L.divIcon({
          html,
          className: "custom-donut-cluster",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
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

  // Wire global handler for popup drawer inspection
  useEffect(() => {
    (window as any).__selectAndOpenTx = (txId: string) => {
      const match = transactions.find((t) => t.transaction_id === txId);
      if (match) {
        onSelectTransaction(match);
      }
    };
    return () => {
      delete (window as any).__selectAndOpenTx;
    };
  }, [transactions, onSelectTransaction]);

  // Update Markers & Clusters when filtered transactions change (independent of zoom level!)
  useEffect(() => {
    if (!mapRef.current || !clusterGroupRef.current) return;

    clusterGroupRef.current.clearLayers();
    const newMarkers: L.Marker[] = [];

    filteredWithCoords.forEach((tx) => {
      if (tx.lat == null || tx.lon == null) return;

      const isSelected = tx.transaction_id === selectedTxId;
      const isBlock = tx.decision === "BLOCK" || tx.status === "QUARANTINED";
      const isReview = tx.decision === "REVIEW_QUEUE" || tx.decision === "REVIEW";
      const formattedAmount = formatCurrency(tx.amount, tx.currency);
      const riskScore = Math.round(tx.risk_score);
      const iconSymbol = isBlock ? "🚨" : isReview ? "⚠️" : "🛡️";

      const pinHtml = `
        <div class="soc-threat-pin ${isBlock ? 'pin-block' : isReview ? 'pin-review' : 'pin-allow'} ${isSelected ? 'pin-selected' : ''}">
          <div class="pin-badge">
            <span class="pin-icon">${iconSymbol}</span>
            <span class="pin-amount">${formattedAmount}</span>
            <span class="pin-score">${riskScore}</span>
          </div>
          <div class="pin-stem"></div>
        </div>
      `;

      const pinIcon = L.divIcon({
        className: "soc-threat-marker-wrapper",
        html: pinHtml,
        iconSize: [84, 28],
        iconAnchor: [42, 28],
        popupAnchor: [0, -28],
      });

      const marker = L.marker([tx.lat, tx.lon], {
        icon: pinIcon,
        zIndexOffset: isSelected ? 1000 : (isBlock ? 500 : 100),
      } as any);

      (marker as any).options.decision = isBlock ? "BLOCK" : isReview ? "REVIEW" : "ALLOW";

      // Rich High-Definition Threat Card Popup
      const popupContent = `
        <div class="soc-detail-popup font-sans text-slate-100">
          <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #1e293b;">
            <div style="font-family:monospace; font-size:12px; font-weight:700; color:#ffffff;">
              ${tx.transaction_id}
            </div>
            <span style="padding:2px 8px; border-radius:4px; font-size:10px; font-weight:700; font-family:monospace; ${
              isBlock ? 'background:#450a0a; color:#fca5a5; border:1px solid #ef4444;' :
              isReview ? 'background:#451a03; color:#fcd34d; border:1px solid #f59e0b;' :
              'background:#064e3b; color:#6ee7b7; border:1px solid #10b981;'
            }">
              ${tx.decision}
            </span>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:baseline; padding:8px 0; border-bottom:1px solid #1e293b;">
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; font-weight:600;">Amount</div>
              <div style="font-size:16px; font-weight:800; color:#ffffff; font-family:monospace;">${formattedAmount}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; font-weight:600;">Risk Score</div>
              <div style="font-size:14px; font-weight:700; font-family:monospace; color:${isBlock ? '#ef4444' : isReview ? '#f59e0b' : '#10b981'};">
                ${riskScore} / 100
              </div>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; padding:8px 0; font-family:monospace; font-size:11px; border-bottom:1px solid #1e293b;">
            <div>
              <span style="font-size:9px; color:#64748b; text-transform:uppercase; display:block;">Location</span>
              <span style="color:#e2e8f0; font-weight:600;">${tx.city || "Mumbai"}, ${tx.country || "IN"}</span>
            </div>
            <div>
              <span style="font-size:9px; color:#64748b; text-transform:uppercase; display:block;">Channel</span>
              <span style="color:#e2e8f0;">${(tx.channel || "MOBILE_APP").replace(/_/g, ' ')}</span>
            </div>
            ${tx.cell_tower ? `
              <div style="grid-column: span 2;">
                <span style="font-size:9px; color:#64748b; text-transform:uppercase; display:block;">Nearby Carrier Tower</span>
                <span style="color:#d8b4fe;">${tx.cell_tower.carrier || "Cellular"} · ${Math.round(tx.cell_tower.distance_meters || 0)}m (${tx.cell_tower.tower_id})</span>
              </div>
            ` : ""}
            ${tx.flags && tx.flags.length > 0 ? `
              <div style="grid-column: span 2;">
                <span style="font-size:9px; color:#64748b; text-transform:uppercase; display:block;">Triggered Risk Rules</span>
                <span style="color:#fcd34d;">${tx.flags.map((f: any) => f.label || f.flag).join(", ")}</span>
              </div>
            ` : ""}
          </div>

          <button
            style="width:100%; margin-top:10px; padding:8px 12px; border-radius:6px; background:#0284c7; color:#ffffff; font-weight:600; font-size:11px; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 4px 12px rgba(2,132,199,0.4);"
            onclick="window.__selectAndOpenTx && window.__selectAndOpenTx('${tx.transaction_id}')"
          >
            <span>Open Full Forensic Drawer</span>
            <span>➔</span>
          </button>
        </div>
      `;

      marker.bindPopup(() => popupContent, {
        className: "custom-soc-popup",
        maxWidth: 320,
        minWidth: 260,
      });

      marker.on("click", () => {
        marker.openPopup();
        onSelectTransaction(tx);
      });

      marker.on("mouseover", () => {
        setHoveredAccountId(tx.account_id);
      });

      marker.on("mouseout", () => {
        setHoveredAccountId(null);
      });

      newMarkers.push(marker);
    });

    clusterGroupRef.current.addLayers(newMarkers);

    // Initial fit OR explicit country filter change ONLY - NEVER fit bounds on zoom!
    if (newMarkers.length > 0 && mapRef.current) {
      if (!initialFitDoneRef.current) {
        initialFitDoneRef.current = true;
        const bounds = L.latLngBounds(newMarkers.map((m) => m.getLatLng()));
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
      } else if (countryFilter !== prevCountryFilterRef.current) {
        prevCountryFilterRef.current = countryFilter;
        if (countryFilter !== "ALL") {
          const bounds = L.latLngBounds(newMarkers.map((m) => m.getLatLng()));
          mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 });
        } else {
          mapRef.current.flyTo([20.0, 0.0], 2.5, { duration: 1.0 });
        }
      }
    }
  }, [filteredWithCoords, selectedTxId, countryFilter]);

  // Update Cell Towers layer independently without resetting map zoom or bounds
  useEffect(() => {
    if (!mapRef.current) return;
    cellTowersLayerRef.current.clearLayers();

    const isZoomValidForTowers = currentZoom >= MIN_TOWER_ZOOM;
    if (!showCellTowers || !isZoomValidForTowers) return;

    // Aggregate transactions by unique cell tower
    const towersMap = new Map<string, {
      tower: any;
      transactions: Transaction[];
      totalAmount: number;
      dangerousCount: number;
      reviewCount: number;
      allowCount: number;
    }>();

    filteredWithCoords.forEach((tx) => {
      const ct = tx.cell_tower || (tx as any).tower;
      if (!ct || !ct.tower_id || ct.lat == null || ct.lon == null) return;

      let entry = towersMap.get(ct.tower_id);
      if (!entry) {
        entry = {
          tower: ct,
          transactions: [],
          totalAmount: 0,
          dangerousCount: 0,
          reviewCount: 0,
          allowCount: 0,
        };
        towersMap.set(ct.tower_id, entry);
      }

      entry.transactions.push(tx);
      entry.totalAmount += (tx.amount || 0);
      const isDangerous = tx.decision === "BLOCK" || tx.status === "QUARANTINED" || (tx.risk_score || 0) >= 80;
      const isReview = tx.decision === "REVIEW_QUEUE" || tx.decision === "REVIEW";

      if (isDangerous) entry.dangerousCount++;
      else if (isReview) entry.reviewCount++;
      else entry.allowCount++;
    });

    towersMap.forEach((entry) => {
      const ct = entry.tower;
      const totalCount = entry.transactions.length;
      const dangerousCount = entry.dangerousCount;
      const dangerPct = totalCount > 0 ? Math.round((dangerousCount / totalCount) * 100) : 0;
      const totalAmountFormatted = formatCurrency(entry.totalAmount, entry.transactions[0]?.currency || "USD");

      const hasDangerousTraffic = dangerousCount > 0;
      const badgeBg = hasDangerousTraffic ? "#581c87" : "#3b0764";
      const badgeBorder = hasDangerousTraffic ? "#ef4444" : "#a855f7";
      const iconShadow = hasDangerousTraffic ? "0 0 12px rgba(239, 68, 68, 0.75)" : "0 0 8px rgba(168, 85, 247, 0.6)";

      const customTowerIcon = L.divIcon({
        className: "cell-tower-custom-icon",
        html: `
          <div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:${badgeBg};border:1.5px solid ${badgeBorder};box-shadow:${iconShadow};cursor:pointer;position:relative;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${hasDangerousTraffic ? '#fca5a5' : '#f3e8ff'}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M7 7l5-5 5 5M4 14h16M2 22h20M9 18l3-3 3 3"/></svg>
            ${dangerousCount > 0 ? `<span style="position:absolute;top:-4px;right:-4px;width:9px;height:9px;border-radius:50%;background:#ef4444;border:1.5px solid #ffffff;box-shadow:0 0 6px #ef4444;"></span>` : ''}
          </div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -16],
      });

      const towerMarker = L.marker([ct.lat, ct.lon], {
        icon: customTowerIcon,
        pane: "towersPane",
      });

      // Quick hover tooltip
      towerMarker.bindTooltip(`
        <div style="font-family:monospace; font-size:11px;">
          <b>🗼 ${ct.carrier || "Cellular Provider"}</b><br/>
          ID: ${ct.tower_id}<br/>
          Traffic: <b>${totalCount} txs</b> (${totalAmountFormatted})<br/>
          Threat Status: <span style="color:${dangerousCount > 0 ? '#ef4444' : '#10b981'}; font-weight:700;">${dangerousCount} Dangerous (${dangerPct}%)</span><br/>
          <i style="color:#94a3b8; font-size:10px;">Click tower to inspect location & dangerous events</i>
        </div>
      `, { direction: "top", offset: [0, -10] });

      // Rich Click Popup Card: Location, Amount of transactions, Dangerous count, and connected items
      const recentTxsHtml = entry.transactions.slice(0, 5).map((t) => {
        const isB = t.decision === "BLOCK" || t.status === "QUARANTINED";
        const isR = t.decision === "REVIEW_QUEUE" || t.decision === "REVIEW";
        const color = isB ? "#ef4444" : isR ? "#f59e0b" : "#10b981";
        const bg = isB ? "#450a0a" : isR ? "#451a03" : "#064e3b";
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-family:monospace; font-size:10.5px; border-bottom:1px solid #1e293b;">
            <span style="color:#cbd5e1; cursor:pointer;" onclick="window.__selectAndOpenTx && window.__selectAndOpenTx('${t.transaction_id}')">
              ${t.transaction_id}
            </span>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-weight:700; color:#ffffff;">${formatCurrency(t.amount, t.currency)}</span>
              <span style="padding:1px 5px; border-radius:3px; background:${bg}; color:${color}; font-size:9px; font-weight:700;">${t.decision}</span>
            </div>
          </div>
        `;
      }).join("");

      const towerPopupContent = `
        <div class="custom-tower-popup-content font-sans text-slate-100" style="min-width:280px; max-width:340px;">
          <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #7e22ce;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">🗼</span>
              <div>
                <h4 style="font-weight:700; color:#ffffff; font-size:13px; margin:0;">${ct.carrier || "Cellular TeleCom"}</h4>
                <div style="font-size:10px; font-family:monospace; color:#d8b4fe;">${ct.sector || ct.tower_id}</div>
              </div>
            </div>
            <span style="padding:2px 6px; border-radius:4px; font-size:9px; font-weight:700; font-family:monospace; background:#581c87; color:#f3e8ff; border:1px solid #a855f7;">
              ${ct.badge || "LIVE CELL"}
            </span>
          </div>

          <!-- Exact Location with 1-Click Copy -->
          <div style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:8px; margin:8px 0; font-family:monospace;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:9px; color:#94a3b8; text-transform:uppercase; font-weight:600;">Tower Location</span>
              <button
                style="background:#1e293b; border:1px solid #334155; color:#cbd5e1; border-radius:4px; padding:1px 6px; font-size:9px; cursor:pointer;"
                onclick="navigator.clipboard.writeText('${ct.lat.toFixed(6)}, ${ct.lon.toFixed(6)}')"
                title="Copy coordinates"
              >
                📋 Copy Lat/Lon
              </button>
            </div>
            <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-top:2px;">
              ${ct.lat.toFixed(6)}, ${ct.lon.toFixed(6)}
            </div>
            <div style="font-size:10px; color:#94a3b8; margin-top:2px;">
              ${ct.city || "Mumbai"}, ${ct.country || "IN"} · Coverage: ±${ct.accuracy_meters || 450}m
            </div>
          </div>

          <!-- Volume & Dangerous Transaction KPIs -->
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <div style="background:#0f172a; border:1px solid #1e293b; border-radius:8px; padding:6px 8px;">
              <div style="font-size:9px; color:#94a3b8; text-transform:uppercase;">Volume Routed</div>
              <div style="font-size:14px; font-weight:800; color:#ffffff; font-family:monospace;">${totalAmountFormatted}</div>
              <div style="font-size:9px; color:#64748b; font-family:monospace;">${totalCount} Transactions</div>
            </div>
            <div style="background:${dangerousCount > 0 ? '#260a0a' : '#042014'}; border:1px solid ${dangerousCount > 0 ? '#b91c1c' : '#059669'}; border-radius:8px; padding:6px 8px;">
              <div style="font-size:9px; color:${dangerousCount > 0 ? '#fca5a5' : '#6ee7b7'}; text-transform:uppercase;">Dangerous Txs</div>
              <div style="font-size:14px; font-weight:800; font-family:monospace; color:${dangerousCount > 0 ? '#ef4444' : '#10b981'};">
                🚨 ${dangerousCount} (${dangerPct}%)
              </div>
              <div style="font-size:9px; color:#94a3b8; font-family:monospace;">${entry.allowCount} Safe · ${entry.reviewCount} Review</div>
            </div>
          </div>

          <!-- Connected Transactions -->
          <div>
            <div style="font-size:9px; font-weight:700; color:#94a3b8; text-transform:uppercase; margin-bottom:4px;">
              Recent Events Routed (${totalCount})
            </div>
            <div style="max-height:105px; overflow-y:auto; padding-right:2px;">
              ${recentTxsHtml}
            </div>
          </div>
        </div>
      `;

      towerMarker.bindPopup(towerPopupContent, {
        className: "custom-tower-popup",
        maxWidth: 340,
        minWidth: 280,
      });

      // Accuracy coverage circle
      const accuracyCircle = L.circle([ct.lat, ct.lon], {
        radius: ct.accuracy_meters || 450,
        color: hasDangerousTraffic ? "#dc2626" : "#9333ea",
        weight: 1.2,
        fillColor: hasDangerousTraffic ? "#ef4444" : "#a855f7",
        fillOpacity: hasDangerousTraffic ? 0.16 : 0.09,
        pane: "towersPane",
      });

      // Connector lines to transactions
      entry.transactions.slice(0, 15).forEach((tx) => {
        if (tx.lat != null && tx.lon != null) {
          const isDanger = tx.decision === "BLOCK" || tx.status === "QUARANTINED";
          const connector = L.polyline([[ct.lat, ct.lon], [tx.lat, tx.lon]], {
            color: isDanger ? "#ef4444" : "#a855f7",
            weight: isDanger ? 1.5 : 1,
            dashArray: isDanger ? "3, 3" : "4, 4",
            opacity: isDanger ? 0.75 : 0.45,
            pane: "towersPane",
          });
          cellTowersLayerRef.current.addLayer(connector);
        }
      });

      cellTowersLayerRef.current.addLayer(towerMarker);
      cellTowersLayerRef.current.addLayer(accuracyCircle);
    });
  }, [filteredWithCoords, showCellTowers, currentZoom]);

  // Update Travel Paths ONLY for the selected account (or hovered account)
  useEffect(() => {
    if (!mapRef.current) return;
    travelPathsLayerRef.current.clearLayers();

    if (!selectedAccount) return;

    // Filter transactions belonging to this account with valid coordinates and sort chronologically
    const accountTxs = transactions
      .filter((t) => t.account_id === selectedAccount && t.lat != null && t.lon != null)
      .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

    if (accountTxs.length < 2) return;

    for (let i = 0; i < accountTxs.length - 1; i++) {
      const t1 = accountTxs[i];
      const t2 = accountTxs[i + 1];

      if (t1.lat == null || t1.lon == null || t2.lat == null || t2.lon == null) continue;

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

      // Midpoint marker with label
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

  // Update Heatmap Layer Toggle - hides clusters so heatmap glows vibrantly
  useEffect(() => {
    if (!mapRef.current) return;

    if (heatLayerRef.current) {
      mapRef.current.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }

    if (showHeatmap && filteredWithCoords.length > 0) {
      // Temporarily remove marker clusters so heatmap thermal glow is 100% visible
      if (clusterGroupRef.current && mapRef.current.hasLayer(clusterGroupRef.current)) {
        mapRef.current.removeLayer(clusterGroupRef.current);
      }

      const heatPoints = filteredWithCoords
        .filter((t) => t.lat != null && t.lon != null)
        .map((t) => [
          t.lat, 
          t.lon, 
          Math.max(0.4, (t.risk_score || 50) / 100)
        ]);

      heatLayerRef.current = (L as any).heatLayer(heatPoints, {
        pane: "heatmapPane",
        radius: 38,
        blur: 24,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.55,
        gradient: {
          0.1: "#06b6d4",
          0.35: "#3b82f6",
          0.6: "#eab308",
          0.8: "#f97316",
          1.0: "#ef4444"
        },
      }).addTo(mapRef.current);
    } else {
      // Restore marker clusters when heatmap is toggled off
      if (clusterGroupRef.current && !mapRef.current.hasLayer(clusterGroupRef.current)) {
        mapRef.current.addLayer(clusterGroupRef.current);
      }
    }
  }, [showHeatmap, filteredWithCoords]);

  // Auto Fly-To on latest incoming SSE transaction
  useEffect(() => {
    if (!autoFlyTo || !latestTxId || !mapRef.current) return;
    const latest = transactions.find((t) => t.transaction_id === latestTxId);
    if (latest && latest.lat != null && latest.lon != null) {
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

  // Global World Reset View
  const handleResetView = () => {
    if (mapRef.current) {
      mapRef.current.flyTo([20.0, 0.0], 2.5, { duration: 1.0 });
    }
  };

  // Instant Region Focus (World, India, US, Europe, Asia)
  const handleFocusRegion = (region: typeof focusRegions[0]) => {
    if (mapRef.current) {
      mapRef.current.flyTo(region.center, region.zoom, { duration: 1.0 });
    }
  };

  // ResizeObserver to ensure map canvas automatically resizes to full viewport without scroll
  useEffect(() => {
    if (!mapContainerRef.current || !mapRef.current) return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.invalidateSize();
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col relative rounded-xl overflow-hidden border border-border shadow-2xl bg-[#080c14]">
      {/* Non-blocking Tile Unavailable Fallback Banner */}
      {tileError && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] px-4 py-2 rounded-lg bg-amber-950/90 border border-amber-600/80 text-amber-200 text-xs flex items-center space-x-2 shadow-2xl backdrop-blur-md animate-fade-in">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>Map tiles unavailable - check MAP_TILE_URL in .env. Showing vector country boundaries.</span>
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

          {/* Quick Region Focus Pills (Escape/World & Region Jump) */}
          <div className="flex items-center space-x-1 border-l border-border pl-2.5">
            <span className="text-[10px] font-semibold text-muted uppercase hidden sm:inline">Focus:</span>
            {focusRegions.map((reg) => (
              <button
                key={reg.label}
                onClick={() => handleFocusRegion(reg)}
                className="px-2 py-0.5 rounded text-[11px] font-medium bg-surface-elevated hover:bg-surface-hover text-slate-300 hover:text-white border border-border flex items-center space-x-1 transition shadow-sm"
                title={`Focus map on ${reg.label}`}
              >
                <span>{reg.icon}</span>
                <span>{reg.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Counters & Layer Toggles */}
        <div className="flex items-center space-x-2">
          {/* Dynamic Counter: "{shown} of {total} events" + link for "{hidden} hidden - no coordinates" */}
          <div className="px-2.5 py-1 rounded-lg bg-surface-elevated font-mono text-[11px] border border-border flex items-center space-x-1.5">
            <span className="text-slate-300">
              <strong className="text-white font-bold">{shownCount}</strong> of <strong className="text-white">{totalEvents}</strong> events
            </span>
            {hiddenCount > 0 && (
              <>
                <span className="text-muted">·</span>
                <button
                  onClick={() => setShowHiddenModal(true)}
                  className="text-amber-400 hover:text-amber-300 underline font-semibold transition"
                  title="Click to view transactions without coordinates"
                >
                  {hiddenCount} hidden - no coordinates
                </button>
              </>
            )}
          </div>

          {/* Cell Towers Toggle with Zoom Gating & Count */}
          <button
            onClick={() => setShowCellTowers(!showCellTowers)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              showCellTowers
                ? "bg-purple-950/70 text-purple-200 border border-purple-700/80 shadow-sm shadow-purple-900/30"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
            title={currentZoom < MIN_TOWER_ZOOM ? `Zoom in to level ${MIN_TOWER_ZOOM}+ to view individual cell towers on the map.` : "Toggle cell tower telemetry layer"}
          >
            <Radio className="h-3 w-3 text-purple-400" />
            <span>
              {currentZoom < MIN_TOWER_ZOOM 
                ? `Cell towers (zoom in · ${towerCount})` 
                : `Cell towers (${towerCount})`}
            </span>
          </button>

          {/* Heatmap Toggle with Active Indicator */}
          <button
            onClick={() => setShowHeatmap(!showHeatmap)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              showHeatmap
                ? "bg-red-950/80 text-red-200 border border-red-500 shadow-md shadow-red-900/40 ring-1 ring-red-500/50"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
            title="Toggle risk-weighted thermal heatmap layer"
          >
            <Flame className={`h-3 w-3 ${showHeatmap ? "text-red-400 animate-pulse" : "text-muted"}`} />
            <span>{showHeatmap ? "Heatmap: ON" : "Heatmap"}</span>
          </button>

          {/* Auto Fly-to Toggle */}
          <button
            onClick={() => setAutoFlyTo(!autoFlyTo)}
            className={`px-2.5 py-1 rounded text-xs font-medium flex items-center space-x-1.5 transition ${
              autoFlyTo
                ? "bg-cyan-950/70 text-cyan-200 border border-cyan-700/80 shadow-sm shadow-cyan-900/30"
                : "bg-surface-elevated text-muted border border-border hover:text-white"
            }`}
            title="Auto-center on incoming SSE transactions"
          >
            <Navigation className="h-3 w-3 text-cyan-400" />
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
          {playbackIndex}% ({shownCount} events)
        </span>
      </div>

      {/* Collapsible Threat Map Legend Card (Config-Driven Bands) */}
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
              {/* Dynamic Decision Colors from Config */}
              <div className="space-y-1">
                <p className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Transaction Risk (Governed)</p>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
                  <span className="text-slate-300 font-mono">Allow (0 - {thresholds.review_score - 1})</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50"></span>
                  <span className="text-slate-300 font-mono">Review Queue ({thresholds.review_score} - {thresholds.block_score - 1})</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50"></span>
                  <span className="text-slate-300 font-mono">Block / Quarantine ({thresholds.block_score} - 100)</span>
                </div>
              </div>

              {/* Cluster Proportion Description */}
              <div className="space-y-1 pt-1 border-t border-border/40">
                <p className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Cluster Doughnut</p>
                <div className="text-[10px] text-muted space-y-0.5">
                  <div>Outer ring: Allow (green) / Review (amber) / Block (red)</div>
                  <div>Border color: 0-10% green, 10-30% amber, 30%+ red</div>
                  <div className="text-slate-400 italic">Single block never colors cluster red</div>
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

              {/* Heatmap Density Legend when active */}
              {showHeatmap && (
                <div className="space-y-1.5 pt-1.5 border-t border-border/40">
                  <p className="text-[10px] uppercase font-bold text-red-400 tracking-wider flex items-center space-x-1">
                    <Flame className="h-3 w-3 text-red-400" />
                    <span>Thermal Risk Density</span>
                  </p>
                  <div className="h-2 rounded-full w-full bg-gradient-to-r from-cyan-400 via-blue-500 via-amber-400 to-red-500 shadow-inner" />
                  <div className="flex justify-between text-[9px] font-mono text-muted">
                    <span>Low Risk (Allow)</span>
                    <span>Review</span>
                    <span>Critical Hotspot</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden Transactions List Modal (Opens when clicking "{hidden} hidden - no coordinates") */}
      {showHiddenModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl bg-surface-elevated border border-border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <div className="flex items-center space-x-2">
                  <EyeOff className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-bold text-white">Events Without Coordinates ({transactionsWithoutCoords.length})</h3>
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  These transactions have no GPS fix, cell telemetry, or IP geolocation and cannot be projected on the basemap.
                </p>
              </div>

              <button 
                onClick={() => setShowHiddenModal(false)}
                className="p-1 rounded-lg text-muted hover:text-white hover:bg-surface transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Filter Search */}
            <div className="p-3 border-b border-border bg-surface-card flex items-center space-x-2">
              <Search className="h-4 w-4 text-muted" />
              <input
                type="text"
                value={hiddenSearch}
                onChange={(e) => setHiddenSearch(e.target.value)}
                placeholder="Search by transaction ID, account, channel, or decision..."
                className="w-full bg-transparent text-xs text-white placeholder-muted focus:outline-none"
              />
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-surface-elevated sticky top-0 z-10 border-b border-border text-[11px] text-muted-dark uppercase font-semibold h-8">
                  <tr>
                    <th className="px-4">Txn ID</th>
                    <th className="px-4">Account</th>
                    <th className="px-4">Amount</th>
                    <th className="px-4">Channel</th>
                    <th className="px-4">Risk & Decision</th>
                    <th className="px-4">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredHiddenList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted">
                        No transactions matched the search query.
                      </td>
                    </tr>
                  ) : (
                    filteredHiddenList.map((tx) => (
                      <tr 
                        key={tx.transaction_id}
                        onClick={() => {
                          onSelectTransaction(tx);
                          setShowHiddenModal(false);
                        }}
                        className="h-10 hover:bg-surface-hover cursor-pointer transition"
                      >
                        <td className="px-4 font-mono font-bold text-cyan-400">{tx.transaction_id}</td>
                        <td className="px-4 font-mono text-slate-300">{tx.account_id}</td>
                        <td className="px-4 font-mono text-white font-semibold">{formatCurrency(tx.amount, tx.currency)}</td>
                        <td className="px-4 text-muted text-[11px]">{tx.channel}</td>
                        <td className="px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                            tx.decision === "BLOCK"
                              ? "bg-red-950 text-red-300 border border-red-800"
                              : tx.decision === "REVIEW" || tx.decision === "REVIEW_QUEUE"
                              ? "bg-amber-950 text-amber-300 border border-amber-800"
                              : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          }`}>
                            {Math.round(tx.risk_score)} · {tx.decision}
                          </span>
                        </td>
                        <td className="px-4 text-[11px] text-muted font-mono">
                          Missing GPS / Cell fix
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-border bg-surface-card flex items-center justify-between text-[11px] text-muted">
              <span>Showing {filteredHiddenList.length} of {transactionsWithoutCoords.length} events without coordinates</span>
              <button
                onClick={() => setShowHiddenModal(false)}
                className="px-3 py-1 rounded bg-surface border border-border hover:bg-surface-hover text-white font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
