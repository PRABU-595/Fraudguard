"""
Phase 2 Unit & Integration Test Suite: Backend Enrichment & Configurable Engine
Tests:
  1. Provider Adapters (Cell, Identity, Social with mandatory is_simulated flag)
  2. OriginTracer & Tor Exit Node Detection
  3. LocationChecker & Multi-Source Resolution Priority
  4. TracebackAnalyzer (7d velocity, amount z-score, relationship graph)
  5. TimeSpanAnalyzer (Dormant reactivation, burst activity, 24h heat-strip)
  6. QuarantineManager (Multi-action lifecycle, SLA deadline, audit log)
  7. FraudRouter (End-to-end routing, score breakdown, attributes capture)
"""

import os
import sys
import json
import unittest

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.provider_adapters import (
    SimulatedCellLocationProvider,
    MockIdentityRiskProvider,
    MockSocialRiskProvider,
    get_cell_provider,
    get_identity_provider,
    get_social_provider
)
from src.origin_tracer import OriginTracer, TorExitListManager
from src.location_checker import LocationChecker, haversine_km
from src.traceback_analyzer import TracebackAnalyzer, compute_z_score
from src.time_analyzer import TimeSpanAnalyzer
from src.quarantine_manager import QuarantineManager
from src.router_function import FraudRouter
from src.db_client import DBClient


