"""
Feature 2: Transaction Traceback (Full Audit Chain)
Links every transaction to its complete history chain for that account,
computes 1h/24h/7d velocity windows without double-counting, rolling 5-txn
chain_risk_score, amount_delta_pct, amount z-score vs baseline, and generates
an entity relationship graph (Account <-> Device <-> IP <-> Merchant).
"""

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

VELOCITY_1HR_SPIKE_THRESHOLD = 5
VELOCITY_SPIKE_POINTS = 25
AMOUNT_SPIKE_PCT_THRESHOLD = 300.0
AMOUNT_SPIKE_POINTS = 20
AMOUNT_ZSCORE_THRESHOLD = 3.0
AMOUNT_ZSCORE_POINTS = 15
CHAIN_SCORE_WINDOW_SIZE = 5


def parse_iso_timestamp(ts_str: Optional[Any]) -> datetime:
    if not ts_str:
        return datetime.now(timezone.utc)
    try:
        clean = str(ts_str).strip()
        if clean.endswith("Z"):
            clean = clean[:-1] + "+00:00"
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _extract_record_ts(record: Dict[str, Any]) -> Optional[str]:
    return (
        record.get("timestamp")
        or (record.get("original_payload") or {}).get("timestamp")
        or record.get("quarantine_ts")
    )


def _extract_record_amount(record: Dict[str, Any]) -> float:
    raw = record.get("amount")
    if raw is None and isinstance(record.get("original_payload"), dict):
        raw = record["original_payload"].get("amount")
    return float(raw) if raw is not None else 0.0


def _extract_record_ip(record: Dict[str, Any]) -> str:
    orig = record.get("origin") or (record.get("original_payload") or {}).get("origin") or {}
    return str(orig.get("ip_address") or record.get("ip_address") or "192.0.2.1")


def _extract_record_device(record: Dict[str, Any]) -> str:
    pii = record.get("pii_enrichment") or (record.get("original_payload") or {}).get("pii_enrichment") or {}
    return str(pii.get("device_fingerprint") or record.get("device_fingerprint") or "fp_default")


def _extract_record_merchant(record: Dict[str, Any]) -> str:
    return str(
        record.get("merchant")
        or record.get("destination_account")
        or (record.get("original_payload") or {}).get("merchant")
        or (record.get("original_payload") or {}).get("destination_account")
        or "General Merchant"
    )


def compute_z_score(val: float, values: List[float]) -> float:
    if len(values) < 3:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    std_dev = math.sqrt(variance)
    if std_dev < 1e-4:
        return 0.0
    return round((val - mean) / std_dev, 2)


