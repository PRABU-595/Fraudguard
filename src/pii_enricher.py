"""
Feature 7: PII Enrichment Layer & Identity Risk
Enriches accounts with identity metadata, cell-tower telemetry, and social risk indicators.
Supports standardized provider adapters (CAMARA Telecom API, OpenCellID, Licensed Social, or Mock).
Every enrichment block carries:
  - is_simulated: bool (MANDATORY)
  - source: str
  - confidence: float
  - fetched_at: str
  - masked_name: str (for privacy compliance)
Evaluates LOCATION_MISMATCH (+15), NEW_ACCOUNT (<30d, +10), and UNVERIFIED_CONTACT (+5).
"""

import os
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    from src.provider_adapters import (
        get_cell_provider,
        get_identity_provider,
        get_social_provider,
        ProviderResult
    )
except ImportError:
    from provider_adapters import (
        get_cell_provider,
        get_identity_provider,
        get_social_provider,
        ProviderResult
    )

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CANDIDATE_PII_STORES = [
    os.path.join(SCRIPT_DIR, "mock_pii_store.json"),
    os.path.join(SCRIPT_DIR, "..", "data", "mock_pii_store.json"),
    os.path.join("/var/task", "mock_pii_store.json"),
    os.path.join("/var/task", "data", "mock_pii_store.json"),
    "data/mock_pii_store.json",
    "mock_pii_store.json",
]

EMBEDDED_FALLBACK_PII_PROFILES: Dict[str, Dict[str, Any]] = {
    "acc_1": {
        "account_holder_name": "DEMO_HOLDER_01 (MOCK)",
        "account_age_days": 450,
        "linked_phone_verified": True,
        "email_verified": True,
        "sim_swap_last_7d": False,
        "social_profile_risk_score": 0.05,
        "device_fingerprint": "fp_demo_ios_001",
        "registered_city": "New York",
        "registered_country": "US",
        "last_known_location": {
            "source": "SIMULATED_CELL_TOWER",
            "is_simulated": True,
            "city": "New York",
            "lat": 40.7128,
            "lon": -74.006,
            "accuracy_meters": 50,
            "timestamp": "2026-10-23T10:00:00Z"
        }
    },
    "acc_2": {
        "account_holder_name": "DEMO_HOLDER_02 (MOCK)",
        "account_age_days": 12,
        "linked_phone_verified": True,
        "email_verified": True,
        "sim_swap_last_7d": False,
        "social_profile_risk_score": 0.35,
        "device_fingerprint": "fp_demo_and_002",
        "registered_city": "New York",
        "registered_country": "US",
        "last_known_location": {
            "source": "SIMULATED_CELL_TOWER",
            "is_simulated": True,
            "city": "New York",
            "lat": 40.7128,
            "lon": -74.006,
            "accuracy_meters": 65,
            "timestamp": "2026-10-23T10:00:00Z"
        }
    },
    "acc_3": {
        "account_holder_name": "DEMO_HOLDER_03 (MOCK)",
        "account_age_days": 180,
        "linked_phone_verified": False,
        "email_verified": False,
        "sim_swap_last_7d": False,
        "social_profile_risk_score": 0.65,
        "device_fingerprint": "fp_demo_web_003",
        "registered_city": "Chicago",
        "registered_country": "US",
        "last_known_location": {
            "source": "SIMULATED_CELL_TOWER",
            "is_simulated": True,
            "city": "Chicago",
            "lat": 41.8781,
            "lon": -87.6298,
            "accuracy_meters": 80,
            "timestamp": "2026-10-23T10:00:00Z"
        }
    },
    "acc_4": {
        "account_holder_name": "DEMO_HOLDER_04 (MOCK)",
        "account_age_days": 5,
        "linked_phone_verified": False,
        "email_verified": False,
        "sim_swap_last_7d": True,
        "social_profile_risk_score": 0.85,
        "device_fingerprint": "fp_demo_emu_004",
        "registered_city": "Mumbai",
        "registered_country": "IN",
        "last_known_location": {
            "source": "SIMULATED_CELL_TOWER",
            "is_simulated": True,
            "city": "Mumbai",
            "lat": 19.076,
            "lon": 72.8777,
            "accuracy_meters": 100,
            "timestamp": "2026-10-23T10:00:00Z"
        }
    },
    "acc_10": {
        "account_holder_name": "DEMO_HOLDER_10 (MOCK)",
        "account_age_days": 14,
        "linked_phone_verified": False,
        "email_verified": True,
        "sim_swap_last_7d": False,
        "social_profile_risk_score": 0.78,
        "device_fingerprint": "fp_demo_tor_010",
        "registered_city": "Frankfurt",
        "registered_country": "DE",
        "last_known_location": {
            "source": "SIMULATED_CELL_TOWER",
            "is_simulated": True,
            "city": "Frankfurt",
            "lat": 50.1109,
            "lon": 8.6821,
            "accuracy_meters": 90,
            "timestamp": "2026-10-23T10:00:00Z"
        }
    }
}


