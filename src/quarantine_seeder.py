"""
FraudGuard Quarantine Queue Diverse Seeder
Seeds the quarantine datastore with a realistic, diverse mix of:
- ON_TRACK items (>25% SLA time remaining)
- AT_RISK items (<25% SLA time remaining)
- BREACHED items (past deadline, e.g. overdue by 2h to 12h)
- ESCALATED cases assigned to Tier-2
- Already RESOLVED cases (RELEASED, CONFIRMED_FRAUD) with analyst notes
"""

import os
import sys
import random
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db_client import DBClient
from src.tower_geo_helper import generate_cell_tower


def seed_diverse_quarantine_cases(db_client: DBClient) -> int:
    now = datetime.now(timezone.utc)
    seeded_count = 0

    cases_spec = [
        # (id_suffix, minutes_ago, sla_duration_min, status, risk_score, flags, city, country, assignee)
        # 1. BREACHED items (past deadline)
        ("br_01", 120, 60, "QUARANTINED", 96.0, ["IMPOSSIBLE_TRAVEL", "RAPID_SUCCESSION"], "London", "GB", "Unassigned"),
        ("br_02", 95, 60, "QUARANTINED", 88.0, ["TOR_EXIT_NODE", "ORIGIN_TOR"], "Frankfurt", "DE", "Unassigned"),
        ("br_03", 240, 60, "QUARANTINED", 92.0, ["HIGH_VELOCITY", "VELOCITY_SPIKE"], "Tokyo", "JP", "analyst_sarah"),
        ("br_04", 720, 60, "QUARANTINED", 99.0, ["IMPOSSIBLE_TRAVEL", "AMOUNT_ANOMALY"], "Sydney", "AU", "Unassigned"),

        # 2. AT_RISK items (<25% time remaining: e.g. created 50-55m ago on a 60m SLA)
        ("risk_01", 52, 60, "QUARANTINED", 85.0, ["AMOUNT_SPIKE", "UNUSUAL_HOUR"], "New York", "US", "analyst_david"),
        ("risk_02", 55, 60, "QUARANTINED", 82.0, ["CHANNEL_RISK", "LOCATION_MISMATCH"], "Paris", "FR", "Unassigned"),
        ("risk_03", 48, 60, "QUARANTINED", 79.0, ["GEO_ORIGIN_MISMATCH"], "Singapore", "SG", "analyst_sarah"),

        # 3. ON_TRACK items (>25% time remaining: created 5-30m ago)
        ("track_01", 12, 60, "QUARANTINED", 90.0, ["ORIGIN_TOR", "BURST_ACTIVITY"], "Amsterdam", "NL", "Unassigned"),
        ("track_02", 20, 60, "QUARANTINED", 76.0, ["UNUSUAL_HOUR", "AMOUNT_ANOMALY"], "Chicago", "US", "analyst_marcus"),
        ("track_03", 5, 60, "QUARANTINED", 84.0, ["IMPOSSIBLE_TRAVEL"], "Toronto", "CA", "Unassigned"),
        ("track_04", 18, 60, "QUARANTINED", 71.0, ["NEW_ACCOUNT", "UNVERIFIED_CONTACT"], "Mumbai", "IN", "Unassigned"),

        # 4. ESCALATED items
        ("esc_01", 85, 60, "ESCALATED", 94.0, ["AMOUNT_ANOMALY", "ORIGIN_TOR"], "Zurich", "CH", "soc_tier2_lead"),
        ("esc_02", 40, 60, "ESCALATED", 98.0, ["IMPOSSIBLE_TRAVEL", "HIGH_VELOCITY"], "Dubai", "AE", "soc_tier2_lead"),

        # 5. RESOLVED items (RELEASED)
        ("rel_01", 180, 60, "RELEASED", 55.0, ["UNUSUAL_HOUR"], "New York", "US", "analyst_sarah"),
        ("rel_02", 210, 60, "RELEASED", 62.0, ["LOCATION_MISMATCH"], "Berlin", "DE", "analyst_david"),

        # 6. RESOLVED items (CONFIRMED_FRAUD)
        ("fraud_01", 300, 60, "CONFIRMED_FRAUD", 100.0, ["IMPOSSIBLE_TRAVEL", "TOR_EXIT_NODE"], "London", "GB", "soc_tier2_lead"),
        ("fraud_02", 360, 60, "CONFIRMED_FRAUD", 98.0, ["HIGH_VELOCITY", "VELOCITY_SPIKE"], "Tokyo", "JP", "analyst_marcus"),
    ]

    for suffix, min_ago, sla_min, status, risk, flags, city, country, assignee in cases_spec:
        tx_id = f"tx_case_{suffix}"
        q_time = now - timedelta(minutes=min_ago)
        iso_time = q_time.strftime("%Y-%m-%dT%H:%M:%SZ")
        sla_deadline = (q_time + timedelta(minutes=sla_min)).strftime("%Y-%m-%dT%H:%M:%SZ")

        coords = {"New York": (40.7128, -74.0060), "London": (51.5074, -0.1278), "Frankfurt": (50.1109, 8.6821),
                  "Tokyo": (35.6762, 139.6503), "Sydney": (-33.8688, 151.2093), "Paris": (48.8566, 2.3522),
                  "Singapore": (1.3521, 103.8198), "Amsterdam": (52.3676, 4.9041), "Chicago": (41.8781, -87.6298),
                  "Toronto": (43.6532, -79.3832), "Mumbai": (19.0760, 72.8777), "Zurich": (47.3769, 8.5417),
                  "Dubai": (25.2048, 55.2708), "Berlin": (52.5200, 13.4050)}.get(city, (40.7128, -74.0060))

        tower = generate_cell_tower(tx_id, coords[0], coords[1], country, iso_time)

        rec = {
            "transaction_id": tx_id,
            "quarantine_id": f"q_{tx_id}",
            "account_id": f"acc_case_{suffix}",
            "amount": round(random.uniform(45.0, 1250.0), 2),
            "currency": "EUR" if country in ("DE", "FR", "NL") else ("GBP" if country == "GB" else "USD"),
            "decision": "BLOCK" if status in ("QUARANTINED", "ESCALATED", "CONFIRMED_FRAUD") else "ALLOW",
            "status": status,
            "risk_score": risk,
            "flags": flags,
            "rule_violations": flags,
            "transaction_city": city,
            "transaction_country": country,
            "lat": coords[0],
            "lon": coords[1],
            "timestamp": iso_time,
            "quarantine_ts": iso_time,
            "sla_deadline": sla_deadline,
            "assignee": assignee,
            "cell_tower": tower,
            "notes_thread": [
                {"author": "System Detection", "text": f"Rule violations triggered quarantine: {', '.join(flags)}", "timestamp": iso_time}
            ]
        }
        if status in ("RELEASED", "CONFIRMED_FRAUD"):
            rec["updated_ts"] = (q_time + timedelta(minutes=random.uniform(15, 45))).strftime("%Y-%m-%dT%H:%M:%SZ")

        db_client.log_quarantine(rec, prevent_overwrite=False)
        db_client.log_transaction(rec, prevent_overwrite=False)
        seeded_count += 1

    return seeded_count


if __name__ == "__main__":
    db = DBClient()
    cnt = seed_diverse_quarantine_cases(db)
    print(f"Seeded {cnt} diverse quarantine cases.")
