"""
Feature 1: Transaction Origin & Source Tracing
Captures and enriches transaction origin metadata (IP, geolocation, ISP, ASN, VPN/Proxy/TOR status)
and evaluates origin-based fraud rules.
Supports:
  - MaxMind GeoLite2 (.mmdb) with optional geoip2 / maxminddb library
  - Real-time ip-api.com fallback
  - Dynamic Tor Bulk Exit List downloader with offline cache
  - Datacenter / Cloud ASN heuristics
  - Offline deterministic fallback database
"""

import os
import json
import time
import threading
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

try:
    import maxminddb
except ImportError:
    maxminddb = None

try:
    import geoip2.database
except ImportError:
    geoip2 = None

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
TOR_CACHE_FILE = os.path.join(ROOT_DIR, "data", "tor_exit_nodes.txt")

# Local deterministic IP -> Geo/Network lookup table for fast, reliable offline/demo execution
LOCAL_IP_GEO_DB: Dict[str, Dict[str, Any]] = {
    # Clean domestic IPs (US / IN / UK)
    "192.0.2.1": {
        "country": "US",
        "city": "New York",
        "region": "NY",
        "isp": "Verizon Fios",
        "asn": "AS701 MCI Communications",
        "connection_type": "broadband",
        "is_vpn": False,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": False,
        "coordinates": {"lat": 40.7128, "lon": -74.0060},
        "timezone": "America/New_York"
    },
    "192.0.2.2": {
        "country": "US",
        "city": "San Francisco",
        "region": "CA",
        "isp": "Comcast Cable",
        "asn": "AS7922 Comcast Cable Communications",
        "connection_type": "broadband",
        "is_vpn": False,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": False,
        "coordinates": {"lat": 37.7749, "lon": -122.4194},
        "timezone": "America/Los_Angeles"
    },
    "192.0.2.3": {
        "country": "US",
        "city": "Chicago",
        "region": "IL",
        "isp": "AT&T Mobility",
        "asn": "AS20057 AT&T Wireless",
        "connection_type": "mobile",
        "is_vpn": False,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": False,
        "coordinates": {"lat": 41.8781, "lon": -87.6298},
        "timezone": "America/Chicago"
    },
    "203.0.113.10": {
        "country": "IN",
        "city": "Mumbai",
        "region": "MH",
        "isp": "Reliance Jio",
        "asn": "AS55836 Reliance Jio Infocomm",
        "connection_type": "mobile",
        "is_vpn": False,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": False,
        "coordinates": {"lat": 19.0760, "lon": 72.8777},
        "timezone": "Asia/Kolkata"
    },
    "198.51.100.20": {
        "country": "GB",
        "city": "London",
        "region": "ENG",
        "isp": "British Telecom",
        "asn": "AS2856 British Telecommunications PLC",
        "connection_type": "broadband",
        "is_vpn": False,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": False,
        "coordinates": {"lat": 51.5074, "lon": -0.1278},
        "timezone": "Europe/London"
    },
    # VPN IPs
    "198.51.100.50": {
        "country": "NL",
        "city": "Amsterdam",
        "region": "NH",
        "isp": "NordVPN / Tefincom S.A.",
        "asn": "AS60068 Datacamp Limited",
        "connection_type": "vpn",
        "is_vpn": True,
        "is_proxy": False,
        "is_tor": False,
        "is_datacenter": True,
        "coordinates": {"lat": 52.3676, "lon": 4.9041},
        "timezone": "Europe/Amsterdam"
    },
    "10.200.0.50": {
        "country": "CH",
        "city": "Zurich",
        "region": "ZH",
        "isp": "ProtonVPN AG",
        "asn": "AS62371 Proton Technologies AG",
        "connection_type": "vpn",
        "is_vpn": True,
        "is_proxy": True,
        "is_tor": False,
        "is_datacenter": True,
        "coordinates": {"lat": 47.3769, "lon": 8.5417},
        "timezone": "Europe/Zurich"
    },
    # Proxy IP
    "198.51.100.75": {
        "country": "SG",
        "city": "Singapore",
        "region": "SG",
        "isp": "DigitalOcean Proxy Node",
        "asn": "AS14061 DigitalOcean LLC",
        "connection_type": "proxy",
        "is_vpn": False,
        "is_proxy": True,
        "is_tor": False,
        "is_datacenter": True,
        "coordinates": {"lat": 1.3521, "lon": 103.8198},
        "timezone": "Asia/Singapore"
    },
    # TOR Exit Nodes
    "185.220.101.1": {
        "country": "DE",
        "city": "Frankfurt",
        "region": "HE",
        "isp": "Tor Exit Node / Zwiebelfreunde",
        "asn": "AS206238 Freedom & Privacy Network",
        "connection_type": "tor",
        "is_vpn": False,
        "is_proxy": True,
        "is_tor": True,
        "is_datacenter": True,
        "coordinates": {"lat": 50.1109, "lon": 8.6821},
        "timezone": "Europe/Berlin"
    },
    "185.220.101.99": {
        "country": "RO",
        "city": "Bucharest",
        "region": "B",
        "isp": "Tor Exit Relay RO",
        "asn": "AS200052 Tor Relay Network",
        "connection_type": "tor",
        "is_vpn": False,
        "is_proxy": True,
        "is_tor": True,
        "is_datacenter": True,
        "coordinates": {"lat": 44.4268, "lon": 26.1025},
        "timezone": "Europe/Bucharest"
    }
}

