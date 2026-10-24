#!/usr/bin/env python3
"""
FraudGuard End-to-End Automated Smoke Test
Exercises all API endpoints, simulation presets, quarantine workflows,
and telemetry provider data contracts.
"""

import os
import sys
import json
import time
import threading
import urllib.request
import urllib.error
from http.server import HTTPServer

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.stream_monitor import TelemetryHTTPRequestHandler


def run_smoke_test(target_url: str = None) -> bool:
    print("=" * 70)
    print("🛡️  FRAUDGUARD END-TO-END SMOKE TEST SUITE")
    print("=" * 70)

    server = None
    if not target_url:
        print("[SETUP] Starting ephemeral test HTTP server...")
        server = HTTPServer(("127.0.0.1", 0), TelemetryHTTPRequestHandler)
        port = server.server_port
        target_url = f"http://127.0.0.1:{port}"
        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        time.sleep(0.1)

    print(f"[TARGET] Testing console at: {target_url}\n")
    tests_passed = 0
    tests_total = 0

    def check(name: str, passed: bool, detail: str = ""):
        nonlocal tests_passed, tests_total
        tests_total += 1
        status = "✅ PASS" if passed else "❌ FAIL"
        if passed:
            tests_passed += 1
        print(f"  {status} | {name} {('- ' + detail) if detail else ''}")
        if not passed:
            raise AssertionError(f"Check failed: {name} - {detail}")

    try:
        # 1. Static Assets & Root UI
        print("[1] Verifying Static Web Assets & UI Shell...")
        with urllib.request.urlopen(f"{target_url}/", timeout=4) as resp:
            html = resp.read().decode("utf-8")
            check("GET / (Root HTML)", resp.status == 200 and "FraudGuard" in html, f"Length: {len(html)} bytes")
            check("HTML Contains Leaflet Map Anchor", 'id="leaflet-threat-map"' in html)
            check("HTML Contains Slide-in Drawer", 'id="detail-drawer"' in html)
            check("HTML Contains Quarantine Table", 'id="quarantine-table"' in html)

        with urllib.request.urlopen(f"{target_url}/static/styles.css", timeout=4) as resp:
            css = resp.read().decode("utf-8")
            check("GET /static/styles.css", resp.status == 200 and "pulseRed" in css, f"Length: {len(css)} bytes")

        with urllib.request.urlopen(f"{target_url}/static/app.js", timeout=4) as resp:
            js = resp.read().decode("utf-8")
            check("GET /static/app.js", resp.status == 200 and "FraudGuardApp" in js, f"Length: {len(js)} bytes")

        # 2. Health & Statistics API
        print("\n[2] Verifying Core Telemetry & Statistics APIs...")
        with urllib.request.urlopen(f"{target_url}/api/health", timeout=4) as resp:
            health = json.loads(resp.read().decode("utf-8"))
            check("GET /api/health", health.get("status") == "healthy" and health.get("service") == "FraudGuard Operations Console")

        with urllib.request.urlopen(f"{target_url}/api/stats", timeout=4) as resp:
            stats = json.loads(resp.read().decode("utf-8"))
            check("GET /api/stats", "total_processed" in stats and "block_rate_pct" in stats, f"Processed: {stats.get('total_processed')}")

        with urllib.request.urlopen(f"{target_url}/api/simulator/status", timeout=4) as resp:
            sim_status = json.loads(resp.read().decode("utf-8"))
            check("GET /api/simulator/status", "active" in sim_status and "available_scenarios" in sim_status)

        # 3. Simulation Presets
        print("\n[3] Testing Attack Simulation Presets...")
        presets = ["NORMAL", "IMPOSSIBLE_TRAVEL", "TOR_ATTACK", "VELOCITY_BURST", "NIGHT_FRAUD"]
        sim_results = {}
        for p in presets:
            req = urllib.request.Request(
                f"{target_url}/api/simulate",
                data=json.dumps({"preset": p}).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=4) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                sim_results[p] = res.get("result", {})
                check(f"POST /api/simulate ({p})", resp.status == 200 and "transaction_id" in res.get("result", {}),
                      f"Decision: {res.get('result', {}).get('decision')} | Risk: {res.get('result', {}).get('risk_score')}")

        # Assert preset logic
        check("TOR_ATTACK triggers force-block & TOR_EXIT_NODE",
              sim_results["TOR_ATTACK"].get("decision") == "BLOCK"
              and "TOR_EXIT_NODE" in sim_results["TOR_ATTACK"].get("flags", []))

        check("IMPOSSIBLE_TRAVEL triggers force-block & speed check",
              sim_results["IMPOSSIBLE_TRAVEL"].get("decision") == "BLOCK"
              and "IMPOSSIBLE_TRAVEL" in sim_results["IMPOSSIBLE_TRAVEL"].get("flags", []))

        # 4. Quarantine SLA & Analyst Actions
        print("\n[4] Verifying Quarantine SLA & Analyst Actions...")
        tor_tx_id = sim_results["TOR_ATTACK"]["transaction_id"]
        with urllib.request.urlopen(f"{target_url}/api/quarantine?status=QUARANTINED", timeout=4) as resp:
            q_feed = json.loads(resp.read().decode("utf-8"))
            check("GET /api/quarantine (Status filter)", q_feed.get("status_filter") == "QUARANTINED" and len(q_feed.get("items", [])) > 0)
            target_item = next((q for q in q_feed.get("items", []) if q.get("transaction_id") == tor_tx_id), None)
            check("Quarantined transaction has SLA metadata", target_item is not None and "sla_due_at" in target_item)

        # Analyst Action: Add Note
        note_req = urllib.request.Request(
            f"{target_url}/api/quarantine/{tor_tx_id}/action",
            data=json.dumps({"action": "ADD_NOTE", "reason": "Investigation initiated", "notes": "Investigating Tor relay source"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": "analyst-token-2026", "X-Analyst-ID": "Analyst_Smoke", "X-User-Role": "analyst"}
        )
        with urllib.request.urlopen(note_req, timeout=4) as resp:
            note_res = json.loads(resp.read().decode("utf-8"))
            check("POST /api/quarantine/{id}/action (ADD_NOTE)", resp.status == 200 and note_res.get("record", {}).get("status") == "QUARANTINED")

        # Analyst Action: Confirm Fraud
        fraud_req = urllib.request.Request(
            f"{target_url}/api/quarantine/{tor_tx_id}/action",
            data=json.dumps({"action": "CONFIRM_FRAUD", "reason": "Confirmed malicious exit relay", "notes": "Blacklisted origin"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": "analyst-token-2026", "X-Analyst-ID": "Analyst_Smoke", "X-User-Role": "analyst"}
        )
        with urllib.request.urlopen(fraud_req, timeout=4) as resp:
            fraud_res = json.loads(resp.read().decode("utf-8"))
            check("POST /api/quarantine/{id}/action (CONFIRM_FRAUD)", resp.status == 200 and fraud_res.get("record", {}).get("status") == "CONFIRMED_FRAUD")

        # 5. Account Trail & Location History
        print("\n[5] Verifying Account Trail & Location Resolution...")
        acc_id = sim_results["NORMAL"].get("account_id", "acc_1")
        with urllib.request.urlopen(f"{target_url}/api/accounts/{acc_id}/trail", timeout=4) as resp:
            trail = json.loads(resp.read().decode("utf-8"))
            check("GET /api/accounts/{id}/trail", trail.get("account_id") == acc_id and "entity_graph" in trail)

        with urllib.request.urlopen(f"{target_url}/api/accounts/{acc_id}/locations", timeout=4) as resp:
            locs = json.loads(resp.read().decode("utf-8"))
            check("GET /api/accounts/{id}/locations", locs.get("account_id") == acc_id and "trail" in locs)

        # 6. Detail View & Export
        print("\n[6] Verifying Forensic Inspection & JSON Export...")
        with urllib.request.urlopen(f"{target_url}/transaction/{tor_tx_id}", timeout=4) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
            check("GET /transaction/{id} (Forensic payload)", detail.get("transaction_id") == tor_tx_id and "origin" in detail and "pii_enrichment" in detail)

        with urllib.request.urlopen(f"{target_url}/transaction/{tor_tx_id}/export", timeout=4) as resp:
            disp = resp.headers.get("Content-Disposition", "")
            exp_data = json.loads(resp.read().decode("utf-8"))
            check("GET /transaction/{id}/export (Download attachment)", "attachment" in disp and exp_data.get("transaction_id") == tor_tx_id)

        print("\n" + "=" * 70)
        print(f"🎉 SMOKE TEST PASSED: {tests_passed}/{tests_total} CHECKS VERIFIED SUCCESSFULLY!")
        print("=" * 70)
        return True

    finally:
        if server:
            server.shutdown()


if __name__ == "__main__":
    url_arg = sys.argv[1] if len(sys.argv) > 1 else None
    success = run_smoke_test(url_arg)
    sys.exit(0 if success else 1)
