"""
FraudGuard Provider Adapters
Standardized interface for external telemetry, cell tower location, identity, and social risk providers.
Every provider returns:
  - is_simulated: bool (MANDATORY)
  - source: str (provider identifier)
  - confidence: float (0.0 to 1.0)
  - fetched_at: str (ISO UTC timestamp)
  - data: dict
"""

import os
import json
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config_rules.json")


def load_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


class ProviderResult:
    def __init__(
        self,
        is_simulated: bool,
        source: str,
        confidence: float,
        data: Dict[str, Any],
        fetched_at: Optional[str] = None
    ) -> None:
        self.is_simulated = bool(is_simulated)
        self.source = str(source)
        self.confidence = max(0.0, min(1.0, float(confidence)))
        self.fetched_at = fetched_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.data = dict(data)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_simulated": self.is_simulated,
            "source": self.source,
            "confidence": round(self.confidence, 2),
            "fetched_at": self.fetched_at,
            "data": self.data
        }


# =========================================================================
# 1. Cell Location Providers (CAMARA, OpenCellID, Simulated)
# =========================================================================

class BaseCellLocationProvider:
    def get_location(
        self,
        phone_number: Optional[str] = None,
        cell_id: Optional[Dict[str, Any]] = None,
        account_id: Optional[str] = None,
        consent_token: Optional[str] = None
    ) -> ProviderResult:
        raise NotImplementedError


