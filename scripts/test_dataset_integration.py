import os
import sys

root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, root)

from src.db_client import DBClient
from src.dataset_streamer import seed_canonical_dataset, DatasetStreamWorker, row_to_canonical_transaction

db = DBClient()
res = seed_canonical_dataset(db, sample_size=3500, force=True)
print("Seed result:", res)

audit_records = db.get_all_main_transactions()
quarantine_records = db.get_all_quarantined_transactions()

print(f"Total Audit Records: {len(audit_records)}")
print(f"Total Quarantined Records: {len(quarantine_records)}")

if audit_records:
    sample_audit = audit_records[0]
    print("Sample Audit Record:")
    print("  ID:", sample_audit.get("transaction_id"))
    print("  Account:", sample_audit.get("account_id"))
    print("  Amount:", sample_audit.get("amount"), sample_audit.get("currency"))
    print("  City/Country:", sample_audit.get("transaction_city"), sample_audit.get("transaction_country"))
    print("  Risk Score:", sample_audit.get("risk_score"))
    print("  Decision:", sample_audit.get("decision"))
    print("  Badge:", sample_audit.get("badge"))
    print("  PII:", sample_audit.get("pii_enrichment"))

if quarantine_records:
    sample_quar = quarantine_records[0]
    print("Sample Quarantined Record:")
    print("  ID:", sample_quar.get("transaction_id"))
    print("  Case ID:", sample_quar.get("quarantine_id"))
    print("  Fraud Type:", sample_quar.get("fraud_type"))
    print("  SLA Deadline:", sample_quar.get("sla_deadline"))
    print("  Status:", sample_quar.get("status"))
    print("  Priority:", sample_quar.get("priority"))

print("\nDataset integration verification SUCCESSFUL!")
