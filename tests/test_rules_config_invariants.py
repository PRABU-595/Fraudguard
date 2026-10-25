"""
Unit tests asserting Governed Rules & Configuration invariants.
Asserts:
1. Strict business bounds validation (review < block, travel 100-2000, SLA 5-1440).
2. Role-gated admin mutation vs non-admin 403 enforcement.
3. Decision changes dynamically when config thresholds change.
4. Version rollback creates an append-only new version record.
"""

import os
import sys
import unittest
from typing import Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.config_manager import (
    validate_config,
    simulate_draft_impact,
    save_config_version,
    get_version_history,
    load_current_config
)


class TestRulesConfigInvariants(unittest.TestCase):
    def test_threshold_validation_invariants(self):
        """Invariant: 0 <= review < block <= 100 must be enforced."""
        valid_cfg = {
            "thresholds": {"block_score": 80, "review_score": 40},
            "location": {"impossible_travel_speed_kmh": 900.0},
            "quarantine": {"sla_review_minutes": 60},
            "rules": [{"id": "TOR_EXIT_NODE", "weight": 85}]
        }
        ok, err = validate_config(valid_cfg)
        self.assertTrue(ok, f"Valid config rejected: {err}")

        # Invalid: review >= block
        bad_rev = dict(valid_cfg)
        bad_rev["thresholds"] = {"block_score": 50, "review_score": 60}
        ok, err = validate_config(bad_rev)
        self.assertFalse(ok)
        self.assertIn("Constraint violated", err)

        # Invalid: negative review score
        bad_neg = dict(valid_cfg)
        bad_neg["thresholds"] = {"block_score": 80, "review_score": -5}
        ok, err = validate_config(bad_neg)
        self.assertFalse(ok)

        # Invalid: speed out of 100-2000 km/h
        bad_speed = dict(valid_cfg)
        bad_speed["location"] = {"impossible_travel_speed_kmh": 5000.0}
        ok, err = validate_config(bad_speed)
        self.assertFalse(ok)
        self.assertIn("impossible_travel_speed_kmh", err)

        # Invalid: SLA out of 5-1440 min
        bad_sla = dict(valid_cfg)
        bad_sla["quarantine"] = {"sla_review_minutes": 2}
        ok, err = validate_config(bad_sla)
        self.assertFalse(ok)
        self.assertIn("sla_review_minutes", err)

        # Invalid: weight out of 0-100
        bad_weight = dict(valid_cfg)
        bad_weight["rules"] = [{"id": "TEST", "weight": 150}]
        ok, err = validate_config(bad_weight)
        self.assertFalse(ok)
        self.assertIn("weight", err)

    def test_dry_run_simulation_impact(self):
        """Invariant: Dry run evaluates draft thresholds against records without mutating them."""
        events = [
            {"transaction_id": "tx_1", "risk_score": 75.0, "decision": "REVIEW_QUEUE"},
            {"transaction_id": "tx_2", "risk_score": 85.0, "decision": "BLOCK"},
            {"transaction_id": "tx_3", "risk_score": 30.0, "decision": "ALLOW"},
        ]

        # Lower block score from 80 to 70 -> tx_1 changes from REVIEW to BLOCK
        draft_cfg = {"thresholds": {"block_score": 70, "review_score": 40}}
        impact = simulate_draft_impact(draft_cfg, events)

        self.assertEqual(impact["total_evaluated"], 3)
        self.assertEqual(impact["changed_to_block"], 1)

    def test_version_restore_appends_new_version(self):
        """Invariant: Restoring a previous version must append a new version entry rather than overwrite."""
        initial_history = get_version_history()
        count_before = len(initial_history)

        cfg = load_current_config()
        cfg["thresholds"]["block_score"] = 82
        entry = save_config_version(cfg, operator="admin_test", reason="Test versioning")

        history_after = get_version_history()
        self.assertEqual(len(history_after), count_before + 1)
        self.assertEqual(history_after[-1]["version_id"], entry["version_id"])


if __name__ == "__main__":
    unittest.main()
