"""
FraudGuard Multi-Scenario Transaction Simulator Engine
Supports on-demand scenario generation (Normal, Impossible Travel, Tor Attack,
Velocity Burst, Night Fraud) and toggleable background streaming.
"""

import time
import random
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

try:
    from src.sse_manager import SSEManager
except ImportError:
    from sse_manager import SSEManager


class SimulatorEngine:
    _instance: Optional["SimulatorEngine"] = None
    _lock = threading.Lock()

    def __init__(self, router: Optional[Any] = None) -> None:
        self.router = router
        self.sse = SSEManager.get_instance()
        self.is_running = False
        self.tps = 1.0
        self._thread: Optional[threading.Thread] = None
        self._seq = 1

    @classmethod
    def get_instance(cls, router: Optional[Any] = None) -> "SimulatorEngine":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(router=router)
            elif router is not None and cls._instance.router is None:
                cls._instance.router = router
            return cls._instance

    def generate_scenario_payload(self, scenario_name: str) -> Dict[str, Any]:
        scenario = str(scenario_name).strip().upper()
        now_utc = datetime.now(timezone.utc)
        now_iso = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        self._seq += 1
        tx_id = f"tx_sim_{int(now_utc.timestamp() * 1000)}_{self._seq}"

        if scenario in ("IMPOSSIBLE_TRAVEL", "TRAVEL_ANOMALY"):
            # First transaction in NY, second transaction in London moments later
            account_id = f"acc_travel_{random.randint(10, 99)}"
            seed_tx = {
                "transaction_id": f"{tx_id}_seed",
                "source_account": account_id,
                "destination_account": "acc_merchant_us",
                "amount": 45.0,
                "currency": "USD",
                "txn_type": "CREDIT",
                "origin_ip": "192.0.2.1",
                "transaction_city": "New York",
                "transaction_country": "US",
                "timestamp": (now_utc - timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
            }
            if self.router:
                self.router.route_transaction(seed_tx)

            return {
                "transaction_id": tx_id,
                "source_account": account_id,
                "destination_account": "acc_merchant_uk",
                "amount": 120.0,
                "currency": "GBP",
                "txn_type": "CREDIT",
                "channel": "MOBILE_APP",
                "origin_ip": "198.51.100.20",
                "transaction_city": "London",
                "transaction_country": "GB",
                "timestamp": now_iso,
                "user_agent": "FraudGuard Mobile SDK 2.4",
                "session_id": f"sess_{tx_id[:10]}"
            }

        elif scenario in ("TOR_ATTACK", "TOR", "TOR_EXIT_NODE"):
            return {
                "transaction_id": tx_id,
                "source_account": f"acc_tor_{random.randint(10, 99)}",
                "destination_account": "acc_crypto_exchange",
                "amount": 250.0,
                "currency": "USD",
                "txn_type": "WIRE",
                "channel": "ONLINE_WEB",
                "origin_ip": "185.220.101.1",
                "transaction_city": "Frankfurt",
                "transaction_country": "DE",
                "timestamp": now_iso,
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0",
                "session_id": f"sess_tor_{tx_id[:8]}"
            }

        elif scenario in ("VELOCITY_BURST", "BURST"):
            account_id = f"acc_burst_{random.randint(10, 99)}"
            # Fire rapid prior transactions
            for i in range(1, 4):
                sub_tx = {
                    "transaction_id": f"{tx_id}_pre_{i}",
                    "source_account": account_id,
                    "destination_account": f"acc_merch_{i}",
                    "amount": 35.0 + i * 5,
                    "currency": "USD",
                    "txn_type": "CREDIT",
                    "origin_ip": "192.0.2.1",
                    "transaction_city": "New York",
                    "transaction_country": "US",
                    "timestamp": (now_utc - timedelta(seconds=(4 - i) * 30)).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
                if self.router:
                    self.router.route_transaction(sub_tx)

            return {
                "transaction_id": tx_id,
                "source_account": account_id,
                "destination_account": "acc_merch_burst_target",
                "amount": 195.0,
                "currency": "USD",
                "txn_type": "WIRE",
                "channel": "ONLINE_WEB",
                "origin_ip": "192.0.2.1",
                "transaction_city": "New York",
                "transaction_country": "US",
                "timestamp": now_iso
            }

        elif scenario in ("NIGHT_FRAUD", "NIGHT"):
            return {
                "transaction_id": tx_id,
                "source_account": f"acc_night_{random.randint(10, 99)}",
                "destination_account": "acc_overseas_wire",
                "amount": 280.0,
                "currency": "USD",
                "txn_type": "WIRE",
                "channel": "ONLINE_WEB",
                "origin_ip": "198.51.100.50",
                "transaction_city": "Amsterdam",
                "transaction_country": "NL",
                "local_hour": 3,
                "timestamp": now_iso
            }

        else:
            # Clean Domestic
            city = "New York"
            country = "US"
            ip = "192.0.2.1"
            return {
                "transaction_id": tx_id,
                "source_account": f"acc_norm_{int(now_utc.timestamp() * 1000)}_{self._seq}",
                "destination_account": f"acc_retail_{random.randint(100, 999)}",
                "amount": round(random.uniform(15.0, 85.0), 2),
                "currency": "USD",
                "txn_type": random.choice(["CREDIT", "DEBIT"]),
                "channel": random.choice(["POS", "ONLINE_WEB", "MOBILE_APP"]),
                "origin_ip": ip,
                "transaction_city": city,
                "transaction_country": country,
                "timestamp": now_iso,
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "session_id": f"sess_{tx_id[:8]}"
            }

    def execute_simulation(self, scenario_name: str) -> Dict[str, Any]:
        if not self.router:
            raise RuntimeError("FraudRouter instance not initialized in SimulatorEngine.")

        payload = self.generate_scenario_payload(scenario_name)
        result = self.router.route_transaction(payload)
        self.sse.broadcast("transaction", result)
        return result

    def start_background(self, tps: float = 1.0) -> None:
        self.tps = max(0.2, min(10.0, float(tps)))
        if self.is_running:
            return
        self.is_running = True
        self._thread = threading.Thread(target=self._background_loop, daemon=True)
        self._thread.start()

    def stop_background(self) -> None:
        self.is_running = False

    def _background_loop(self) -> None:
        scenarios = ["NORMAL", "NORMAL", "NORMAL", "NIGHT_FRAUD", "VELOCITY_BURST", "IMPOSSIBLE_TRAVEL", "TOR_ATTACK"]
        while self.is_running:
            try:
                scen = random.choice(scenarios)
                self.execute_simulation(scen)
            except Exception:
                pass
            interval = 1.0 / max(0.1, self.tps)
            time.sleep(interval)

    def get_status(self) -> Dict[str, Any]:
        return {
            "active": self.is_running,
            "running": self.is_running,
            "is_running": self.is_running,
            "tps": self.tps,
            "available_scenarios": ["NORMAL", "IMPOSSIBLE_TRAVEL", "TOR_ATTACK", "VELOCITY_BURST", "NIGHT_FRAUD"]
        }
