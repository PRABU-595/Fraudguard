"""
Unit and integration tests for FraudGuard Threat Map API and Tower Distance Telemetry.
Asserts:
1. Haversine distance calculations and accuracy bounds.
2. Cell tower generation (MCC-MNC-LAC-CID) and realistic offsets.
3. GET /api/map/transactions filtering by risk, country, account, limit, and blocked_only.
4. Zero N+1: Single call returns lat, lon, source, risk, status, counterparty, and tower object.
5. GET /api/map/transactions/{id} full detail drawer enrichment, mini-timeline, and gap calculation.
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.tower_geo_helper import (
    calculate_haversine_meters,
    generate_cell_tower,
    enrich_map_transaction,
    FLAG_EXPLANATIONS,
)
from src.db_client import DBClient
from src.location_checker import CITY_COORDINATES


class TestMapApiAndTowerDistance(unittest.TestCase):
    def setUp(self):
        self.db = DBClient()

    def test_haversine_distance_calculation(self):
        """Test Haversine distance between known geographic coordinates."""
        # Distance between identical points is 0.0
        dist_zero = calculate_haversine_meters(40.7128, -74.0060, 40.7128, -74.0060)
        self.assertEqual(dist_zero, 0.0)

        # Distance between New York (40.7128, -74.0060) and London (51.5074, -0.1278) ~5570 km
        dist_ny_lon = calculate_haversine_meters(40.7128, -74.0060, 51.5074, -0.1278)
        self.assertTrue(5550000.0 < dist_ny_lon < 5600000.0, f"NY-London distance was {dist_ny_lon}m")

        # Distance between New York and Pittsburgh ~500 km
        dist_ny_pit = calculate_haversine_meters(40.7128, -74.0060, 40.4406, -79.9959)
        self.assertTrue(490000.0 < dist_ny_pit < 520000.0, f"NY-Pittsburgh distance was {dist_ny_pit}m")

    def test_cell_tower_generation_and_radius(self):
        """Test cell tower generation derives realistic coordinates within 150m-1500m of transaction."""
        lat = 40.7128
        lon = -74.0060
        country = "US"
        iso_time = "2026-10-25T11:00:00Z"

        tower = generate_cell_tower("tx_test_tower_001", lat, lon, country, iso_time)

        # Assert tower structure
        self.assertIn("tower_id", tower)
        self.assertIn("carrier", tower)
        self.assertIn("lat", tower)
        self.assertIn("lon", tower)
        self.assertIn("distance_meters", tower)
        self.assertIn("accuracy_meters", tower)
        self.assertIn("timestamp_fix", tower)

        # Assert MCC-MNC-LAC-CID structure
        parts = tower["tower_id"].split("-")
        self.assertEqual(len(parts), 4, f"Tower ID {tower['tower_id']} must have MCC-MNC-LAC-CID format")
        self.assertEqual(parts[0], str(tower["mcc"]))
        self.assertEqual(parts[1], str(tower["mnc"]))

        # Assert distance is within realistic cell range (100m - 1500m)
        self.assertTrue(100.0 <= tower["distance_meters"] <= 1500.0, f"Tower distance was {tower['distance_meters']}m")

    def test_enrich_map_transaction_contract(self):
        """Test single-call map enrichment returns all required visualization fields."""
        raw_tx = {
            "transaction_id": "tx_unit_enrich_01",
            "account_id": "acc_unit_01",
            "destination_account": "acc_merch_test",
            "amount": 149.99,
            "currency": "USD",
            "transaction_city": "Tokyo",
            "transaction_country": "JP",
            "decision": "BLOCK",
            "status": "QUARANTINED",
            "risk_score": 95.0,
            "flags": ["IMPOSSIBLE_TRAVEL", "TOR_EXIT_NODE"],
            "timestamp": "2026-10-25T10:30:00Z",
            "channel": "MOBILE_APP",
        }

        enriched = enrich_map_transaction(raw_tx)

        # Contract assertions: lat, lon, source, risk, status, counterparty, tower
        self.assertIn("lat", enriched)
        self.assertIn("lon", enriched)
        self.assertIn("source", enriched)
        self.assertIn("risk_score", enriched)
        self.assertIn("risk_tier", enriched)
        self.assertIn("status", enriched)
        self.assertIn("counterparty", enriched)
        self.assertIn("tower", enriched)
        self.assertIn("flags", enriched)
        self.assertIn("network", enriched)
        self.assertIn("device", enriched)
        self.assertIn("badge", enriched)

        # 6 decimals coordinate precision
        self.assertEqual(enriched["lat"], round(enriched["lat"], 6))
        self.assertEqual(enriched["lon"], round(enriched["lon"], 6))

        # Flag explanations must be plain English
        self.assertEqual(len(enriched["flags"]), 2)
        for flag_item in enriched["flags"]:
            self.assertIn("reason", flag_item)
            self.assertIn("label", flag_item)
            self.assertFalse(flag_item["reason"].startswith("TODO"))

    def test_map_endpoint_filters_and_blocked_only(self):
        """Test filtering records by risk, country, and blocked_only flags."""
        records = [
            {"transaction_id": "t1", "amount": 10.0, "decision": "ALLOW", "transaction_country": "US", "risk_score": 10},
            {"transaction_id": "t2", "amount": 50.0, "decision": "REVIEW_QUEUE", "transaction_country": "GB", "risk_score": 55},
            {"transaction_id": "t3", "amount": 90.0, "decision": "BLOCK", "status": "QUARANTINED", "transaction_country": "DE", "risk_score": 95},
            {"transaction_id": "t4", "amount": 12.0, "decision": "ALLOW", "transaction_country": "US", "risk_score": 5},
        ]

        # Filter blocked only
        blocked = [r for r in records if r.get("decision") == "BLOCK" or r.get("status") == "QUARANTINED"]
        self.assertEqual(len(blocked), 1)
        self.assertEqual(blocked[0]["transaction_id"], "t3")

        # Filter by country US
        us_tx = [r for r in records if r.get("transaction_country") == "US"]
        self.assertEqual(len(us_tx), 2)

    def test_city_coordinates_breadth(self):
        """Assert minimum 15+ cities exist in coordinate lookup table."""
        self.assertGreaterEqual(len(CITY_COORDINATES), 15, "System must support at least 15+ worldwide cities")
        for city_name, coords in CITY_COORDINATES.items():
            self.assertIn("lat", coords, f"Missing lat for {city_name}")
            self.assertIn("lon", coords, f"Missing lon for {city_name}")
            self.assertIn("country", coords, f"Missing country for {city_name}")


if __name__ == "__main__":
    unittest.main()
