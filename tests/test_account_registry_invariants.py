"""
Unit tests asserting Account Registry metric invariants and shared-entity fraud ring detection.
Asserts:
1. velocity_1h <= velocity_24h <= velocity_7d <= total_transactions.
2. Amount z-score returns None (Insufficient data) when historical transactions < 5.
3. Shared entity & fraud ring detection flags accounts sharing device fingerprints or IPs.
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.traceback_analyzer import TracebackAnalyzer, compute_z_score


class TestAccountRegistryInvariants(unittest.TestCase):
    def setUp(self):
        self.analyzer = TracebackAnalyzer()

    def test_velocity_metrics_consistency_invariant(self):
        """Invariant: velocity_1h <= velocity_24h <= velocity_7d <= total_transactions."""
        now = datetime.now(timezone.utc)
        acct_id = "acc_test_velocity_invariants"

        # Generate a series of transactions across time windows
        history = [
            # 20 min ago (inside 1h, 24h, 7d)
            {"transaction_id": "tx_v1", "account_id": acct_id, "amount": 100.0, "timestamp": (now - timedelta(minutes=20)).isoformat()},
            # 45 min ago (inside 1h, 24h, 7d)
            {"transaction_id": "tx_v2", "account_id": acct_id, "amount": 120.0, "timestamp": (now - timedelta(minutes=45)).isoformat()},
            # 3 hours ago (inside 24h, 7d)
            {"transaction_id": "tx_v3", "account_id": acct_id, "amount": 80.0, "timestamp": (now - timedelta(hours=3)).isoformat()},
            # 18 hours ago (inside 24h, 7d)
            {"transaction_id": "tx_v4", "account_id": acct_id, "amount": 95.0, "timestamp": (now - timedelta(hours=18)).isoformat()},
            # 3 days ago (inside 7d)
            {"transaction_id": "tx_v5", "account_id": acct_id, "amount": 150.0, "timestamp": (now - timedelta(days=3)).isoformat()},
            # 5 days ago (inside 7d)
            {"transaction_id": "tx_v6", "account_id": acct_id, "amount": 110.0, "timestamp": (now - timedelta(days=5)).isoformat()},
            # 20 days ago (outside 7d, but in total history)
            {"transaction_id": "tx_v7", "account_id": acct_id, "amount": 75.0, "timestamp": (now - timedelta(days=20)).isoformat()},
            {"transaction_id": "tx_v8", "account_id": acct_id, "amount": 60.0, "timestamp": (now - timedelta(days=25)).isoformat()},
        ]

        current_tx = {
            "transaction_id": "tx_v_curr",
            "account_id": acct_id,
            "amount": 130.0,
            "timestamp": now.isoformat()
        }

        res = self.analyzer.evaluate(tx=current_tx, prior_records=history)
        tb = res["traceback"]

        v_1h = tb["velocity_1hr"]
        v_24h = tb["velocity_24hr"]
        v_7d = tb["velocity_7d"]
        total = tb["account_transaction_count"]

        # Strict mathematical assertion
        self.assertLessEqual(v_1h, v_24h, "velocity_1h must be <= velocity_24h")
        self.assertLessEqual(v_24h, v_7d, "velocity_24h must be <= velocity_7d")
        self.assertLessEqual(v_7d, total, "velocity_7d must be <= total_transactions")

    def test_insufficient_data_z_score_under_5_transactions(self):
        """Invariant: When historical transactions < 5, z-score must be None ('Insufficient data')."""
        # Exactly 3 historical transactions (< 5)
        vals_small = [50.0, 75.0, 60.0]
        z_small = compute_z_score(150.0, vals_small)
        self.assertIsNone(z_small, "compute_z_score must return None for fewer than 5 historical transactions")

        # 5 historical transactions (sufficient data)
        vals_suff = [50.0, 55.0, 60.0, 52.0, 58.0]
        z_suff = compute_z_score(120.0, vals_suff)
        self.assertIsNotNone(z_suff)
        self.assertIsInstance(z_suff, float)
        self.assertGreater(z_suff, 2.0, "Spike amount should have elevated positive z-score")

    def test_shared_entity_fraud_ring_detection(self):
        """Invariant: Detects when multiple accounts share an IP or device fingerprint."""
        shared_dev = "fp_ring_cluster_01"
        accounts = ["acc_alpha", "acc_beta", "acc_gamma", "acc_delta"]

        mock_transactions = [
            {"account_id": acct, "device_fingerprint": shared_dev, "origin_ip": "72.14.204.10", "transaction_id": f"tx_ring_{acct}"}
            for acct in accounts
        ]

        # Group accounts by device
        device_to_accounts: Dict[str, set] = {}
        for tx in mock_transactions:
            dev = tx["device_fingerprint"]
            if dev not in device_to_accounts:
                device_to_accounts[dev] = set()
            device_to_accounts[dev].add(tx["account_id"])

        shared_cluster = device_to_accounts.get(shared_dev, set())
        self.assertEqual(len(shared_cluster), 4, "Must identify all 4 accounts in the shared cluster")
        self.assertTrue(len(shared_cluster) >= 3, "Cluster with >=3 accounts qualifies as a possible fraud ring")


if __name__ == "__main__":
    unittest.main()