DEFAULT_DOMESTIC_PROFILE: Dict[str, Any] = {
    "country": "US",
    "city": "New York",
    "region": "NY",
    "isp": "Default Domestic ISP",
    "asn": "AS00000 Domestic Transit",
    "connection_type": "broadband",
    "is_vpn": False,
    "is_proxy": False,
    "is_tor": False,
    "is_datacenter": False,
    "coordinates": {"lat": 40.7128, "lon": -74.0060},
    "timezone": "America/New_York"
}

DATACENTER_KEYWORDS = [
    "amazon", "aws", "digitalocean", "hetzner", "ovh", "linode", "vultr",
    "google cloud", "azure", "microsoft", "leaseweb", "choopa", "m247",
    "datacamp", "cogent", "oracle cloud", "alibaba"
]


class TorExitListManager:
    """
    Maintains active Tor exit node IP cache with scheduled/on-demand refreshes
    from check.torproject.org bulk exit list.
    """
    _instance: Optional["TorExitListManager"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self.exit_nodes: Set[str] = {
            "185.220.101.1", "185.220.101.99", "185.220.102.8",
            "185.220.100.252", "185.220.101.5", "185.220.101.7",
            "185.220.101.8", "185.220.101.9", "185.220.101.10",
            "192.42.116.16", "199.249.230.70", "51.15.43.205"
        }
        self.last_refreshed: float = 0.0
        self._load_cached_file()

    @classmethod
    def get_instance(cls) -> "TorExitListManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def _load_cached_file(self) -> None:
        if os.path.exists(TOR_CACHE_FILE):
            try:
                with open(TOR_CACHE_FILE, "r", encoding="utf-8") as f:
                    for line in f:
                        clean = line.strip()
                        if clean and not clean.startswith("#"):
                            self.exit_nodes.add(clean)
            except Exception:
                pass

    def is_tor(self, ip_address: str) -> bool:
        if not ip_address:
            return False
        clean_ip = ip_address.strip()
        # Direct check
        if clean_ip in self.exit_nodes:
            return True
        # Check local DB
        if clean_ip in LOCAL_IP_GEO_DB and LOCAL_IP_GEO_DB[clean_ip].get("is_tor"):
            return True
        return False

    def refresh_from_upstream(self, timeout_sec: float = 3.0) -> int:
        now = time.time()
        # Rate limit refresh to at most once per 30 minutes
        if now - self.last_refreshed < 1800 and len(self.exit_nodes) > 12:
            return len(self.exit_nodes)

        url = "https://check.torproject.org/torbulkexitlist"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FraudGuard/1.0"})
            with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
                lines = resp.read().decode("utf-8", errors="ignore").splitlines()
                count = 0
                for line in lines:
                    ip = line.strip()
                    if ip and not ip.startswith("#") and "." in ip:
                        self.exit_nodes.add(ip)
                        count += 1
                self.last_refreshed = now
                # Save cache
                try:
                    os.makedirs(os.path.dirname(TOR_CACHE_FILE), exist_ok=True)
                    with open(TOR_CACHE_FILE, "w", encoding="utf-8") as f:
                        f.write("\n".join(sorted(self.exit_nodes)))
                except Exception:
                    pass
                return len(self.exit_nodes)
        except Exception:
            return len(self.exit_nodes)


class OriginTracer:
    def __init__(self, allow_external_api: bool = False, api_timeout: float = 1.0) -> None:
        self.allow_external_api = allow_external_api
        self.api_timeout = api_timeout
        self.tor_manager = TorExitListManager.get_instance()
        self.maxmind_reader = self._init_maxmind_reader()

    def _init_maxmind_reader(self) -> Optional[Any]:
        candidates = [
            os.environ.get("MAXMIND_DB_PATH"),
            os.path.join(ROOT_DIR, "data", "GeoLite2-City.mmdb"),
            os.path.join("/var/task", "data", "GeoLite2-City.mmdb"),
            "data/GeoLite2-City.mmdb"
        ]
        for p in candidates:
            if p and os.path.exists(p):
                if geoip2 is not None:
                    try:
                        return geoip2.database.Reader(p)
                    except Exception:
                        pass
                if maxminddb is not None:
                    try:
                        return maxminddb.open_database(p)
                    except Exception:
                        pass
        return None

    @staticmethod
    def extract_ip(tx: Dict[str, Any], event_headers: Optional[Dict[str, Any]] = None) -> str:
        """Extract origin IP from transaction payload or Lambda/ALB event headers."""
        if isinstance(tx.get("origin"), dict) and tx["origin"].get("ip_address"):
            return str(tx["origin"]["ip_address"]).strip()
        if tx.get("origin_ip"):
            return str(tx["origin_ip"]).strip()
        if tx.get("ip_address"):
            return str(tx["ip_address"]).strip()
        if event_headers and isinstance(event_headers, dict):
            xff = event_headers.get("x-forwarded-for") or event_headers.get("X-Forwarded-For")
            if xff:
                return xff.split(",")[0].strip()
        return "192.0.2.1"

    def _detect_datacenter(self, isp: str, asn: str) -> bool:
        combined = f"{isp} {asn}".lower()
        return any(kw in combined for kw in DATACENTER_KEYWORDS)

    def lookup_ip(self, ip_address: str, pre_populated_origin: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Look up IP metadata in:
        1. pre-populated origin dict
        2. Local deterministic table
        3. MaxMind GeoLite2 (.mmdb) if available
        4. ip-api.com live fallback
        5. Default clean domestic profile
        """
        # If known in local deterministic DB, use it as baseline
        if ip_address in LOCAL_IP_GEO_DB:
            record = dict(LOCAL_IP_GEO_DB[ip_address])
            record["ip_address"] = ip_address
            record["coordinates"] = dict(record["coordinates"])
            if pre_populated_origin and isinstance(pre_populated_origin, dict):
                for k, v in pre_populated_origin.items():
                    if v is not None:
                        record[k] = v
            if self.tor_manager.is_tor(ip_address):
                record["is_tor"] = True
                record["connection_type"] = "tor"
            return record

        if pre_populated_origin and isinstance(pre_populated_origin, dict) and len(pre_populated_origin) > 1:
            merged = dict(DEFAULT_DOMESTIC_PROFILE)
            merged["ip_address"] = ip_address
            for k, v in pre_populated_origin.items():
                if v is not None:
                    merged[k] = v
            if "coordinates" not in merged or not isinstance(merged["coordinates"], dict):
                merged["coordinates"] = dict(DEFAULT_DOMESTIC_PROFILE["coordinates"])
            if self.tor_manager.is_tor(ip_address):
                merged["is_tor"] = True
                merged["connection_type"] = "tor"
            return merged

        # 2. MaxMind GeoLite2 (.mmdb)
        if self.maxmind_reader:
            try:
                res = self.maxmind_reader.city(ip_address) if hasattr(self.maxmind_reader, "city") else self.maxmind_reader.get(ip_address)
                if res:
                    city_name = "Unknown"
                    country_code = "US"
                    lat = 40.7128
                    lon = -74.0060
                    tz = "UTC"
                    if hasattr(res, "city"):
                        city_name = res.city.name or "Unknown"
                        country_code = res.country.iso_code or "US"
                        lat = float(res.location.latitude or 40.7128)
                        lon = float(res.location.longitude or -74.0060)
                        tz = res.location.time_zone or "UTC"
                    elif isinstance(res, dict):
                        city_name = res.get("city", {}).get("names", {}).get("en", "Unknown")
                        country_code = res.get("country", {}).get("iso_code", "US")
                        loc = res.get("location", {})
                        lat = float(loc.get("latitude", 40.7128))
                        lon = float(loc.get("longitude", -74.0060))
                        tz = loc.get("time_zone", "UTC")

                    is_tor = self.tor_manager.is_tor(ip_address)
                    return {
                        "ip_address": ip_address,
                        "country": country_code,
                        "city": city_name,
                        "region": "State",
                        "isp": "MaxMind GeoLite2 ISP",
                        "asn": "AS0000 GeoIP",
                        "connection_type": "tor" if is_tor else "broadband",
                        "is_vpn": False,
                        "is_proxy": is_tor,
                        "is_tor": is_tor,
                        "is_datacenter": False,
                        "coordinates": {"lat": lat, "lon": lon},
                        "timezone": tz,
                        "geo_source": "MAXMIND_GEOLITE2"
                    }
            except Exception:
                pass

        # 3. ip-api.com live fallback
        if self.allow_external_api:
            try:
                url = f"http://ip-api.com/json/{ip_address}?fields=status,countryCode,regionName,city,lat,lon,timezone,isp,as,mobile,proxy,hosting"
                req = urllib.request.Request(url, headers={"User-Agent": "FraudGuard/1.0"})
                with urllib.request.urlopen(req, timeout=self.api_timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("status") == "success":
                        is_proxy = bool(data.get("proxy", False))
                        is_mobile = bool(data.get("mobile", False))
                        is_hosting = bool(data.get("hosting", False))
                        isp_name = str(data.get("isp", "Unknown ISP"))
                        asn_name = str(data.get("as", "AS0 Unknown"))
                        is_dc = is_hosting or self._detect_datacenter(isp_name, asn_name)
                        is_tor = self.tor_manager.is_tor(ip_address)

                        conn_type = "tor" if is_tor else ("vpn" if is_dc and is_proxy else ("proxy" if is_proxy else ("mobile" if is_mobile else "broadband")))
                        return {
                            "ip_address": ip_address,
                            "country": data.get("countryCode", "US"),
                            "city": data.get("city", "Unknown"),
                            "region": data.get("regionName", "Unknown"),
                            "isp": isp_name,
                            "asn": asn_name,
                            "connection_type": conn_type,
                            "is_vpn": bool(is_dc and is_proxy),
                            "is_proxy": is_proxy,
                            "is_tor": is_tor,
                            "is_datacenter": is_dc,
                            "coordinates": {
                                "lat": float(data.get("lat", 0.0)),
                                "lon": float(data.get("lon", 0.0))
                            },
                            "timezone": data.get("timezone", "UTC"),
                            "geo_source": "IP_API_LIVE"
                        }
            except Exception:
                pass

        # 4. Default clean domestic fallback
        fallback = dict(DEFAULT_DOMESTIC_PROFILE)
        fallback["ip_address"] = ip_address
        fallback["coordinates"] = dict(DEFAULT_DOMESTIC_PROFILE["coordinates"])
        if self.tor_manager.is_tor(ip_address):
            fallback["is_tor"] = True
            fallback["connection_type"] = "tor"
        return fallback

    def evaluate(
        self,
        tx: Dict[str, Any],
        event_headers: Optional[Dict[str, Any]] = None,
        registered_country: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Enriches transaction with `origin` block and evaluates origin risk rules.
        """
        ip_address = self.extract_ip(tx, event_headers=event_headers)
        pre_origin = tx.get("origin") if isinstance(tx.get("origin"), dict) else None
        origin = self.lookup_ip(ip_address, pre_populated_origin=pre_origin)

        # Sync Tor status with TorExitListManager
        if self.tor_manager.is_tor(ip_address):
            origin["is_tor"] = True
            origin["connection_type"] = "tor"

        # Ensure connection_type consistency with boolean flags
        if origin.get("is_tor"):
            origin["connection_type"] = "tor"
        elif origin.get("is_vpn"):
            origin["connection_type"] = "vpn"
        elif origin.get("is_proxy"):
            origin["connection_type"] = "proxy"

        flags: List[str] = []
        risk_points = 0
        force_block = False

        # Check TOR first (AUTOMATIC FORCE BLOCK)
        if origin.get("is_tor"):
            flags.append("ORIGIN_TOR")
            flags.append("TOR_EXIT_NODE")
            risk_points += 20
            force_block = True

        # Check VPN (HIGH RISK +20)
        if origin.get("is_vpn"):
            flags.append("ORIGIN_VPN")
            risk_points += 20

        # Check Proxy
        if origin.get("is_proxy") and not origin.get("is_tor"):
            flags.append("ORIGIN_PROXY")
            risk_points += 15

        # Check Datacenter ASN
        if origin.get("is_datacenter") and not origin.get("is_tor") and not origin.get("is_vpn"):
            flags.append("DATACENTER_IP")
            risk_points += 15

        # Check cross-border mismatch (IP country != card/account registered country) -> +10
        acct_country = registered_country or tx.get("registered_country") or tx.get("card_registered_country")
        if acct_country and origin.get("country") and origin["country"].upper() != acct_country.upper():
            flags.append("GEO_ORIGIN_MISMATCH")
            risk_points += 10

        # Determine threat level label
        if origin.get("is_tor"):
            threat_level = "CRITICAL"
        elif origin.get("is_vpn") or origin.get("is_proxy"):
            threat_level = "HIGH"
        elif "GEO_ORIGIN_MISMATCH" in flags or origin.get("is_datacenter"):
            threat_level = "MEDIUM"
        else:
            threat_level = "LOW"

        origin["threat_level"] = threat_level

        return {
            "origin": origin,
            "flags": flags,
            "risk_points": risk_points,
            "force_block": force_block
        }
