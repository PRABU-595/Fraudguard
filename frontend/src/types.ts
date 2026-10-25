export type RiskTier = "CRITICAL" | "ELEVATED" | "NOMINAL";

export interface CellTower {
  tower_id: string;
  carrier: string;
  mcc: number;
  mnc: number;
  lac: number;
  cid: number;
  lat: number | null;
  lon: number | null;
  has_coordinates?: boolean;
  distance_meters: number;
  distance_km: number;
  accuracy_meters: number;
  timestamp_fix: string;
  badge: "LIVE" | "SIMULATED";
}

export interface NetworkTelemetry {
  ip: string;
  isp: string;
  asn: string;
  connection_type: string;
  is_vpn: boolean;
  is_tor: boolean;
  badge: "LIVE" | "SIMULATED";
}

export interface DeviceTelemetry {
  fingerprint: string;
  os_browser: string;
  is_new_device: boolean;
  badge: "LIVE" | "SIMULATED";
}

export interface RiskFlag {
  flag: string;
  label: string;
  reason: string;
}

export interface Transaction {
  id: string;
  transaction_id: string;
  account_id: string;
  destination_account: string;
  amount: number;
  currency: string;
  status: "APPROVED" | "QUARANTINED" | "PENDING_REVIEW" | "RELEASED" | "CONFIRMED_FRAUD" | string;
  decision: "ALLOW" | "REVIEW_QUEUE" | "BLOCK" | string;
  risk_score: number;
  risk_tier: RiskTier;
  risk_color: string;
  lat: number | null;
  lon: number | null;
  has_coordinates?: boolean;
  city: string;
  country: string;
  source: "CELL_TOWER" | "GPS" | "IP" | string;
  accuracy_meters: number;
  timestamp: string;
  relative_time?: string;
  counterparty: string;
  merchant_category: string;
  channel: "POS" | "ONLINE_WEB" | "MOBILE_APP" | "WIRE" | string;
  tower: CellTower;
  cell_tower?: CellTower;
  flags: RiskFlag[];
  network?: NetworkTelemetry;
  device?: DeviceTelemetry;
  badge: "LIVE" | "SIMULATED";
  gap_since_previous?: string;
  account_mini_timeline?: Transaction[];
}

export interface SystemStats {
  total_events: number;
  total_processed: number;
  flagged_count: number;
  blocked_count: number;
  block_rate_pct: number;
  quarantine_active: number;
  quarantine_backlog: number;
  sla_breaches: number;
  stream_active: boolean;
  stream_state: "LIVE" | "RECONNECTING" | "PAUSED" | "OFF";
  tps: number;
  mttr_minutes: number;
  sparkline_30m: number[];
  delta_vs_previous_hour_pct: number;
  uptime_seconds?: number;
  environment?: string;
}