class TracebackAnalyzer:
    def __init__(self, db_client: Optional[Any] = None) -> None:
        self.db_client = db_client
        self._local_history: Dict[str, List[Dict[str, Any]]] = {}

    def _get_account_history(self, account_id: Optional[str], current_tx_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieve prior transactions for account_id sorted oldest -> newest,
        explicitly excluding current_tx_id to prevent double-counting.
        """
        if not account_id:
            return []

        records: List[Dict[str, Any]] = []
        if self.db_client and hasattr(self.db_client, "get_account_transactions"):
            records = self.db_client.get_account_transactions(account_id)
        else:
            records = list(self._local_history.get(account_id, []))

        # Deduplicate by transaction_id and exclude current transaction_id
        seen_ids = set()
        filtered = []
        for r in records:
            tid = r.get("transaction_id")
            if current_tx_id and tid == current_tx_id:
                continue
            if tid and tid in seen_ids:
                continue
            if tid:
                seen_ids.add(tid)
            filtered.append(r)

        filtered.sort(key=lambda r: parse_iso_timestamp(_extract_record_ts(r)))
        return filtered

    def record_in_local_history(self, account_id: Optional[str], tx_record: Dict[str, Any]) -> None:
        if not account_id:
            return
        if account_id not in self._local_history:
            self._local_history[account_id] = []
        tid = tx_record.get("transaction_id")
        if tid and any(x.get("transaction_id") == tid for x in self._local_history[account_id]):
            return
        self._local_history[account_id].append(tx_record)

    def generate_entity_graph(
        self,
        account_id: str,
        history: List[Dict[str, Any]],
        current_tx: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Generates a node-link relationship graph (Account <-> Device <-> IP <-> Merchant).
        """
        nodes: List[Dict[str, Any]] = []
        links: List[Dict[str, Any]] = []
        node_ids: Set[str] = set()

        def add_node(nid: str, label: str, ntype: str, risk: str = "LOW") -> None:
            if nid not in node_ids:
                node_ids.add(nid)
                nodes.append({"id": nid, "label": label, "type": ntype, "risk": risk})

        def add_link(source: str, target: str, rel: str) -> None:
            links.append({"source": source, "target": target, "relation": rel})

        # Central Account node
        add_node(f"acc:{account_id}", account_id, "account", risk="LOW")

        # Current transaction entities
        curr_dev = _extract_record_device(current_tx)
        curr_ip = _extract_record_ip(current_tx)
        curr_merch = _extract_record_merchant(current_tx)

        add_node(f"dev:{curr_dev}", curr_dev, "device", risk="MEDIUM" if "emu" in curr_dev else "LOW")
        add_node(f"ip:{curr_ip}", curr_ip, "ip", risk="HIGH" if "185.220" in curr_ip else "LOW")
        add_node(f"merch:{curr_merch}", curr_merch, "merchant", risk="LOW")

        add_link(f"acc:{account_id}", f"dev:{curr_dev}", "used_device")
        add_link(f"acc:{account_id}", f"ip:{curr_ip}", "originated_from")
        add_link(f"acc:{account_id}", f"merch:{curr_merch}", "transacted_with")

        # Connect up to 10 historical records
        for r in history[-10:]:
            d = _extract_record_device(r)
            ip = _extract_record_ip(r)
            m = _extract_record_merchant(r)

            add_node(f"dev:{d}", d, "device", risk="LOW")
            add_node(f"ip:{ip}", ip, "ip", risk="LOW")
            add_node(f"merch:{m}", m, "merchant", risk="LOW")

            add_link(f"acc:{account_id}", f"dev:{d}", "used_device")
            add_link(f"acc:{account_id}", f"ip:{ip}", "originated_from")
            add_link(f"acc:{account_id}", f"merch:{m}", "transacted_with")

        return {"nodes": nodes, "links": links}

    def evaluate(
        self,
        tx: Dict[str, Any],
        current_risk_score: Optional[float] = None,
        prior_records: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Computes the `traceback` block and evaluates VELOCITY_SPIKE, AMOUNT_SPIKE, and AMOUNT_ZSCORE_ANOMALY flags.
        """
        tx_id = tx.get("transaction_id")
        account_id = tx.get("account_id") or tx.get("source_account") or tx.get("user_id") or "acc_unknown"
        raw_amt = tx.get("amount", 0.0)
        amount = float(raw_amt) if raw_amt is not None else 0.0
        tx_time = parse_iso_timestamp(tx.get("timestamp"))

        if prior_records is not None:
            history = [
                r for r in prior_records
                if not (tx_id and r.get("transaction_id") == tx_id)
            ]
            history.sort(key=lambda r: parse_iso_timestamp(_extract_record_ts(r)))
        else:
            history = self._get_account_history(account_id, current_tx_id=tx_id)

        prior_count = len(history)
        account_tx_count = prior_count + 1

        # Velocity windows: 1h, 24h, 7d
        one_hr_ago = tx_time - timedelta(hours=1)
        twenty_four_hr_ago = tx_time - timedelta(hours=24)
        seven_days_ago = tx_time - timedelta(days=7)

        prior_1hr = sum(
            1 for r in history
            if one_hr_ago <= parse_iso_timestamp(_extract_record_ts(r)) <= tx_time
        )
        prior_24hr = sum(
            1 for r in history
            if twenty_four_hr_ago <= parse_iso_timestamp(_extract_record_ts(r)) <= tx_time
        )
        prior_7d = sum(
            1 for r in history
            if seven_days_ago <= parse_iso_timestamp(_extract_record_ts(r)) <= tx_time
        )

        velocity_1hr = prior_1hr + 1
        velocity_24hr = prior_24hr + 1
        velocity_7d = prior_7d + 1

        prior_chronological = [
            r for r in history
            if parse_iso_timestamp(_extract_record_ts(r)) <= tx_time
        ]

        historical_amounts = [_extract_record_amount(r) for r in history]
        amount_zscore = compute_z_score(amount, historical_amounts)

        if prior_count == 0:
            prev_tx_id = None
            prev_tx_ts = None
            prev_amount = 0.0
            prev_merchant = ""
            prev_location = ""
            amount_delta_pct = 0.0
            chain_scores = [float(current_risk_score)] if current_risk_score is not None else [0.0]
            chain_risk_score = round(sum(chain_scores) / len(chain_scores), 2)
            last_tx = None
        else:
            last_tx = prior_chronological[-1] if prior_chronological else history[-1]
            orig_payload = last_tx.get("original_payload") if isinstance(last_tx.get("original_payload"), dict) else {}
            prev_tx_id = last_tx.get("transaction_id")
            prev_tx_ts = _extract_record_ts(last_tx)
            prev_amount = _extract_record_amount(last_tx)
            prev_merchant = (
                last_tx.get("merchant")
                or orig_payload.get("merchant")
                or last_tx.get("merchant_category")
                or last_tx.get("destination_account")
                or orig_payload.get("destination_account")
                or ""
            )
            prev_location = (
                last_tx.get("location")
                or (last_tx.get("origin", {}) or {}).get("city")
                or (orig_payload.get("origin", {}) or {}).get("city")
                or last_tx.get("transaction_city")
                or orig_payload.get("transaction_city")
                or ""
            )

            # Compute % change vs previous amount and vs historical average
            delta_prev = ((amount - prev_amount) / prev_amount * 100.0) if prev_amount > 0 else 0.0
            avg_amount = sum(historical_amounts) / prior_count
            delta_avg = ((amount - avg_amount) / avg_amount * 100.0) if avg_amount > 0 else 0.0
            amount_delta_pct = round(max(delta_prev, delta_avg), 2)

            # Rolling average of last 5 scores
            historical_scores = [
                float(r.get("risk_score", r.get("total_risk", 0.0)))
                for r in history
            ]
            if current_risk_score is not None:
                window_scores = (historical_scores + [float(current_risk_score)])[-CHAIN_SCORE_WINDOW_SIZE:]
            else:
                window_scores = historical_scores[-CHAIN_SCORE_WINDOW_SIZE:]
            chain_risk_score = round(sum(window_scores) / len(window_scores), 2) if window_scores else 0.0

        flags: List[str] = []
        risk_points = 0

        if velocity_1hr > VELOCITY_1HR_SPIKE_THRESHOLD:
            flags.append("VELOCITY_SPIKE")
            risk_points += VELOCITY_SPIKE_POINTS

        if amount_delta_pct > AMOUNT_SPIKE_PCT_THRESHOLD:
            flags.append("AMOUNT_SPIKE")
            risk_points += AMOUNT_SPIKE_POINTS

        if amount_zscore > AMOUNT_ZSCORE_THRESHOLD:
            flags.append("AMOUNT_ZSCORE_ANOMALY")
            risk_points += AMOUNT_ZSCORE_POINTS

        entity_graph = self.generate_entity_graph(str(account_id), history, tx)

        traceback_block = {
            "account_transaction_count": account_tx_count,
            "previous_transaction_id": prev_tx_id,
            "previous_transaction_ts": prev_tx_ts,
            "previous_amount": round(prev_amount, 2),
            "previous_merchant": prev_merchant,
            "previous_location": prev_location,
            "chain_risk_score": chain_risk_score,
            "velocity_1hr": velocity_1hr,
            "velocity_24hr": velocity_24hr,
            "velocity_7d": velocity_7d,
            "amount_delta_pct": amount_delta_pct,
            "amount_zscore": amount_zscore,
            "entity_graph": entity_graph
        }

        return {
            "traceback": traceback_block,
            "flags": flags,
            "risk_points": risk_points,
            "previous_record": last_tx,
            "history_last_5": history[-CHAIN_SCORE_WINDOW_SIZE:],
            "history_full": history
        }
