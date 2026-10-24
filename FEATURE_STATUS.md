# FraudGuard Feature Audit & Status Matrix

This document provides a transparent, auditable breakdown of every feature in FraudGuard, distinguishing production-live implementations from simulated adapters, explaining fallback mechanisms, and detailing verification procedures.

---

## 1. Feature Status Matrix

| Feature ID | Module & Component | Status | Real vs Simulated | Data Source / Provider Adapter | Verification Instructions |
|---|---|---|---|---|---|
| **Feature A** | **Source of Origin Request** (`src/origin_tracer.py`) | **LIVE** | **Real** (MaxMind DB + Tor Bulk Exit List + Heuristics) | • MaxMind GeoLite2 City `.mmdb` (offline)<br>• ip-api fallback<br>• Bulk Tor exit list cache (`check.torproject.org`)<br>• Datacenter ASN list (DigitalOcean, OVH, AWS, Hetzner) | Run `python tests/test_phase2_backend.py` (Test 1 & 2). Inject Tor IP (`185.220.101.1`) to verify `ORIGIN_TOR` and `TOR_EXIT_NODE` force block. |
| **Feature B** | **Extended Attributes** (`src/router_function.py`, `schema/transaction_schema.json`) | **LIVE** | **Real** (Parsed from payload & client headers) | • Captured: `user_agent`, `browser`, `os`, `session_id`, `mcc`, `is_new_device`, `is_new_beneficiary`, timezone mismatch | Check `transaction_schema.json` and drawer Attributes grid in UI or `/api/transactions` output. |
| **Feature C** | **Track Back Transaction** (`src/traceback_analyzer.py`) | **LIVE** | **Real** (Stateful audit trail & graph generator) | • 1h / 24h / 7d velocity metrics<br>• Amount z-score against historical baseline<br>• Entity relationship graph (Account ↔ Device ↔ IP ↔ Merchant) | Run `python tests/test_phase2_backend.py` (Test 3) or visit `/api/accounts/{id}/trail`. Inspect node graph in Accounts tab. |
| **Feature D** | **Time Span Analysis** (`src/time_analyzer.py`) | **LIVE** | **Real** (IANA local timezone conversion & heuristics) | • UTC to local time via origin timezone<br>• `UNUSUAL_HOUR` (01:00–05:00)<br>• `RAPID_SUCCESSION` (<120s)<br>• `DORMANT_REACTIVATION` (>60 days)<br>• `BURST_ACTIVITY` (≥3 in 5 min) | Run `python tests/test_phase2_backend.py` (Test 4). See 24h heat strip in transaction drawer Overview tab. |
| **Feature E** | **Multi-Source Location Priority** (`src/location_checker.py`) | **LIVE & SIMULATED** | **Hybrid / Adapter** | • Carrier Cell Tower (Simulated / CAMARA adapter)<br>• Device GPS (consented)<br>• IP Geolocation (MaxMind / ip-api)<br>• Priority resolver: Carrier > GPS > IP | Run `python tests/test_phase2_backend.py` (Test 5). Verify location freshness and accuracy metadata. |
| **Feature F** | **Anomaly Blocking & Quarantine SLA** (`src/quarantine_manager.py`) | **LIVE** | **Real** (Configurable rule engine & SLA manager) | • Configurable rules via `src/config_rules.json`<br>• Force-block rules (`TOR_EXIT_NODE`, `IMPOSSIBLE_TRAVEL`)<br>• 60-minute review SLA countdown<br>• Lifecycle actions: `RELEASE`, `CONFIRM_FRAUD`, `ESCALATE`, `ADD_NOTE`<br>• Append-only audit log in `data/analyst_action_audit.json` | Run `python tests/test_phase2_backend.py` (Test 6) and `tests/test_phase3_api_and_console.py`. Inspect Quarantine tab in UI. |
| **Feature G** | **In-Depth Transaction Inspection** (`static/app.js`, `static/index.html`) | **LIVE** | **Real** | • 8-tab drawer: Overview, Map, Risk Signals, History, Customer, Network, Raw JSON, Audit Log<br>• Risk gauge (0–100)<br>• JSON export (`/transaction/{id}/export`) | Click any row in Live Feed or marker on map. Drawer slides in with live telemetry. |
| **Feature H.1** | **Cell Location Provider** (`src/provider_adapters.py`) | **SIMULATED** | **Adapter Contract** (Labeled in UI) | • `CAMARACellLocationAdapter` (telecom device verification)<br>• `OpenCellIDAdapter` (MCC/MNC/LAC/CID)<br>• `SimulatedCellLocationProvider` (mock cell tower) | Toggle provider in `src/config_rules.json` or `.env`. Badge displays `SIMULATED` in UI. |
| **Feature H.2** | **Identity Risk Provider** (`src/provider_adapters.py`) | **SIMULATED** | **Adapter Contract** (Labeled in UI) | • `VendorIdentityRiskAdapter`<br>• `MockIdentityRiskProvider`<br>• PII masking (`J*** D**`)<br>• SIM swap detection | Badge displays `SIMULATED` in UI. Unmasked PII requires analyst role + authentication. |
| **Feature H.3** | **Social Network Reputation** (`src/provider_adapters.py`) | **SIMULATED** | **Adapter Contract** (Zero Web Scraping) | • `LicensedSocialRiskAdapter` (consented API)<br>• `MockSocialRiskProvider`<br>• Reputation score, linked account count, disposable email detection | Strictly complies with anti-scraping guidelines. Badge displays `SIMULATED` in UI. |
| **Interactive Map** | **Leaflet Dark Threat Map** (`static/app.js`) | **LIVE** | **Real** | • OpenStreetMap tiles with dark CartoDB style<br>• Toggleable layers: Origin, Home, Cell Tower, Travel Polyline<br>• Pulsing red polyline for speed > 900 km/h<br>• Account movement timeline with slider | Navigate to "Threat Map" tab. Run `IMPOSSIBLE_TRAVEL` scenario to see animated travel arc and speed warning. |
| **Streaming** | **Server-Sent Events (SSE)** (`src/sse_manager.py`) | **LIVE** | **Real** | • Long-lived `/stream` HTTP connection<br>• 15s keep-alive heartbeats<br>• Auto-reconnect client logic | Open dashboard at `http://localhost:8081`. Watch SSE status indicator turn green (Connected). |

---

## 2. Standardized Provider Contract

Every external telemetry provider implements the following contract:

```python
@dataclass
class ProviderResult:
    is_simulated: bool      # Explicit transparency flag
    source: str            # E.g., 'CAMARA_TELECOM_API', 'MOCK_CELL_TOWER'
    confidence: float      # Confidence score 0.0 - 1.0
    fetched_at: str        # ISO 8601 UTC timestamp
    data: Dict[str, Any]   # Provider payload
```

In the UI, every card powered by a provider includes a prominent badge:
- **LIVE**: Real, verified external or database source.
- **SIMULATED**: Deterministic sandbox adapter for evaluation and demo purposes without requiring commercial carrier contracts.
