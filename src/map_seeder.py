"""
FraudGuard Map & Telemetry Historical Seeder
Populates the datastore with 130+ multi-city, multi-account transactions
across 18+ global financial hubs, with realistic cell towers, multi-hop travel
paths, and risk tiers so the SOC map and ingestion console are populated on launch.
"""

import math
import os
import random
import sys
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db_client import DBClient
from src.location_checker import CITY_COORDINATES
from src.tower_geo_helper import generate_cell_tower, calculate_haversine_meters

GLOBAL_CITIES = [
    ("New York", "US"),
    ("San Francisco", "US"),
    ("Chicago", "US"),
    ("London", "GB"),
    ("Frankfurt", "DE"),
    ("Paris", "FR"),
    ("Zurich", "CH"),
    ("Tokyo", "JP"),
    ("Singapore", "SG"),
    ("Mumbai", "IN"),
    ("Delhi", "IN"),
    ("Sydney", "AU"),
    ("Berlin", "DE"),
    ("Toronto", "CA"),
    ("Sao Paulo", "BR"),
    ("Dubai", "AE"),
    ("Hong Kong", "HK"),
    ("Seoul", "KR"),
]

MERCHANTS = [
    ("Amazon Web Services", "Cloud Infrastructure"),
    ("Stripe Payments US", "Payment Gateway"),
    ("Apple Retail Store", "Consumer Electronics"),
    ("British Airways Direct", "Aviation & Travel"),
    ("Lufthansa Express", "Aviation & Travel"),
    ("Starbucks Reserve", "Food & Beverage"),
    ("Uber Technologies", "Rideshare & Mobility"),
    ("MercadoLivre Brasil", "E-Commerce Marketplace"),
    ("Rakuten Global Market", "E-Commerce Marketplace"),
    ("Sephora Beauty Hub", "Luxury Retail"),
    ("Target Supercenter", "General Merchandise"),
    ("Binance Crypto Clearing", "Virtual Currency Exchange"),
    ("Emirates Airlines", "Aviation & Travel"),
    ("Seven & I Holdings", "Convenience Retail"),
]


def seed_historical_map_data(db_client: DBClient, force: bool = False) -> int:
    """Seed transactions across 18+ cities and 35+ accounts if database has under 100 events."""
    existing_records = db_client.get_all_main_transactions()
    if len(existing_records) >= 120 and not force:
        return len(existing_records)

    now = datetime.now(timezone.utc)
    seeded_records: List[Dict[str, Any]] = []

    # 35 accounts
    for acct_idx in range(1, 36):
        acct_id = f"acc_soc_{acct_idx:02d}"
        home_city, home_country = GLOBAL_CITIES[(acct_idx - 1) % len(GLOBAL_CITIES)]
        home_coords = CITY_COORDINATES.get(home_city.lower(), {"lat": 40.7128, "lon": -74.0060})

        # 3 to 5 transactions per account over the last 12 hours
        num_tx = 4
        base_time = now - timedelta(hours=random.uniform(4, 12))

        # Determine account personality
        is_impossible_travel = (acct_idx == 4 or acct_idx == 18)
        is_tor_attacker = (acct_idx == 9 or acct_idx == 27)
        is_velocity_burst = (acct_idx == 14)

        prev_city = home_city
        prev_country = home_country
        prev_coords = home_coords
        prev_time = base_time

        for tx_idx in range(num_tx):
            t_id = f"tx_map_{acct_idx:02d}_{tx_idx + 1}"
            merchant, merchant_cat = MERCHANTS[(acct_idx + tx_idx) % len(MERCHANTS)]

            if is_impossible_travel and tx_idx == 2:
                # Impossible supersonic hop: e.g. London -> Tokyo in 15 minutes (> 9000 km/h)
                curr_city, curr_country = ("Tokyo", "JP") if prev_city == "London" else ("London", "GB")
                curr_coords = CITY_COORDINATES.get(curr_city.lower(), {"lat": 35.6762, "lon": 139.6503})
                curr_time = prev_time + timedelta(minutes=15)
                decision = "BLOCK"
                status = "QUARANTINED"
                risk_score = 98.0
                flags = ["IMPOSSIBLE_TRAVEL", "RAPID_SUCCESSION", "GEO_ORIGIN_MISMATCH"]
                ip = "185.220.101.42"
            elif is_tor_attacker and tx_idx >= 1:
                curr_city, curr_country = ("Frankfurt", "DE")
                curr_coords = CITY_COORDINATES.get("frankfurt", {"lat": 50.1109, "lon": 8.6821})
                curr_time = prev_time + timedelta(minutes=random.uniform(10, 45))
                decision = "BLOCK"
                status = "QUARANTINED"
                risk_score = 92.0
                flags = ["ORIGIN_TOR", "TOR_EXIT_NODE", "LOCATION_MISMATCH"]
                ip = "185.220.103.111"
            elif is_velocity_burst and tx_idx >= 2:
                curr_city = prev_city
                curr_country = prev_country
                curr_coords = prev_coords
                curr_time = prev_time + timedelta(seconds=random.uniform(5, 20))
                decision = "BLOCK"
                status = "QUARANTINED"
                risk_score = 88.0
                flags = ["HIGH_VELOCITY", "VELOCITY_SPIKE", "RAPID_SUCCESSION"]
                ip = "192.0.2.14"
            else:
                # Normal transaction
                curr_city = home_city
                curr_country = home_country
                curr_coords = home_coords
                curr_time = prev_time + timedelta(minutes=random.uniform(30, 120))
                decision = "ALLOW"
                status = "APPROVED"
                risk_score = round(random.uniform(2.0, 24.0), 1)
                flags = []
                ip = f"198.51.100.{acct_idx * 3 + tx_idx}"

            # Sub-kilometer jitter for coordinate diversity
            jitter_lat = ((random.random() - 0.5) * 0.04)
            jitter_lon = ((random.random() - 0.5) * 0.04)
            lat = round(curr_coords["lat"] + jitter_lat, 6)
            lon = round(curr_coords["lon"] + jitter_lon, 6)
            iso_time = curr_time.strftime("%Y-%m-%dT%H:%M:%SZ")

            tower = generate_cell_tower(t_id, lat, lon, curr_country, iso_time)

            record = {
                "transaction_id": t_id,
                "account_id": acct_id,
                "source_account": acct_id,
                "destination_account": f"acc_merch_{hash(merchant) % 9999:04d}",
                "amount": round(random.uniform(18.0, 850.0), 2),
                "currency": "EUR" if curr_country in ("DE", "FR", "NL") else ("GBP" if curr_country == "GB" else ("JPY" if curr_country == "JP" else "USD")),
                "txn_type": random.choice(["CREDIT", "DEBIT", "WIRE"]),
                "channel": random.choice(["POS", "ONLINE_WEB", "MOBILE_APP"]),
                "origin_ip": ip,
                "transaction_city": curr_city,
                "transaction_country": curr_country,
                "lat": lat,
                "lon": lon,
                "timestamp": iso_time,
                "decision": decision,
                "status": status,
                "risk_score": risk_score,
                "flags": flags,
                "rule_violations": flags,
                "counterparty": merchant,
                "merchant_category": merchant_cat,
                "cell_tower": tower,
                "fix_source": "CELL_TOWER" if tx_idx % 2 == 0 else "GPS",
                "accuracy_meters": round(random.uniform(8.0, 45.0), 1),
            }

            try:
                db_client.log_transaction(record, prevent_overwrite=False)
                if status == "QUARANTINED":
                    # Build SLA-compliant quarantine record
                    q_record = dict(record)
                    q_record["quarantine_id"] = f"q_{t_id}"
                    q_record["quarantine_ts"] = iso_time
                    q_record["sla_deadline"] = (curr_time + timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
                    q_record["is_sla_breached"] = False
                    q_record["priority"] = "HIGH" if risk_score >= 90 else "MEDIUM"
                    db_client.log_quarantine(q_record, prevent_overwrite=False)
                seeded_records.append(record)
            except Exception as e:
                print(f"Error logging {t_id}: {e}")

            prev_city = curr_city
            prev_country = curr_country
            prev_coords = curr_coords
            prev_time = curr_time

    return len(seeded_records)


if __name__ == "__main__":
    db = DBClient()
    count = seed_historical_map_data(db, force=True)
    print(f"Successfully seeded {count} multi-city SOC transactions.")
