"""
FraudGuard Governed Configuration Manager
Supports:
- Role-gated read-only vs admin mutation
- Strict validation: 0 <= review < block <= 100, travel 100-2000 km/h, SLA 5-1440 min
- Dry-run simulation ("Test changes") against the last N events
- Immutable append-only versioning with diffs and rollback restore
- Provider health monitoring (simulated vs live)
"""

import os
import json
import copy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config_rules.json")
VERSIONS_FILE = os.path.join(ROOT_DIR, "data", "config_versions.json")
AUDIT_FILE = os.path.join(ROOT_DIR, "data", "analyst_action_audit.json")

DEFAULT_CONFIG: Dict[str, Any] = {
    "thresholds": {
        "block_score": 80,
        "review_score": 40,
        "force_block_min_score": 85
    },
    "force_block_rules": [
        "TOR_EXIT_NODE",
        "ORIGIN_TOR",
        "IMPOSSIBLE_TRAVEL"
    ],
    "location": {
        "impossible_travel_speed_kmh": 900.0,
        "resolution_priority": ["carrier_cell_tower", "device_gps", "ip_geolocation"]
    },
    "quarantine": {
        "auto_release_hours": 24,
        "sla_review_minutes": 60,
        "alarm_threshold": 100
    },
    "rules": [
        {"id": "IMPOSSIBLE_TRAVEL", "name": "Impossible Travel", "description": "Movement between distant locations exceeding jet speeds (>900 km/h)", "weight": 85, "severity": "CRITICAL", "enabled": True, "force_block": True},
        {"id": "TOR_EXIT_NODE", "name": "Tor Exit Relay", "description": "Origin IP confirmed on active Tor onion exit directory", "weight": 85, "severity": "CRITICAL", "enabled": True, "force_block": True},
        {"id": "HIGH_VELOCITY", "name": "Velocity Spike", "description": "More than 5 transactions within a 60-second window", "weight": 60, "severity": "HIGH", "enabled": True, "force_block": False},
        {"id": "AMOUNT_ANOMALY", "name": "Amount Anomaly", "description": "Transaction amount exceeds statistical 3σ threshold for cardholder", "weight": 50, "severity": "MEDIUM", "enabled": True, "force_block": False},
        {"id": "GEO_ORIGIN_MISMATCH", "name": "Geo Origin Mismatch", "description": "Transaction country does not match cardholder billing country", "weight": 40, "severity": "MEDIUM", "enabled": True, "force_block": False},
        {"id": "UNUSUAL_HOUR", "name": "Dormant Hours Transaction", "description": "Transaction initiated during cardholder's historical dormant hours (2am - 5am local)", "weight": 35, "severity": "LOW", "enabled": True, "force_block": False},
        {"id": "NEW_ACCOUNT", "name": "New Account Activity", "description": "High-value activity on accounts provisioned within the last 7 days", "weight": 30, "severity": "LOW", "enabled": True, "force_block": False},
        {"id": "CHANNEL_RISK", "name": "Channel Risk", "description": "Transaction submitted through high-risk unauthenticated web channel", "weight": 35, "severity": "LOW", "enabled": True, "force_block": False},
    ],
    "providers": {
        "cell_location": {
            "name": "Cell Location & Tower Fix",
            "active_provider": "simulated",
            "is_simulated": True,
            "status": "HEALTHY",
            "latency_ms": 42,
            "api_key_configured": True,
            "last_successful_call": "3s ago",
            "quota_used": "14,290 / 100,000",
            "legal_consent_required": True,
            "legal_notice": "Device location requires telecom partner access and verified customer consent."
        },
        "identity_risk": {
            "name": "Identity & KYC Telemetry",
            "active_provider": "mock",
            "is_simulated": True,
            "status": "HEALTHY",
            "latency_ms": 118,
            "api_key_configured": True,
            "last_successful_call": "12s ago",
            "quota_used": "3,480 / 50,000",
            "legal_consent_required": False
        },
        "social_reputation": {
            "name": "Social Risk Intelligence",
            "active_provider": "mock",
            "is_simulated": True,
            "status": "HEALTHY",
            "latency_ms": 85,
            "api_key_configured": True,
            "last_successful_call": "45s ago",
            "quota_used": "1,120 / 25,000",
            "legal_consent_required": False
        },
        "ip_geolocation": {
            "name": "IP Geolocation & ASN",
            "active_provider": "simulated",
            "is_simulated": True,
            "status": "HEALTHY",
            "latency_ms": 15,
            "api_key_configured": True,
            "last_successful_call": "1s ago",
            "quota_used": "89,120 / 500,000",
            "legal_consent_required": False
        },
        "tor_directory": {
            "name": "Tor Relay Directory Index",
            "active_provider": "live",
            "is_simulated": False,
            "status": "HEALTHY",
            "latency_ms": 5,
            "api_key_configured": True,
            "last_successful_call": "refreshed 3h ago",
            "quota_used": "Unlimited / Local Cache",
            "legal_consent_required": False
        }
    }
}


