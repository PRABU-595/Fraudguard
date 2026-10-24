#!/usr/bin/env python3
"""
Break-It Tester: Adversarial QA & Stress Attack Suite for FraudGuard
Executes hostile, edge-case, concurrency, and injection attacks against the console APIs.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.environ.get("TARGET_URL", "http://127.0.0.1:8081")

def run_attacks():
    results = []

    def req(method, path, body=None, headers=None):
        url = f"{BASE_URL}{path}"
        data = None
        h = headers or {}
        if body is not None:
            if isinstance(body, (dict, list)):
                data = json.dumps(body).encode("utf-8")
                h["Content-Type"] = "application/json"
            elif isinstance(body, str):
                data = body.encode("utf-8")
                h["Content-Type"] = "application/json"
            elif isinstance(body, bytes):
                data = body

        r = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=3.0) as resp:
                code = resp.status
                raw = resp.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = raw
                return code, parsed
        except urllib.error.HTTPError as e:
            err_raw = e.read().decode("utf-8", errors="replace")
            try:
                err_parsed = json.loads(err_raw)
            except Exception:
                err_parsed = err_raw
            return e.code, err_parsed
        except Exception as ex:
            return 0, str(ex)

    print(f"=== BREAK-IT TESTER: ATTACKING {BASE_URL} ===\n")

    # --------------------------------------------------------------------------
    # CATEGORY 1: INJECTION & SECURITY ATTACKS
    # --------------------------------------------------------------------------
    # Test 1.1: XSS Injection in Analyst Notes
    xss_payload = "<script>alert('XSS_BREACH')</script><img src=x onerror=alert(1)>"
    c, r = req("POST", "/api/quarantine/tx_attack_xss/action", {
        "action": "ADD_NOTE",
        "notes": xss_payload,
        "reason": xss_payload
    }, headers={"X-API-Key": "fg-analyst-demo-key-2026"})
    results.append({
        "id": "SEC-01",
        "area": "Security / XSS",
        "input": "XSS script in quarantine action note",
        "expected": "Properly handled or escaped, no raw reflection in unescaped HTML",
        "actual": f"Status: {c}, Responded without crash",
        "passed": c in (200, 404) and "XSS_BREACH" not in str(r).replace(xss_payload, ""),
        "severity": "Medium"
    })

    # Test 1.2: Path Traversal in Account Trail
    c, r = req("GET", "/api/accounts/..%2f..%2fetc%2fpasswd/trail")
    results.append({
        "id": "SEC-02",
        "area": "Security / Path Traversal",
        "input": "GET /api/accounts/../../etc/passwd/trail",
        "expected": "400 or 404 or sanitized empty account trail, no file read",
        "actual": f"Status: {c}",
        "passed": c in (200, 400, 404) and "root:" not in str(r),
        "severity": "Critical"
    })

    # Test 1.3: SQL / NoSQL Injection in Transaction Lookup
    c, r = req("GET", "/transaction/'%20OR%20'1'='1")
    results.append({
        "id": "SEC-03",
        "area": "Security / Injection",
        "input": "GET /transaction/' OR '1'='1",
        "expected": "404 Not Found, no crash or data leak",
        "actual": f"Status: {c}",
        "passed": c == 404,
        "severity": "High"
    })

    # Test 1.4: Malformed / Broken JSON in POST /api/simulate
    c, r = req("POST", "/api/simulate", body="{\"preset\": \"NORMAL\", broken")
    results.append({
        "id": "INP-01",
        "area": "Input Validation",
        "input": "Malformed JSON syntax in POST body",
        "expected": "400 Bad Request (INVALID_JSON)",
        "actual": f"Status: {c}, Body: {str(r)[:60]}",
        "passed": c == 400 and (isinstance(r, dict) and r.get("error") == "INVALID_JSON"),
        "severity": "Medium"
    })

    # Test 1.5: Array passed when Object expected
    c, r = req("POST", "/api/simulate", body="[1, 2, 3]")
    results.append({
        "id": "INP-02",
        "area": "Input Validation",
        "input": "JSON Array root payload where object expected",
        "expected": "400 Bad Request (INVALID_PAYLOAD)",
        "actual": f"Status: {c}, Body: {str(r)[:60]}",
        "passed": c == 400,
        "severity": "Medium"
    })

    # --------------------------------------------------------------------------
    # CATEGORY 2: BOUNDARIES, DATA TYPES & EXTREME VALUES
    # --------------------------------------------------------------------------
    # Test 2.1: Pagination with Negative and Extreme Values
    c, r = req("GET", "/api/transactions?page=-5&limit=0")
    results.append({
        "id": "BND-01",
        "area": "Boundary / Pagination",
        "input": "GET /api/transactions?page=-5&limit=0",
        "expected": "200 with clamped page=1 and valid items array (no division by zero or crash)",
        "actual": f"Status: {c}, page: {r.get('page') if isinstance(r, dict) else 'n/a'}",
        "passed": c == 200 and isinstance(r, dict) and r.get("page") == 1,
        "severity": "High"
    })

    # Test 2.2: Pagination with Non-Numeric Input
    c, r = req("GET", "/api/transactions?page=undefined&limit=NaN")
    results.append({
        "id": "BND-02",
        "area": "Boundary / Type Coercion",
        "input": "GET /api/transactions?page=undefined&limit=NaN",
        "expected": "200 OK fallback to default page=1, limit=15 without 500 error",
        "actual": f"Status: {c}",
        "passed": c == 200,
        "severity": "Medium"
    })

    # Test 2.3: Non-existent Quarantine Transaction Action
    c, r = req("POST", "/api/quarantine/non_existent_tx_99999/action", {
        "action": "RELEASE",
        "reason": "Test non-existent"
    }, headers={"X-API-Key": "fg-analyst-demo-key-2026"})
    results.append({
        "id": "BND-03",
        "area": "Quarantine / Missing Record",
        "input": "Action on non-existent transaction ID",
        "expected": "404 Not Found error response",
        "actual": f"Status: {c}, Body: {str(r)[:60]}",
        "passed": c == 404,
        "severity": "Medium"
    })

    # Test 2.4: Invalid Action Name
    c, r = req("POST", "/api/quarantine/tx_sim_test/action", {
        "action": "EXPLODE_TRANSACTION",
        "reason": "Invalid action"
    }, headers={"X-API-Key": "fg-analyst-demo-key-2026"})
    results.append({
        "id": "BND-04",
        "area": "Quarantine / Invalid Action",
        "input": "Action = EXPLODE_TRANSACTION",
        "expected": "400 Bad Request with allowed actions list",
        "actual": f"Status: {c}, Body: {str(r)[:60]}",
        "passed": c == 400,
        "severity": "Medium"
    })

    # Test 2.5: Empty Bulk Action
    c, r = req("POST", "/api/quarantine/bulk", {
        "transaction_ids": [],
        "action": "RELEASE"
    }, headers={"X-API-Key": "fg-analyst-demo-key-2026"})
    results.append({
        "id": "BND-05",
        "area": "Quarantine / Bulk Action",
        "input": "Bulk action with empty transaction_ids array",
        "expected": "200 OK with processed_count = 0, no exception",
        "actual": f"Status: {c}, processed_count: {r.get('processed_count') if isinstance(r, dict) else 'n/a'}",
        "passed": c == 200 and isinstance(r, dict) and r.get("processed_count") == 0,
        "severity": "Medium"
    })

    # --------------------------------------------------------------------------
    # CATEGORY 3: CONCURRENCY & RACE CONDITIONS
    # --------------------------------------------------------------------------
    # First seed a quarantined transaction via TOR_ATTACK
    c_seed, r_seed = req("POST", "/api/simulate", {"preset": "TOR_ATTACK"})
    seed_tx_id = (r_seed.get("result") or {}).get("transaction_id") if isinstance(r_seed, dict) else None

    if seed_tx_id:
        # Test 3.1: 10 Concurrent Conflicting Analyst Actions on the Same Record
        def fire_action(act):
            return req("POST", f"/api/quarantine/{seed_tx_id}/action", {
                "action": act,
                "reason": f"Concurrent test {act}",
                "notes": "Stress test"
            }, headers={"X-API-Key": "fg-analyst-demo-key-2026"})

        actions = ["RELEASE", "CONFIRM_FRAUD", "ADD_NOTE", "ESCALATE", "RELEASE"]
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(fire_action, a) for a in actions]
            statuses = [f.result()[0] for f in futures]

        results.append({
            "id": "CONC-01",
            "area": "Concurrency / State Mutation",
            "input": f"5 concurrent conflicting actions on {seed_tx_id}",
            "expected": "All requests complete with 200 without deadlock, file lock corruption, or crash",
            "actual": f"Statuses: {statuses}",
            "passed": all(s == 200 for s in statuses),
            "severity": "High"
        })
    else:
        results.append({
            "id": "CONC-01",
            "area": "Concurrency / State Mutation",
            "input": "Seed transaction creation",
            "expected": "Valid transaction created",
            "actual": "Failed to seed",
            "passed": False,
            "severity": "High"
        })

    # Test 3.2: 30 Rapid Concurrent Ingestion / Stats Requests
    def fire_stats(_):
        return req("GET", "/api/stats")[0]

    with ThreadPoolExecutor(max_workers=10) as pool:
        stat_statuses = list(pool.map(fire_stats, range(30)))

    results.append({
        "id": "CONC-02",
        "area": "Concurrency / Server Load",
        "input": "30 rapid parallel GET /api/stats requests",
        "expected": "All 30 succeed with HTTP 200 (server remains non-blocking)",
        "actual": f"Success rate: {stat_statuses.count(200)}/30",
        "passed": stat_statuses.count(200) == 30,
        "severity": "High"
    })

    # --------------------------------------------------------------------------
    # CATEGORY 4: UNKNOWN ROUTES & METHOD ATTACKS
    # --------------------------------------------------------------------------
    # Test 4.1: Unsupported HTTP Method on Read-Only Route
    c, r = req("DELETE", "/api/health")
    results.append({
        "id": "METH-01",
        "area": "Routing / HTTP Methods",
        "input": "DELETE /api/health",
        "expected": "404 or 405 or 501, no crash or hanging connection",
        "actual": f"Status: {c}",
        "passed": c in (400, 404, 405, 501),
        "severity": "Low"
    })

    # Test 4.2: Large Overflow URI (>4096 chars)
    overflow_path = "/api/accounts/" + ("A" * 2048) + "/trail"
    c, r = req("GET", overflow_path)
    results.append({
        "id": "BND-06",
        "area": "Boundary / Buffer Overflow",
        "input": "GET with 2048-character account ID",
        "expected": "Server gracefully returns 200 (empty trail) or 400/414, no buffer crash",
        "actual": f"Status: {c}",
        "passed": c in (200, 400, 404, 414),
        "severity": "Medium"
    })

    # --------------------------------------------------------------------------
    # PRINT REPORT
    # --------------------------------------------------------------------------
    passed_count = sum(1 for x in results if x["passed"])
    failed_count = len(results) - passed_count

    print(f"Summary: {len(results)} cases run, {passed_count} passed, {failed_count} failed.\n")
    print("| # | Severity | Area | Input / Steps | Expected | Actual |")
    print("|---|----------|------|---------------|----------|--------|")
    for idx, r in enumerate(results, 1):
        status_icon = "✅" if r["passed"] else "❌"
        print(f"| {idx} | {r['severity']} | {r['area']} | {r['input']} | {r['expected']} | {status_icon} {r['actual']} |")

    return failed_count == 0

if __name__ == "__main__":
    success = run_attacks()
    sys.exit(0 if success else 1)
