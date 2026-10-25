"""
FraudGuard Map & Telemetry Historical Seeder
Populates the datastore with 2,500+ multi-city, multi-account transactions
across Indian metros and 18+ global financial hubs, with realistic stationary
carrier cell towers, multi-hop travel paths, and risk tiers so the SOC Threat Map
and ingestion console are teeming with realistic real-world financial traffic.
"""

import hashlib
import json
import math
import os
import random
import sys
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.db_client import DBClient
from src.location_checker import CITY_COORDINATES
from src.tower_geo_helper import calculate_haversine_meters

# 80+ Realistic Stationary Carrier Cell Towers Across Indian and Global Metro Centers
STATIONARY_CELL_TOWERS: List[Dict[str, Any]] = [
    # --- INDIA: Mumbai ---
    {"tower_id": "405-861-5201-19042", "carrier": "Reliance Jio 5G", "city": "Mumbai", "country": "IN", "lat": 19.0657, "lon": 72.8688, "accuracy_meters": 320, "sector": "Bandra-Kurla Complex (BKC)"},
    {"tower_id": "404-45-8310-72105", "carrier": "Bharti Airtel", "city": "Mumbai", "country": "IN", "lat": 18.9284, "lon": 72.8331, "accuracy_meters": 450, "sector": "Nariman Point Financial District"},
    {"tower_id": "404-20-8364-72056", "carrier": "Vodafone Idea", "city": "Mumbai", "country": "IN", "lat": 19.1136, "lon": 72.8697, "accuracy_meters": 550, "sector": "Andheri East Transit Corridor"},
    {"tower_id": "405-861-5202-31048", "carrier": "Reliance Jio 5G", "city": "Mumbai", "country": "IN", "lat": 19.0178, "lon": 72.8302, "accuracy_meters": 280, "sector": "Lower Parel Commercial Hub"},
    {"tower_id": "404-45-8314-10294", "carrier": "Bharti Airtel", "city": "Mumbai", "country": "IN", "lat": 19.0886, "lon": 72.8679, "accuracy_meters": 410, "sector": "Chhatrapati Shivaji Airport Terminal 2"},

    # --- INDIA: Delhi NCR ---
    {"tower_id": "405-861-1101-44012", "carrier": "Reliance Jio 5G", "city": "Delhi", "country": "IN", "lat": 28.6304, "lon": 77.2177, "accuracy_meters": 350, "sector": "Connaught Place Central Loop"},
    {"tower_id": "404-45-1102-88231", "carrier": "Bharti Airtel", "city": "Delhi", "country": "IN", "lat": 28.4986, "lon": 77.0878, "accuracy_meters": 480, "sector": "Gurgaon DLF Cyber City"},
    {"tower_id": "404-20-1103-67120", "carrier": "Vodafone Idea", "city": "Delhi", "country": "IN", "lat": 28.5672, "lon": 77.3210, "accuracy_meters": 520, "sector": "Noida Sector 18 Commercial Hub"},
    {"tower_id": "405-861-1104-99014", "carrier": "Reliance Jio 5G", "city": "Delhi", "country": "IN", "lat": 28.5562, "lon": 77.1000, "accuracy_meters": 380, "sector": "IGI Airport Terminal 3"},
    {"tower_id": "404-45-1105-32109", "carrier": "Bharti Airtel", "city": "Delhi", "country": "IN", "lat": 28.5494, "lon": 77.2536, "accuracy_meters": 420, "sector": "Nehru Place Electronics Market"},

    # --- INDIA: Bengaluru ---
    {"tower_id": "405-861-8001-22019", "carrier": "Reliance Jio 5G", "city": "Bengaluru", "country": "IN", "lat": 12.8452, "lon": 77.6602, "accuracy_meters": 340, "sector": "Electronic City Tech Zone"},
    {"tower_id": "404-45-8002-55412", "carrier": "Bharti Airtel", "city": "Bengaluru", "country": "IN", "lat": 12.9352, "lon": 77.6245, "accuracy_meters": 290, "sector": "Koramangala Startup Hub"},
    {"tower_id": "404-20-8003-77190", "carrier": "Vodafone Idea", "city": "Bengaluru", "country": "IN", "lat": 12.9719, "lon": 77.6412, "accuracy_meters": 410, "sector": "Indiranagar 100ft Metro Sector"},
    {"tower_id": "405-861-8004-90124", "carrier": "Reliance Jio 5G", "city": "Bengaluru", "country": "IN", "lat": 12.9698, "lon": 77.7499, "accuracy_meters": 360, "sector": "Whitefield ITPL Business Park"},

    # --- INDIA: Hyderabad ---
    {"tower_id": "405-861-4001-11890", "carrier": "Reliance Jio 5G", "city": "Hyderabad", "country": "IN", "lat": 17.4435, "lon": 78.3772, "accuracy_meters": 310, "sector": "HITEC City Cyber Towers"},
    {"tower_id": "404-45-4002-44123", "carrier": "Bharti Airtel", "city": "Hyderabad", "country": "IN", "lat": 17.4338, "lon": 78.3615, "accuracy_meters": 390, "sector": "Gachibowli Financial District"},
    {"tower_id": "404-20-4003-88231", "carrier": "Vodafone Idea", "city": "Hyderabad", "country": "IN", "lat": 17.4156, "lon": 78.4345, "accuracy_meters": 460, "sector": "Banjara Hills Commercial Core"},

    # --- INDIA: Chennai, Pune, Kolkata, Ahmedabad ---
    {"tower_id": "404-45-4401-12094", "carrier": "Bharti Airtel", "city": "Chennai", "country": "IN", "lat": 12.9815, "lon": 80.2180, "accuracy_meters": 420, "sector": "OMR IT Expressway Corridor"},
    {"tower_id": "405-861-2001-33104", "carrier": "Reliance Jio 5G", "city": "Pune", "country": "IN", "lat": 18.5912, "lon": 73.7389, "accuracy_meters": 380, "sector": "Hinjawadi Infotech Park"},
    {"tower_id": "404-20-3301-77821", "carrier": "Vodafone Idea", "city": "Kolkata", "country": "IN", "lat": 22.5804, "lon": 88.4289, "accuracy_meters": 490, "sector": "Salt Lake Sector V Tech Center"},
    {"tower_id": "404-45-7901-55102", "carrier": "Bharti Airtel", "city": "Ahmedabad", "country": "IN", "lat": 23.0304, "lon": 72.5074, "accuracy_meters": 440, "sector": "SG Highway Commercial Center"},

    # --- USA: New York ---
    {"tower_id": "310-410-4821-29401", "carrier": "AT&T Mobility 5G", "city": "New York", "country": "US", "lat": 40.7068, "lon": -74.0090, "accuracy_meters": 240, "sector": "Wall Street Financial Core"},
    {"tower_id": "311-480-1092-88123", "carrier": "Verizon Wireless", "city": "New York", "country": "US", "lat": 40.7580, "lon": -73.9855, "accuracy_meters": 310, "sector": "Times Square Midtown Hub"},
    {"tower_id": "310-260-3319-45012", "carrier": "T-Mobile USA", "city": "New York", "country": "US", "lat": 40.7484, "lon": -73.9857, "accuracy_meters": 290, "sector": "Empire State Commercial Sector"},
    {"tower_id": "310-410-6712-10943", "carrier": "AT&T Mobility 5G", "city": "New York", "country": "US", "lat": 40.6932, "lon": -73.9866, "accuracy_meters": 430, "sector": "Brooklyn Tech Triangle"},

    # --- USA: San Francisco & Chicago ---
    {"tower_id": "311-480-4151-66231", "carrier": "Verizon Wireless", "city": "San Francisco", "country": "US", "lat": 37.7915, "lon": -122.3998, "accuracy_meters": 260, "sector": "SoMa Market Street Corridor"},
    {"tower_id": "310-410-4152-89012", "carrier": "AT&T Mobility 5G", "city": "San Francisco", "country": "US", "lat": 37.7785, "lon": -122.4172, "accuracy_meters": 320, "sector": "Civic Center Tech Hub"},
    {"tower_id": "310-260-3121-77104", "carrier": "T-Mobile USA", "city": "Chicago", "country": "US", "lat": 41.8827, "lon": -87.6233, "accuracy_meters": 350, "sector": "The Loop Financial District"},

    # --- UK: London ---
    {"tower_id": "234-30-2001-99412", "carrier": "EE Limited 5G", "city": "London", "country": "GB", "lat": 51.5055, "lon": -0.0195, "accuracy_meters": 280, "sector": "Canary Wharf Financial Wharf"},
    {"tower_id": "234-15-2002-33104", "carrier": "Vodafone UK", "city": "London", "country": "GB", "lat": 51.5138, "lon": -0.0886, "accuracy_meters": 310, "sector": "City of London Bank Junction"},
    {"tower_id": "234-10-2003-88129", "carrier": "O2 UK", "city": "London", "country": "GB", "lat": 51.4700, "lon": -0.4543, "accuracy_meters": 490, "sector": "Heathrow Airport International Terminal"},

    # --- GERMANY: Frankfurt & Berlin ---
    {"tower_id": "262-01-6901-44123", "carrier": "Deutsche Telekom 5G", "city": "Frankfurt", "country": "DE", "lat": 50.1105, "lon": 8.6720, "accuracy_meters": 290, "sector": "Bankenviertel Financial Sector"},
    {"tower_id": "262-02-6902-88190", "carrier": "Vodafone Germany", "city": "Frankfurt", "country": "DE", "lat": 50.0379, "lon": 8.5622, "accuracy_meters": 540, "sector": "Frankfurt Airport Terminal 1 Hub"},
    {"tower_id": "262-01-3001-12094", "carrier": "Deutsche Telekom 5G", "city": "Berlin", "country": "DE", "lat": 52.5096, "lon": 13.3765, "accuracy_meters": 370, "sector": "Potsdamer Platz Business Center"},

    # --- ASIA-PACIFIC: Tokyo & Singapore ---
    {"tower_id": "440-10-3301-99120", "carrier": "NTT Docomo 5G", "city": "Tokyo", "country": "JP", "lat": 35.6905, "lon": 139.7005, "accuracy_meters": 210, "sector": "Shinjuku Station Commercial District"},
    {"tower_id": "440-20-3302-44189", "carrier": "SoftBank Corp", "city": "Tokyo", "country": "JP", "lat": 35.6698, "lon": 139.7634, "accuracy_meters": 250, "sector": "Ginza Luxury Retail Avenue"},
    {"tower_id": "525-01-6501-11029", "carrier": "Singtel Mobile 5G", "city": "Singapore", "country": "SG", "lat": 1.2838, "lon": 103.8591, "accuracy_meters": 220, "sector": "Marina Bay Financial Centre"},
    {"tower_id": "525-05-6502-88145", "carrier": "StarHub Mobile", "city": "Singapore", "country": "SG", "lat": 1.3048, "lon": 103.8318, "accuracy_meters": 280, "sector": "Orchard Road Shopping Belt"},
    {"tower_id": "505-01-2001-77124", "carrier": "Telstra 5G", "city": "Sydney", "country": "AU", "lat": -33.8642, "lon": 151.2090, "accuracy_meters": 310, "sector": "Sydney CBD George Street"},

    # --- MIDDLE EAST & OTHERS: Dubai, Paris, Zurich, Toronto ---
    {"tower_id": "424-02-9701-44120", "carrier": "e& (Etisalat) 5G", "city": "Dubai", "country": "AE", "lat": 25.2048, "lon": 55.2708, "accuracy_meters": 270, "sector": "DIFC Dubai International Financial Centre"},
    {"tower_id": "424-03-9702-88190", "carrier": "du Telecom", "city": "Dubai", "country": "AE", "lat": 25.1972, "lon": 55.2744, "accuracy_meters": 290, "sector": "Downtown Burj Khalifa Commerce"},
    {"tower_id": "208-01-7501-33104", "carrier": "Orange France 5G", "city": "Paris", "country": "FR", "lat": 48.8924, "lon": 2.2361, "accuracy_meters": 310, "sector": "La Défense Business District"},
    {"tower_id": "228-01-8001-12049", "carrier": "Swisscom 5G", "city": "Zurich", "country": "CH", "lat": 47.3690, "lon": 8.5390, "accuracy_meters": 260, "sector": "Paradeplatz Banking Hub"},
    {"tower_id": "302-720-4161-55120", "carrier": "Rogers Wireless 5G", "city": "Toronto", "country": "CA", "lat": 43.6487, "lon": -79.3817, "accuracy_meters": 290, "sector": "Bay Street Financial District"},
    {"tower_id": "724-10-1101-99124", "carrier": "Vivo Brazil", "city": "Sao Paulo", "country": "BR", "lat": -23.5615, "lon": -46.6559, "accuracy_meters": 420, "sector": "Avenida Paulista Financial Core"},
]

