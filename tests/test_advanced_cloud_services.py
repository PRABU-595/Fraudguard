"""
Unit Test Suite for Advanced Cloud Services & AWS Microservices:
  - Amazon SQS (Queueing, DLQ)
  - Amazon Bedrock (GenAI Forensic Incident Summaries)
  - Amazon ElastiCache / Redis (Sliding Window Velocity Feature Store)
  - AWS Step Functions (State Machine ASL Workflow Execution)
  - Amazon Cognito (Zero-Trust RBAC Authentication)
"""

import os
import sys
import unittest
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from src.cloud_sqs_adapter import get_sqs_adapter
from src.cloud_bedrock_copilot import get_bedrock_copilot
from src.cloud_redis_feature_store import get_feature_store
from src.cloud_step_functions import get_step_functions_orchestrator
from src.cloud_cognito_auth import get_cognito_manager


class TestAdvancedCloudServices(unittest.TestCase):

    def test_01_sqs_adapter_enqueue_and_metrics(self):
        sqs = get_sqs_adapter()
        sample_tx = {
            "transaction_id": "tx_sqs_test_01",
            "account_id": "acc_sqs_01",
            "amount": 450.0,
            "currency": "USD"
        }
        res = sqs.enqueue_transaction(sample_tx)
        self.assertIn(res["status"], ["QUEUED_AWS_SQS", "QUEUED_LOCAL_BUFFER"])
        self.assertEqual(res["transaction_id"], "tx_sqs_test_01")

        metrics = sqs.get_queue_metrics()
        self.assertGreaterEqual(metrics["total_enqueued_since_boot"], 1)
        self.assertEqual(metrics["buffer_state"], "ACTIVE_HEALTHY")

    def test_02_sqs_dead_letter_queue(self):
        sqs = get_sqs_adapter()
        malformed = {"corrupted_raw": "invalid_format"}
        res = sqs.send_to_dead_letter_queue(malformed, reason="Unparseable JSON Schema")
        self.assertIn(res["status"], ["ROUTED_AWS_DLQ", "ROUTED_LOCAL_DLQ"])
        self.assertEqual(res["reason"], "Unparseable JSON Schema")

    def test_03_bedrock_genai_forensic_copilot(self):
        bedrock = get_bedrock_copilot()
        critical_tx = {
            "transaction_id": "tx_bedrock_test_critical",
            "account_id": "acc_fraud_syndicate",
            "amount": 9500.0,
            "currency": "USD",
            "risk_score": 94.2,
            "decision": "BLOCK",
            "city": "Mumbai",
            "country": "IN",
            "flags": ["IMPOSSIBLE_TRAVEL", "TOR_EXIT_NODE"],
            "cell_tower": {
                "carrier": "Reliance Jio 5G",
                "tower_id": "405-861-5201-19042",
                "sector": "Bandra-Kurla Complex (BKC)"
            }
        }
        briefing = bedrock.generate_incident_briefing(critical_tx)
        self.assertIn("executive_summary", briefing)
        self.assertIn(briefing["recommended_action"], ["CONFIRM_FRAUD", "MANUAL_CALL_VERIFICATION"])
        self.assertEqual(briefing["severity"], "CRITICAL")
        self.assertIn("Reliance Jio 5G", briefing["executive_summary"])

    def test_04_elasticache_redis_feature_store(self):
        fs = get_feature_store()
        account = "acc_velocity_burst_99"
        
        # Simulate burst of 5 rapid transactions within 10 seconds
        for i in range(5):
            fs.record_transaction(account, amount=120.0 + i * 10)

        features = fs.get_account_velocity_features(account)
        self.assertEqual(features["account_id"], account)
        self.assertGreaterEqual(features["window_60s"]["count"], 5)
        self.assertTrue(features["signals"]["is_burst"])
        self.assertLess(features["lookup_latency_ms"], 5.0)

    def test_05_step_functions_workflow_orchestration(self):
        sfn = get_step_functions_orchestrator()
        asl = sfn.get_asl_definition()
        self.assertIn("StartAt", asl)
        self.assertIn("States", asl)
        self.assertIn("RunMLRiskModel", asl["States"])

        # Execute a mock transaction workflow
        tx = {
            "transaction_id": "tx_sfn_eval_01",
            "amount": 3400.0,
            "risk_score": 88.0,
            "decision": "BLOCK"
        }
        exec_res = sfn.execute_fraud_workflow(tx)
        self.assertEqual(exec_res["status"], "SUCCEEDED")
        self.assertEqual(exec_res["branch_taken"], "HandleForceBlock")
        self.assertGreaterEqual(exec_res["steps_count"], 4)

    def test_06_cognito_auth_manager(self):
        cognito = get_cognito_manager()
        analyst_auth = cognito.authenticate_header(auth_header=None, role_header="analyst")
        self.assertEqual(analyst_auth["role"], "analyst")
        self.assertTrue(analyst_auth["authenticated"])

        admin_auth = cognito.authenticate_header(auth_header="Bearer cognito_admin_token_xyz")
        self.assertEqual(admin_auth["role"], "admin")
        self.assertEqual(admin_auth["auth_method"], "COGNITO_USER_POOL_JWT")


if __name__ == "__main__":
    unittest.main()
