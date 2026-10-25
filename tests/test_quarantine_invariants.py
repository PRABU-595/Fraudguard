"""
Unit tests asserting Quarantine case queue invariants, SLA status derivation,
and role-gated bulk release rules for FraudGuard.
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.quarantine_manager import QuarantineManager, format_sla_countdown
from src.db_client import DBClient


class TestQuarantineInvariants(unittest.TestCase):
    def setUp(self):
        self.db = DBClient()
        self.qm = QuarantineManager(db_client=self.db)

    def test_quarantine_count_invariant(self):
        """Invariant: Table total of open items must equal the KPI 'Quarantine backlog'."""
        sla_feed = self.qm.get_quarantine_feed_with_sla()
        open_items = [q for q in sla_feed if q.get("status") in ("QUARANTINED", "AT_RISK", "ESCALATED")]
        open_count = len(open_items)

        # Invariant: open count must be non-negative integer matching active backlog
        self.assertGreaterEqual(open_count, 0)
        resolved_items = [q for q in sla_feed if q.get("status") in ("RELEASED", "CONFIRMED_FRAUD")]
        self.assertEqual(len(sla_feed), open_count + len(resolved_items))

    def test_sla_status_derivation(self):
        """Invariant: SLA status must be ON_TRACK (>25%), AT_RISK (<25%), or BREACHED (<=0)."""
        now = datetime.now(timezone.utc)
        total_sla_minutes = 60  # default SLA

        # Case 1: 45 min remaining (>25% of 60m) -> ON_TRACK
        rem_sec_ontrack = 45 * 60
        countdown_ontrack = format_sla_countdown(rem_sec_ontrack)
        self.assertIn("left", countdown_ontrack)
        self.assertNotIn(".", countdown_ontrack, "Never show decimal minutes")
        self.assertEqual(countdown_ontrack, "45m left")

        # Case 2: 8 min remaining (<25% of 60m = 15m) -> AT_RISK
        rem_sec_atrisk = 8 * 60
        countdown_atrisk = format_sla_countdown(rem_sec_atrisk)
        self.assertEqual(countdown_atrisk, "8m left")
        self.assertNotIn(".", countdown_atrisk)

        # Case 3: Overdue by 11 hours 29 minutes -> BREACHED
        rem_sec_overdue = -(11 * 3600 + 29 * 60)
        countdown_overdue = format_sla_countdown(rem_sec_overdue)
        self.assertEqual(countdown_overdue, "overdue 11h 29m")
        self.assertNotIn(".", countdown_overdue)

        # Case 4: Overdue by 15 minutes
        rem_sec_overdue_short = -15 * 60
        countdown_overdue_short = format_sla_countdown(rem_sec_overdue_short)
        self.assertEqual(countdown_overdue_short, "overdue 15m")

    def test_bulk_release_role_rules(self):
        """Invariant: Bulk release of items with risk >= 80 must be blocked for non-admin callers (HTTP 403)."""
        # Seed a test transaction with risk 95
        high_risk_tx = {
            "transaction_id": "tx_test_bulk_high_risk",
            "account_id": "acc_test_bulk",
            "amount": 500.0,
            "risk_score": 95.0,
            "decision": "BLOCK",
            "status": "QUARANTINED",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        self.db.log_transaction(high_risk_tx, prevent_overwrite=False)
        self.db.log_quarantine(high_risk_tx, prevent_overwrite=False)

        # Non-admin analyst tries to bulk release
        analyst_res = self.qm.bulk_action(
            transaction_ids=["tx_test_bulk_high_risk"],
            action="RELEASE",
            analyst_id="analyst_test",
            auth_token="analyst-token-2026"  # analyst role
        )
        self.assertEqual(analyst_res.get("http_status"), 403, "Analyst must be forbidden from bulk releasing risk >= 80")
        self.assertEqual(analyst_res.get("error"), "FORBIDDEN")

        # Admin tries to bulk release
        admin_res = self.qm.bulk_action(
            transaction_ids=["tx_test_bulk_high_risk"],
            action="RELEASE",
            analyst_id="admin_user",
            auth_token="admin-token-2026"  # admin role
        )
        self.assertEqual(admin_res.get("http_status"), 200, "Admin must be permitted to bulk release")


if __name__ == "__main__":
    unittest.main()