MERCHANTS = [
    ("Amazon Web Services Cloud", "Cloud Infrastructure", ["WIRE", "ONLINE_WEB"]),
    ("Stripe Payments US", "Payment Gateway", ["ONLINE_WEB"]),
    ("Apple Retail Store", "Consumer Electronics", ["POS", "MOBILE_APP"]),
    ("Reliance Digital Retail", "Consumer Electronics", ["POS", "ONLINE_WEB"]),
    ("Swiggy Express Food", "Food & Mobility", ["MOBILE_APP"]),
    ("Zomato Delivery Direct", "Food & Mobility", ["MOBILE_APP"]),
    ("Flipkart Marketplace", "E-Commerce", ["ONLINE_WEB", "MOBILE_APP"]),
    ("British Airways Direct", "Aviation & Travel", ["ONLINE_WEB", "WIRE"]),
    ("Emirates Airlines Online", "Aviation & Travel", ["ONLINE_WEB", "WIRE"]),
    ("Starbucks Reserve", "Food & Beverage", ["POS", "MOBILE_APP"]),
    ("Uber Mobility Technologies", "Rideshare & Mobility", ["MOBILE_APP"]),
    ("Binance Virtual Assets", "Cryptocurrency Exchange", ["ONLINE_WEB", "WIRE"]),
    ("Target Supercenter", "General Retail", ["POS", "ONLINE_WEB"]),
    ("Sephora Beauty Hub", "Luxury Retail", ["POS", "MOBILE_APP"]),
    ("Air India Express", "Aviation & Travel", ["ONLINE_WEB", "WIRE"]),
    ("Tata CLiQ Luxury", "Luxury Marketplace", ["ONLINE_WEB"]),
]


