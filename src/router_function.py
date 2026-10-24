"""
Module 5: FraudGuard Decision Orchestration & Routing Engine
Integrates:
  - Base RuleEngine (Module 2)
  - ML Risk Model (Module 4)
  - Feature 1: OriginTracer (MaxMind, Tor exit list, Datacenter ASN)
  - Feature 2: TracebackAnalyzer (1h/24h/7d velocity, z-score, relationship graph)
  - Feature 3: TimeSpanAnalyzer (24h heat-strip, burst, dormant reactivation)
  - Feature 4: LocationChecker (Carrier/GPS/IP priority resolver, impossible travel)
  - Feature 5: QuarantineManager (SLA timers, multi-action ledger, RBAC audit)
  - Feature 7: PIIEnricher (Standardized provider adapters, PII masking)
"""

import os
import json
import math
import time
import logging
from typing import Any, Dict, List, Optional

try:
    import joblib
except ImportError:
    joblib = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    from src.rule_engine import RuleEngine
    from src.db_client import DBClient
    from src.origin_tracer import OriginTracer
    from src.traceback_analyzer import TracebackAnalyzer
    from src.time_analyzer import TimeSpanAnalyzer
    from src.location_checker import LocationChecker
    from src.quarantine_manager import QuarantineManager
    from src.pii_enricher import PIIEnricher
except ImportError:
    from rule_engine import RuleEngine
    from db_client import DBClient
    from origin_tracer import OriginTracer
    from traceback_analyzer import TracebackAnalyzer
    from time_analyzer import TimeSpanAnalyzer
    from location_checker import LocationChecker
    from quarantine_manager import QuarantineManager
    from pii_enricher import PIIEnricher

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, "config_rules.json")

logger = logging.getLogger("fraudguard.router")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)

RULE_POINT_VALUES: Dict[str, int] = {
    "AMOUNT_ANOMALY": 40,
    "CHANNEL_RISK": 40,
    "HIGH_VELOCITY": 80,
    "ORIGIN_TOR": 20,
    "TOR_EXIT_NODE": 25,
    "ORIGIN_VPN": 20,
    "ORIGIN_PROXY": 15,
    "DATACENTER_IP": 15,
    "GEO_ORIGIN_MISMATCH": 10,
    "TIMEZONE_MISMATCH": 10,
    "VELOCITY_SPIKE": 25,
    "AMOUNT_SPIKE": 20,
    "AMOUNT_ZSCORE_ANOMALY": 15,
    "UNUSUAL_HOUR": 15,
    "RAPID_SUCCESSION": 20,
    "DORMANT_REACTIVATION": 15,
    "BURST_ACTIVITY": 20,
    "IMPOSSIBLE_TRAVEL": 40,
    "INTERNATIONAL_TRANSACTION": 10,
    "LOCATION_MISMATCH": 15,
    "NEW_ACCOUNT": 10,
    "UNVERIFIED_CONTACT": 5,
    "SIM_SWAP_DETECTED": 25,
    "NEW_DEVICE_DETECTED": 10,
    "NEW_BENEFICIARY_DETECTED": 10
}


def load_router_config() -> Dict[str, Any]:
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "thresholds": {"block_score": 80, "review_score": 40, "force_block_min_score": 85},
        "force_block_rules": ["TOR_EXIT_NODE", "ORIGIN_TOR", "IMPOSSIBLE_TRAVEL"]
    }