class CAMARACellLocationAdapter(BaseCellLocationProvider):
    """
    CAMARA / GSMA Open Gateway Device Location Verification API adapter.
    Requires telecom operator consent / authorization token and registered API key.
    """
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        self.api_url = api_url or os.environ.get("CAMARA_LOCATION_API_URL", "https://api.telecom.example.com/camara/location/v1")
        self.api_key = api_key or os.environ.get("CAMARA_API_KEY")

    def get_location(
        self,
        phone_number: Optional[str] = None,
        cell_id: Optional[Dict[str, Any]] = None,
        account_id: Optional[str] = None,
        consent_token: Optional[str] = None
    ) -> ProviderResult:
        # Legal and technical requirement: must have valid consent token and API key
        if not self.api_key or not consent_token or not phone_number:
            return ProviderResult(
                is_simulated=True,
                source="CAMARA_TELECOM_UNAVAILABLE",
                confidence=0.0,
                data={
                    "status": "UNCONFIGURED_OR_NO_CONSENT",
                    "note": "CAMARA API requires active operator contract, valid consent_token, and CAMARA_API_KEY.",
                    "city": "New York",
                    "lat": 40.7128,
                    "lon": -74.0060,
                    "accuracy_meters": 500
                }
            )

        try:
            req_data = json.dumps({
                "device": {"phoneNumber": phone_number},
                "maxAge": 60
            }).encode("utf-8")
            req = urllib.request.Request(
                f"{self.api_url}/verify",
                data=req_data,
                headers={
                    "Authorization": f"Bearer {consent_token}",
                    "X-API-Key": self.api_key,
                    "Content-Type": "application/json"
                }
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                return ProviderResult(
                    is_simulated=False,
                    source="CAMARA_OPERATOR_GATEWAY",
                    confidence=0.95,
                    data={
                        "status": "VERIFIED_LIVE",
                        "city": res.get("city", "Unknown"),
                        "lat": float(res.get("latitude", 0.0)),
                        "lon": float(res.get("longitude", 0.0)),
                        "accuracy_meters": int(res.get("accuracy", 150))
                    }
                )
        except Exception as exc:
            return ProviderResult(
                is_simulated=True,
                source="CAMARA_FALLBACK",
                confidence=0.2,
                data={
                    "status": "FALLBACK_ERROR",
                    "error": str(exc),
                    "city": "New York",
                    "lat": 40.7128,
                    "lon": -74.0060,
                    "accuracy_meters": 1000
                }
            )


class OpenCellIDAdapter(BaseCellLocationProvider):
    """
    OpenCellID provider mapping GSM/LTE/5G Cell identifiers (MCC, MNC, LAC, CID)
    to physical mast coordinates.
    """
    def __init__(self, api_key: Optional[str] = None) -> None:
        self.api_key = api_key or os.environ.get("OPENCELLID_API_KEY")

    def get_location(
        self,
        phone_number: Optional[str] = None,
        cell_id: Optional[Dict[str, Any]] = None,
        account_id: Optional[str] = None,
        consent_token: Optional[str] = None
    ) -> ProviderResult:
        cid_dict = cell_id or {}
        mcc = cid_dict.get("mcc", 310)
        mnc = cid_dict.get("mnc", 410)
        lac = cid_dict.get("lac")
        cid = cid_dict.get("cell_id") or cid_dict.get("cid")

        if not self.api_key or not lac or not cid:
            # Deterministic lookup table for demo cell towers
            known_towers = {
                (310, 410, 1024, 50123): {"city": "New York", "lat": 40.7128, "lon": -74.0060, "accuracy_meters": 65},
                (310, 410, 2048, 60234): {"city": "Chicago", "lat": 41.8781, "lon": -87.6298, "accuracy_meters": 80},
                (404, 45, 3012, 70345): {"city": "Mumbai", "lat": 19.0760, "lon": 72.8777, "accuracy_meters": 100},
                (234, 15, 4015, 80456): {"city": "London", "lat": 51.5074, "lon": -0.1278, "accuracy_meters": 50},
                (262, 1, 5020, 90567): {"city": "Frankfurt", "lat": 50.1109, "lon": 8.6821, "accuracy_meters": 90}
            }
            key = (int(mcc), int(mnc), int(lac or 1024), int(cid or 50123))
            tower = known_towers.get(key, {"city": "New York", "lat": 40.7128, "lon": -74.0060, "accuracy_meters": 150})
            return ProviderResult(
                is_simulated=True,
                source="OPENCELLID_SIMULATED_DB",
                confidence=0.85,
                data={
                    "city": tower["city"],
                    "lat": tower["lat"],
                    "lon": tower["lon"],
                    "accuracy_meters": tower["accuracy_meters"],
                    "mcc": mcc,
                    "mnc": mnc,
                    "lac": lac or 1024,
                    "cid": cid or 50123
                }
            )

        try:
            url = f"https://opencellid.org/cell/get?key={self.api_key}&mcc={mcc}&mnc={mnc}&lac={lac}&cellid={cid}&format=json"
            req = urllib.request.Request(url, headers={"User-Agent": "FraudGuard/1.0"})
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return ProviderResult(
                    is_simulated=False,
                    source="OPENCELLID_LIVE",
                    confidence=0.9,
                    data={
                        "city": data.get("city", "CellTower"),
                        "lat": float(data.get("lat", 0.0)),
                        "lon": float(data.get("lon", 0.0)),
                        "accuracy_meters": int(data.get("range", 200)),
                        "mcc": mcc,
                        "mnc": mnc,
                        "lac": lac,
                        "cid": cid
                    }
                )
        except Exception as exc:
            return ProviderResult(
                is_simulated=True,
                source="OPENCELLID_FALLBACK",
                confidence=0.3,
                data={
                    "city": "New York",
                    "lat": 40.7128,
                    "lon": -74.0060,
                    "accuracy_meters": 500,
                    "error": str(exc)
                }
            )


class SimulatedCellLocationProvider(BaseCellLocationProvider):
    """
    Simulated carrier cell tower provider using local profile store.
    Always labeled with is_simulated=True.
    """
    def __init__(self, profiles: Optional[Dict[str, Any]] = None) -> None:
        self.profiles = profiles or {}

    def get_location(
        self,
        phone_number: Optional[str] = None,
        cell_id: Optional[Dict[str, Any]] = None,
        account_id: Optional[str] = None,
        consent_token: Optional[str] = None
    ) -> ProviderResult:
        prof = self.profiles.get(str(account_id), {})
        loc = prof.get("last_known_location") or {}
        city = loc.get("city", "New York")
        lat = float(loc.get("lat", 40.7128))
        lon = float(loc.get("lon", -74.0060))
        acc = int(loc.get("accuracy_meters", 50))
        ts = loc.get("timestamp") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        return ProviderResult(
            is_simulated=True,
            source="SIMULATED_CELL_TOWER",
            confidence=0.88,
            fetched_at=ts,
            data={
                "city": city,
                "lat": lat,
                "lon": lon,
                "accuracy_meters": acc,
                "mcc": 310,
                "mnc": 410,
                "lac": 1024,
                "cid": 50123
            }
        )


# =========================================================================
# 2. Identity Risk Providers (Vendor vs Mock)
# =========================================================================

class BaseIdentityRiskProvider:
    def evaluate_identity(self, account_id: str, payload: Optional[Dict[str, Any]] = None) -> ProviderResult:
        raise NotImplementedError


class VendorIdentityRiskAdapter(BaseIdentityRiskProvider):
    """
    Licensed identity verification vendor adapter (e.g. Email/Phone intelligence, SIM-swap check).
    """
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        self.api_url = api_url or os.environ.get("IDENTITY_VENDOR_API_URL")
        self.api_key = api_key or os.environ.get("IDENTITY_VENDOR_API_KEY")

    def evaluate_identity(self, account_id: str, payload: Optional[Dict[str, Any]] = None) -> ProviderResult:
        if not self.api_key or not self.api_url:
            return MockIdentityRiskProvider().evaluate_identity(account_id, payload)

        try:
            req_data = json.dumps({"account_id": account_id, "attributes": payload or {}}).encode("utf-8")
            req = urllib.request.Request(
                self.api_url,
                data=req_data,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return ProviderResult(
                    is_simulated=False,
                    source="IDENTITY_VENDOR_LIVE",
                    confidence=0.92,
                    data=data
                )
        except Exception:
            return MockIdentityRiskProvider().evaluate_identity(account_id, payload)


class MockIdentityRiskProvider(BaseIdentityRiskProvider):
    def __init__(self, profiles: Optional[Dict[str, Any]] = None) -> None:
        self.profiles = profiles or {}

    def evaluate_identity(self, account_id: str, payload: Optional[Dict[str, Any]] = None) -> ProviderResult:
        prof = self.profiles.get(str(account_id), {})
        return ProviderResult(
            is_simulated=True,
            source="MOCK_IDENTITY_STORE",
            confidence=0.85,
            data={
                "account_holder_name": prof.get("account_holder_name", f"HOLDER_{account_id} (MOCK)"),
                "account_age_days": prof.get("account_age_days", 365),
                "linked_phone_verified": prof.get("linked_phone_verified", True),
                "sim_swap_last_7d": prof.get("sim_swap_last_7d", False),
                "device_fingerprint": prof.get("device_fingerprint", "fp_demo_default")
            }
        )


# =========================================================================
# 3. Social Risk Providers (Licensed/Consented vs Mock - NO Scraping)
# =========================================================================

class BaseSocialRiskProvider:
    def get_social_risk(self, account_id: str, consent_granted: bool = False) -> ProviderResult:
        raise NotImplementedError


class LicensedSocialRiskAdapter(BaseSocialRiskProvider):
    """
    Licensed Social Network Identity Reputation Provider.
    Only accesses authorized API endpoints with user consent. Strictly NO scraping.
    """
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        self.api_url = api_url or os.environ.get("SOCIAL_RISK_API_URL")
        self.api_key = api_key or os.environ.get("SOCIAL_RISK_API_KEY")

    def get_social_risk(self, account_id: str, consent_granted: bool = False) -> ProviderResult:
        if not consent_granted or not self.api_key or not self.api_url:
            return MockSocialRiskProvider().get_social_risk(account_id, consent_granted=consent_granted)

        try:
            req_data = json.dumps({"account_id": account_id}).encode("utf-8")
            req = urllib.request.Request(
                self.api_url,
                data=req_data,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return ProviderResult(
                    is_simulated=False,
                    source="LICENSED_SOCIAL_API",
                    confidence=0.88,
                    data={
                        "social_risk_score": float(data.get("risk_score", 0.1)),
                        "account_reputation": data.get("reputation", "HIGH"),
                        "consent_verified": True
                    }
                )
        except Exception:
            return MockSocialRiskProvider().get_social_risk(account_id, consent_granted=consent_granted)


class MockSocialRiskProvider(BaseSocialRiskProvider):
    def __init__(self, profiles: Optional[Dict[str, Any]] = None) -> None:
        self.profiles = profiles or {}

    def get_social_risk(self, account_id: str, consent_granted: bool = False) -> ProviderResult:
        prof = self.profiles.get(str(account_id), {})
        score = float(prof.get("social_profile_risk_score", 0.05))
        return ProviderResult(
            is_simulated=True,
            source="MOCK_SOCIAL_STORE",
            confidence=0.80,
            data={
                "social_risk_score": score,
                "reputation": "ESTABLISHED" if score < 0.3 else ("MODERATE" if score < 0.7 else "HIGH_RISK"),
                "consent_verified": consent_granted,
                "explanation": f"Simulated social reputation metric ({score * 100:.0f}% risk factor)."
            }
        )


# =========================================================================
# Provider Factory
# =========================================================================

def get_cell_provider(profiles: Optional[Dict[str, Any]] = None) -> BaseCellLocationProvider:
    config = load_config().get("providers", {}).get("cell_location", {})
    provider_type = os.environ.get("CELL_LOCATION_PROVIDER", config.get("active_provider", "simulated")).lower()

    if provider_type == "camara":
        return CAMARACellLocationAdapter()
    elif provider_type == "opencellid":
        return OpenCellIDAdapter()
    return SimulatedCellLocationProvider(profiles=profiles)


def get_identity_provider(profiles: Optional[Dict[str, Any]] = None) -> BaseIdentityRiskProvider:
    config = load_config().get("providers", {}).get("identity_risk", {})
    provider_type = os.environ.get("IDENTITY_RISK_PROVIDER", config.get("active_provider", "mock")).lower()

    if provider_type == "vendor":
        return VendorIdentityRiskAdapter()
    return MockIdentityRiskProvider(profiles=profiles)


def get_social_provider(profiles: Optional[Dict[str, Any]] = None) -> BaseSocialRiskProvider:
    config = load_config().get("providers", {}).get("social_risk", {})
    provider_type = os.environ.get("SOCIAL_RISK_PROVIDER", config.get("active_provider", "mock")).lower()

    if provider_type == "licensed":
        return LicensedSocialRiskAdapter()
    return MockSocialRiskProvider(profiles=profiles)
