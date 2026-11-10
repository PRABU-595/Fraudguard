import boto3
import time
from datetime import datetime, timezone

region = "us-east-1"
cw_client = boto3.client("cloudwatch", region_name=region)
logs_client = boto3.client("logs", region_name=region)

print("1. Testing CloudWatch Metrics PutMetricData...")
try:
    cw_client.put_metric_data(
        Namespace="FraudGuard",
        MetricData=[
            {
                "MetricName": "TransactionsIngested",
                "Value": 1.0,
                "Unit": "Count",
                "Dimensions": [
                    {"Name": "Environment", "Value": "Production"},
                    {"Name": "Decision", "Value": "ALLOW"}
                ]
            }
        ]
    )
    print("   SUCCESS: CloudWatch metric emitted!")
except Exception as e:
    print(f"   FAILED: {e}")

print("2. Testing CloudWatch Logs CreateLogGroup / PutLogEvents...")
log_group = "/aws/fraudguard/transactions"
log_stream = f"stream_{datetime.now(timezone.utc).strftime('%Y-%m-%d_%H')}"

try:
    try:
        logs_client.create_log_group(logGroupName=log_group)
        print(f"   Created log group: {log_group}")
    except logs_client.exceptions.ResourceAlreadyExistsException:
        print(f"   Log group already exists: {log_group}")

    try:
        logs_client.create_log_stream(logGroupName=log_group, logStreamName=log_stream)
        print(f"   Created log stream: {log_stream}")
    except logs_client.exceptions.ResourceAlreadyExistsException:
        print(f"   Log stream already exists: {log_stream}")

    now_ms = int(time.time() * 1000)
    logs_client.put_log_events(
        logGroupName=log_group,
        logStreamName=log_stream,
        logEvents=[
            {
                "timestamp": now_ms,
                "message": '{"event": "TRANSACTION_INGEST", "status": "TEST_SUCCESS", "note": "FraudGuard CloudWatch live logger"}'
            }
        ]
    )
    print("   SUCCESS: CloudWatch log event dispatched!")
except Exception as e:
    print(f"   FAILED: {e}")
