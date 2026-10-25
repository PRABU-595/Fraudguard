"""
FraudGuard Quarantine Queue Precision Seeder
Re-seeds quarantine_log with:
- ~40% ON_TRACK
- ~25% AT_RISK
- ~20% BREACHED
- ~15% CLOSED (RELEASED + CONFIRMED_FRAUD)
Guarantees NO "seed" rows, varied amounts, accounts, countries, and risk scores.
"""

import os
import sys
import json
import random
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from src.tower_geo_helper import generate_cell_tower

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUARANTINE_LOG_FILE = os.path.join(ROOT_DIR, "data", "quarantine_log.json")
AUDIT_LOG_FILE = os.path.join(ROOT_DIR, "data", "audit_log.json")

CITIES = [
    ("New York", "US", 40.7128, -74.0060, "USD"),
    ("London", "GB", 51.5074, -0.1278, "GBP"),
    ("Frankfurt", "DE", 50.1109, 8.6821, "EUR"),
    ("Tokyo", "JP", 35.6762, 139.6503, "USD"),
    ("Singapore", "SG", 1.3521, 103.8198, "USD"),
    ("Paris", "FR", 48.8566, 2.3522, "EUR"),
    ("Amsterdam", "NL", 52.3676, 4.9041, "EUR"),
    ("Zurich", "CH", 47.3769, 8.5417, "EUR"),
    ("Dubai", "AE", 25.2048, 55.2708, "USD"),
    ("Sydney", "AU", -33.8688, 151.2093, "USD"),
    ("Toronto", "CA", 43.6532, -79.3832, "USD"),
    ("Mumbai", "IN", 19.0760, 72.8777, "USD"),
    ("Berlin", "DE", 52.5200, 13.4050, "EUR"),
    ("São Paulo", "BR", -23.5505, -46.6333, "USD"),
]

FLAGS_POOL = [
    ["IMPOSSIBLE_TRAVEL", "RAPID_SUCCESSION"],
    ["TOR_EXIT_NODE", "ORIGIN_TOR"],
    ["HIGH_VELOCITY", "VELOCITY_SPIKE"],
    ["AMOUNT_ANOMALY", "BURST_ACTIVITY"],
    ["AMOUNT_SPIKE", "UNUSUAL_HOUR"],
    ["GEO_ORIGIN_MISMATCH", "LOCATION_MISMATCH"],
    ["NEW_ACCOUNT", "UNVERIFIED_CONTACT"],
    ["CHANNEL_RISK", "UNUSUAL_HOUR"],
    ["IMPOSSIBLE_TRAVEL", "AMOUNT_ANOMALY"],
]

ANALYSTS = ["analyst_sarah", "analyst_david", "analyst_marcus", "soc_tier2_lead", "Unassigned"]


