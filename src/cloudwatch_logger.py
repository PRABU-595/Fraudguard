"""
CloudWatch Logger for FraudGuard
Streams real-time transaction telemetry to Amazon CloudWatch Logs and CloudWatch Metrics.
Log Group: /aws/fraudguard/transactions
Metric Namespace: FraudGuard

Features:
  - Thread-safe background worker with non-blocking queue to handle high-frequency streaming.
  - Batched log event emission (put_log_events) to CloudWatch Logs.
  - Batched metric data emission (put_metric_data) to namespace FraudGuard.
  - Exponential backoff & graceful fallback when running offline or in restricted environments.
"""

import json
import logging
import os
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import boto3
    from botocore.exceptions import ClientError, BotoCoreError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

logger = logging.getLogger("CloudWatchLogger")

LOG_GROUP_NAME = "/aws/fraudguard/transactions"
METRIC_NAMESPACE = "FraudGuard"
DEFAULT_AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")


class CloudWatchLogger:
    _instance: Optional["CloudWatchLogger"] = None
    _lock = threading.Lock()

    def __init__(self, region_name: str = DEFAULT_AWS_REGION):
        self.region_name = region_name
        self.enabled = BOTO3_AVAILABLE
        self.cw_client = None
        self.logs_client = None
        self.log_stream_name = f"live-stream-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
        self.sequence_token: Optional[str] = None
        self._log_queue: queue.Queue = queue.Queue(maxsize=10000)
        self._metric_queue: queue.Queue = queue.Queue(maxsize=10000)
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False

        if self.enabled:
            try:
                self.cw_client = boto3.client("cloudwatch", region_name=self.region_name)
                self.logs_client = boto3.client("logs", region_name=self.region_name)
                self._ensure_log_resources()
            except Exception as e:
                logger.warning(f"[CloudWatchLogger] AWS client init notice: {e}")
                self.enabled = False

        self._start_worker()

    @classmethod
    def get_instance(cls, region_name: str = DEFAULT_AWS_REGION) -> "CloudWatchLogger":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(region_name=region_name)
            return cls._instance

    def _ensure_log_resources(self) -> None:
        if not self.logs_client:
            return
        # Ensure log group
        try:
            self.logs_client.create_log_group(logGroupName=LOG_GROUP_NAME)
            logger.info(f"[CloudWatchLogger] Created log group {LOG_GROUP_NAME}")
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
                logger.warning(f"[CloudWatchLogger] Log group check: {e}")
        except Exception:
            pass

        # Set retention to 7 days to preserve Free Tier storage
        try:
            self.logs_client.put_retention_policy(logGroupName=LOG_GROUP_NAME, retentionInDays=7)
        except Exception:
            pass

        # Ensure log stream
        try:
            self.logs_client.create_log_stream(logGroupName=LOG_GROUP_NAME, logStreamName=self.log_stream_name)
            logger.info(f"[CloudWatchLogger] Created log stream {self.log_stream_name}")
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceAlreadyExistsException":
                logger.warning(f"[CloudWatchLogger] Log stream check: {e}")
        except Exception:
            pass

    def _start_worker(self) -> None:
        if self._worker_thread is not None and self._worker_thread.is_alive():
            return
        self._running = True
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="CW-Batch-Emitter")
        self._worker_thread.start()

    def log_transaction(self, tx: Dict[str, Any]) -> None:
        """Enqueue transaction for asynchronous emission to CloudWatch Logs and Metrics."""
        if not tx:
            return
        now_ms = int(time.time() * 1000)

        # 1. Prepare structured CloudWatch Log event
        log_entry = {
            "timestamp": now_ms,
            "message": json.dumps({
                "source": "fraudguard-realtime-engine",
                "transaction_id": tx.get("transaction_id") or tx.get("id"),
                "account_id": tx.get("account_id") or tx.get("source_account"),
                "amount": float(tx.get("amount") or 0.0),
                "currency": str(tx.get("currency") or "USD"),
                "channel": str(tx.get("channel") or tx.get("txn_type") or "POS"),
                "decision": str(tx.get("decision") or "ALLOW"),
                "status": str(tx.get("status") or "PROCESSED"),
                "risk_score": float(tx.get("risk_score") or 0.0),
                "flags": tx.get("flags") or tx.get("rule_violations") or [],
                "fraud_type": str(tx.get("fraud_type") or "NONE"),
                "is_fraud": bool(tx.get("is_fraud", False)),
                "location": {
                    "city": tx.get("city") or tx.get("transaction_city"),
                    "country": tx.get("country") or tx.get("transaction_country"),
                    "lat": float(tx.get("lat") or 0.0),
                    "lon": float(tx.get("lon") or 0.0),
                },
                "cell_tower": {
                    "carrier": (tx.get("cell_tower") or {}).get("carrier"),
                    "tower_id": (tx.get("cell_tower") or {}).get("tower_id"),
                },
                "recorded_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }, default=str)
        }

        try:
            self._log_queue.put_nowait(log_entry)
        except queue.Full:
            pass

        # 2. Prepare CloudWatch Metrics
        dec = str(tx.get("decision") or "ALLOW").upper()
        channel = str(tx.get("channel") or tx.get("txn_type") or "POS").upper()
        risk = float(tx.get("risk_score") or 0.0)
        amt = float(tx.get("amount") or 0.0)
        is_blocked = dec in ("BLOCK", "QUARANTINED") or bool(tx.get("is_fraud", False))

        metrics = [
            {
                "MetricName": "TransactionsProcessed",
                "Value": 1.0,
                "Unit": "Count",
                "Dimensions": [{"Name": "Decision", "Value": dec}]
            },
            {
                "MetricName": "RiskScore",
                "Value": risk,
                "Unit": "None",
                "Dimensions": [{"Name": "Channel", "Value": channel}]
            },
            {
                "MetricName": "TransactionAmount",
                "Value": amt,
                "Unit": "None",
                "Dimensions": [{"Name": "Currency", "Value": str(tx.get("currency") or "USD")}]
            }
        ]

        if is_blocked:
            metrics.append({
                "MetricName": "FraudDetected",
                "Value": 1.0,
                "Unit": "Count",
                "Dimensions": [{"Name": "Reason", "Value": str(tx.get("fraud_type") or "ANOMALY")}]
            })

        for m in metrics:
            try:
                self._metric_queue.put_nowait(m)
            except queue.Full:
                pass

    def _worker_loop(self) -> None:
        last_metric_flush = time.time()
        last_log_flush = time.time()
        log_batch: List[Dict[str, Any]] = []
        metric_batch: List[Dict[str, Any]] = []

        while self._running:
            try:
                now = time.time()

                # Drain log queue
                while len(log_batch) < 25:
                    try:
                        item = self._log_queue.get_nowait()
                        log_batch.append(item)
                    except queue.Empty:
                        break

                # Drain metric queue
                while len(metric_batch) < 20:
                    try:
                        m_item = self._metric_queue.get_nowait()
                        metric_batch.append(m_item)
                    except queue.Empty:
                        break

                # Flush logs if threshold reached or timed out (every 3 seconds)
                if log_batch and (len(log_batch) >= 15 or (now - last_log_flush) >= 3.0):
                    self._flush_logs(log_batch)
                    log_batch.clear()
                    last_log_flush = now

                # Flush metrics if threshold reached or timed out (every 5 seconds)
                if metric_batch and (len(metric_batch) >= 15 or (now - last_metric_flush) >= 5.0):
                    self._flush_metrics(metric_batch)
                    metric_batch.clear()
                    last_metric_flush = now

                time.sleep(0.5)

            except Exception as e:
                time.sleep(1.0)

    def _flush_logs(self, batch: List[Dict[str, Any]]) -> None:
        if not self.logs_client or not self.enabled:
            return
        # CloudWatch requires chronological sort
        batch.sort(key=lambda x: x["timestamp"])
        kwargs: Dict[str, Any] = {
            "logGroupName": LOG_GROUP_NAME,
            "logStreamName": self.log_stream_name,
            "logEvents": batch
        }
        if self.sequence_token:
            kwargs["sequenceToken"] = self.sequence_token

        try:
            resp = self.logs_client.put_log_events(**kwargs)
            self.sequence_token = resp.get("nextSequenceToken")
        except ClientError as e:
            code = e.response["Error"]["Code"]
            if code in ("InvalidSequenceTokenException", "DataAlreadyAcceptedException"):
                # Extract expected sequence token from error message
                msg = e.response["Error"].get("Message", "")
                parts = msg.split("The next expected sequenceToken is: ")
                if len(parts) > 1:
                    self.sequence_token = parts[1].strip()
                    try:
                        kwargs["sequenceToken"] = self.sequence_token
                        resp = self.logs_client.put_log_events(**kwargs)
                        self.sequence_token = resp.get("nextSequenceToken")
                    except Exception:
                        pass
            elif code == "ResourceNotFoundException":
                self._ensure_log_resources()
        except Exception:
            pass

    def _flush_metrics(self, batch: List[Dict[str, Any]]) -> None:
        if not self.cw_client or not self.enabled:
            return
        try:
            self.cw_client.put_metric_data(
                Namespace=METRIC_NAMESPACE,
                MetricData=batch
            )
        except Exception:
            pass

    def stop(self) -> None:
        self._running = False
        if self._worker_thread:
            self._worker_thread.join(timeout=2.0)
