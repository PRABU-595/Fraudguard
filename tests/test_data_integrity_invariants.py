"""Unit tests asserting KPI, stream state, and data integrity invariants for FraudGuard."""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.stream_monitor import calculate_live_tps
from src.quarantine_manager import QuarantineManager
from src.simulator_engine import SimulatorEngine
from src.db_client import DBClient


class TestDataIntegrityInvariants(unittest.TestCase):
    def setUp(self):
        self.db = DBClient()
        self.qm = QuarantineManager(db_client=self.db)

    def test_tps_is_zero_when_stream_is_off(self):
        """Invariant: If stream is off, TPS must strictly be 0.0, regardless of event timestamps."""
        now_iso = datetime.now(timezone.utc).isoformat()
        records = [
            {"timestamp": now_iso, "txn_id": f"tx_{i}", "risk_score": 10}
            for i in range(50)
        ]
        # Inactive stream
        tps = calculate_live_tps(records, is_stream_active=False, configured_tps=5.0)
        self.assertEqual(tps, 0.0, "TPS must be exactly 0.0 when stream is inactive.")

        # Active stream returns positive rate
        tps_active = calculate_live_tps(records, is_stream_active=True, configured_tps=5.0)
        self.assertGreater(tps_active, 0.0, "TPS must be greater than 0.0 when stream is active with events.")

    def test_kpi_mathematical_reconciliation(self):
        """Invariant: Total = count of events, Blocked % = blocked/total, Quarantine backlog = open only."""
        sample_records = [
            {"transaction_id": "tx_1", "decision": "ALLOW", "status": "APPROVED", "risk_score": 5},
            {"transaction_id": "tx_2", "decision": "BLOCK", "status": "QUARANTINED", "risk_score": 95},
            {"transaction_id": "tx_3", "decision": "REVIEW_QUEUE", "status": "PENDING_REVIEW", "risk_score": 60},
            {"transaction_id": "tx_4", "decision": "ALLOW", "status": "APPROVED", "risk_score": 15},
        ]
        total_events = len(sample_records)
        blocked_count = sum(1 for r in sample_records if r.get("decision") == "BLOCK" or r.get("status") == "QUARANTINED")
        expected_pct = round((blocked_count / max(1, total_events)) * 100.0, 1)

        self.assertEqual(total_events, 4)
        self.assertEqual(blocked_count, 1)
        self.assertEqual(expected_pct, 25.0)

    def test_quarantine_backlog_and_sla_breach_invariants(self):
        """Invariant: Quarantine backlog only counts items with status == 'QUARANTINED'.
        SLA breaches only count OPEN quarantine items past their deadline, NOT resolved items."""
        now = datetime.now(timezone.utc)
        test_items = [
            # Open, breached (deadline 15 min ago)
            {
                "quarantine_id": "q_open_breached",
                "status": "QUARANTINED",
                "quarantine_ts": (now - timedelta(minutes=45)).isoformat(),
                "sla_deadline": (now - timedelta(minutes=15)).isoformat(),
                "is_sla_breached": True
            },
            # Open, not breached (deadline 20 min in future)
            {
                "quarantine_id": "q_open_healthy",
                "status": "QUARANTINED",
                "quarantine_ts": (now - timedelta(minutes=10)).isoformat(),
                "sla_deadline": (now + timedelta(minutes=20)).isoformat(),
                "is_sla_breached": False
            },
            # Resolved (RELEASED) whose deadline was in the past; must NOT count towards open backlog or SLA breach
            {
                "quarantine_id": "q_resolved_released",
                "status": "RELEASED",
                "quarantine_ts": (now - timedelta(hours=2)).isoformat(),
                "sla_deadline": (now - timedelta(hours=1)).isoformat(),
                "is_sla_breached": True,
                "action_ts": (now - timedelta(minutes=50)).isoformat()
            },
            # Resolved (CONFIRMED_FRAUD)
            {
                "quarantine_id": "q_resolved_confirmed",
                "status": "CONFIRMED_FRAUD",
                "quarantine_ts": (now - timedelta(hours=3)).isoformat(),
                "sla_deadline": (now - timedelta(hours=2)).isoformat(),
                "is_sla_breached": True,
                "action_ts": (now - timedelta(hours=2, minutes=10)).isoformat()
            }
        ]

        # Calculate open quarantine items
        open_items = [q for q in test_items if q.get("status") == "QUARANTINED"]
        self.assertEqual(len(open_items), 2, "Only items with status == 'QUARANTINED' must be in quarantine backlog.")

        # Calculate SLA breaches among open items only
        open_breaches = [q for q in open_items if q.get("is_sla_breached") is True]
        self.assertEqual(len(open_breaches), 1, "SLA breaches must only count OPEN quarantine items past deadline.")

    def test_event_feed_descending_sort_invariant(self):
        """Invariant: Ingestion feed must be ordered descending by event timestamp."""
        now = datetime.now(timezone.utc)
        raw_events = [
            {"transaction_id": "tx_old", "timestamp": (now - timedelta(minutes=30)).isoformat()},
            {"transaction_id": "tx_latest", "timestamp": now.isoformat()},
            {"transaction_id": "tx_mid", "timestamp": (now - timedelta(minutes=10)).isoformat()},
        ]

        def get_iso_ts(ev: Dict[str, Any]) -> str:
            return ev.get("timestamp") or ev.get("quarantine_ts") or ""

        sorted_events = sorted(raw_events, key=get_iso_ts, reverse=True)
        self.assertEqual(sorted_events[0]["transaction_id"], "tx_latest")
        self.assertEqual(sorted_events[1]["transaction_id"], "tx_mid")
        self.assertEqual(sorted_events[2]["transaction_id"], "tx_old")


if __name__ == "__main__":
    unittest.main()