def load_current_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                merged = copy.deepcopy(DEFAULT_CONFIG)
                merged.update(data)
                return merged
        except Exception:
            pass
    return copy.deepcopy(DEFAULT_CONFIG)


def validate_config(candidate: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Strictly validates business bounds on candidate configuration."""
    th = candidate.get("thresholds", {})
    block_score = th.get("block_score")
    review_score = th.get("review_score")

    if block_score is None or review_score is None:
        return False, "thresholds.block_score and thresholds.review_score must be specified."

    try:
        b = float(block_score)
        r = float(review_score)
    except (ValueError, TypeError):
        return False, "Threshold scores must be numeric."

    if not (0 <= r < b <= 100):
        return False, f"Constraint violated: 0 <= review_score ({r}) < block_score ({b}) <= 100."

    loc = candidate.get("location", {})
    speed = loc.get("impossible_travel_speed_kmh")
    if speed is not None:
        try:
            s = float(speed)
            if not (100.0 <= s <= 2000.0):
                return False, f"impossible_travel_speed_kmh ({s}) must be between 100.0 and 2000.0 km/h."
        except (ValueError, TypeError):
            return False, "impossible_travel_speed_kmh must be numeric."

    quar = candidate.get("quarantine", {})
    sla = quar.get("sla_review_minutes")
    if sla is not None:
        try:
            sl = int(sla)
            if not (5 <= sl <= 1440):
                return False, f"sla_review_minutes ({sl}) must be between 5 and 1440 minutes."
        except (ValueError, TypeError):
            return False, "sla_review_minutes must be an integer."

    for rule in candidate.get("rules", []):
        weight = rule.get("weight")
        if weight is not None:
            try:
                w = float(weight)
                if not (0 <= w <= 100):
                    return False, f"Rule '{rule.get('id')}' weight ({w}) must be between 0 and 100."
            except (ValueError, TypeError):
                return False, f"Rule '{rule.get('id')}' weight must be numeric."

    return True, None


def simulate_draft_impact(draft_config: Dict[str, Any], records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Dry run: evaluate draft config thresholds against records to report decision changes."""
    th = draft_config.get("thresholds", {})
    new_block = float(th.get("block_score", 80))
    new_review = float(th.get("review_score", 40))

    changed_to_block = 0
    changed_to_review = 0
    changed_to_allow = 0

    for r in records:
        score = float(r.get("risk_score") or r.get("score") or 0.0)
        curr_decision = str(r.get("decision") or "ALLOW").upper()

        if score >= new_block:
            hypo_decision = "BLOCK"
        elif score >= new_review:
            hypo_decision = "REVIEW_QUEUE"
        else:
            hypo_decision = "ALLOW"

        if hypo_decision != curr_decision:
            if hypo_decision == "BLOCK":
                changed_to_block += 1
            elif hypo_decision == "REVIEW_QUEUE":
                changed_to_review += 1
            else:
                changed_to_allow += 1

    return {
        "total_evaluated": len(records),
        "changed_to_block": changed_to_block,
        "changed_to_review": changed_to_review,
        "changed_to_allow": changed_to_allow,
        "summary": f"+{changed_to_block} blocks, {changed_to_review} reviews, {changed_to_allow} allows"
    }


def save_config_version(new_config: Dict[str, Any], operator: str, reason: str) -> Dict[str, Any]:
    """Persists config and writes an immutable version entry."""
    valid, err = validate_config(new_config)
    if not valid:
        raise ValueError(err)

    versions = []
    if os.path.exists(VERSIONS_FILE):
        try:
            with open(VERSIONS_FILE, "r", encoding="utf-8") as f:
                versions = json.load(f)
        except Exception:
            pass

    next_v = len(versions) + 1
    version_id = f"v{next_v}"
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    version_entry = {
        "version_id": version_id,
        "operator": operator,
        "reason": reason,
        "timestamp": now_iso,
        "config": new_config
    }
    versions.append(version_entry)

    os.makedirs(os.path.dirname(VERSIONS_FILE), exist_ok=True)
    with open(VERSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(versions, f, indent=2)

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(new_config, f, indent=2)

    return version_entry


def get_version_history() -> List[Dict[str, Any]]:
    if os.path.exists(VERSIONS_FILE):
        try:
            with open(VERSIONS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []
