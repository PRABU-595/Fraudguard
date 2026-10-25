"""
FraudGuard Tower & Geographic Telemetry Helper
Provides Haversine distance calculation, cell tower generation, coordinate enrichment,
carrier mapping, and SOC plain-English flag explanations.
"""

import hashlib
import math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

CARRIERS_BY_COUNTRY: Dict[str, List[Dict[str, Any]]] = {
    "US": [
        {"carrier": "Verizon Wireless", "mcc": 311, "mnc": 480},
        {"carrier": "AT&T Mobility", "mcc": 310, "mnc": 410},
        {"carrier": "T-Mobile USA", "mcc": 310, "mnc": 260},
    ],
    "GB": [
        {"carrier": "EE Limited", "mcc": 234, "mnc": 30},
        {"carrier": "Vodafone UK", "mcc": 234, "mnc": 15},
        {"carrier": "O2 UK", "mcc": 234, "mnc": 10},
    ],
    "DE": [
        {"carrier": "Deutsche Telekom", "mcc": 262, "mnc": 1},
        {"carrier": "Vodafone Germany", "mcc": 262, "mnc": 2},
        {"carrier": "Telefónica O2", "mcc": 262, "mnc": 3},
    ],
    "IN": [
        {"carrier": "Reliance Jio", "mcc": 405, "mnc": 861},
        {"carrier": "Bharti Airtel", "mcc": 404, "mnc": 45},
        {"carrier": "Vodafone Idea", "mcc": 404, "mnc": 20},
    ],
    "JP": [
        {"carrier": "NTT Docomo", "mcc": 440, "mnc": 10},
        {"carrier": "SoftBank Corp", "mcc": 440, "mnc": 20},
        {"carrier": "au by KDDI", "mcc": 440, "mnc": 51},
    ],
    "FR": [
        {"carrier": "Orange France", "mcc": 208, "mnc": 1},
        {"carrier": "SFR", "mcc": 208, "mnc": 10},
        {"carrier": "Bouygues Telecom", "mcc": 208, "mnc": 20},
    ],
    "SG": [
        {"carrier": "Singtel Mobile", "mcc": 525, "mnc": 1},
        {"carrier": "StarHub", "mcc": 525, "mnc": 5},
        {"carrier": "M1 Singapore", "mcc": 525, "mnc": 3},
    ],
    "AU": [
        {"carrier": "Telstra", "mcc": 505, "mnc": 1},
        {"carrier": "Optus", "mcc": 505, "mnc": 2},
        {"carrier": "TPG Telecom", "mcc": 505, "mnc": 3},
    ],
    "NL": [
        {"carrier": "KPN Mobile", "mcc": 204, "mnc": 8},
        {"carrier": "Vodafone Netherlands", "mcc": 204, "mnc": 4},
    ],
    "CH": [
        {"carrier": "Swisscom", "mcc": 228, "mnc": 1},
        {"carrier": "Sunrise Communications", "mcc": 228, "mnc": 2},
    ],
    "BR": [
        {"carrier": "Vivo Brazil", "mcc": 724, "mnc": 10},
        {"carrier": "Claro Brasil", "mcc": 724, "mnc": 5},
    ],
    "AE": [
        {"carrier": "e& (Etisalat)", "mcc": 424, "mnc": 2},
        {"carrier": "du Telecom", "mcc": 424, "mnc": 3},
    ],
    "CA": [
        {"carrier": "Rogers Wireless", "mcc": 302, "mnc": 720},
        {"carrier": "Bell Mobility", "mcc": 302, "mnc": 610},
    ],
}

DEFAULT_CARRIER = {"carrier": "Global Telecom Link", "mcc": 901, "mnc": 1}

FLAG_EXPLANATIONS: Dict[str, str] = {
    "IMPOSSIBLE_TRAVEL": "Consecutive transactions occurred faster than physical jet travel speed (>900 km/h).",
    "ORIGIN_TOR": "Request origin IP resolved to a recognized Tor anonymity network exit node.",
    "TOR_EXIT_NODE": "Origin IP confirmed in dynamic Tor directory index.",
    "HIGH_VELOCITY": "Transaction velocity exceeded 5 events within a 60-second sliding window.",
    "VELOCITY_SPIKE": "Sudden frequency surge significantly exceeding cardholder's baseline.",
    "RAPID_SUCCESSION": "Transactions executed within sub-second intervals indicating automated replay.",
    "BURST_ACTIVITY": "Concentrated bursts of transactions directed across disparate destinations.",
    "AMOUNT_ANOMALY": "Transaction amount exceeds statistical upper bound (3σ) for this account.",
    "AMOUNT_SPIKE": "Substantial deviation from account's 30-day moving average.",
    "GEO_ORIGIN_MISMATCH": "Transaction origin country does not match cardholder billing country.",
    "LOCATION_MISMATCH": "Observed device coordinates deviate from primary domicile account profile.",
    "UNUSUAL_HOUR": "Transaction initiated during cardholder's historical dormant hours (2am - 5am local).",
    "NEW_ACCOUNT": "Activity on newly provisioned account (< 7 days since KYC issuance).",
    "UNVERIFIED_CONTACT": "Cardholder lacks verified two-factor authentication recovery contact.",
    "CHANNEL_RISK": "High-risk unauthenticated transaction channel or headless agent signature.",
}