def mask_name(raw_name: Optional[str]) -> str:
    if not raw_name:
        return "Anonymous Customer"
    parts = str(raw_name).split()
    masked_parts = []
    for p in parts:
        if len(p) <= 2:
            masked_parts.append(p[0] + "*")
        else:
            masked_parts.append(p[0] + ("*" * (len(p) - 2)) + p[-1])
    return " ".join(masked_parts)


class PIIEnricher:
    def __init__(self, store_path: Optional[str] = None) -> None:
        self.store_path = store_path
        self.profiles = self._load_store()
        self.cell_provider = get_cell_provider(self.profiles)
        self.id_provider = get_identity_provider(self.profiles)
        self.social_provider = get_social_provider(self.profiles)

    def _load_store(self) -> Dict[str, Any]:
        paths = [self.store_path] if self.store_path else list(CANDIDATE_PII_STORES)
        for p in paths:
            if p and os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                        if isinstance(loaded, dict) and loaded:
                            return loaded
                except Exception:
                    continue
        return dict(EMBEDDED_FALLBACK_PII_PROFILES)

    def get_profile(self, account_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not account_id:
            return None
        acct_str = str(account_id)
        if acct_str in self.profiles:
            return self.profiles[acct_str]
        if acct_str in ("acc_unknown", "acc_999_nonexistent", "unknown") or "nonexistent" in acct_str:
            return None

        # Dynamic persona synthesis for simulator preset families
        if acct_str.startswith("acc_clean_") or acct_str.startswith("acc_norm_"):
            num = acct_str.replace("acc_clean_", "").replace("acc_norm_", "")
            return {
                "account_holder_name": f"David Miller ({num})",
                "account_age_days": 320,
                "linked_phone_verified": True,
                "email_verified": True,
                "sim_swap_last_7d": False,
                "social_profile_risk_score": 0.05,
                "social_reputation": "ESTABLISHED",
                "device_fingerprint": f"fp_clean_{num}",
                "registered_city": "New York",
                "registered_country": "US",
                "last_known_location": {
                    "source": "SIMULATED_CELL_TOWER",
                    "is_simulated": True,
                    "city": "New York",
                    "lat": 40.7128,
                    "lon": -74.006,
                    "accuracy_meters": 50,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }
        elif acct_str.startswith("acc_travel_"):
            num = acct_str.replace("acc_travel_", "")
            return {
                "account_holder_name": f"Alexander Wright ({num})",
                "account_age_days": 540,
                "linked_phone_verified": True,
                "email_verified": True,
                "sim_swap_last_7d": False,
                "social_profile_risk_score": 0.08,
                "social_reputation": "ESTABLISHED",
                "device_fingerprint": f"fp_travel_{num}",
                "registered_city": "New York",
                "registered_country": "US",
                "last_known_location": {
                    "source": "SIMULATED_CELL_TOWER",
                    "is_simulated": True,
                    "city": "London",
                    "lat": 51.5074,
                    "lon": -0.1278,
                    "accuracy_meters": 65,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }
        elif acct_str.startswith("acc_tor_"):
            num = acct_str.replace("acc_tor_", "")
            return {
                "account_holder_name": f"Viktor Vance ({num})",
                "account_age_days": 8,
                "linked_phone_verified": False,
                "email_verified": False,
                "sim_swap_last_7d": True,
                "social_profile_risk_score": 0.88,
                "social_reputation": "HIGH_RISK",
                "device_fingerprint": f"fp_tor_{num}",
                "registered_city": "Frankfurt",
                "registered_country": "DE",
                "last_known_location": {
                    "source": "SIMULATED_CELL_TOWER",
                    "is_simulated": True,
                    "city": "Frankfurt",
                    "lat": 50.1109,
                    "lon": 8.6821,
                    "accuracy_meters": 90,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }
        elif acct_str.startswith("acc_burst_"):
            num = acct_str.replace("acc_burst_", "")
            return {
                "account_holder_name": f"Elena Rostova ({num})",
                "account_age_days": 19,
                "linked_phone_verified": False,
                "email_verified": True,
                "sim_swap_last_7d": False,
                "social_profile_risk_score": 0.65,
                "social_reputation": "MODERATE",
                "device_fingerprint": f"fp_burst_{num}",
                "registered_city": "New York",
                "registered_country": "US",
                "last_known_location": {
                    "source": "SIMULATED_CELL_TOWER",
                    "is_simulated": True,
                    "city": "New York",
                    "lat": 40.7128,
                    "lon": -74.006,
                    "accuracy_meters": 75,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }
        elif acct_str.startswith("acc_night_"):
            num = acct_str.replace("acc_night_", "")
            return {
                "account_holder_name": f"Marcus Brody ({num})",
                "account_age_days": 180,
                "linked_phone_verified": True,
                "email_verified": True,
                "sim_swap_last_7d": False,
                "social_profile_risk_score": 0.15,
                "social_reputation": "ESTABLISHED",
                "device_fingerprint": f"fp_night_{num}",
                "registered_city": "Chicago",
                "registered_country": "US",
                "last_known_location": {
                    "source": "SIMULATED_CELL_TOWER",
                    "is_simulated": True,
                    "city": "Chicago",
                    "lat": 41.8781,
                    "lon": -87.6298,
                    "accuracy_meters": 80,
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
            }
        return None

    def evaluate(self, tx: Dict[str, Any], origin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Enriches transaction with `pii_enrichment` block carrying mandatory
        is_simulated flag, provider source, confidence, and PII masking.
        Evaluates LOCATION_MISMATCH (+15), NEW_ACCOUNT (+10), UNVERIFIED_CONTACT (+5).
        """
        account_id = tx.get("account_id") or tx.get("source_account") or tx.get("user_id") or "acc_unknown"
        profile = tx.get("mock_pii_override") or self.get_profile(account_id)

        # Query provider adapters
        cell_res = self.cell_provider.get_location(account_id=str(account_id))
        id_res = self.id_provider.evaluate_identity(str(account_id), tx)
        social_res = self.social_provider.get_social_risk(str(account_id), consent_granted=bool(tx.get("social_consent", False)))

        is_simulated = bool(cell_res.is_simulated or id_res.is_simulated or social_res.is_simulated)

        if not profile:
            raw_holder = "DEMO_UNREGISTERED (MOCK)"
            return {
                "pii_enrichment": {
                    "data_source": "MOCK_DEMO_DATA" if is_simulated else "LIVE_PROVIDERS",
                    "enrichment_status": "NOT_FOUND",
                    "is_simulated": is_simulated,
                    "confidence": 0.5,
                    "source": "UNREGISTERED_FALLBACK",
                    "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "account_holder_name": raw_holder,
                    "account_holder_masked": mask_name(raw_holder),
                    "account_age_days": None,
                    "linked_phone_verified": None,
                    "email_verified": None,
                    "sim_swap_last_7d": False,
                    "social_profile_risk_score": 0.0,
                    "social_reputation": "UNKNOWN",
                    "device_fingerprint": "unknown",
                    "last_known_location": None,
                    "location_matches_transaction": True
                },
                "flags": [],
                "risk_points": 0,
                "profile": None
            }

        orig = origin or tx.get("origin") or {}
        tx_city = (
            tx.get("transaction_city")
            or orig.get("city")
            or tx.get("location")
            or (profile.get("last_known_location") or {}).get("city")
            or "New York"
        )
        if profile.get("last_known_location") and isinstance(profile["last_known_location"], dict):
            last_loc = dict(profile["last_known_location"])
        else:
            last_loc = dict(cell_res.data or {})
        last_loc["source"] = last_loc.get("source") or cell_res.source
        last_loc["is_simulated"] = last_loc.get("is_simulated", cell_res.is_simulated)
        cell_city = last_loc.get("city", "New York")

        if tx.get("location_matches_transaction") is not None:
            loc_matches = bool(tx["location_matches_transaction"])
        else:
            loc_matches = str(cell_city).strip().lower() == str(tx_city).strip().lower()

        account_age = int(profile.get("account_age_days") if profile.get("account_age_days") is not None else id_res.data.get("account_age_days", 365))
        phone_verified = bool(profile.get("linked_phone_verified") if profile.get("linked_phone_verified") is not None else id_res.data.get("linked_phone_verified", True))
        email_verified = bool(profile.get("email_verified") if profile.get("email_verified") is not None else True)
        sim_swap = bool(profile.get("sim_swap_last_7d") if profile.get("sim_swap_last_7d") is not None else id_res.data.get("sim_swap_last_7d", False))
        social_score = float(profile.get("social_profile_risk_score") if profile.get("social_profile_risk_score") is not None else social_res.data.get("social_risk_score", 0.0))
        raw_holder_name = str(profile.get("account_holder_name") or id_res.data.get("account_holder_name") or "DEMO_HOLDER (MOCK)")

        flags: List[str] = []
        risk_points = 0

        if not loc_matches:
            flags.append("LOCATION_MISMATCH")
            risk_points += 15

        if account_age < 30:
            flags.append("NEW_ACCOUNT")
            risk_points += 10

        if not phone_verified:
            flags.append("UNVERIFIED_CONTACT")
            risk_points += 5

        if sim_swap:
            flags.append("SIM_SWAP_DETECTED")
            risk_points += 25

        pii_enrichment = {
            "data_source": "MOCK_DEMO_DATA" if is_simulated else "LIVE_IDENTITY_PROVIDER",
            "enrichment_status": "FOUND",
            "is_simulated": is_simulated,
            "confidence": round((cell_res.confidence + id_res.confidence + social_res.confidence) / 3.0, 2),
            "source": f"{cell_res.source}+{id_res.source}",
            "fetched_at": cell_res.fetched_at,
            "account_holder_name": raw_holder_name,
            "account_holder_masked": mask_name(raw_holder_name),
            "account_age_days": account_age,
            "linked_phone_verified": phone_verified,
            "email_verified": email_verified,
            "sim_swap_last_7d": sim_swap,
            "social_profile_risk_score": social_score,
            "social_reputation": social_res.data.get("reputation", "ESTABLISHED"),
            "device_fingerprint": str(id_res.data.get("device_fingerprint", profile.get("device_fingerprint", "fp_demo_default"))),
            "last_known_location": last_loc,
            "location_matches_transaction": loc_matches
        }

        return {
            "pii_enrichment": pii_enrichment,
            "flags": flags,
            "risk_points": risk_points,
            "profile": profile
        }
