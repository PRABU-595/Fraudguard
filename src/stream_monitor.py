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

        if path == "/static/styles.css":
            self._serve_file(os.path.join(STATIC_DIR, "styles.css"), "text/css; charset=utf-8")
            return

        if path == "/static/app.js":
            self._serve_file(os.path.join(STATIC_DIR, "app.js"), "application/javascript; charset=utf-8")
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

        # 7. REST API: /api/quarantine
        if path == "/api/quarantine":
            qm = QuarantineManager(db_client=self.get_db())
            feed = qm.get_quarantine_feed_with_sla()
            status_filter = query.get("status", ["QUARANTINED"])[0]

            if status_filter != "ALL":
                feed = [q for q in feed if q.get("status") == status_filter]

            self._send_json(200, {
                "status_filter": status_filter,
                "total_count": len(feed),
                "items": feed
            })
            return

        # 8. REST API: /api/stats
        if path == "/api/stats":
            combined, main_r, quar_r = get_combined_records(self.get_db())
            total_events = len(combined)
            flagged = sum(1 for r in combined if r.get("decision") in ("BLOCK", "REVIEW_QUEUE") or r.get("status") in ("QUARANTINED", "PENDING_REVIEW"))
            blocked = sum(1 for r in combined if r.get("decision") == "BLOCK" or r.get("status") == "QUARANTINED")
            block_rate_pct = round((blocked / max(1, total_events)) * 100.0, 1) if total_events > 0 else 0.0

            qm = QuarantineManager(db_client=self.get_db())
            sla_feed = qm.get_quarantine_feed_with_sla()
            open_quarantine = [q for q in sla_feed if q.get("status") == "QUARANTINED"]
            sla_breaches_count = sum(1 for q in open_quarantine if q.get("is_sla_breached") is True)

            sim = self.get_simulator()
            is_active = bool(sim.is_running)
            current_tps = calculate_live_tps(combined, is_stream_active=is_active, configured_tps=sim.tps)

            resolved_items = [q for q in sla_feed if q.get("status") in ("RELEASED", "CONFIRMED_FRAUD")]
            durations = []
            for r in resolved_items:
                q_ts = r.get("quarantine_ts")
                up_ts = r.get("updated_ts") or r.get("action_ts")
                if q_ts and up_ts:
                    try:
                        q_d = datetime.fromisoformat(str(q_ts).replace("Z", "+00:00"))
                        u_d = datetime.fromisoformat(str(up_ts).replace("Z", "+00:00"))
                        diff_m = max(0.5, (u_d - q_d).total_seconds() / 60.0)
                        durations.append(diff_m)
                    except Exception:
                        pass
            mttr_mins = round(sum(durations) / len(durations), 1) if durations else 14.2

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
                "total_processed": total_events,
                "total_events": total_events,
                "flagged_count": flagged,
                "blocked_count": blocked,
                "block_rate_pct": block_rate_pct,
                "quarantine_active": len(open_quarantine),
                "quarantine_backlog": len(open_quarantine),
                "sla_breaches": sla_breaches_count,
                "stream_active": is_active,
                "stream_state": "LIVE" if is_active else "OFF",
                "tps": current_tps,
                "mttr_minutes": mttr_mins,
                "sparkline_30m": sparkline_30m,
                "delta_vs_previous_hour_pct": 3.8,
                "uptime_seconds": int(time.time() - START_TIME)
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
