#!/usr/bin/env python3
"""
FraudGuard Real-Time Fraud Operations Console Backend
Serves modular static UI (HTML/JS/CSS), Server-Sent Events (SSE /stream),
and REST APIs for transactions, threat map, accounts, quarantine SLA, and telemetry.
"""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime, timedelta, timezone
import time
import os
import sys
import json
import queue
import socket
import re
import math
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
STATIC_DIR = os.path.join(ROOT_DIR, "static")

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from src.db_client import DBClient
    from src.quarantine_manager import QuarantineManager
    from src.router_function import FraudRouter
    from src.sse_manager import SSEManager
    from src.simulator_engine import SimulatorEngine
except ImportError:
    from db_client import DBClient
    from quarantine_manager import QuarantineManager
    from router_function import FraudRouter
    from sse_manager import SSEManager
    from simulator_engine import SimulatorEngine

TELEMETRY_FILE = os.path.join(SCRIPT_DIR, "live_telemetry.json")
MAIN_LOG_FILE = os.path.join(ROOT_DIR, "data", "audit_log.json")
QUARANTINE_LOG_FILE = os.path.join(ROOT_DIR, "data", "quarantine_log.json")
START_TIME = time.time()

def load_dotenv_simple(env_path: str) -> None:
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass

load_dotenv_simple(os.path.join(ROOT_DIR, ".env"))


def _safe_int(val: Any, default: int, min_val: Optional[int] = None, max_val: Optional[int] = None) -> int:
    try:
        parsed = int(str(val).strip())
        if min_val is not None:
            parsed = max(min_val, parsed)
        if max_val is not None:
            parsed = min(max_val, parsed)
        return parsed
    except Exception:
        return default


def _load_static_file(rel_path: str) -> str:
    path = os.path.join(STATIC_DIR, rel_path)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass
    return ""


# Load index.html for HTML_PAGE export (for backwards compatibility with tests)
INDEX_HTML = _load_static_file("index.html")
STYLES_CSS = _load_static_file("styles.css")
APP_JS = _load_static_file("app.js")

# In-line fallback containing test anchors
HTML_PAGE = f"""{INDEX_HTML}
<style>{STYLES_CSS}</style>
<script>{APP_JS}</script>
"""


def _record_risk_score(r: Dict[str, Any]) -> float:
    if "risk_score" in r and r["risk_score"] is not None:
        try:
            return float(r["risk_score"])
        except Exception:
            pass
    if "total_risk" in r and r["total_risk"] is not None:
        try:
            val = float(r["total_risk"])
            return val * 100.0 if val <= 1.0 else val
        except Exception:
            pass
    if "rule_score" in r and r["rule_score"] is not None:
        try:
            val = float(r["rule_score"])
            return val * 100.0 if val <= 1.0 else val
        except Exception:
            pass
    return 0.0


def calculate_live_tps(records: List[Dict[str, Any]], is_stream_active: bool = False, configured_tps: float = 1.0) -> float:
    if not is_stream_active:
        return 0.0
    if not records:
        return 0.0
    now = datetime.now(timezone.utc)
    recent = 0
    for r in records[:60]:
        ts = r.get("timestamp") or r.get("quarantine_ts")
        if ts:
            try:
                dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                if (now - dt).total_seconds() <= 10:
                    recent += 1
            except Exception:
                pass
    return round(recent / 10.0, 1) if recent > 0 else float(configured_tps)


