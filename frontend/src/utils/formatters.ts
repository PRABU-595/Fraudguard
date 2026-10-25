export function formatCurrency(amount: number, currency: string = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export function formatShortId(id: string): string {
  if (!id) return "";
  if (id.length <= 12) return id;
  return `${id.slice(0, 7)}…${id.slice(-4)}`;
}

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString.replace("Z", "+00:00"));
    const now = new Date();
    const diffSec = Math.max(1, Math.floor((now.getTime() - d.getTime()) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return isoString;
  }
}

export function formatFullTime(isoString: string): { utc: string; local: string } {
  try {
    const d = new Date(isoString);
    return {
      utc: d.toUTCString(),
      local: d.toLocaleString(),
    };
  } catch {
    return { utc: isoString, local: isoString };
  }
}

export function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export const FLAG_DESCRIPTIONS: Record<string, string> = {
  IMPOSSIBLE_TRAVEL: "Impossible Travel (>900 km/h)",
  ORIGIN_TOR: "Tor Exit Node",
  TOR_EXIT_NODE: "Tor Exit Relay",
  HIGH_VELOCITY: "High Velocity Spike",
  VELOCITY_SPIKE: "Velocity Surge",
  RAPID_SUCCESSION: "Rapid Succession Replay",
  BURST_ACTIVITY: "Burst Velocity Activity",
  AMOUNT_ANOMALY: "Amount Anomaly (>3σ)",
  AMOUNT_SPIKE: "Sudden Amount Spike",
  GEO_ORIGIN_MISMATCH: "Country Mismatch",
  LOCATION_MISMATCH: "Location Anomaly",
  UNUSUAL_HOUR: "Off-Hour Transaction",
  NEW_ACCOUNT: "New Account Activity",
  UNVERIFIED_CONTACT: "Unverified MFA Profile",
  CHANNEL_RISK: "High-Risk Channel",
};

export function getHumanSignalLabel(flagName: string): string {
  return FLAG_DESCRIPTIONS[flagName] || flagName.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
}
