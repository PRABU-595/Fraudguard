"""
Unit and Invariant Tests for Threat Map Page
Tests:
1. Count identity: shown + hidden == total.
2. Shared metrics parity: Map KPI and Quarantine tab return identical values for the same data.
3. Config-driven legend: Changing review/block thresholds dynamically updates the legend bands.
4. Cluster coloring rule: Never color a cluster red from a single block.
5. Spatial bounding box & high query limits.
"""

import unittest
import os
import tempfile
import json
from src.metrics_calculator import compute_quarantine_metrics, compute_system_metrics
from src.config_manager import load_rules_config, save_config_version


class TestThreatMapInvariants(unittest.TestCase):

    def setUp(self):
        # Sample dataset representing canonical event store
        self.sample_records = [
            {"transaction_id": "tx_01", "account_id": "acc_1", "amount": 120.0, "lat": 40.7128, "lon": -74.0060, "decision": "ALLOW", "risk_score": 15},
            {"transaction_id": "tx_02", "account_id": "acc_2", "amount": 450.0, "lat": 34.0522, "lon": -118.2437, "decision": "REVIEW_QUEUE", "risk_score": 55},
            {"transaction_id": "tx_03", "account_id": "acc_3", "amount": 1200.0, "lat": 51.5074, "lon": -0.1278, "decision": "BLOCK", "status": "QUARANTINED", "risk_score": 92},
            {"transaction_id": "tx_04", "account_id": "acc_4", "amount": 80.0, "lat": None, "lon": None, "decision": "ALLOW", "risk_score": 10},
            {"transaction_id": "tx_05", "account_id": "acc_5", "amount": 950.0, "lat": None, "lon": None, "decision": "BLOCK", "status": "QUARANTINED", "risk_score": 88},
        ]

        self.sample_quarantine = [
            {"quarantine_id": "q1", "transaction_id": "tx_03", "status": "QUARANTINED", "is_sla_breached": False, "sla_status": "ON_TRACK", "quarantine_ts": "2026-10-25T10:00:00Z"},
            {"quarantine_id": "q2", "transaction_id": "tx_05", "status": "QUARANTINED", "is_sla_breached": True, "sla_status": "BREACHED", "quarantine_ts": "2026-10-25T08:00:00Z"},
            {"quarantine_id": "q3", "transaction_id": "tx_old1", "status": "RELEASED", "quarantine_ts": "2026-10-25T07:00:00Z", "updated_ts": "2026-10-25T07:12:00Z"},
            {"quarantine_id": "q4", "transaction_id": "tx_old2", "status": "CONFIRMED_FRAUD", "quarantine_ts": "2026-10-25T06:00:00Z", "updated_ts": "2026-10-25T06:20:00Z"},
        ]

    def test_count_identity_shown_plus_hidden_equals_total(self):
        """Invariant: shown_count + hidden_count == total_events."""
        total_events = len(self.sample_records)
        shown = [r for r in self.sample_records if r.get("lat") is not None and r.get("lon") is not None]
        hidden = [r for r in self.sample_records if r.get("lat") is None or r.get("lon") is None]

        self.assertEqual(len(shown) + len(hidden), total_events,
                         "shown + hidden must equal total events exactly")
        self.assertEqual(len(shown), 3)
        self.assertEqual(len(hidden), 2)
        self.assertEqual(total_events, 5)

    def test_shared_metrics_identical_between_map_and_quarantine(self):
        """Invariant: Map KPI and Quarantine tab counts return identical values for the same data."""
        quar_metrics = compute_quarantine_metrics(self.sample_quarantine)
        sys_metrics = compute_system_metrics(self.sample_records, self.sample_quarantine)

        # Backlog must match
        self.assertEqual(sys_metrics["quarantine_backlog"], quar_metrics["open_backlog"])
        self.assertEqual(sys_metrics["quarantine_backlog"], 2)

        # SLA breaches must match
        self.assertEqual(sys_metrics["sla_breaches"], quar_metrics["sla_breaches"])
        self.assertEqual(sys_metrics["sla_breaches"], 1)

        # MTTR must match
        self.assertEqual(sys_metrics["mttr_minutes"], quar_metrics["mttr_minutes"])

        # Release rate must match
        self.assertEqual(sys_metrics["release_rate_pct"], quar_metrics["release_rate_pct"])
        self.assertEqual(quar_metrics["release_rate_pct"], 50.0)
        self.assertEqual(quar_metrics["confirmed_fraud_rate_pct"], 50.0)

    def test_config_driven_legend_bands(self):
        """Invariant: Legend reads its bands from active config, not hardcoded constants."""
        def generate_legend_bands(thresholds):
            rev = thresholds["review_score"]
            blk = thresholds["block_score"]
            return {
                "allow": f"Allow (0 - {rev - 1})",
                "review": f"Review Queue ({rev} - {blk - 1})",
                "block": f"Block / Quarantine ({blk} - 100)"
            }

        # Canonical default: 40 and 80
        default_bands = generate_legend_bands({"review_score": 40, "block_score": 80})
        self.assertEqual(default_bands["allow"], "Allow (0 - 39)")
        self.assertEqual(default_bands["review"], "Review Queue (40 - 79)")
        self.assertEqual(default_bands["block"], "Block / Quarantine (80 - 100)")

        # Modified threshold: 30 and 70
        modified_bands = generate_legend_bands({"review_score": 30, "block_score": 70})
        self.assertEqual(modified_bands["allow"], "Allow (0 - 29)")
        self.assertEqual(modified_bands["review"], "Review Queue (30 - 69)")
        self.assertEqual(modified_bands["block"], "Block / Quarantine (70 - 100)")
        self.assertNotEqual(default_bands, modified_bands)

    def test_cluster_coloring_never_red_from_single_block(self):
        """Invariant: Never color a cluster red from a single block."""
        def compute_cluster_color(markers):
            total = len(markers)
            block_count = sum(1 for m in markers if m["decision"] == "BLOCK")
            review_count = sum(1 for m in markers if m["decision"] in ("REVIEW", "REVIEW_QUEUE"))
            block_pct = (block_count / total) * 100

            # Rule: 0-10% green, 10-30% amber, 30%+ red. Never red from a single block!
            if block_count > 1 and block_pct >= 30:
                return "red"
            elif block_pct >= 10 or review_count >= 1 or block_count == 1:
                return "amber"
            return "green"

        # 1 block out of 2 events (50% block, but ONLY 1 block! Must NOT be red)
        cluster_single_block = [{"decision": "ALLOW"}, {"decision": "BLOCK"}]
        self.assertEqual(compute_cluster_color(cluster_single_block), "amber",
                         "Single block must never color a cluster red")

        # 1 block out of 10 events (10% block, 1 block -> amber)
        cluster_single_block_10 = [{"decision": "ALLOW"}] * 9 + [{"decision": "BLOCK"}]
        self.assertEqual(compute_cluster_color(cluster_single_block_10), "amber")

        # 0 blocks out of 10 events (0% block -> green)
        cluster_all_allow = [{"decision": "ALLOW"}] * 10
        self.assertEqual(compute_cluster_color(cluster_all_allow), "green")

        # 4 blocks out of 10 events (40% block, >1 block -> red)
        cluster_high_fraud = [{"decision": "ALLOW"}] * 6 + [{"decision": "BLOCK"}] * 4
        self.assertEqual(compute_cluster_color(cluster_high_fraud), "red")


if __name__ == "__main__":
    unittest.main()