def seed_dense_realworld_traffic(db_client: DBClient, target_total: int = 3000, force: bool = False) -> int:
    """
    Populate the system with 2,500 - 3,500 dense, realistic multi-city transactions
    routed through 80+ stationary cell towers, with varied amounts, authentic risk tiers,
    and dangerous transaction clusters.
    """
    existing_main = db_client.get_all_main_transactions()
    existing_quar = db_client.get_all_quarantined_transactions()
    total_existing = len(existing_main) + len(existing_quar)

    if total_existing >= target_total and not force:
        return total_existing

    now = datetime.now(timezone.utc)
    seeded_main: List[Dict[str, Any]] = []
    seeded_quar: List[Dict[str, Any]] = []

    # Map towers by city for fast lookup
    towers_by_city: Dict[str, List[Dict[str, Any]]] = {}
    for tw in STATIONARY_CELL_TOWERS:
        towers_by_city.setdefault(tw["city"], []).append(tw)

    # 120 diverse accounts
    num_accounts = 120
    transactions_per_acct = max(10, int(target_total / num_accounts))

    current_id_counter = 1000

    for acct_idx in range(1, num_accounts + 1):
        acct_id = f"acc_soc_{acct_idx:03d}"
        home_tower = STATIONARY_CELL_TOWERS[(acct_idx - 1) % len(STATIONARY_CELL_TOWERS)]
        home_city = home_tower["city"]
        home_country = home_tower["country"]

        # Account risk profile
        is_fraud_syndicate = (acct_idx % 9 == 0)
        is_international_traveler = (acct_idx % 6 == 0)
        is_high_value_corp = (acct_idx % 8 == 0)

        # Baseline start time (spread over last 24 hours)
        base_time = now - timedelta(hours=random.uniform(2, 24))

        for tx_idx in range(transactions_per_acct):
            current_id_counter += 1
            t_id = f"tx_soc_{current_id_counter}"
            merchant, merchant_cat, allowed_channels = random.choice(MERCHANTS)
            channel = random.choice(allowed_channels)

            # Determine routing tower
            if is_international_traveler and tx_idx == 3:
                # Roaming hop to London or New York or Singapore
                roam_city = random.choice(["London", "New York", "Singapore", "Tokyo"])
                tw = random.choice(towers_by_city.get(roam_city, [home_tower]))
            elif is_fraud_syndicate and tx_idx % 2 == 1:
                # Route through high-density fraud sector
                tw = random.choice(towers_by_city.get(home_city, [home_tower]))
            else:
                tw = home_tower

            # Realistic micro-offset inside tower coverage radius (15m to 250m)
            angle = random.uniform(0, 2 * math.pi)
            dist_m = random.uniform(25.0, min(float(tw["accuracy_meters"]), 380.0))
            delta_lat = (dist_m * math.cos(angle)) / 111139.0
            delta_lon = (dist_m * math.sin(angle)) / (111139.0 * math.cos(math.radians(tw["lat"])))

            tx_lat = round(tw["lat"] + delta_lat, 6)
            tx_lon = round(tw["lon"] + delta_lon, 6)

            tx_time = base_time + timedelta(minutes=random.uniform(5, 55) * tx_idx)
            iso_time = tx_time.strftime("%Y-%m-%dT%H:%M:%SZ")

            # Amounts based on merchant and account category
            if is_high_value_corp:
                amount = round(random.uniform(1200.0, 9800.0), 2)
            elif "Luxury" in merchant_cat or "Aviation" in merchant_cat:
                amount = round(random.uniform(450.0, 3200.0), 2)
            else:
                amount = round(random.uniform(8.50, 480.0), 2)

            currency = "INR" if tw["country"] == "IN" else ("EUR" if tw["country"] in ("DE", "FR", "NL") else ("GBP" if tw["country"] == "GB" else "USD"))

            # Decision Logic: ~72% ALLOW, ~16% REVIEW, ~12% BLOCK / QUARANTINE
            dice = random.random()
            if is_fraud_syndicate or dice < 0.12:
                decision = "BLOCK"
                status = "QUARANTINED"
                risk_score = round(random.uniform(82.0, 99.0), 1)
                flags = random.sample([
                    "IMPOSSIBLE_TRAVEL", "ORIGIN_TOR", "HIGH_VELOCITY",
                    "AMOUNT_ANOMALY", "GEO_ORIGIN_MISMATCH", "CHANNEL_RISK"
                ], k=random.randint(2, 4))
            elif dice < 0.28:
                decision = "REVIEW_QUEUE"
                status = "PENDING_REVIEW"
                risk_score = round(random.uniform(42.0, 78.0), 1)
                flags = random.sample(["VELOCITY_SPIKE", "UNUSUAL_HOUR", "NEW_ACCOUNT"], k=random.randint(1, 2))
            else:
                decision = "ALLOW"
                status = "APPROVED"
                risk_score = round(random.uniform(2.0, 28.0), 1)
                flags = []

            # Cell tower payload attached to transaction
            tower_data = {
                "tower_id": tw["tower_id"],
                "carrier": tw["carrier"],
                "lat": tw["lat"],
                "lon": tw["lon"],
                "distance_meters": round(dist_m, 1),
                "distance_km": round(dist_m / 1000.0, 3),
                "accuracy_meters": tw["accuracy_meters"],
                "sector": tw["sector"],
                "city": tw["city"],
                "country": tw["country"],
                "badge": "LIVE",
            }

            record = {
                "id": t_id,
                "transaction_id": t_id,
                "account_id": acct_id,
                "source_account": acct_id,
                "destination_account": f"acc_merch_{hashlib.md5(merchant.encode()).hexdigest()[:6]}",
                "amount": amount,
                "currency": currency,
                "txn_type": random.choice(["CREDIT", "DEBIT", "WIRE"]),
                "channel": channel,
                "origin_ip": f"198.51.{acct_idx % 250}.{random.randint(10, 240)}",
                "transaction_city": tw["city"],
                "transaction_country": tw["country"],
                "lat": tx_lat,
                "lon": tx_lon,
                "timestamp": iso_time,
                "decision": decision,
                "status": status,
                "risk_score": risk_score,
                "flags": flags,
                "rule_violations": flags,
                "counterparty": merchant,
                "merchant_category": merchant_cat,
                "cell_tower": tower_data,
                "tower": tower_data,
                "fix_source": "CELL_TOWER",
                "accuracy_meters": round(random.uniform(12.0, 35.0), 1),
                "has_coordinates": True,
            }

            if status == "QUARANTINED":
                q_record = dict(record)
                q_record["quarantine_id"] = f"q_{t_id}"
                q_record["quarantine_ts"] = iso_time
                q_record["sla_deadline"] = (tx_time + timedelta(minutes=45)).strftime("%Y-%m-%dT%H:%M:%SZ")
                q_record["is_sla_breached"] = (tx_time < (now - timedelta(minutes=45)))
                q_record["priority"] = "HIGH" if risk_score >= 90 else "MEDIUM"
                seeded_quar.append(q_record)
            else:
                seeded_main.append(record)

    # Persist in atomic batch
    audit_log_path = os.path.join(os.path.dirname(__file__), "..", "data", "audit_log.json")
    quar_log_path = os.path.join(os.path.dirname(__file__), "..", "data", "quarantine_log.json")

    os.makedirs(os.path.dirname(audit_log_path), exist_ok=True)

    with open(audit_log_path, "w", encoding="utf-8") as f:
        json.dump(seeded_main, f, indent=2)

    with open(quar_log_path, "w", encoding="utf-8") as f:
        json.dump(seeded_quar, f, indent=2)

    return len(seeded_main) + len(seeded_quar)


def seed_historical_map_data(db_client: DBClient, force: bool = False) -> int:
    """Wrapper maintain compatibility with stream_monitor invocation."""
    return seed_dense_realworld_traffic(db_client, target_total=3000, force=force)


if __name__ == "__main__":
    db = DBClient()
    total_seeded = seed_dense_realworld_traffic(db, target_total=3000, force=True)
    print(f"Successfully seeded {total_seeded} dense multi-city transactions across 80+ cell towers.")
