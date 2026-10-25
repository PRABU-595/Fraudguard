"""
Phase 3/4/5 Test Suite: Production Console, SSE, Threat Map Endpoints & Quarantine APIs
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import threading
import unittest
from http.server import HTTPServer, ThreadingHTTPServer

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.stream_monitor import TelemetryHTTPRequestHandler


class TestPhase3ConsoleAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), TelemetryHTTPRequestHandler)
        cls.port = cls.httpd.server_port
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.5)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def _get(self, path):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers={"Connection": "close"})
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            content = resp.read()
            ct = resp.headers.get("Content-Type", "")
            return resp.status, ct, content

    def _post(self, path, payload, headers=None):
        data = json.dumps(payload).encode("utf-8")
        hdrs = {"Content-Type": "application/json", "Connection": "close"}
        if headers:
            hdrs.update(headers)
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=hdrs)
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            content = resp.read()
            return resp.status, json.loads(content.decode("utf-8"))

    def test_01_static_assets(self):
        """Verify index.html, styles.css, and app.js are served cleanly."""
        st, ct, content = self._get("/")
        self.assertEqual(st, 200)
        self.assertIn(b"FraudGuard", content)
        self.assertIn(b"Threat Map", content)

        st, ct, content = self._get("/static/styles.css")
        self.assertEqual(st, 200)
        self.assertIn(b"theme-dark", content)

        st, ct, content = self._get("/static/app.js")
        self.assertEqual(st, 200)
        self.assertIn(b"FraudGuardApp", content)

    def test_02_health_and_stats(self):
        """Verify /api/health and /api/stats return operational telemetry."""
        st, ct, content = self._get("/api/health")
        self.assertEqual(st, 200)
        data = json.loads(content.decode("utf-8"))
        self.assertEqual(data["status"], "healthy")

        st, ct, content = self._get("/api/stats")
        self.assertEqual(st, 200)
        stats = json.loads(content.decode("utf-8"))
        self.assertIn("total_processed", stats)
        self.assertIn("tps", stats)

    def test_03_scenario_simulation(self):
        """Verify scenario generation endpoints (NORMAL, TOR_ATTACK, IMPOSSIBLE_TRAVEL)."""
        # Normal domestic
        st, res = self._post("/api/simulate", {"preset": "NORMAL"})
        self.assertEqual(st, 200)
        self.assertEqual(res["result"]["decision"], "ALLOW")

        # Tor Attack
        st, res_tor = self._post("/api/simulate", {"preset": "TOR_ATTACK"})
        self.assertEqual(st, 200)
        self.assertEqual(res_tor["result"]["decision"], "BLOCK")
        self.assertIn("TOR_EXIT_NODE", res_tor["result"]["flags"])
        tx_tor_id = res_tor["result"]["transaction_id"]

        # Quarantine Action on Tor Attack transaction
        st_act, res_act = self._post(
            f"/api/quarantine/{tx_tor_id}/action",
            {"action": "CONFIRM_FRAUD", "reason": "Confirmed exit relay", "notes": "Blocked in test"},
            headers={"X-API-Key": "analyst-token-2026", "X-Analyst-ID": "QA_Lead", "X-User-Role": "analyst"}
        )
        self.assertEqual(st_act, 200)
        self.assertEqual(res_act["status"], "CONFIRMED_FRAUD")

    def test_04_quarantine_feed_and_sla(self):
        """Verify quarantine feed endpoint returns SLA calculation."""
        st, ct, content = self._get("/api/quarantine?status=ALL")
        self.assertEqual(st, 200)
        qdata = json.loads(content.decode("utf-8"))
        self.assertIn("items", qdata)
        self.assertGreater(len(qdata["items"]), 0)
        first = qdata["items"][0]
        self.assertIn("sla_remaining_minutes", first)
        self.assertIn("is_sla_breached", first)

    def test_05_accounts_trail_and_locations(self):
        """Verify /api/accounts/{id}/trail and /locations endpoints."""
        st, ct, content = self._get("/api/accounts/acc_1/trail")
        self.assertEqual(st, 200)
        trail = json.loads(content.decode("utf-8"))
        self.assertIn("velocity_1hr", trail)
        self.assertIn("entity_graph", trail)

        st, ct, content = self._get("/api/accounts/acc_1/locations")
        self.assertEqual(st, 200)
        locs = json.loads(content.decode("utf-8"))
        self.assertIn("trail", locs)

    def test_06_reveal_pii(self):
        """Verify PII unmasking endpoint with role-based headers."""
        # First ensure we have a transaction
        st, sim_res = self._post("/api/simulate", {"preset": "NORMAL"})
        tx_id = sim_res["result"]["transaction_id"]

        st_pii, res_pii = self._post(
            "/api/auth/reveal-pii",
            {"transaction_id": tx_id},
            headers={"X-API-Key": "analyst-token-2026", "X-Analyst-ID": "Sarah Chen", "X-User-Role": "analyst"}
        )
        self.assertEqual(st_pii, 200)
        self.assertIn("unmasked_name", res_pii)
        self.assertTrue(res_pii["audit_recorded"])


if __name__ == "__main__":
    unittest.main()