def calculate_haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two geographic points in meters."""
    R = 6371000.0  # Earth's mean radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (math.sin(delta_phi / 2.0) ** 2 +
         math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(max(0.0, a)), math.sqrt(max(0.0, 1.0 - a)))
    return round(R * c, 1)


def generate_cell_tower(txn_id: str, lat: float, lon: float, country: str, timestamp_str: str) -> Dict[str, Any]:
    """Deterministically derive a realistic nearby cell tower for a given transaction."""
    # Seed hashing off txn_id for repeatability
    digest = hashlib.sha256(f"{txn_id}_tower".encode("utf-8")).hexdigest()
    int_seed = int(digest[:8], 16)

    # Place tower radially between 180m and 1050m from transaction
    angle = (int_seed % 360) * (math.pi / 180.0)
    radial_dist_m = 180.0 + ((int_seed >> 8) % 870)  # 180m to 1050m

    # Convert radial displacement to lat/lon degrees
    lat_rad = math.radians(lat)
    cos_lat = max(0.1, math.cos(lat_rad))
    delta_lat = (radial_dist_m * math.cos(angle)) / 111139.0
    delta_lon = (radial_dist_m * math.sin(angle)) / (111139.0 * cos_lat)

    tower_lat = round(lat + delta_lat, 6)
    tower_lon = round(lon + delta_lon, 6)
    dist_m = calculate_haversine_meters(lat, lon, tower_lat, tower_lon)

    carriers = CARRIERS_BY_COUNTRY.get(country.upper(), [DEFAULT_CARRIER])
    carrier_info = carriers[int_seed % len(carriers)]

    lac = 1000 + (int_seed % 8999)
    cid = 10000 + ((int_seed >> 4) % 89999)
    tower_id = f"{carrier_info['mcc']}-{carrier_info['mnc']}-{lac}-{cid}"

    accuracy = round(20.0 + ((int_seed % 500) / 10.0), 1)  # 20.0m to 70.0m

    # Fix timestamp slightly prior to txn timestamp
    try:
        dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        fix_dt = dt - timedelta(seconds=(int_seed % 12) + 1)
        fix_ts = fix_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        fix_ts = timestamp_str

    return {
        "tower_id": tower_id,
        "carrier": carrier_info["carrier"],
        "mcc": carrier_info["mcc"],
        "mnc": carrier_info["mnc"],
        "lac": lac,
        "cid": cid,
        "lat": tower_lat,
        "lon": tower_lon,
        "distance_meters": dist_m,
        "distance_km": round(dist_m / 1000.0, 3),
        "accuracy_meters": accuracy,
        "timestamp_fix": fix_ts,
        "badge": "SIMULATED" if "sim" in txn_id.lower() or "test" in txn_id.lower() or "t0" in txn_id.lower() else "LIVE",
    }


def enrich_map_transaction(record: Dict[str, Any], all_records: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Enrich a transaction record with all attributes required by the Map & Detail Drawer."""
    from src.location_checker import CITY_COORDINATES

    txn_id = record.get("transaction_id") or record.get("txn_id") or "tx_unknown"
    account_id = record.get("account_id") or record.get("source_account") or "acc_unknown"
    dest_account = record.get("destination_account") or "acc_merchant_direct"

    # Coordinates resolution
    lat = record.get("lat") or record.get("latitude")
    lon = record.get("lon") or record.get("longitude")
    city = record.get("transaction_city") or (record.get("origin") or {}).get("city") or "New York"
    country = record.get("transaction_country") or (record.get("origin") or {}).get("country") or "US"

    if lat is None or lon is None:
        city_lower = str(city).strip().lower()
        coords = CITY_COORDINATES.get(city_lower)
        if not coords:
            # Fallback
            coords = CITY_COORDINATES.get("new york", {"lat": 40.7128, "lon": -74.0060, "country": "US"})
        
        # Add deterministic sub-kilometer jitter per transaction ID so markers don't stack exactly on top of each other
        h = int(hashlib.md5(txn_id.encode("utf-8")).hexdigest()[:6], 16)
        j_lat = ((h % 200) - 100) * 0.0003
        j_lon = (((h >> 8) % 200) - 100) * 0.0003
        lat = round(coords["lat"] + j_lat, 6)
        lon = round(coords["lon"] + j_lon, 6)
        if not country or country == "US":
            country = coords.get("country", "US")

    lat = round(float(lat), 6)
    lon = round(float(lon), 6)

    # Decision and Risk
    decision = str(record.get("decision") or record.get("action") or "ALLOW").upper()
    if record.get("status") == "QUARANTINED":
        decision = "BLOCK"
    elif record.get("status") == "PENDING_REVIEW":
        decision = "REVIEW_QUEUE"

    risk_score = float(record.get("risk_score") or record.get("score") or 0.0)
    if risk_score >= 80 or decision == "BLOCK":
        risk_tier = "CRITICAL"
        risk_color = "#ef4444"  # Red
    elif risk_score >= 40 or decision in ("REVIEW_QUEUE", "REVIEW"):
        risk_tier = "ELEVATED"
        risk_color = "#f59e0b"  # Amber
    else:
        risk_tier = "NOMINAL"
        risk_color = "#10b981"  # Green

    source_fix = record.get("fix_source") or ("CELL_TOWER" if ("sim" in txn_id or "travel" in txn_id) else "GPS")
    accuracy_m = float(record.get("accuracy_meters") or 18.5)

    timestamp_str = str(record.get("timestamp") or record.get("quarantine_ts") or datetime.now(timezone.utc).isoformat())

    # Build tower
    tower = generate_cell_tower(txn_id, lat, lon, country, timestamp_str)

    # Flags and reasons
    raw_flags = record.get("flags") or record.get("rule_violations") or []
    flags_enriched = []
    for f in raw_flags:
        f_str = str(f).upper()
        flags_enriched.append({
            "flag": f_str,
            "label": f_str.replace("_", " ").title(),
            "reason": FLAG_EXPLANATIONS.get(f_str, "Algorithmic risk rule violation triggered."),
        })

    # Badge: Live vs Simulated
    is_sim = "sim" in txn_id.lower() or "test" in txn_id.lower() or "t0" in txn_id.lower() or "int" in txn_id.lower()
    badge = "SIMULATED" if is_sim else "LIVE"

    # Counterparty details
    counterparty = record.get("counterparty") or record.get("merchant_name") or f"Merchant {dest_account[-6:]}"
    merchant_category = record.get("merchant_category") or "General Retail & Services"
    channel = record.get("channel") or (record.get("attributes") or {}).get("payment_channel") or "MOBILE_APP"

    # Network & Device telemetry
    ip = record.get("origin_ip") or (record.get("origin") or {}).get("ip") or "192.0.2.1"
    is_tor = any("TOR" in str(f) for f in raw_flags) or "185.220" in ip
    is_vpn = any("VPN" in str(f) for f in raw_flags)

    network_info = {
        "ip": ip,
        "isp": "Amazon AWS Cloud Data Center" if is_tor else "Level 3 Communications / Lumen",
        "asn": "AS16509" if is_tor else "AS3356",
        "connection_type": "Data Center / VPN" if (is_tor or is_vpn) else "Cellular LTE / 5G",
        "is_vpn": is_vpn,
        "is_tor": is_tor,
        "badge": badge,
    }

    h_dev = int(hashlib.sha256(account_id.encode("utf-8")).hexdigest()[:8], 16)
    device_info = {
        "fingerprint": f"fp_{digest_hex(account_id)[:12]}",
        "os_browser": "iOS 17.5 / Mobile Safari" if channel == "MOBILE_APP" else "Chrome 122.0 / Windows 11",
        "is_new_device": any("NEW_ACCOUNT" in str(f) for f in raw_flags) or (h_dev % 3 == 0),
        "badge": badge,
    }

    # Relative time & local time
    utc_dt = None
    try:
        utc_dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        diff_s = (datetime.now(timezone.utc) - utc_dt).total_seconds()
        if diff_s < 60:
            rel_time = f"{int(max(1, diff_s))}s ago"
        elif diff_s < 3600:
            rel_time = f"{int(diff_s // 60)}m ago"
        elif diff_s < 86400:
            rel_time = f"{int(diff_s // 3600)}h ago"
        else:
            rel_time = f"{int(diff_s // 86400)}d ago"
    except Exception:
        rel_time = "just now"

    return {
        "id": txn_id,
        "transaction_id": txn_id,
        "account_id": account_id,
        "destination_account": dest_account,
        "amount": float(record.get("amount") or 0.0),
        "currency": str(record.get("currency") or "USD").upper(),
        "status": record.get("status") or ("QUARANTINED" if decision == "BLOCK" else "APPROVED"),
        "decision": decision,
        "risk_score": risk_score,
        "risk_tier": risk_tier,
        "risk_color": risk_color,
        "lat": lat,
        "lon": lon,
        "city": city,
        "country": country,
        "source": source_fix,
        "accuracy_meters": accuracy_m,
        "timestamp": timestamp_str,
        "relative_time": rel_time,
        "counterparty": counterparty,
        "merchant_category": merchant_category,
        "channel": channel,
        "tower": tower,
        "flags": flags_enriched,
        "network": network_info,
        "device": device_info,
        "badge": badge,
        "raw_record": record,
    }


def digest_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()
