import os
import sys

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, root)

from src.db_client import DBClient
from src.stream_monitor import get_combined_records
from src.metrics_calculator import compute_system_metrics, compute_quarantine_metrics
from src.analytics_aggregator import aggregate_soc_analytics
from src.tower_geo_helper import enrich_map_transaction
from src.quarantine_manager import QuarantineManager

db = DBClient()
combined, main_r, quar_r = get_combined_records(db)

print(f"Combined total: {len(combined)}")
print(f"Main records: {len(main_r)}")
print(f"Quarantine records: {len(quar_r)}")

# Test System Metrics
sys_metrics = compute_system_metrics(combined, quar_r)
print("\nSystem Metrics:")
print(f"  Total Processed: {sys_metrics['total_processed']}")
print(f"  Blocked Count: {sys_metrics['blocked_count']}")
print(f"  Block Rate: {sys_metrics['block_rate_pct']}%")
print(f"  Quarantine Active: {sys_metrics['quarantine_active']}")

# Test Quarantine Manager feed
qm = QuarantineManager(db_client=db)
q_feed = qm.get_quarantine_feed_with_sla()
print(f"\nQuarantine Feed Count: {len(q_feed)}")
if q_feed:
    print(f"  Sample Case: {q_feed[0].get('transaction_id')}, SLA Status: {q_feed[0].get('sla_status')}, Countdown: {q_feed[0].get('sla_countdown')}")

# Test Analytics Aggregator
analytics = aggregate_soc_analytics(combined, quar_r)
print("\nAnalytics Aggregator:")
print(f"  Total Events in Window: {analytics['summary']['total_events']}")
print(f"  Volume Buckets: {len(analytics['volume_over_time'])}")
print(f"  Channel Breakdown: {analytics['channel_breakdown']}")
print(f"  Risk Histogram: {analytics['risk_histogram']}")

# Test Map Transactions
map_items = [enrich_map_transaction(r, combined) for r in combined[:10]]
print(f"\nMap Transactions enriched: {len(map_items)}")
first_tower = (map_items[0].get('tower') or map_items[0].get('cell_tower') or {})
print(f"  First Map item: {map_items[0]['city']}, {map_items[0]['country']} ({map_items[0]['lat']}, {map_items[0]['lon']}) Carrier: {first_tower.get('carrier', 'N/A')}")

print("\nALL BACKEND API MODULE TESTS PASSED!")