def run_precision_reseed():
    now = datetime.now(timezone.utc)
    cases = []
    case_idx = 1001

    def make_case(status: str, min_ago: int, sla_min: int = 60, risk: float = 85.0, is_closed: bool = False, close_status: str = ""):
        nonlocal case_idx
        q_time = now - timedelta(minutes=min_ago)
        iso_time = q_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        sla_deadline = (q_time + timedelta(minutes=sla_min)).strftime("%Y-%m-%dT%H:%M:%SZ")

        city, country, lat, lon, curr = random.choice(CITIES)
        flags = random.choice(FLAGS_POOL)
        assignee = random.choice(ANALYSTS) if status != "QUARANTINED" or random.random() > 0.4 else "Unassigned"
        tx_id = f"tx_case_{case_idx:04d}"
        case_id = f"CASE-{case_idx:04d}"
        case_idx += 1

        tower = generate_cell_tower(tx_id, lat, lon, country, iso_time)

        rec = {
            "case_id": case_id,
            "transaction_id": tx_id,
            "quarantine_id": f"q_{tx_id}",
            "account_id": f"acc_{country.lower()}_{random.randint(10, 99)}",
            "source_account": f"acc_{country.lower()}_{random.randint(10, 99)}",
            "destination_account": f"merch_{random.randint(100, 999)}",
            "amount": round(random.uniform(25.0, 4800.0), 2),
            "currency": curr,
            "decision": "BLOCK" if status in ("QUARANTINED", "ESCALATED") or close_status == "CONFIRMED_FRAUD" else "ALLOW",
            "status": close_status if is_closed else status,
            "risk_score": risk,
            "flags": flags,
            "rule_violations": flags,
            "transaction_city": city,
            "transaction_country": country,
            "lat": lat,
            "lon": lon,
            "timestamp": iso_time,
            "quarantine_ts": iso_time,
            "sla_deadline": sla_deadline,
            "assignee": assignee,
            "cell_tower": tower,
            "network": {
                "ip": f"198.51.100.{random.randint(10, 250)}",
                "isp": "Enterprise Gateway ISP",
                "vpn": "TOR" in flags[0] or "TOR" in flags[-1]
            },
            "device": {
                "fingerprint": f"fp_{random.randint(10000, 99999)}",
                "os": "macOS 15.1" if random.random() > 0.5 else "Windows 11",
                "browser": "Chrome 131"
            },
            "notes_thread": [
                {"author": "System Detection", "text": f"Rule violations triggered quarantine: {', '.join(flags)}", "timestamp": iso_time}
            ]
        }

        if is_closed:
            resolve_delay = random.randint(10, 30)
            rec["updated_ts"] = (q_time + timedelta(minutes=resolve_delay)).strftime("%Y-%m-%dT%H:%M:%SZ")
            rec["action_ts"] = rec["updated_ts"]
            rec["notes_thread"].append({
                "author": assignee if assignee != "Unassigned" else "analyst_sarah",
                "text": f"Resolved case as {close_status}.",
                "timestamp": rec["updated_ts"]
            })

        return rec

    # 1. 40 ON_TRACK items (created 5 to 30 min ago on 60m SLA -> 30-55m remaining, >25%)
    for _ in range(40):
        min_ago = random.randint(5, 30)
        risk = round(random.uniform(55.0, 95.0), 1)
        cases.append(make_case("QUARANTINED", min_ago, sla_min=60, risk=risk))

    # 2. 25 AT_RISK items (created 47 to 57 min ago on 60m SLA -> 3-13m remaining, <25%)
    for _ in range(25):
        min_ago = random.randint(47, 57)
        risk = round(random.uniform(65.0, 98.0), 1)
        cases.append(make_case("QUARANTINED", min_ago, sla_min=60, risk=risk))

    # 3. 20 BREACHED items (created 65 to 600 min ago on 60m SLA -> overdue by 5m to 9h)
    for _ in range(20):
        min_ago = random.randint(65, 600)
        risk = round(random.uniform(75.0, 100.0), 1)
        cases.append(make_case("QUARANTINED", min_ago, sla_min=60, risk=risk))

    # 4. 15 CLOSED items (6 RELEASED, 9 CONFIRMED_FRAUD)
    for _ in range(6):
        min_ago = random.randint(40, 240)
        risk = round(random.uniform(40.0, 78.0), 1)
        cases.append(make_case("RESOLVED", min_ago, sla_min=60, risk=risk, is_closed=True, close_status="RELEASED"))

    for _ in range(9):
        min_ago = random.randint(40, 360)
        risk = round(random.uniform(85.0, 100.0), 1)
        cases.append(make_case("RESOLVED", min_ago, sla_min=60, risk=risk, is_closed=True, close_status="CONFIRMED_FRAUD"))

    # Assert exact distribution
    total = len(cases)
    assert total == 100, f"Expected 100 cases, got {total}"

    # Filter out any lingering "seed" records
    clean_cases = [c for c in cases if "seed" not in str(c.get("transaction_id", "")).lower() and "seed" not in str(c.get("account_id", "")).lower()]

    with open(QUARANTINE_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(clean_cases, f, indent=2)

    print(f"Successfully re-seeded quarantine_log.json with {len(clean_cases)} cases:")
    print("  - ON_TRACK: 40 (40%)")
    print("  - AT_RISK: 25 (25%)")
    print("  - BREACHED: 20 (20%)")
    print("  - CLOSED: 15 (15%: 6 Released, 9 Confirmed Fraud)")
    print("  - Zero 'seed' rows guaranteed.")


if __name__ == "__main__":
    run_precision_reseed()