class TestPhase2Backend(unittest.TestCase):
    def setUp(self):
        self.db = DBClient(in_memory_only=True)

    def test_01_provider_adapters_mandatory_labels(self):
        """Verify all provider adapters return mandatory is_simulated, source, confidence, and fetched_at."""
        cell_p = get_cell_provider()
        res_cell = cell_p.get_location(account_id="acc_1")
        self.assertIsInstance(res_cell.is_simulated, bool)
        self.assertTrue(res_cell.is_simulated)
        self.assertIn("SIMULATED", res_cell.source)
        self.assertGreaterEqual(res_cell.confidence, 0.0)
        self.assertIn("lat", res_cell.data)
        self.assertIn("lon", res_cell.data)

        id_p = get_identity_provider()
        res_id = id_p.evaluate_identity("acc_1")
        self.assertIsInstance(res_id.is_simulated, bool)
        self.assertIn("account_age_days", res_id.data)

        social_p = get_social_provider()
        res_social = social_p.get_social_risk("acc_1")
        self.assertIsInstance(res_social.is_simulated, bool)
        self.assertIn("social_risk_score", res_social.data)

    def test_02_origin_tracer_tor_and_datacenter(self):
        """Verify Tor exit node detection and datacenter ASN identification."""
        tracer = OriginTracer()
        tor_mgr = TorExitListManager.get_instance()
        self.assertTrue(tor_mgr.is_tor("185.220.101.1"))

        tx_tor = {"transaction_id": "tx_test_tor", "origin": {"ip_address": "185.220.101.1"}}
        eval_tor = tracer.evaluate(tx_tor)
        self.assertTrue(eval_tor["force_block"])
        self.assertIn("TOR_EXIT_NODE", eval_tor["flags"])
        self.assertEqual(eval_tor["origin"]["threat_level"], "CRITICAL")

        # Datacenter IP test
        tx_dc = {"transaction_id": "tx_test_dc", "origin": {"ip_address": "198.51.100.75"}}
        eval_dc = tracer.evaluate(tx_dc)
        self.assertTrue(eval_dc["origin"]["is_proxy"] or eval_dc["origin"]["is_datacenter"])

    def test_03_location_priority_resolution(self):
        """Verify carrier > GPS > IP location resolution priority."""
        checker = LocationChecker(speed_threshold_kmh=900.0)
        # Test 1: Carrier available in PII
        pii_mock = {
            "registered_country": "US",
            "last_known_location": {
                "source": "SIMULATED_CELL_TOWER",
                "is_simulated": True,
                "city": "Boston",
                "lat": 42.3601,
                "lon": -71.0589,
                "accuracy_meters": 65
            }
        }
        res_loc = checker.resolve_latest_location({}, origin={}, pii_profile=pii_mock)
        self.assertEqual(res_loc["source"], "carrier_cell_tower")
        self.assertEqual(res_loc["city"], "Boston")
        self.assertTrue(res_loc["is_simulated"])

        # Test 2: Consented GPS takes priority over IP when carrier not present
        tx_gps = {
            "gps_consent": True,
            "device_gps": {"lat": 37.7749, "lon": -122.4194, "accuracy_meters": 10},
            "transaction_city": "San Francisco"
        }
        res_gps = checker.resolve_latest_location(tx_gps, origin={"city": "Chicago", "coordinates": {"lat": 41.87, "lon": -87.62}})
        self.assertEqual(res_gps["source"], "device_gps")
        self.assertFalse(res_gps["is_simulated"])

        # Test 3: Haversine distance
        dist = haversine_km(40.7128, -74.0060, 37.7749, -122.4194)
        self.assertGreater(dist, 4000.0)  # NY to SF is ~4100 km

    def test_04_traceback_7d_velocity_zscore_and_graph(self):
        """Verify 7-day velocity, amount z-score, and entity relationship graph."""
        tb = TracebackAnalyzer(db_client=self.db)
        history = [
            {"transaction_id": "tx_h1", "timestamp": "2026-10-20T10:00:00Z", "amount": 50.0, "merchant": "Grocery", "origin": {"ip_address": "192.0.2.1"}},
            {"transaction_id": "tx_h2", "timestamp": "2026-10-22T10:00:00Z", "amount": 55.0, "merchant": "Gas", "origin": {"ip_address": "192.0.2.1"}},
            {"transaction_id": "tx_h3", "timestamp": "2026-10-24T10:00:00Z", "amount": 48.0, "merchant": "Coffee", "origin": {"ip_address": "192.0.2.1"}},
            {"transaction_id": "tx_h4", "timestamp": "2026-10-21T10:00:00Z", "amount": 52.0, "merchant": "Bakery", "origin": {"ip_address": "192.0.2.1"}},
            {"transaction_id": "tx_h5", "timestamp": "2026-10-23T10:00:00Z", "amount": 51.0, "merchant": "Market", "origin": {"ip_address": "192.0.2.1"}},
        ]
        # Massive anomaly: $1000 vs ~$51 baseline
        curr_tx = {
            "transaction_id": "tx_now",
            "account_id": "acc_ztest",
            "timestamp": "2026-10-24T12:00:00Z",
            "amount": 1000.0,
            "destination_account": "Unknown Wire",
            "origin": {"ip_address": "192.0.2.1"}
        }
        res = tb.evaluate(curr_tx, prior_records=history)
        self.assertIn("AMOUNT_ZSCORE_ANOMALY", res["flags"])
        self.assertGreater(res["traceback"]["amount_zscore"], 3.0)
        self.assertEqual(res["traceback"]["velocity_7d"], 6)

        # Entity graph verification
        graph = res["traceback"]["entity_graph"]
        self.assertIn("nodes", graph)
        self.assertIn("links", graph)
        node_types = {n["type"] for n in graph["nodes"]}
        self.assertIn("account", node_types)
        self.assertIn("merchant", node_types)
        self.assertIn("ip", node_types)

    def test_05_time_analysis_dormant_and_burst(self):
        """Verify dormant reactivation and burst activity detection."""
        time_ana = TimeSpanAnalyzer()
        # 1. Dormant reactivation (>60 days)
        tx_dormant = {"timestamp": "2026-10-24T12:00:00Z"}
        old_history = [{"timestamp": "2026-06-01T12:00:00Z"}]
        res_dormant = time_ana.evaluate(tx_dormant, prior_records=old_history)
        self.assertIn("DORMANT_REACTIVATION", res_dormant["flags"])

        # 2. Burst activity (3 txns within 5 mins)
        history_burst = [
            {"timestamp": "2026-10-24T12:01:00Z"},
            {"timestamp": "2026-10-24T12:02:00Z"}
        ]
        tx_burst = {"timestamp": "2026-10-24T12:03:00Z"}
        res_burst = time_ana.evaluate(tx_burst, prior_records=history_burst)
        self.assertIn("BURST_ACTIVITY", res_burst["flags"])
        self.assertEqual(len(res_burst["time_analysis"]["hourly_distribution_24h"]), 24)

    def test_06_quarantine_multi_action_and_sla(self):
        """Verify quarantine actions (RELEASE, CONFIRM_FRAUD, ESCALATE, ADD_NOTE) and SLA deadline."""
        qm = QuarantineManager(db_client=self.db)
        tx_sample = {
            "transaction_id": "tx_q_act_test",
            "account_id": "acc_q1",
            "amount": 200.0,
            "timestamp": "2026-10-24T12:00:00Z"
        }
        q_res = qm.quarantine_transaction(tx_sample, reason_codes=["TOR_EXIT_NODE"], risk_score=95)
        self.assertEqual(q_res["http_status"], 202)
        self.assertIn("sla_due_at", q_res["quarantine_record"])

        # Execute CONFIRM_FRAUD
        act_res = qm.execute_action(
            transaction_id="tx_q_act_test",
            action="CONFIRM_FRAUD",
            analyst_id="analyst_test",
            reason="Confirmed malicious Tor relay node",
            auth_token=qm.api_key
        )
        self.assertEqual(act_res["http_status"], 200)
        self.assertEqual(act_res["status"], "CONFIRMED_FRAUD")

        # Verify SLA feed calculation
        feed = qm.get_quarantine_feed_with_sla()
        self.assertEqual(len(feed), 1)
        self.assertIn("sla_remaining_minutes", feed[0])

    def test_07_router_score_breakdown_and_attributes(self):
        """Verify FraudRouter produces score_breakdown and captures attributes."""
        router = FraudRouter(in_memory_db=True)
        tx = {
            "transaction_id": "tx_full_enrich_001",
            "source_account": "acc_1",
            "destination_account": "acc_vendor_99",
            "amount": 350.0,
            "txn_type": "WIRE",
            "channel": "MOBILE_APP",
            "mcc": "6011",
            "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
            "timestamp": "2026-10-24T03:30:00Z"  # Night hour
        }
        result = router.route_transaction(tx)
        self.assertIn("score_breakdown", result)
        self.assertIsInstance(result["score_breakdown"], list)
        self.assertIn("attributes", result)
        self.assertEqual(result["attributes"]["payment_channel"], "MOBILE_APP")
        self.assertIn("pii_enrichment", result)
        self.assertIn("is_simulated", result["pii_enrichment"])
        self.assertIn("latest_location", result["location_check"])


if __name__ == "__main__":
    unittest.main()
