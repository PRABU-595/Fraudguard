"""
Feature 4: Account Holder Location vs Transaction Location
Computes Haversine distance between registered location and transaction origin,
evaluates international status, and calculates physical travel speed from the
previous transaction to detect impossible travel (> 900 km/h -> automatic BLOCK).
Supports multi-source location priority resolution (Carrier Cell Tower > Device GPS > IP Geo).
"""

import os
import json
import math
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config_rules.json")

EARTH_RADIUS_KM = 6371.0
DEFAULT_IMPOSSIBLE_TRAVEL_SPEED_KMH = 900.0
IMPOSSIBLE_TRAVEL_POINTS = 40
INTERNATIONAL_TXN_POINTS = 10
MIN_EFFECTIVE_HOURS = 1.0 / 3600.0  # 1 second floor for simultaneous (0-minute) cross-city transactions

CITY_COORDINATES: Dict[str, Dict[str, Any]] = {
    "new york": {"lat": 40.7128, "lon": -74.0060, "country": "US"},
    "san francisco": {"lat": 37.7749, "lon": -122.4194, "country": "US"},
    "chicago": {"lat": 41.8781, "lon": -87.6298, "country": "US"},
    "boston": {"lat": 42.3601, "lon": -71.0589, "country": "US"},
    "washington": {"lat": 38.9072, "lon": -77.0369, "country": "US"},
    "pittsburgh": {"lat": 40.4406, "lon": -79.9959, "country": "US"},  # ~500km from New York
    "mumbai": {"lat": 19.0760, "lon": 72.8777, "country": "IN"},
    "delhi": {"lat": 28.6139, "lon": 77.2090, "country": "IN"},
    "london": {"lat": 51.5074, "lon": -0.1278, "country": "GB"},
    "amsterdam": {"lat": 52.3676, "lon": 4.9041, "country": "NL"},
    "frankfurt": {"lat": 50.1109, "lon": 8.6821, "country": "DE"},
    "zurich": {"lat": 47.3769, "lon": 8.5417, "country": "CH"},
    "bucharest": {"lat": 44.4268, "lon": 26.1025, "country": "RO"},
    "singapore": {"lat": 1.3521, "lon": 103.8198, "country": "SG"},
}


