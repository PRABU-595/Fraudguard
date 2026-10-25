"""
Unit tests asserting SOC Analytics aggregation invariants.
Asserts:
1. sum(risk_histogram counts) == total_events
2. sum(hourly volume totals) == total_events
3. sum(country counts) == total_events
4. Rule frequency counts strictly match flags stored on records
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.analytics_aggregator import aggregate_soc_analytics


class TestAnalyticsInvariants(unittest.TestCase):
    def test_aggregation_invariants(self):
        """Invariant: All slices of aggregated data must strictly reconcile mathematically to total_events."""
        sample_records = [
            {"transaction_id": "tx_1", "amount": 100.0, "risk_score": 10.0, "decision": "ALLOW", "transaction_country": "US", "flags": []},
            {"transaction_id": "tx_2", "amount": 250.0, "risk_score": 55.0, "decision": "REVIEW_QUEUE", "transaction_country": "GB", "flags": ["UNUSUAL_HOUR"]},
            {"transaction_id": "tx_3", "amount": 420.0, "risk_score": 95.0, "decision": "BLOCK", "status": "QUARANTINED", "transaction_country": "DE", "flags": ["ORIGIN_TOR", "TOR_EXIT_NODE"]},
            {"transaction_id": "tx_4", "amount": 80.0, "risk_score": 35.0, "decision": "ALLOW", "transaction_country": "JP", "flags": ["NEW_ACCOUNT"]},
            {"transaction_id": "tx_5", "amount": 900.0, "risk_score": 85.0, "decision": "BLOCK", "status": "QUARANTINED", "transaction_country": "US", "flags": ["IMPOSSIBLE_TRAVEL", "ORIGIN_TOR"]},
        ]
        sample_quarantine = [
            {"transaction_id": "tx_3", "status": "QUARANTINED"},
            {"transaction_id": "tx_5", "status": "QUARANTINED"},
        ]

        analytics = aggregate_soc_analytics(sample_records, sample_quarantine)
        total_events = len(sample_records)

        # 1. Histogram Invariant: sum of histogram counts == total_events
        hist_total = sum(b["count"] for b in analytics["risk_histogram"])
        self.assertEqual(hist_total, total_events, f"Histogram sum ({hist_total}) must equal total events ({total_events})")

        # 2. Volume over time Invariant: sum of bucket counts == total_events
        hourly_total = sum(b["total"] for b in analytics["volume_over_time"])
        self.assertEqual(hourly_total, total_events, f"Hourly total ({hourly_total}) must equal total events ({total_events})")

        # 3. Country count Invariant: sum of country counts == total_events
        country_total = sum(c["count"] for c in analytics["fraud_by_country"])
        self.assertEqual(country_total, total_events, f"Country total ({country_total}) must equal total events ({total_events})")

        # 4. Rule counts Invariant: verify exact occurrences
        rule_map = {r["rule_id"]: r["count"] for r in analytics["top_rules"]}
        self.assertEqual(rule_map.get("ORIGIN_TOR"), 2)
        self.assertEqual(rule_map.get("IMPOSSIBLE_TRAVEL"), 1)
        self.assertEqual(rule_map.get("UNUSUAL_HOUR"), 1)
        self.assertEqual(rule_map.get("TOR_EXIT_NODE"), 1)


if __name__ == "__main__":
    unittest.main()