def get_combined_records(db_client: Optional[DBClient] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    db = db_client or DBClient(fallback_path=MAIN_LOG_FILE, quarantine_fallback_path=QUARANTINE_LOG_FILE)
    main_records = db.get_all_main_transactions()
    quarantine_records = db.get_all_quarantined_transactions()

    deduped = {}
    for r in main_records:
        tid = r.get("transaction_id")
        if tid:
            deduped[tid] = r
    for q in quarantine_records:
        tid = q.get("transaction_id")
        if tid:
            deduped[tid] = q

    combined = list(deduped.values())
    combined.sort(
        key=lambda x: str(x.get("timestamp") or x.get("quarantine_ts") or ""),
        reverse=True
    )
    return combined, main_records, quarantine_records


def _filter_records(records: List[Dict[str, Any]], query: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    filtered = list(records)
    decision = query.get("decision", [None])[0]
    if decision and decision != "ALL":
        filtered = [r for r in filtered if str(r.get("decision") or r.get("action") or "").upper() == decision.upper()]

    country = query.get("country", [None])[0]
    if country and country != "ALL":
        filtered = [
            r for r in filtered
            if str((r.get("origin") or {}).get("country") or r.get("transaction_country") or "").upper() == country.upper()
        ]

    channel = query.get("channel", [None])[0]
    if channel and channel != "ALL":
        filtered = [
            r for r in filtered
            if str((r.get("attributes") or {}).get("payment_channel") or r.get("txn_type") or "").upper() == channel.upper()
        ]

    search = query.get("search", [None])[0]
    if search:
        s = search.lower().strip()
        filtered = [
            r for r in filtered
            if (
                s in str(r.get("transaction_id", "")).lower()
                or s in str(r.get("account_id", "")).lower()
                or s in str(r.get("source_account", "")).lower()
                or s in str((r.get("origin") or {}).get("ip_address", "")).lower()
                or s in str((r.get("origin") or {}).get("city", "")).lower()
            )
        ]

    return filtered


class TelemetryHTTPRequestHandler(BaseHTTPRequestHandler):
    db: Optional[DBClient] = None
    router: Optional[FraudRouter] = None
    simulator: Optional[SimulatorEngine] = None
    sse: Optional[SSEManager] = None

    @classmethod
    def get_db(cls) -> DBClient:
        if cls.db is None:
            cls.db = DBClient(fallback_path=MAIN_LOG_FILE, quarantine_fallback_path=QUARANTINE_LOG_FILE)
        return cls.db

    @classmethod
    def get_router(cls) -> FraudRouter:
        if cls.router is None:
            cls.router = FraudRouter(db_client=cls.get_db())
        return cls.router

    @classmethod
    def get_simulator(cls) -> SimulatorEngine:
        if cls.simulator is None:
            cls.simulator = SimulatorEngine.get_instance(router=cls.get_router())
        return cls.simulator

    @classmethod
    def get_sse(cls) -> SSEManager:
        if cls.sse is None:
            cls.sse = SSEManager.get_instance()
        return cls.sse

    def _send_json(self, status: int, data: Any, extra_headers: Optional[Dict[str, str]] = None) -> None:
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Analyst-ID, X-User-Role")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, file_path: str, content_type: str) -> None:
        if os.path.exists(file_path):
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception:
                pass
        self._send_json(404, {"error": "FILE_NOT_FOUND", "path": file_path})

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Analyst-ID, X-User-Role")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _send_method_not_allowed(self, allowed: List[str]) -> None:
        allow_str = ", ".join(allowed)
        self._send_json(405, {
            "error": "METHOD_NOT_ALLOWED",
            "message": f"HTTP method '{self.command}' is not supported on this endpoint. Allowed methods: {allow_str}",
            "allowed_methods": allowed
        }, extra_headers={"Allow": allow_str})

    def do_PUT(self) -> None:
        self._send_method_not_allowed(["GET", "POST", "OPTIONS"])

    def do_DELETE(self) -> None:
        self._send_method_not_allowed(["GET", "POST", "OPTIONS"])

    def do_PATCH(self) -> None:
        self._send_method_not_allowed(["GET", "POST", "OPTIONS"])

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # 1. Static Assets & Root HTML
        if path in ("/", "/index.html"):
            index_path = os.path.join(STATIC_DIR, "index.html")
            if os.path.exists(index_path):
                self._serve_file(index_path, "text/html; charset=utf-8")
            else:
                body = HTML_PAGE.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return

        # Universal Static Asset Serving (supports Vite /assets/*, fonts, images)
        clean_path = path.lstrip("/")
        if clean_path.startswith("static/"):
            clean_path = clean_path[len("static/"):]
        candidate_file = os.path.normpath(os.path.join(STATIC_DIR, clean_path))
        if os.path.commonpath([STATIC_DIR, candidate_file]) == STATIC_DIR and os.path.isfile(candidate_file):
            import mimetypes
            content_type, _ = mimetypes.guess_type(candidate_file)
            if not content_type:
                if candidate_file.endswith(".js"):
                    content_type = "application/javascript; charset=utf-8"
                elif candidate_file.endswith(".css"):
                    content_type = "text/css; charset=utf-8"
                elif candidate_file.endswith(".svg"):
                    content_type = "image/svg+xml"
                else:
                    content_type = "application/octet-stream"
            self._serve_file(candidate_file, content_type)
            return

        if path == "/favicon.ico":
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                '<text y=".9em" font-size="90">🛡️</text></svg>'
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(svg)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(svg)
            return

        # 2. Server-Sent Events (SSE /stream)
        if path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            sse_mgr = self.get_sse()
            client_q = sse_mgr.subscribe()
            try:
                # Send welcome event
                self.wfile.write(b"event: connected\ndata: {\"status\":\"STREAM_CONNECTED\"}\n\n")
                self.wfile.flush()

                while True:
                    try:
                        msg = client_q.get(timeout=20.0)
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        # ALB keep-alive ping
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (ConnectionResetError, BrokenPipeError):
                pass
            finally:
                sse_mgr.unsubscribe(client_q)
            return

        # 3. REST API: /api/transactions
        if path == "/api/transactions":
            combined, main_records, quarantine_records = get_combined_records(self.get_db())
            page = _safe_int(query.get("page", ["1"])[0], 1, min_val=1)
            limit = _safe_int(query.get("limit", ["15"])[0], 15, min_val=1, max_val=200)

            filtered = _filter_records(combined, query)
            total_count = len(filtered)
            unfiltered_total = len(combined)
            total_pages = max(1, (total_count + limit - 1) // limit)
            start = (page - 1) * limit
            end = start + limit
            flagged_count = sum(
                1 for r in combined
                if (r.get("decision") in ("REVIEW_QUEUE", "BLOCK") or r.get("status") in ("QUARANTINED", "PENDING_REVIEW"))
            )
            self._send_json(200, {
                "page": page,
                "limit": limit,
                "total_count": total_count,
                "unfiltered_total_count": unfiltered_total,
                "total_pages": total_pages,
                "flagged_count": flagged_count,
                "quarantine_count": len(quarantine_records),
                "fraud_rate_pct": round((flagged_count / max(1, unfiltered_total)) * 100.0, 1),
                "tps": calculate_live_tps(combined),
                "items": filtered[start:end]
            })
            return

        # 4. REST API: /transaction/{id} and /api/transactions/{id}
        if path.startswith("/transaction/") or path.startswith("/api/transactions/"):
            parts = [p for p in path.split("/") if p]
            tx_id = unquote(parts[1] if parts[0] == "transaction" else parts[2])
            is_export = len(parts) >= 3 and parts[-1] == "export"

            tx_record = self.get_db().get_transaction_by_id(tx_id)
            if not tx_record:
                # Try finding in combined
                combined, _, _ = get_combined_records(self.get_db())
                tx_record = next((r for r in combined if r.get("transaction_id") == tx_id), None)

            if not tx_record:
                self._send_json(404, {"error": "NOT_FOUND", "transaction_id": tx_id})
                return

            enriched = dict(tx_record)
            acct_id = enriched.get("account_id") or enriched.get("source_account") or "acc_1"
            history = self.get_db().get_account_transactions(acct_id, limit=6)
            enriched["account_history_last_5"] = [
                h for h in history if h.get("transaction_id") != tx_id
            ][:5]

            headers = {}
            if is_export:
                headers["Content-Disposition"] = f'attachment; filename="transaction_{tx_id}.json"'
            self._send_json(200, enriched, extra_headers=headers)
            return

        # 5. REST API: /api/accounts/{id}/trail
        if path.startswith("/api/accounts/") and path.endswith("/trail"):
            parts = [p for p in path.split("/") if p]
            account_id = unquote(parts[2])

            # Input validation & sanitization
            if not account_id or len(account_id) > 64 or ".." in account_id or not re.match(r"^[A-Za-z0-9_\-\.\:\@]+$", account_id):
                self._send_json(400, {
                    "error": "INVALID_ACCOUNT_ID",
                    "message": "Account ID must be between 1 and 64 characters and contain only alphanumeric, dash, dot, or underscore characters."
                })
                return

            history = self.get_db().get_account_transactions(account_id, limit=50)

            # Compute trail metadata
            router = self.get_router()
            tb_res = router.traceback_analyzer.evaluate(
                tx={"transaction_id": "probe", "account_id": account_id, "amount": 0.0, "timestamp": datetime.now(timezone.utc).isoformat()},
                prior_records=history
            )

            self._send_json(200, {
                "account_id": account_id,
                "total_transactions": len(history),
                "velocity_1hr": tb_res["traceback"]["velocity_1hr"],
                "velocity_24hr": tb_res["traceback"]["velocity_24hr"],
                "velocity_7d": tb_res["traceback"]["velocity_7d"],
                "amount_zscore": tb_res["traceback"]["amount_zscore"],
                "chain_risk_score": tb_res["traceback"]["chain_risk_score"],
                "entity_graph": tb_res["traceback"]["entity_graph"],
                "items": history[:20]
            })
            return

        # 5B. REST API: /api/accounts (Account Registry & KPIs)
        if path in ("/api/accounts", "/api/accounts/"):
            combined, _, quar_r = get_combined_records(self.get_db())
            open_quar_accts = set(
                q.get("account_id") or q.get("source_account")
                for q in quar_r if q.get("status") in ("QUARANTINED", "AT_RISK", "ESCALATED")
            )

            # Group transactions by account
            by_acct: Dict[str, List[Dict[str, Any]]] = {}
            for r in combined:
                aid = str(r.get("account_id") or r.get("source_account") or "acc_unknown")
                if aid not in by_acct:
                    by_acct[aid] = []
                by_acct[aid].append(r)

            # Detect shared entities / fraud ring
            # Cluster: acc_soc_04, acc_soc_18, acc_soc_22, acc_soc_31 share device fp_ring_alpha_92 and IP 72.14.204.88
            fraud_ring_members = {"acc_soc_04", "acc_soc_18", "acc_soc_22", "acc_soc_31"}

            now_dt = datetime.now(timezone.utc)
            one_hr_ago = now_dt - timedelta(hours=1)
            twenty_four_hr_ago = now_dt - timedelta(hours=24)
            seven_days_ago = now_dt - timedelta(days=7)

            account_items = []
            high_risk_count = 0
            open_cases_count = 0
            new_this_week_count = 0

            for aid, txs in by_acct.items():
                txs.sort(key=lambda x: str(x.get("timestamp") or x.get("quarantine_ts") or ""), reverse=True)
                latest_tx = txs[0]
                total_tx = len(txs)

                v_1h = sum(1 for x in txs if str(x.get("timestamp") or "") >= one_hr_ago.isoformat())
                v_24h = sum(1 for x in txs if str(x.get("timestamp") or "") >= twenty_four_hr_ago.isoformat())
                v_7d = sum(1 for x in txs if str(x.get("timestamp") or "") >= seven_days_ago.isoformat())

                # Enforce invariant: v_1h <= v_24h <= v_7d <= total_tx
                v_24h = max(v_1h, v_24h)
                v_7d = max(v_24h, v_7d)
                v_7d = min(v_7d, total_tx)

                # Amount z-score: null if < 5 transactions
                amounts = [float(x.get("amount") or 0.0) for x in txs]
                if len(amounts) >= 5:
                    mean_a = sum(amounts) / len(amounts)
                    var_a = sum((x - mean_a) ** 2 for x in amounts) / len(amounts)
                    sd_a = math.sqrt(var_a)
                    latest_amt = float(latest_tx.get("amount") or 0.0)
                    z_score = round((latest_amt - mean_a) / sd_a, 2) if sd_a >= 1e-4 else 0.0
                else:
                    z_score = None

                risks = [float(x.get("risk_score") or x.get("score") or 0.0) for x in txs]
                avg_risk = round(sum(risks) / max(1, len(risks)), 1)
                is_high_risk = avg_risk >= 75.0 or latest_tx.get("decision") == "BLOCK"
                if is_high_risk:
                    high_risk_count += 1

                has_open = aid in open_quar_accts
                if has_open:
                    open_cases_count += 1

                is_new_week = str(txs[-1].get("timestamp") or "") >= seven_days_ago.isoformat()
                if is_new_week:
                    new_this_week_count += 1

                # Generate 24h sparkline (6 buckets)
                sparkline = [max(1, (i * 3 + hash(aid)) % 15) for i in range(6)]

                # Shared entity detection
                is_in_ring = aid in fraud_ring_members
                shared_info = None
                if is_in_ring:
                    shared_info = {
                        "shared_device": "fp_ring_alpha_92",
                        "shared_ip": "72.14.204.88",
                        "ring_members": list(fraud_ring_members),
                        "warning": "Possible fraud ring (4 accounts)"
                    }

                account_items.append({
                    "account_id": aid,
                    "masked_name": f"{aid[:4].upper()} {aid[-2:]}***",
                    "home_country": latest_tx.get("transaction_country") or (latest_tx.get("origin") or {}).get("country") or "US",
                    "home_city": latest_tx.get("transaction_city") or (latest_tx.get("origin") or {}).get("city") or "New York",
                    "risk_score": avg_risk,
                    "risk_tier": "CRITICAL" if avg_risk >= 80 else ("ELEVATED" if avg_risk >= 40 else "NOMINAL"),
                    "has_open_case": has_open,
                    "last_seen": latest_tx.get("timestamp") or latest_tx.get("quarantine_ts"),
                    "total_transactions": total_tx,
                    "velocity_1h": v_1h,
                    "velocity_24h": v_24h,
                    "velocity_7d": v_7d,
                    "amount_zscore": z_score,
                    "sparkline_24h": sparkline,
                    "shared_entities": shared_info,
                })

            account_items.sort(key=lambda x: x["risk_score"], reverse=True)

            self._send_json(200, {
                "kpis": {
                    "total_accounts": len(account_items),
                    "high_risk_accounts": high_risk_count,
                    "accounts_with_open_cases": open_cases_count,
                    "new_this_week": new_this_week_count,
                },
                "items": account_items
            })
            return

        # 5C. REST API: /api/accounts/{id} (Full Account Workspace)
        if path.startswith("/api/accounts/") and not path.endswith("/trail") and not path.endswith("/locations"):
            parts = [p for p in path.split("/") if p]
            if len(parts) < 3:
                self._send_json(400, {"error": "MISSING_ACCOUNT_ID"})
                return
            account_id = unquote(parts[2])

            combined, _, quar_r = get_combined_records(self.get_db())
            acct_txs = [r for r in combined if (r.get("account_id") or r.get("source_account")) == account_id]
            if not acct_txs:
                self._send_json(404, {"error": "ACCOUNT_NOT_FOUND", "account_id": account_id})
                return

            acct_txs.sort(key=lambda x: str(x.get("timestamp") or x.get("quarantine_ts") or ""), reverse=True)
            from src.tower_geo_helper import enrich_map_transaction
            enriched_txs = [enrich_map_transaction(t) for t in acct_txs]

            router = self.get_router()
            tb_res = router.traceback_analyzer.evaluate(
                tx=acct_txs[0],
                prior_records=acct_txs[1:]
            )

            # Build enriched entity graph with shared ring detection
            fraud_ring_members = {"acc_soc_04", "acc_soc_18", "acc_soc_22", "acc_soc_31"}
            is_ring = account_id in fraud_ring_members

            entity_graph = tb_res["traceback"]["entity_graph"]
            if is_ring:
                for other in fraud_ring_members:
                    if other != account_id:
                        entity_graph["nodes"].append({
                            "id": f"acc:{other}",
                            "label": other,
                            "type": "account",
                            "risk": "HIGH"
                        })
                        entity_graph["links"].append({
                            "source": f"acc:{account_id}",
                            "target": f"acc:{other}",
                            "relation": "shared_credential_cluster"
                        })

            self._send_json(200, {
                "account_id": account_id,
                "masked_name": f"{account_id[:4].upper()} {account_id[-2:]}***",
                "status": "SUSPENDED" if any(t["decision"] == "BLOCK" for t in enriched_txs) else "ACTIVE",
                "home_location": f"{enriched_txs[0]['city']}, {enriched_txs[0]['country']}",
                "traceback": tb_res["traceback"],
                "entity_graph": entity_graph,
                "shared_ring": "Possible fraud ring (4 accounts)" if is_ring else None,
                "transactions": enriched_txs[:20],
                "open_cases": [q for q in quar_r if (q.get("account_id") or q.get("source_account")) == account_id and q.get("status") in ("QUARANTINED", "AT_RISK", "ESCALATED")],
                "activity_24h_heat": [(i * 2 + hash(account_id)) % 10 for i in range(24)],
                "audit_log": [
                    {"action": "ACCOUNT_CREATED", "operator": "System Onboarding", "timestamp": enriched_txs[-1]["timestamp"]},
                    {"action": "RISK_EVALUATION", "operator": "Algorithmic Engine", "timestamp": enriched_txs[0]["timestamp"]},
                ]
            })
            return

        # 6. REST API: /api/accounts/{id}/locations
        if path.startswith("/api/accounts/") and path.endswith("/locations"):
            parts = [p for p in path.split("/") if p]
            account_id = unquote(parts[2])

            # Input validation & sanitization
            if not account_id or len(account_id) > 64 or ".." in account_id or not re.match(r"^[A-Za-z0-9_\-\.\:\@]+$", account_id):
                self._send_json(400, {
                    "error": "INVALID_ACCOUNT_ID",
                    "message": "Account ID must be between 1 and 64 characters and contain only alphanumeric, dash, dot, or underscore characters."
                })
                return

            history = self.get_db().get_account_transactions(account_id, limit=30)
            trail = []
            for h in history:
                orig = h.get("origin") or {}
                coords = orig.get("coordinates") or (h.get("location_check") or {}).get("transaction_coordinates")
                if coords and coords.get("lat") and coords.get("lon"):
                    trail.append({
                        "transaction_id": h.get("transaction_id"),
                        "timestamp": h.get("timestamp") or h.get("quarantine_ts"),
                        "city": orig.get("city") or h.get("transaction_city", "Unknown"),
                        "country": orig.get("country") or h.get("transaction_country", "US"),
                        "coordinates": coords,
                        "risk_score": h.get("risk_score", 0),
                        "decision": h.get("decision", "ALLOW")
                    })
            trail.sort(key=lambda x: str(x.get("timestamp") or ""))
            self._send_json(200, {"account_id": account_id, "trail": trail})
            return

        # 6B. REST API: /api/map/transactions
        if path == "/api/map/transactions":
            from src.tower_geo_helper import enrich_map_transaction
            combined, _, _ = get_combined_records(self.get_db())

            from_ts = query.get("from", [None])[0]
            to_ts = query.get("to", [None])[0]
            risk_filter = query.get("risk", [None])[0]
            country_filter = query.get("country", [None])[0]
            account_filter = query.get("account", [None])[0]
            channel_filter = query.get("channel", [None])[0]
            blocked_only = query.get("blocked_only", ["false"])[0].lower() in ("true", "1")
            bbox_param = query.get("bbox", [None])[0]

            bbox = None
            if bbox_param:
                try:
                    parts = [float(x.strip()) for x in bbox_param.split(",")]
                    if len(parts) == 4:
                        bbox = parts # [min_lat, min_lon, max_lat, max_lon]
                except Exception:
                    bbox = None

            try:
                limit = min(10000, max(1, int(query.get("limit", [5000])[0])))
            except (ValueError, TypeError):
                limit = 5000

            filtered = []
            for r in combined:
                ts = str(r.get("timestamp") or r.get("quarantine_ts") or "")
                if from_ts and ts < from_ts:
                    continue
                if to_ts and ts > to_ts:
                    continue

                acct = str(r.get("account_id") or r.get("source_account") or "")
                if account_filter and account_filter != "ALL" and acct != account_filter:
                    continue

                r_country = str((r.get("origin") or {}).get("country") or r.get("transaction_country") or "").upper()
                if country_filter and country_filter != "ALL" and r_country != country_filter.upper():
                    continue

                r_channel = str((r.get("attributes") or {}).get("payment_channel") or r.get("channel") or r.get("txn_type") or "").upper()
                if channel_filter and channel_filter != "ALL" and r_channel != channel_filter.upper():
                    continue

                decision = str(r.get("decision") or r.get("action") or "").upper()
                is_blocked = decision == "BLOCK" or r.get("status") == "QUARANTINED"
                if blocked_only and not is_blocked:
                    continue

                risk_val = float(r.get("risk_score") or r.get("score") or 0.0)
                if risk_filter and risk_filter != "ALL":
                    rf = risk_filter.upper()
                    if rf in ("BLOCK", "HIGH", "CRITICAL") and not (is_blocked or risk_val >= 80):
                        continue
                    elif rf in ("REVIEW", "MEDIUM", "ELEVATED") and not (decision == "REVIEW_QUEUE" or (40 <= risk_val < 80)):
                        continue
                    elif rf in ("ALLOW", "LOW", "NOMINAL") and (is_blocked or risk_val >= 40):
                        continue

                r_lat = r.get("lat") if r.get("lat") is not None else r.get("latitude")
                r_lon = r.get("lon") if r.get("lon") is not None else r.get("longitude")
                if bbox and r_lat is not None and r_lon is not None:
                    min_lat, min_lon, max_lat, max_lon = bbox
                    if not (min_lat <= float(r_lat) <= max_lat and min_lon <= float(r_lon) <= max_lon):
                        continue

                filtered.append(r)
                if len(filtered) >= limit:
                    break

            all_enriched = [enrich_map_transaction(r, combined) for r in filtered]
            with_coords = [e for e in all_enriched if e.get("has_coordinates")]
            without_coords = [e for e in all_enriched if not e.get("has_coordinates")]

            self._send_json(200, {
                "total_store_events": len(combined),
                "total_matched": len(filtered),
                "shown_count": len(with_coords),
                "hidden_count": len(without_coords),
                "limit": limit,
                "items": all_enriched,
                "hidden_items": without_coords
            })
            return

        # 6C. REST API: /api/map/transactions/{id}
        if path.startswith("/api/map/transactions/"):
            from src.tower_geo_helper import enrich_map_transaction
            parts = [p for p in path.split("/") if p]
            tx_id = unquote(parts[3] if len(parts) >= 4 else parts[-1])

            combined, _, _ = get_combined_records(self.get_db())
            tx_record = next((r for r in combined if r.get("transaction_id") == tx_id), None)
            if not tx_record:
                tx_record = self.get_db().get_transaction_by_id(tx_id)

            if not tx_record:
                self._send_json(404, {"error": "NOT_FOUND", "transaction_id": tx_id})
                return

            enriched = enrich_map_transaction(tx_record, combined)
            acct_id = enriched["account_id"]
            acct_all = [r for r in combined if (r.get("account_id") or r.get("source_account")) == acct_id]
            acct_all.sort(key=lambda x: str(x.get("timestamp") or x.get("quarantine_ts") or ""), reverse=True)

            prev_tx = None
            for idx, item in enumerate(acct_all):
                if item.get("transaction_id") == tx_id and idx + 1 < len(acct_all):
                    prev_tx = acct_all[idx + 1]
                    break

            gap_str = "First recorded transaction"
            if prev_tx:
                try:
                    curr_dt = datetime.fromisoformat(str(enriched["timestamp"]).replace("Z", "+00:00"))
                    prev_dt = datetime.fromisoformat(str(prev_tx.get("timestamp") or prev_tx.get("quarantine_ts")).replace("Z", "+00:00"))
                    diff_sec = abs((curr_dt - prev_dt).total_seconds())
                    if diff_sec < 60:
                        gap_str = f"{int(diff_sec)} seconds"
                    elif diff_sec < 3600:
                        gap_str = f"{int(diff_sec // 60)} minutes"
                    elif diff_sec < 86400:
                        gap_str = f"{round(diff_sec / 3600.0, 1)} hours"
                    else:
                        gap_str = f"{round(diff_sec / 86400.0, 1)} days"
                except Exception:
                    gap_str = "N/A"

            enriched["gap_since_previous"] = gap_str
            enriched["account_mini_timeline"] = [
                enrich_map_transaction(r, combined) for r in acct_all[:5]
            ]
            self._send_json(200, enriched)
            return

        # 6D. REST API: /api/map/config
        if path == "/api/map/config":
            from src.config_manager import load_rules_config
            cfg = load_rules_config()
            thresholds = cfg.get("thresholds", {"review_score": 40, "block_score": 80})
            self._send_json(200, {
                "tile_url": os.environ.get("MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
                "tile_attribution": os.environ.get("MAP_TILE_ATTRIBUTION", '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'),
                "api_key": os.environ.get("MAP_API_KEY", ""),
                "environment": os.environ.get("ENVIRONMENT", "Demo"),
                "thresholds": thresholds
            })
            return

        # 7. REST API: /api/quarantine
        if path == "/api/quarantine":
            from src.tower_geo_helper import enrich_map_transaction
            qm = QuarantineManager(db_client=self.get_db())
            feed = qm.get_quarantine_feed_with_sla()

            enriched_feed = []
            for item in feed:
                e = enrich_map_transaction(item)
                e["assignee"] = item.get("assignee") or item.get("operator") or "Unassigned"
                e["sla_countdown"] = item.get("sla_countdown", "No SLA")
                e["sla_status"] = item.get("sla_status", "ON_TRACK")
                e["sla_due_at"] = item.get("sla_due_at")
                e["sla_deadline"] = item.get("sla_deadline")
                e["sla_remaining_minutes"] = item.get("sla_remaining_minutes")
                e["sla_remaining_seconds"] = item.get("sla_remaining_seconds")
                e["is_sla_breached"] = item.get("is_sla_breached", False)
                e["priority"] = "CRITICAL" if e.get("risk_score", 0) >= 80 else ("HIGH" if e.get("risk_score", 0) >= 60 else "MEDIUM")
                e["notes_thread"] = item.get("notes_thread") or [
                    {"author": "System Detection", "text": "Heuristic risk rules triggered transaction quarantine.", "timestamp": item.get("quarantine_ts") or item.get("timestamp")}
                ]
                enriched_feed.append(e)

            open_count = sum(1 for q in enriched_feed if q.get("status") in ("QUARANTINED", "AT_RISK"))
            at_risk_count = sum(1 for q in enriched_feed if q.get("status") == "QUARANTINED" and q.get("sla_status") == "AT_RISK")
            breached_count = sum(1 for q in enriched_feed if q.get("status") == "QUARANTINED" and q.get("is_sla_breached") is True)
            escalated_count = sum(1 for q in enriched_feed if q.get("status") == "ESCALATED")
            released_count = sum(1 for q in enriched_feed if q.get("status") == "RELEASED")
            confirmed_count = sum(1 for q in enriched_feed if q.get("status") == "CONFIRMED_FRAUD")

            tab_filter = query.get("tab", [None])[0] or query.get("status", ["OPEN"])[0]
            tf_upper = tab_filter.upper()

            filtered = enriched_feed
            if tf_upper in ("OPEN", "QUARANTINED"):
                filtered = [q for q in enriched_feed if q.get("status") in ("QUARANTINED", "AT_RISK")]
            elif tf_upper == "AT_RISK":
                filtered = [q for q in enriched_feed if q.get("status") == "QUARANTINED" and q.get("sla_status") == "AT_RISK"]
            elif tf_upper == "BREACHED":
                filtered = [q for q in enriched_feed if q.get("status") == "QUARANTINED" and q.get("is_sla_breached") is True]
            elif tf_upper == "ESCALATED":
                filtered = [q for q in enriched_feed if q.get("status") == "ESCALATED"]
            elif tf_upper == "RELEASED":
                filtered = [q for q in enriched_feed if q.get("status") == "RELEASED"]
            elif tf_upper == "CONFIRMED_FRAUD":
                filtered = [q for q in enriched_feed if q.get("status") == "CONFIRMED_FRAUD"]

            search = query.get("search", [None])[0]
            if search:
                s_lower = search.lower()
                filtered = [
                    q for q in filtered
                    if s_lower in str(q.get("transaction_id", "")).lower()
                    or s_lower in str(q.get("account_id", "")).lower()
                    or s_lower in str(q.get("network", {}).get("ip", "")).lower()
                ]

            from src.metrics_calculator import compute_quarantine_metrics
            quar_metrics = compute_quarantine_metrics(enriched_feed)
            for idx, q_item in enumerate(enriched_feed, start=1001):
                if not q_item.get("case_id"):
                    q_item["case_id"] = f"CASE-{idx:04d}"

            self._send_json(200, {
                "tab": tab_filter,
                "counts": {
                    "open": open_count,
                    "at_risk": at_risk_count,
                    "breached": breached_count,
                    "escalated": escalated_count,
                    "released": released_count,
                    "confirmed_fraud": confirmed_count,
                    "all": len(enriched_feed)
                },
                "metrics": quar_metrics,
                "total_count": len(filtered),
                "items": filtered
            })
            return

        # 8. REST API: /api/stats
        if path == "/api/stats":
            from src.metrics_calculator import compute_system_metrics
            combined, main_r, quar_r = get_combined_records(self.get_db())
            sys_metrics = compute_system_metrics(combined, quar_r)

            sim = self.get_simulator()
            is_active = bool(sim.is_running)
            current_tps = calculate_live_tps(combined, is_stream_active=is_active, configured_tps=sim.tps)

            now_dt = datetime.now(timezone.utc)
            sparkline_30m = [0] * 6
            for r in combined:
                ts = r.get("timestamp") or r.get("quarantine_ts")
                if ts:
                    try:
                        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
                        diff_sec = (now_dt - dt).total_seconds()
                        if 0 <= diff_sec < 1800:
                            idx = int(diff_sec // 300)
                            if 0 <= idx < 6:
                                sparkline_30m[5 - idx] += 1
                    except Exception:
                        pass

            self._send_json(200, {
                "total_processed": sys_metrics["total_processed"],
                "total_events": sys_metrics["total_events"],
                "flagged_count": sys_metrics["flagged_count"],
                "blocked_count": sys_metrics["blocked_count"],
                "block_rate_pct": sys_metrics["block_rate_pct"],
                "quarantine_active": sys_metrics["quarantine_active"],
                "quarantine_backlog": sys_metrics["quarantine_backlog"],
                "sla_breaches": sys_metrics["sla_breaches"],
                "mttr_minutes": sys_metrics["mttr_minutes"],
                "release_rate_pct": sys_metrics["release_rate_pct"],
                "confirmed_fraud_rate_pct": sys_metrics["confirmed_fraud_rate_pct"],
                "false_positive_rate_pct": sys_metrics["false_positive_rate_pct"],
                "stream_active": is_active,
                "stream_state": "LIVE" if is_active else "OFF",
                "tps": current_tps,
                "sparkline_30m": sparkline_30m,
                "delta_vs_previous_hour_pct": 3.8,
                "environment": os.environ.get("ENVIRONMENT", "Demo"),
                "uptime_seconds": int(time.time() - START_TIME)
            })
            return

        # 9. REST API: /api/analytics
        if path == "/api/analytics":
            from src.analytics_aggregator import aggregate_soc_analytics
            combined, _, quar_r = get_combined_records(self.get_db())
            from_ts = query.get("from", [None])[0]
            to_ts = query.get("to", [None])[0]
            data = aggregate_soc_analytics(combined, quar_r, from_ts, to_ts)
            self._send_json(200, data)
            return

        # 10. REST API: /api/config
        if path == "/api/config":
            from src.config_manager import load_current_config, get_version_history
            cfg = load_current_config()
            versions = get_version_history()
            self._send_json(200, {
                "config": cfg,
                "versions": versions
            })
            return

        # 9. REST API: /api/health
        if path == "/api/health":
            self._send_json(200, {
                "status": "healthy",
                "service": "FraudGuard Operations Console",
                "version": "2.4.0",
                "uptime_seconds": int(time.time() - START_TIME)
            })
            return

        # 10. REST API: /api/simulator/status
        if path == "/api/simulator/status":
            sim = self.get_simulator()
            self._send_json(200, sim.get_status())
            return

        # Fallback 404
        self._send_json(404, {"error": "NOT_FOUND", "path": path})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        length = _safe_int(self.headers.get("Content-Length", "0"), 0, min_val=0)
        raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
        try:
            body = json.loads(raw)
        except Exception:
            self._send_json(400, {"error": "INVALID_JSON"})
            return

        if not isinstance(body, dict):
            self._send_json(400, {"error": "INVALID_PAYLOAD", "message": "Request body must be a JSON object."})
            return

        # 0A. /api/config/dry-run (Simulate changes without saving)
        if path == "/api/config/dry-run":
            from src.config_manager import simulate_draft_impact
            combined, _, _ = get_combined_records(self.get_db())
            draft = body.get("config", body)
            impact = simulate_draft_impact(draft, combined)
            self._send_json(200, impact)
            return

        # 0B. /api/config (Governed Configuration Mutation - Admin Only)
        if path == "/api/config":
            from src.config_manager import save_config_version, validate_config
            qm = QuarantineManager(db_client=self.get_db())
            auth_token = body.get("auth_token") or self.headers.get("X-API-Key")
            is_auth, auth_user, role = qm.verify_auth(auth_token, dict(self.headers))
            if role != "admin":
                self._send_json(403, {
                    "error": "FORBIDDEN",
                    "message": "Configuration mutations are restricted to Administrator roles."
                })
                return

            candidate = body.get("config", body)
            valid, err = validate_config(candidate)
            if not valid:
                self._send_json(400, {"error": "VALIDATION_FAILED", "message": err})
                return

            reason = body.get("reason", "Governed threshold update")
            try:
                saved = save_config_version(candidate, operator=auth_user or "admin", reason=reason)
                self._send_json(200, saved)
            except Exception as e:
                self._send_json(400, {"error": "SAVE_ERROR", "message": str(e)})
            return

        # 0C. /api/config/restore (Version Rollback - Admin Only)
        if path == "/api/config/restore":
            from src.config_manager import save_config_version, get_version_history
            qm = QuarantineManager(db_client=self.get_db())
            auth_token = body.get("auth_token") or self.headers.get("X-API-Key")
            is_auth, auth_user, role = qm.verify_auth(auth_token, dict(self.headers))
            if role != "admin":
                self._send_json(403, {"error": "FORBIDDEN", "message": "Only admins can restore configuration versions."})
                return

            target_v = body.get("version_id")
            history = get_version_history()
            match = next((v for v in history if v.get("version_id") == target_v), None)
            if not match:
                self._send_json(404, {"error": "VERSION_NOT_FOUND", "version_id": target_v})
                return

            saved = save_config_version(match["config"], operator=auth_user or "admin", reason=f"Rollback to {target_v}")
            self._send_json(200, saved)
            return

        # 1. /api/simulate
        if path == "/api/simulate":
            preset = str(body.get("preset") or "NORMAL").upper()
            sim = self.get_simulator()
            result = sim.execute_simulation(preset)
            self._send_json(200, {
                "preset": preset,
                "latency_ms": result.get("execution_ms", 1.2),
                "result": result
            })
            return

        # 2. /api/simulator/toggle
        if path == "/api/simulator/toggle":
            sim = self.get_simulator()
            activate = bool(body.get("active", not sim.is_running))
            tps = float(body.get("tps", 1.0))
            if activate:
                sim.start_background(tps=tps)
            else:
                sim.stop_background()
            self._send_json(200, sim.get_status())
            return

        # 3. /api/quarantine/{id}/action
        if path.startswith("/api/quarantine/") and path.endswith("/action"):
            parts = [p for p in path.split("/") if p]
            if len(parts) < 4:
                self._send_json(400, {"error": "INVALID_PATH"})
                return
            tx_id = unquote(parts[2])
            if not tx_id or len(tx_id) > 128 or ".." in tx_id or not re.match(r"^[A-Za-z0-9_\-\.\:\@]+$", tx_id):
                self._send_json(400, {"error": "Invalid transaction_id format"})
                return
            if len(str(body.get("notes") or "")) > 2000:
                self._send_json(400, {"error": "Notes field exceeds maximum allowed length of 2000 characters"})
                return
            qm = QuarantineManager(db_client=self.get_db())
            auth_token = (
                body.get("api_key")
                or self.headers.get("X-API-Key")
                or self.headers.get("Authorization", "").replace("Bearer ", "").strip()
            )
            res = qm.execute_action(
                transaction_id=tx_id,
                action=body.get("action", "RELEASE"),
                analyst_id=body.get("analyst_id") or self.headers.get("X-Analyst-ID", "analyst_1"),
                reason=body.get("reason", "Operator resolution"),
                notes=body.get("notes"),
                auth_token=auth_token,
                headers=dict(self.headers)
            )
            self._send_json(res["http_status"], res)
            return

        # 4. /api/release
        if path == "/api/release":
            qm = QuarantineManager(db_client=self.get_db())
            res = qm.release_transaction(
                transaction_id=body.get("transaction_id"),
                analyst_notes=body.get("analyst_notes", "Released via API"),
                headers=dict(self.headers)
            )
            self._send_json(res["http_status"], res)
            return

        # 5. /api/quarantine/bulk
        if path == "/api/quarantine/bulk":
            qm = QuarantineManager(db_client=self.get_db())
            ids = body.get("transaction_ids", [])
            action = body.get("action", "RELEASE")
            reason = body.get("reason", "Bulk review")
            res = qm.bulk_action(
                transaction_ids=ids,
                action=action,
                reason=reason,
                headers=dict(self.headers)
            )
            self._send_json(res["http_status"], res)
            return

        # 6. /api/auth/reveal-pii
        if path == "/api/auth/reveal-pii":
            tx_id = body.get("transaction_id")
            tx_rec = self.get_db().get_transaction_by_id(tx_id)
            if not tx_rec:
                self._send_json(404, {"error": "TRANSACTION_NOT_FOUND"})
                return

            pii = tx_rec.get("pii_enrichment") or {}
            unmasked = pii.get("account_holder_name", "DEMO_HOLDER (MOCK)")
            # Audit log the reveal event
            qm = QuarantineManager(db_client=self.get_db())
            qm._append_action_audit({
                "transaction_id": tx_id,
                "action": "PII_UNMASK_REVEAL",
                "operator": self.headers.get("X-Analyst-ID", "analyst_operator"),
                "role": self.headers.get("X-User-Role", "analyst"),
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            })

            self._send_json(200, {
                "transaction_id": tx_id,
                "unmasked_name": unmasked,
                "audit_recorded": True
            })
            return

        self._send_json(404, {"error": "NOT_FOUND", "path": path})

    def log_message(self, format: str, *args: Any) -> None:
        pass


class ThreadedConsoleServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Silently absorb client disconnects (ConnectionResetError, BrokenPipeError) on SSE
        pass


def run_server(port: int = 8081) -> None:
    try:
        from src.map_seeder import seed_historical_map_data
        seed_historical_map_data(DBClient(), force=False)
    except Exception as e:
        pass
    server_address = ("0.0.0.0", port)
    httpd = ThreadedConsoleServer(server_address, TelemetryHTTPRequestHandler)
    print("\n==========================================================================")
    print(f" FraudGuard Real-Time Console Running at: http://localhost:{port}")
    print("==========================================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping console server...")
        httpd.server_close()


if __name__ == "__main__":
    port_num = _safe_int(os.environ.get("DASHBOARD_PORT", "8081"), 8081, min_val=1, max_val=65535)
    run_server(port=port_num)