def load_impossible_speed_threshold() -> float:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return float(data.get("location", {}).get("impossible_travel_speed_kmh", DEFAULT_IMPOSSIBLE_TRAVEL_SPEED_KMH))
        except Exception:
            pass
    return DEFAULT_IMPOSSIBLE_TRAVEL_SPEED_KMH


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance in kilometers between two lat/lon points."""
    phi1 = math.radians(float(lat1))
    phi2 = math.radians(float(lat2))
    d_phi = math.radians(float(lat2) - float(lat1))
    d_lambda = math.radians(float(lon2) - float(lon1))

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return round(EARTH_RADIUS_KM * c, 2)


def resolve_coordinates(
    city: Optional[str] = None,
    coords_dict: Optional[Dict[str, Any]] = None,
    default_city: str = "New York"
) -> Tuple[float, float]:
    if city:
        key = str(city).strip().lower()
        if key in CITY_COORDINATES:
            return CITY_COORDINATES[key]["lat"], CITY_COORDINATES[key]["lon"]
    if isinstance(coords_dict, dict) and "lat" in coords_dict and "lon" in coords_dict:
        return float(coords_dict["lat"]), float(coords_dict["lon"])
    fallback = CITY_COORDINATES.get(default_city.lower(), CITY_COORDINATES["new york"])
    return fallback["lat"], fallback["lon"]


class LocationChecker:
    def __init__(self, speed_threshold_kmh: Optional[float] = None) -> None:
        self.speed_threshold_kmh = speed_threshold_kmh or load_impossible_speed_threshold()

    def resolve_latest_location(
        self,
        tx: Dict[str, Any],
        origin: Optional[Dict[str, Any]] = None,
        pii_profile: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Resolves latest known account/device location according to strict priority:
          1. Carrier / Cell Tower (if available from PII/Carrier adapter)
          2. Device GPS (if user consented)
          3. IP Geolocation (fallback)
        Always provides: source, accuracy_meters, freshness_seconds, is_simulated, coordinates, city, country.
        """
        now_ts = time.time()

        # Priority 1: Carrier / Cell-Tower
        cell_loc = (pii_profile or {}).get("last_known_location")
        if cell_loc and isinstance(cell_loc, dict) and "lat" in cell_loc and "lon" in cell_loc:
            ts_str = cell_loc.get("timestamp")
            freshness = 120.0
            if ts_str:
                try:
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    freshness = max(0.0, round(now_ts - dt.timestamp(), 1))
                except Exception:
                    pass
            is_sim = cell_loc.get("is_simulated", True)
            return {
                "source": "carrier_cell_tower",
                "source_label": "Telecom Carrier Cell Tower",
                "is_simulated": is_sim,
                "city": cell_loc.get("city", "New York"),
                "country": (pii_profile or {}).get("registered_country", "US"),
                "coordinates": {"lat": float(cell_loc["lat"]), "lon": float(cell_loc["lon"])},
                "accuracy_meters": int(cell_loc.get("accuracy_meters", 65)),
                "freshness_seconds": freshness,
                "timestamp": ts_str or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            }

        # Priority 2: Device GPS (Consented)
        gps = tx.get("device_gps") or tx.get("device_coordinates")
        if gps and isinstance(gps, dict) and "lat" in gps and "lon" in gps and tx.get("gps_consent", False):
            return {
                "source": "device_gps",
                "source_label": "Consented Device GPS Sensor",
                "is_simulated": False,
                "city": tx.get("transaction_city", "Local Device"),
                "country": tx.get("transaction_country", "US"),
                "coordinates": {"lat": float(gps["lat"]), "lon": float(gps["lon"])},
                "accuracy_meters": int(gps.get("accuracy_meters", 15)),
                "freshness_seconds": float(gps.get("freshness_seconds", 10.0)),
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            }

        # Priority 3: IP Geolocation
        orig = origin or tx.get("origin") or {}
        ip_coords = orig.get("coordinates") or {"lat": 40.7128, "lon": -74.0060}
        return {
            "source": "ip_geolocation",
            "source_label": "IP Network Geolocation",
            "is_simulated": orig.get("geo_source") != "IP_API_LIVE",
            "city": orig.get("city", "New York"),
            "country": orig.get("country", "US"),
            "coordinates": {"lat": float(ip_coords.get("lat", 40.7128)), "lon": float(ip_coords.get("lon", -74.0060))},
            "accuracy_meters": 5000,
            "freshness_seconds": 0.0,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        }

    def evaluate(
        self,
        tx: Dict[str, Any],
        origin: Optional[Dict[str, Any]] = None,
        previous_record: Optional[Dict[str, Any]] = None,
        time_since_last_txn_mins: Optional[float] = None,
        pii_profile: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Computes `location_check` block and evaluates IMPOSSIBLE_TRAVEL and INTERNATIONAL_TRANSACTION.
        """
        orig = origin or tx.get("origin") or {}
        tx_city = tx.get("transaction_city") or orig.get("city") or tx.get("location") or "New York"
        tx_country = (
            tx.get("transaction_country")
            or orig.get("country")
            or CITY_COORDINATES.get(str(tx_city).lower(), {}).get("country")
            or "US"
        )
        tx_coords = tx.get("coordinates") or orig.get("coordinates")
        tx_lat, tx_lon = resolve_coordinates(tx_city, tx_coords)

        # Account registered city & country
        reg_city = (
            tx.get("account_registered_city")
            or (pii_profile or {}).get("registered_city")
            or ((pii_profile or {}).get("last_known_location") or {}).get("city")
            or "New York"
        )
        reg_country = (
            tx.get("account_registered_country")
            or tx.get("registered_country")
            or (pii_profile or {}).get("registered_country")
            or CITY_COORDINATES.get(str(reg_city).lower(), {}).get("country")
            or "US"
        )
        reg_coords = tx.get("account_registered_coordinates")
        reg_lat, reg_lon = resolve_coordinates(reg_city, reg_coords)

        distance_km = haversine_km(reg_lat, reg_lon, tx_lat, tx_lon)
        is_international = str(tx_country).upper() != str(reg_country).upper()

        # Travel speed vs previous transaction
        travel_speed_kmh = 0.0
        is_impossible_travel = False
        travel_dist_km = 0.0

        prev_loc_source = previous_record or tx.get("previous_transaction")
        if prev_loc_source and time_since_last_txn_mins is not None and time_since_last_txn_mins >= 0:
            prev_orig = (
                prev_loc_source.get("origin")
                or (prev_loc_source.get("original_payload") or {}).get("origin")
                or {}
            )
            prev_city = (
                prev_loc_source.get("transaction_city")
                or (prev_loc_source.get("location_check") or {}).get("transaction_city")
                or (prev_loc_source.get("original_payload") or {}).get("transaction_city")
                or prev_orig.get("city")
                or prev_loc_source.get("location")
            )
            prev_coords = prev_loc_source.get("coordinates") or prev_orig.get("coordinates")
            if prev_city or prev_coords:
                prev_lat, prev_lon = resolve_coordinates(prev_city, prev_coords)
                travel_dist_km = haversine_km(prev_lat, prev_lon, tx_lat, tx_lon)
                if travel_dist_km > 0:
                    hours = float(time_since_last_txn_mins) / 60.0
                    effective_hours = max(hours, MIN_EFFECTIVE_HOURS)
                    travel_speed_kmh = round(travel_dist_km / effective_hours, 2)
                    if travel_speed_kmh > self.speed_threshold_kmh:
                        is_impossible_travel = True

        flags: List[str] = []
        risk_points = 0
        force_block = False

        if is_impossible_travel:
            flags.append("IMPOSSIBLE_TRAVEL")
            risk_points += IMPOSSIBLE_TRAVEL_POINTS
            force_block = True

        if is_international:
            flags.append("INTERNATIONAL_TRANSACTION")
            risk_points += INTERNATIONAL_TXN_POINTS

        # Resolve multi-source latest location
        latest_location = self.resolve_latest_location(tx, origin=orig, pii_profile=pii_profile)

        location_check = {
            "account_registered_city": reg_city,
            "account_registered_country": reg_country,
            "account_registered_coordinates": {"lat": reg_lat, "lon": reg_lon},
            "transaction_city": tx_city,
            "transaction_country": tx_country,
            "transaction_coordinates": {"lat": tx_lat, "lon": tx_lon},
            "distance_km": distance_km,
            "is_international": is_international,
            "is_impossible_travel": is_impossible_travel,
            "travel_distance_km": travel_dist_km,
            "travel_speed_kmh": travel_speed_kmh,
            "speed_threshold_kmh": self.speed_threshold_kmh,
            "latest_location": latest_location
        }

        return {
            "location_check": location_check,
            "flags": flags,
            "risk_points": risk_points,
            "force_block": force_block
        }
