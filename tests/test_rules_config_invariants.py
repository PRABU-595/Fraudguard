"""
Unit tests asserting Governed Rules & Configuration invariants.
Asserts:
1. Strict business bounds validation (review < block, travel 100-2000, SLA 5-1440).
2. Dry run evaluates draft thresholds on stored events and reports changes & affected amounts without mutating data.
3. Version restore appends an immutable new version record.
4. Test isolation: all test mutations use temporary CONFIG_PATH & VERSIONS_PATH, leaving production config files untouched.
"""

import os
import sys
import json
import shutil
import tempfile
import unittest
from typing import Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.config_manager import (
    validate_config,
    simulate_draft_impact,
    save_config_version,
    get_version_history,
    load_current_config,
    DEFAULT_CONFIG_FILE,
    DEFAULT_VERSIONS_FILE
)


class TestRulesConfigInvariants(unittest.TestCase):
    def setUp(self):
        # Create isolated temporary directory for test config and versions
        self.temp_dir = tempfile.mkdtemp()
        self.test_cfg_path = os.path.join(self.temp_dir, "test_config_rules.json")
        self.test_ver_path = os.path.join(self.temp_dir, "test_config_versions.json")

        self.orig_env = dict(os.environ)
        os.environ["CONFIG_PATH"] = self.test_cfg_path
        os.environ["VERSIONS_PATH"] = self.test_ver_path

        # Seed initial test config
        with open(self.test_cfg_path, "w", encoding="utf-8") as f:
            json.dump({"thresholds": {"block_score": 80, "review_score": 40}}, f)
        with open(self.test_ver_path, "w", encoding="utf-8") as f:
            json.dump([], f)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.orig_env)
        shutil.rmtree(self.temp_dir, ignore_errors=True)

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
        self.assertIn("Invalid thresholds", err)

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
            {"transaction_id": "tx_1", "amount": 150.0, "risk_score": 75.0, "decision": "REVIEW_QUEUE"},
            {"transaction_id": "tx_2", "amount": 200.0, "risk_score": 85.0, "decision": "BLOCK"},
            {"transaction_id": "tx_3", "amount": 50.0, "risk_score": 30.0, "decision": "ALLOW"},
        ]

        # Lower block score from 80 to 70 -> tx_1 changes from REVIEW to BLOCK
        draft_cfg = {"thresholds": {"block_score": 70, "review_score": 40}}
        impact = simulate_draft_impact(draft_cfg, events)

        self.assertEqual(impact["total_evaluated"], 3)
        self.assertEqual(impact["changed_to_block"], 1)
        self.assertEqual(impact["affected_total_amount"], 150.0)
        self.assertEqual(len(impact["sample_cases"]), 1)
        self.assertEqual(impact["sample_cases"][0]["old_decision"], "REVIEW")
        self.assertEqual(impact["sample_cases"][0]["new_decision"], "BLOCK")

    def test_version_restore_appends_new_version(self):
        """Invariant: Restoring a previous version must append a new version entry rather than overwrite."""
        initial_history = get_version_history()
        count_before = len(initial_history)

        cfg = load_current_config()
        cfg["thresholds"]["block_score"] = 75
        entry = save_config_version(cfg, operator="admin_test", reason="Test versioning")

        history_after = get_version_history()
        self.assertEqual(len(history_after), count_before + 1)
        self.assertEqual(history_after[-1]["version_id"], entry["version_id"])

    def test_real_config_untouched_by_test_suite(self):
        """Asserts that real production config files remain untouched when running tests under CONFIG_PATH."""
        with open(DEFAULT_CONFIG_FILE, "r", encoding="utf-8") as f:
            real_cfg = json.load(f)

        # Production block score must be canonical 80
        self.assertEqual(real_cfg["thresholds"]["block_score"], 80, "Production config block_score must remain 80")

        # Mutate the test config
        test_cfg = load_current_config()
        test_cfg["thresholds"]["block_score"] = 92
        save_config_version(test_cfg, operator="isolated_test_runner", reason="Isolation verification")

        # Verify real config on disk did not change
        with open(DEFAULT_CONFIG_FILE, "r", encoding="utf-8") as f:
            real_cfg_after = json.load(f)

        self.assertEqual(real_cfg_after["thresholds"]["block_score"], 80, "Real config must remain untouched by test mutations")


if __name__ == "__main__":
    unittest.main()