class FraudRouter:
    def __init__(
        self,
        model_path: str = "fraud_model.pkl",
        db_client: Optional[Any] = None,
        in_memory_db: bool = False
    ) -> None:
        self.config = load_router_config()
        self.ml_model = self._load_ml_model(model_path)
        self.rule_engine = RuleEngine()
        self.db = db_client if db_client is not None else DBClient(in_memory_only=in_memory_db)
        self.origin_tracer = OriginTracer()
        self.traceback_analyzer = TracebackAnalyzer(db_client=self.db)
        self.time_analyzer = TimeSpanAnalyzer()
        self.location_checker = LocationChecker()
        self.quarantine_manager = QuarantineManager(db_client=self.db)
        self.pii_enricher = PIIEnricher()

    @staticmethod
    def _load_ml_model(model_path: Optional[str]) -> Optional[Any]:
        if joblib is None or not model_path:
            return None
        candidate_paths = [
            model_path,
            os.path.join(SCRIPT_DIR, os.path.basename(model_path)),
            os.path.join(SCRIPT_DIR, "..", os.path.basename(model_path)),
            os.path.join("/var/task", os.path.basename(model_path)),
        ]
        for path in candidate_paths:
            if path and os.path.exists(path):
                try:
                    return joblib.load(path)
                except Exception:
                    continue
        return None

    def _get_ml_score(self, tx: Dict[str, Any]) -> float:
        if not self.ml_model or pd is None:
            return 0.0
        try:
            df = pd.DataFrame([tx])
            drop_cols = [
                "transaction_id", "source_account", "destination_account",
                "timestamp", "is_suspicious", "origin", "traceback",
                "time_analysis", "location_check", "pii_enrichment",
                "mock_pii_override", "account_typical_hours", "attributes", "score_breakdown"
            ]
            df_model = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")
            if "amount" not in df_model.columns:
                df_model["amount"] = 0.0
            if "simulation_step" not in df_model.columns:
                df_model["simulation_step"] = 0
            if "txn_type" not in df_model.columns:
                df_model["txn_type"] = "UNKNOWN"

            probs = self.ml_model.predict_proba(df_model)
            if probs.shape[1] > 1:
                val = float(probs[0][1])
                return round(val, 4) if math.isfinite(val) else 0.0
        except Exception:
            pass
        return 0.0

    def route_transaction(
        self,
        tx: Dict[str, Any],
        event_headers: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        start_time = time.perf_counter()

        if not isinstance(tx, dict):
            raise ValueError("Transaction payload must be a JSON object.")

        tx_id = tx.get("transaction_id")
        if not tx_id or (isinstance(tx_id, str) and not tx_id.strip()):
            raise ValueError("Missing required field: transaction_id")

        account_id = (
            tx.get("account_id")
            or tx.get("source_account")
            or tx.get("user_id")
            or "acc_unknown"
        )

        raw_amount = tx.get("amount", 0.0)
        if isinstance(raw_amount, bool):
            raise ValueError("Transaction amount must be a finite non-negative number.")
        if raw_amount is None:
            amount = 0.0
        else:
            try:
                amount = float(raw_amount)
            except (ValueError, TypeError) as exc:
                raise ValueError(f"Invalid transaction amount: {raw_amount}") from exc

        if not math.isfinite(amount) or amount < 0.0:
            raise ValueError("Transaction amount must be a finite non-negative number.")

        tx_norm = dict(tx)
        tx_norm["amount"] = amount
        tx_norm["account_id"] = str(account_id)
        if not tx_norm.get("source_account"):
            tx_norm["source_account"] = str(account_id)

        # 1. Base Rule Engine (Module 2)
        rule_result = self.rule_engine.process_transaction(tx_norm)
        base_rule_score = float(rule_result["rule_score"])
        base_rule_points = int(round(base_rule_score * 100))
        all_flags: List[str] = list(rule_result["triggered_rules"])

        # 2. PII Lookup for preliminary profile
        prelim_origin = self.origin_tracer.lookup_ip(
            self.origin_tracer.extract_ip(tx_norm, event_headers=event_headers),
            pre_populated_origin=tx_norm.get("origin") if isinstance(tx_norm.get("origin"), dict) else None
        )
        f7_res = self.pii_enricher.evaluate(tx_norm, origin=prelim_origin)
        pii_profile = f7_res["profile"]
        reg_country = (
            tx_norm.get("registered_country")
            or tx_norm.get("account_registered_country")
            or (pii_profile or {}).get("registered_country")
        )

        # 3. Origin & Source Tracing
        f1_res = self.origin_tracer.evaluate(
            tx_norm,
            event_headers=event_headers,
            registered_country=reg_country
        )
        origin_block = f1_res["origin"]

        # Finalize PII with finalized origin block
        f7_res = self.pii_enricher.evaluate(tx_norm, origin=origin_block)
        pii_block = f7_res["pii_enrichment"]

        # 4. Traceback Audit
        f2_prelim = self.traceback_analyzer.evaluate(tx_norm, current_risk_score=None)
        prev_record = f2_prelim["previous_record"]
        prior_history = f2_prelim["history_last_5"]
        full_history = f2_prelim.get("history_full", [])

        # 5. Time-Span Analysis
        f3_res = self.time_analyzer.evaluate(
            tx_norm,
            origin=origin_block,
            prior_records=prior_history,
            previous_ts_str=f2_prelim["traceback"]["previous_transaction_ts"]
        )
        time_block = f3_res["time_analysis"]

        # 6. Location & Travel Check
        f4_res = self.location_checker.evaluate(
            tx_norm,
            origin=origin_block,
            previous_record=prev_record,
            time_since_last_txn_mins=time_block["time_since_last_txn_mins"],
            pii_profile=pii_profile
        )
        location_block = f4_res["location_check"]

        # 7. Device / Beneficiary / Timezone Attributes Check
        device_fp = pii_block.get("device_fingerprint") or tx_norm.get("device_fingerprint") or "fp_default"
        prior_devices = {
            (r.get("pii_enrichment") or {}).get("device_fingerprint") or r.get("device_fingerprint")
            for r in full_history if r.get("device_fingerprint") or (r.get("pii_enrichment") or {}).get("device_fingerprint")
        }
        is_new_device = bool(full_history and device_fp not in prior_devices)

        dest_acct = tx_norm.get("destination_account") or tx_norm.get("merchant") or "acc_merchant"
        prior_beneficiaries = {
            r.get("destination_account") or r.get("merchant")
            for r in full_history if r.get("destination_account") or r.get("merchant")
        }
        is_new_beneficiary = bool(full_history and dest_acct not in prior_beneficiaries)

        origin_tz = origin_block.get("timezone", "UTC")
        client_tz = tx_norm.get("client_timezone") or tx_norm.get("timezone") or origin_tz
        tz_mismatch = bool(client_tz != origin_tz and client_tz != "UTC")

        attr_flags: List[str] = []
        attr_points = 0
        if is_new_device:
            attr_flags.append("NEW_DEVICE_DETECTED")
            attr_points += 10
        if is_new_beneficiary:
            attr_flags.append("NEW_BENEFICIARY_DETECTED")
            attr_points += 10
        if tz_mismatch:
            attr_flags.append("TIMEZONE_MISMATCH")
            attr_points += 10

        # Collect flags deterministically
        for flag_list in (f1_res["flags"], f2_prelim["flags"], f3_res["flags"], f4_res["flags"], f7_res["flags"], attr_flags):
            for fl in flag_list:
                if fl not in all_flags:
                    all_flags.append(fl)

        # Dynamic Config Check: Force block rules
        cfg_force_rules = self.config.get("force_block_rules", ["TOR_EXIT_NODE", "ORIGIN_TOR", "IMPOSSIBLE_TRAVEL"])
        force_block = any(fl in cfg_force_rules for fl in all_flags) or bool(f1_res["force_block"] or f4_res["force_block"])

        enrichment_points = (
            f1_res["risk_points"]
            + f2_prelim["risk_points"]
            + f3_res["risk_points"]
            + f4_res["risk_points"]
            + f7_res["risk_points"]
            + attr_points
        )
        combined_rule_points = int(max(0, min(100, round(base_rule_points + enrichment_points))))
        effective_rule_score = round(combined_rule_points / 100.0, 2)

        ml_score = self._get_ml_score(tx_norm)

        thresholds = self.config.get("thresholds", {})
        block_thresh = thresholds.get("block_score", 80)
        review_thresh = thresholds.get("review_score", 40)
        force_min = thresholds.get("force_block_min_score", 85)

        if force_block:
            risk_score_int = int(max(force_min, min(100, combined_rule_points)))
        else:
            risk_score_int = int(max(0, min(100, combined_rule_points)))

        total_risk = round(risk_score_int / 100.0, 2)

        # Finalize Feature 2 with score
        f2_final = self.traceback_analyzer.evaluate(tx_norm, current_risk_score=float(risk_score_int))
        traceback_block = f2_final["traceback"]

        # Decision routing
        if force_block or risk_score_int >= block_thresh:
            decision = "BLOCK"
            action = "BLOCK"
            status_label = "QUARANTINED"
            http_status = 202
        elif risk_score_int >= review_thresh:
            decision = "REVIEW_QUEUE"
            action = "REVIEW_QUEUE"
            status_label = "PENDING_REVIEW"
            http_status = 200
        else:
            decision = "ALLOW"
            action = "APPROVE"
            status_label = "APPROVED"
            http_status = 200

        # Explainable score breakdown
        score_breakdown: List[Dict[str, Any]] = []
        for fl in all_flags:
            pts = RULE_POINT_VALUES.get(fl, 10)
            score_breakdown.append({
                "rule": fl,
                "points": pts,
                "category": "HIGH" if pts >= 25 else ("MEDIUM" if pts >= 15 else "LOW")
            })

        elapsed_ms = round((time.perf_counter() - start_time) * 1000.0, 2)

        # Attributes container
        attributes_block = {
            "device_fingerprint": device_fp,
            "user_agent": tx_norm.get("user_agent") or (event_headers or {}).get("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
            "browser": tx_norm.get("browser", "Chrome 122"),
            "os": tx_norm.get("os", "Windows 11"),
            "screen_resolution": tx_norm.get("screen_resolution", "1920x1080"),
            "session_id": tx_norm.get("session_id", f"sess_{tx_id[:8]}"),
            "payment_channel": tx_norm.get("channel") or tx_norm.get("payment_channel", "ONLINE_WEB"),
            "merchant_category_code": tx_norm.get("mcc", "5411"),
            "currency": tx_norm.get("currency", "USD"),
            "is_new_device": is_new_device,
            "is_new_beneficiary": is_new_beneficiary,
            "timezone_mismatch": tz_mismatch
        }

        audit_record: Dict[str, Any] = {
            "transaction_id": str(tx_id),
            "account_id": str(account_id),
            "source_account": str(tx_norm.get("source_account") or account_id),
            "destination_account": str(dest_acct),
            "timestamp": tx_norm.get("timestamp") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "amount": amount,
            "currency": attributes_block["currency"],
            "txn_type": str(tx_norm.get("txn_type") or "CREDIT").upper(),
            "merchant": tx_norm.get("merchant") or dest_acct,
            "merchant_category": tx_norm.get("merchant_category") or tx_norm.get("txn_type") or "retail",
            "transaction_city": location_block["transaction_city"],
            "transaction_country": location_block["transaction_country"],
            "rule_score": effective_rule_score,
            "ml_score": ml_score,
            "total_risk": total_risk,
            "risk_score": int(risk_score_int),
            "decision": decision,
            "action": action,
            "status": status_label,
            "http_status": http_status,
            "triggered_rules": all_flags,
            "flags": all_flags,
            "score_breakdown": score_breakdown,
            "attributes": attributes_block,
            "origin": origin_block,
            "traceback": traceback_block,
            "time_analysis": time_block,
            "location_check": location_block,
            "pii_enrichment": pii_block,
            "execution_ms": elapsed_ms
        }

        if decision == "BLOCK":
            q_out = self.quarantine_manager.quarantine_transaction(
                tx=audit_record,
                reason_codes=all_flags,
                risk_score=risk_score_int
            )
            audit_record["quarantine_ts"] = q_out["quarantine_record"]["quarantine_ts"]
            audit_record["auto_release_after"] = q_out["quarantine_record"]["auto_release_after"]
            audit_record["sla_due_at"] = q_out["quarantine_record"].get("sla_due_at")
        else:
            self.db.log_transaction(audit_record)

        logger.info(json.dumps({
            "event": "SCORE",
            "txn_id": audit_record["transaction_id"],
            "score": int(risk_score_int),
            "transaction_id": audit_record["transaction_id"],
            "account_id": audit_record["account_id"],
            "risk_score": int(risk_score_int),
            "decision": decision,
            "status": status_label,
            "flags": all_flags,
            "execution_ms": elapsed_ms
        }))

        return audit_record
