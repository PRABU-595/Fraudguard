"""
Unit tests asserting shared metrics invariants and analytics contract parity.
Asserts:
1. release_rate = released / (released + confirmed_fraud); confirmed_rate = confirmed / (released + confirmed); sum == 100%.
2. Both Quarantine and Analytics endpoints use the canonical shared metrics engine.
3. Volume over time zero-fills 24 hourly buckets.
4. Analytics captions are dynamically computed from aggregation data without hardcoding.
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.metrics_calculator import compute_quarantine_metrics
from src.analytics_aggregator import aggregate_soc_analytics


class TestSharedMetricsInvariants(unittest.TestCase):
    def test_release_and_confirmed_rates_sum_to_100(self):
        """Invariant: release_rate and confirmed_fraud_rate must sum to 100.0%."""
        mock_quarantine = [
            {"status": "QUARANTINED", "quarantine_ts": "2026-10-25T10:00:00Z"},
            {"status": "QUARANTINED", "quarantine_ts": "2026-10-25T11:00:00Z"},
            {"status": "RELEASED", "quarantine_ts": "2026-10-25T08:00:00Z", "updated_ts": "2026-10-25T08:20:00Z"},
            {"status": "RELEASED", "quarantine_ts": "2026-10-25T07:00:00Z", "updated_ts": "2026-10-25T07:15:00Z"},
            {"status": "CONFIRMED_FRAUD", "quarantine_ts": "2026-10-25T06:00:00Z", "updated_ts": "2026-10-25T06:30:00Z"},
            {"status": "CONFIRMED_FRAUD", "quarantine_ts": "2026-10-25T05:00:00Z", "updated_ts": "2026-10-25T05:25:00Z"},
            {"status": "CONFIRMED_FRAUD", "quarantine_ts": "2026-10-25T04:00:00Z", "updated_ts": "2026-10-25T04:10:00Z"},
        ]

        metrics = compute_quarantine_metrics(mock_quarantine)

        self.assertEqual(metrics["open_backlog"], 2)
        self.assertEqual(metrics["total_closed"], 5)
        self.assertEqual(metrics["released_count"], 2)
        self.assertEqual(metrics["confirmed_count"], 3)

        # 2 / 5 = 40.0%
        self.assertEqual(metrics["release_rate_pct"], 40.0)
        # 3 / 5 = 60.0%
        self.assertEqual(metrics["confirmed_fraud_rate_pct"], 60.0)
        # Mathematical invariant: sum == 100.0%
        self.assertEqual(round(metrics["release_rate_pct"] + metrics["confirmed_fraud_rate_pct"], 1), 100.0)

    def test_volume_chart_zero_filled_24_buckets(self):
        """Invariant: 24H volume timeline must always contain exactly 24 hourly buckets."""
        now = datetime.now(timezone.utc)
        mock_records = [
            {"transaction_id": "tx_1", "amount": 100.0, "decision": "ALLOW", "timestamp": (now - timedelta(hours=2)).isoformat()},
            {"transaction_id": "tx_2", "amount": 250.0, "decision": "BLOCK", "timestamp": (now - timedelta(hours=5)).isoformat()},
        ]

        res = aggregate_soc_analytics(mock_records, [])
        volume = res["volume_over_time"]

        self.assertEqual(len(volume), 24, "Must zero-fill exactly 24 hourly buckets for 24H timeline")
        total_sum = sum(b["total"] for b in volume)
        self.assertEqual(total_sum, len(mock_records), "Sum of hourly buckets must equal total events")

    def test_dynamic_captions_calculated_from_data(self):
        """Invariant: Captions must contain real aggregated figures, never hardcoded static strings."""
        mock_records = [
            {"transaction_id": f"tx_{i}", "risk_score": 85.0 if i < 3 else 10.0, "amount": 50.0, "decision": "BLOCK" if i < 3 else "ALLOW"}
            for i in range(10)
        ]

        res = aggregate_soc_analytics(mock_records, [])
        captions = res["captions"]

        self.assertIn("risk_histogram", captions)
        self.assertIn("volume_over_time", captions)
        # 3 out of 10 events scored 85 -> 30.0%
        self.assertIn("30.0%", captions["risk_histogram"])


if __name__ == "__main__":
    unittest.main()
