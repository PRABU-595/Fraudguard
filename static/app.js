/**
 * FraudGuard Operations Console - Enterprise Frontend Application
 * Real-time SSE, Interactive Leaflet Threat Map, Quarantine SLA Operations,
 * Entity Relationship Graph, Chart.js Analytics, and RBAC Audit Controls.
 */

const FLAG_EXPLANATIONS = {
    "ORIGIN_VPN": "Transaction originated from a commercial VPN service (+20 risk).",
    "ORIGIN_TOR": "Transaction originated from a Tor anonymizing exit relay (+20 risk, automatic block).",
    "TOR_EXIT_NODE": "Source IP verified against active Tor bulk exit registry (Force BLOCK).",
    "ORIGIN_PROXY": "Transaction routed through an open or commercial HTTP/SOCKS proxy (+15 risk).",
    "DATACENTER_IP": "Source IP registered to a cloud hosting provider or datacenter ASN (+15 risk).",
    "GEO_ORIGIN_MISMATCH": "IP location country differs from cardholder registered home country (+10 risk).",
    "TIMEZONE_MISMATCH": "Device/client reported timezone mismatches origin IP geolocation timezone (+10 risk).",
    "VELOCITY_SPIKE": "Unusually high transaction count for this account in a 1-hour window (+25 risk).",
    "AMOUNT_SPIKE": "Transaction amount exceeds account baseline by >300% (+20 risk).",
    "AMOUNT_ZSCORE_ANOMALY": "Transaction amount deviates >3 standard deviations from historical mean (+15 risk).",
    "UNUSUAL_HOUR": "Nighttime activity (23:00 to 05:00 local time) outside account's typical active hours (+15 risk).",
    "RAPID_SUCCESSION": "Transaction occurred less than 2 minutes after prior account activity (+20 risk).",
    "DORMANT_REACTIVATION": "Sudden activity on an account dormant for >60 days (+15 risk).",
    "BURST_ACTIVITY": "Burst of >= 3 transactions within a 5-minute interval (+20 risk).",
    "IMPOSSIBLE_TRAVEL": "Implied travel speed between consecutive transactions exceeds 900 km/h (Force BLOCK).",
    "INTERNATIONAL_TRANSACTION": "Transaction destination or rail operates across international borders (+10 risk).",
    "LOCATION_MISMATCH": "Cell-tower / device location differs from transaction origin city (+15 risk).",
    "NEW_ACCOUNT": "Account tenure is less than 30 days (+10 risk).",
    "UNVERIFIED_CONTACT": "Account holder phone number has not been SMS verified (+5 risk).",
    "SIM_SWAP_DETECTED": "Telecom carrier reported a SIM-swap within the last 7 days (+25 risk).",
    "NEW_DEVICE_DETECTED": "First time account has transacted from this device fingerprint (+10 risk).",
    "NEW_BENEFICIARY_DETECTED": "First transfer to this counterparty account (+10 risk).",
    "AMOUNT_ANOMALY": "High-value transfer exceeding deterministic threshold ($180.00).",
    "CHANNEL_RISK": "High-value transfer over elevated-risk payment rail ($150.00+ WIRE/CHECK).",
    "HIGH_VELOCITY": "Elevated 6-hour transaction frequency detected by the velocity monitor."
};

class FraudGuardApp {
    constructor() {
        this.transactions = [];
        this.quarantine = [];
        this.selectedTx = null;
        this.activeView = 'feed';
        this.activeDrawerTab = 'overview';
        this.isPaused = false;
        this.page = 1;
        this.limit = 15;
        this.totalCount = 0;
        this.selectedQuarantineIds = new Set();
        
        // RBAC Session
        this.currentUser = {
            name: "Sarah Chen",
            role: "analyst", // viewer, analyst, admin
            token: "fg-analyst-demo-key-2026"
        };

        // Map state
        this.map = null;
        this.mapLayers = {
            origin: null,
            home: null,
            cell: null,
            travel: null
        };
        this.layerVisibility = {
            origin: true,
            home: true,
            cell: true,
            travel: true
        };
        this.selectedAccountTrail = [];
        this.accountTimelineIndex = 0;

        // Analytics Charts
        this.charts = {};

        // Simulator
        this.streamActive = false;
    }

    init() {
        this.updateUserBadge();
        this.initMap();
        this.loadTransactions();
        this.loadQuarantineFeed();
        this.initSSE();
        this.initCharts();
        this.startSLATicker();
        this.pollSimulatorStatus();
        this.initKeyboardShortcuts();
    }

    initKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
            if (e.key === 'Escape') {
                this.closeDrawer();
                this.closeActionModal();
                this.closeLoginModal();
            } else if (e.key === '1') {
                this.runScenario('NORMAL');
            } else if (e.key === '2') {
                this.runScenario('IMPOSSIBLE_TRAVEL');
            } else if (e.key === '3') {
                this.runScenario('TOR_ATTACK');
            } else if (e.key === '4') {
                this.runScenario('VELOCITY_BURST');
            } else if (e.key === '5') {
                this.runScenario('NIGHT_FRAUD');
            }
        });
    }

    // =========================================================================
    // 1. Navigation & Views
    // =========================================================================

    switchView(viewName) {
        this.activeView = viewName;
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        document.querySelectorAll('.view-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `view-${viewName}`);
        });

        if (viewName === 'map' && this.map) {
            setTimeout(() => this.map.invalidateSize(), 150);
        } else if (viewName === 'quarantine') {
            this.loadQuarantineFeed();
        } else if (viewName === 'accounts') {
            this.loadAccountsView();
        } else if (viewName === 'analytics') {
            this.updateCharts();
        }
    }

    // =========================================================================
    // 2. Real-Time Server-Sent Events (SSE)
    // =========================================================================

    initSSE() {
        const dot = document.getElementById('sse-status-dot');
        const text = document.getElementById('sse-status-text');

        if (!window.EventSource) {
            text.innerText = "SSE Not Supported (Polling)";
            setInterval(() => this.loadTransactions(), 3000);
            return;
        }

        const es = new EventSource('/stream');

        es.onopen = () => {
            dot.className = "indicator-dot dot-live";
            text.innerText = "SSE Live Connected";
        };

        es.addEventListener('transaction', (event) => {
            try {
                const tx = JSON.parse(event.data);
                this.onNewTransaction(tx);
            } catch (err) {
                console.error("SSE parse error", err);
            }
        });

        es.addEventListener('ping', () => {
            dot.className = "indicator-dot dot-live";
        });

        es.onerror = () => {
            dot.className = "indicator-dot dot-off";
            text.innerText = "SSE Reconnecting...";
        };
    }

    onNewTransaction(tx) {
        if (!this.isPaused) {
            this.transactions.unshift(tx);
            if (this.transactions.length > 500) this.transactions.pop();
            this.renderFeedTable();
            this.updateStats();
        }

        // Live Map Update
        if (this.map) {
            this.addTransactionToMap(tx, true);
        }

        // Quarantine check
        if (tx.decision === 'BLOCK' || tx.status === 'QUARANTINED') {
            this.quarantine.unshift(tx);
            this.renderQuarantineTable();
            this.showToast(`🚨 QUARANTINED: ${tx.transaction_id} ($${tx.amount.toFixed(2)})`, 'danger');
        }
    }

    // =========================================================================
    // 3. Transactions Feed & REST API
    // =========================================================================

    async loadTransactions() {
        try {
            const params = new URLSearchParams({
                page: this.page,
                limit: this.limit
            });
            const res = await fetch(`/api/transactions?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                this.transactions = data.items || [];
                this.totalCount = data.total_count || this.transactions.length;
                this.renderFeedTable();
                this.updateStats(data);
                this.populateMapInitial();
            }
        } catch (err) {
            console.error("Failed to load transactions", err);
        }
    }

    renderFeedTable() {
        const tbody = document.getElementById('transactions-tbody');
        const countLabel = document.getElementById('table-record-count');
        const pageLabel = document.getElementById('page-indicator');

        const filtered = this.getFilteredTransactions();
        countLabel.innerText = `Showing ${filtered.length} events`;
        pageLabel.innerText = `Page ${this.page} of ${Math.max(1, Math.ceil(this.totalCount / this.limit))}`;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No transactions match the selected filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(tx => {
            const score = tx.risk_score !== undefined ? tx.risk_score : 0;
            const scoreClass = score >= 80 ? 'text-block' : (score >= 40 ? 'text-amber' : 'text-green');
            const pillClass = tx.decision === 'BLOCK' ? 'pill-block' : (tx.decision === 'REVIEW_QUEUE' ? 'pill-review' : 'pill-allow');
            const flags = (tx.flags || tx.triggered_rules || []).slice(0, 3);
            const flagChips = flags.map(f => `<span class="flag-chip ${f.includes('TOR') || f.includes('TRAVEL') ? 'flag-chip-danger' : ''}">${f}</span>`).join('');

            return `
                <tr onclick="app.openDrawer('${tx.transaction_id}')">
                    <td class="font-mono" style="font-size:11.5px;">${this.formatTime(tx.timestamp)}</td>
                    <td class="font-mono font-semibold">${tx.transaction_id}</td>
                    <td class="font-mono">${tx.account_id || tx.source_account || 'acc_1'}</td>
                    <td class="font-mono font-semibold">$${Number(tx.amount || 0).toFixed(2)}</td>
                    <td>${tx.attributes?.payment_channel || tx.txn_type || 'ONLINE'}</td>
                    <td>${tx.origin?.city || tx.transaction_city || 'New York'}, ${tx.origin?.country || tx.transaction_country || 'US'}</td>
                    <td class="font-mono ${scoreClass}" style="font-weight:700;">${score}/100</td>
                    <td><span class="pill ${pillClass}">${tx.decision || 'ALLOW'}</span></td>
                    <td>${flagChips}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); app.openDrawer('${tx.transaction_id}')">Inspect</button>
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('nav-feed-count').innerText = this.transactions.length;
    }

    getFilteredTransactions() {
        const search = (document.getElementById('filter-search')?.value || '').toLowerCase();
        const decision = document.getElementById('filter-decision')?.value || '';
        const country = document.getElementById('filter-country')?.value || '';
        const channel = document.getElementById('filter-channel')?.value || '';

        return this.transactions.filter(tx => {
            if (decision && tx.decision !== decision) return false;
            if (country && (tx.origin?.country !== country && tx.transaction_country !== country)) return false;
            if (channel && (tx.attributes?.payment_channel !== channel && tx.txn_type !== channel)) return false;
            if (search) {
                const text = `${tx.transaction_id} ${tx.account_id} ${tx.source_account} ${tx.origin?.ip_address} ${tx.origin?.city}`.toLowerCase();
                if (!text.includes(search)) return false;
            }
            return true;
        });
    }

    applyFilters() {
        this.renderFeedTable();
    }

    togglePauseFeed() {
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('btn-pause-feed');
        btn.innerText = this.isPaused ? "▶ Resume Feed" : "⏸ Pause Feed";
        btn.classList.toggle('btn-primary', this.isPaused);
        btn.classList.toggle('btn-outline', !this.isPaused);
    }

    prevPage() {
        if (this.page > 1) {
            this.page--;
            this.loadTransactions();
        }
    }

    nextPage() {
        if (this.page * this.limit < this.totalCount) {
            this.page++;
            this.loadTransactions();
        }
    }

    // =========================================================================
    // 4. Interactive Leaflet Threat Map
    // =========================================================================

    initMap() {
        const mapContainer = document.getElementById('leaflet-threat-map');
        if (!mapContainer || this.map) return;

        // Initialize Map centered on World View
        this.map = L.map('leaflet-threat-map', {
            center: [30.0, 10.0],
            zoom: 2.5,
            minZoom: 2,
            maxZoom: 18,
            attributionControl: false
        });

        // Dark-styled OpenStreetMap tiles (100% free, zero API key required)
        const tileUrl = window.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
        L.tileLayer(tileUrl, {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(this.map);

        // Layer Groups
        this.mapLayers.origin = L.layerGroup().addTo(this.map);
        this.mapLayers.home = L.layerGroup().addTo(this.map);
        this.mapLayers.cell = L.layerGroup().addTo(this.map);
        this.mapLayers.travel = L.layerGroup().addTo(this.map);
    }

    populateMapInitial() {
        if (!this.map) return;
        this.transactions.slice(0, 30).forEach(tx => this.addTransactionToMap(tx, false));
        this.populateAccountDropdown();
    }

    addTransactionToMap(tx, flyTo = false) {
        if (!this.map) return;

        const origin = tx.origin || {};
        const coords = origin.coordinates || tx.location_check?.transaction_coordinates || { lat: 40.7128, lon: -74.0060 };
        const score = tx.risk_score || 0;
        const color = score >= 80 ? '#ef4444' : (score >= 40 ? '#f59e0b' : '#10b981');

        // 1. Origin Marker
        const originMarker = L.circleMarker([coords.lat, coords.lon], {
            radius: 7,
            fillColor: color,
            color: '#fff',
            weight: 1.5,
            opacity: 0.9,
            fillOpacity: 0.8
        });
        originMarker.bindPopup(`
            <div style="font-family:var(--font-sans); color:#1e293b;">
                <strong>${tx.transaction_id}</strong><br>
                Account: ${tx.account_id || tx.source_account}<br>
                Amount: $${Number(tx.amount || 0).toFixed(2)}<br>
                Score: <strong>${score}/100</strong> (${tx.decision})<br>
                <a href="javascript:void(0)" onclick="app.openDrawer('${tx.transaction_id}')" style="color:#2563eb; font-weight:600;">Inspect Transaction →</a>
            </div>
        `);
        originMarker.addTo(this.mapLayers.origin);

        // 2. Home Location Pin
        const regCoords = tx.location_check?.account_registered_coordinates;
        if (regCoords && regCoords.lat && regCoords.lon) {
            const homeMarker = L.circleMarker([regCoords.lat, regCoords.lon], {
                radius: 5,
                fillColor: '#3b82f6',
                color: '#fff',
                weight: 1,
                fillOpacity: 0.8
            });
            homeMarker.bindTooltip(`Registered Home: ${tx.location_check.account_registered_city}`);
            homeMarker.addTo(this.mapLayers.home);
        }

        // 3. Cell Tower Location Pin & Radius
        const cell = tx.location_check?.latest_location;
        if (cell && cell.coordinates && cell.source === 'carrier_cell_tower') {
            const cellCircle = L.circle([cell.coordinates.lat, cell.coordinates.lon], {
                radius: cell.accuracy_meters || 150,
                color: '#a855f7',
                fillColor: '#a855f7',
                fillOpacity: 0.15,
                weight: 1
            });
            cellCircle.bindTooltip(`Cell Tower Radius: ${cell.city} (${cell.accuracy_meters}m) [SIMULATED]`);
            cellCircle.addTo(this.mapLayers.cell);
        }

        // 4. Travel Path Polyline
        const isImpossible = tx.location_check?.is_impossible_travel;
        const speed = tx.location_check?.travel_speed_kmh || 0;
        const prevTx = tx.traceback?.previous_transaction_id;

        if (prevTx && regCoords && coords) {
            const line = L.polyline([[regCoords.lat, regCoords.lon], [coords.lat, coords.lon]], {
                color: isImpossible ? '#ef4444' : '#64748b',
                weight: isImpossible ? 3 : 1.5,
                dashArray: isImpossible ? '4, 8' : '2, 4',
                className: isImpossible ? 'impossible-travel-path' : ''
            });
            line.bindTooltip(`Travel: ${tx.location_check?.distance_km}km | Speed: ${speed} km/h ${isImpossible ? '⚠️ IMPOSSIBLE' : ''}`);
            line.addTo(this.mapLayers.travel);
        }

        if (flyTo) {
            this.map.flyTo([coords.lat, coords.lon], Math.max(this.map.getZoom(), 4), { duration: 1.2 });
        }
    }

    toggleMapLayer(layerName) {
        const isVisible = !this.layerVisibility[layerName];
        this.layerVisibility[layerName] = isVisible;
        document.getElementById(`layer-toggle-${layerName}`)?.classList.toggle('active', isVisible);

        const group = this.mapLayers[layerName];
        if (group) {
            if (isVisible) {
                this.map.addLayer(group);
            } else {
                this.map.removeLayer(group);
            }
        }
    }

    populateAccountDropdown() {
        const select = document.getElementById('map-account-select');
        if (!select) return;
        const accounts = [...new Set(this.transactions.map(t => t.account_id || t.source_account).filter(Boolean))];
        select.innerHTML = `<option value="">Select Account for Timeline</option>` + 
            accounts.map(acc => `<option value="${acc}">${acc}</option>`).join('');
    }

    async selectAccountForMap() {
        const accountId = document.getElementById('map-account-select').value;
        const slider = document.getElementById('map-timeline-slider');
        if (!accountId) {
            slider.disabled = true;
            return;
        }

        try {
            const res = await fetch(`/api/accounts/${accountId}/locations`);
            if (res.ok) {
                const data = await res.json();
                this.selectedAccountTrail = data.trail || [];
                slider.disabled = false;
                slider.max = Math.max(1, this.selectedAccountTrail.length - 1);
                slider.value = slider.max;
                this.onTimelineSliderChange(slider.value);
            }
        } catch (err) {
            console.error("Failed to load account trail", err);
        }
    }

    onTimelineSliderChange(val) {
        const index = parseInt(val, 10);
        document.getElementById('map-slider-val').innerText = `Point ${index + 1} of ${this.selectedAccountTrail.length}`;
        if (!this.selectedAccountTrail[index]) return;

        const pt = this.selectedAccountTrail[index];
        if (pt.coordinates) {
            this.map.flyTo([pt.coordinates.lat, pt.coordinates.lon], 6, { duration: 0.8 });
        }
    }

    // =========================================================================
    // 5. Quarantine Management & SLA Operations
    // =========================================================================

    async loadQuarantineFeed() {
        try {
            const statusFilter = document.getElementById('quarantine-status-filter')?.value || 'QUARANTINED';
            const res = await fetch(`/api/quarantine?status=${statusFilter}`);
            if (res.ok) {
                const data = await res.json();
                this.quarantine = data.items || [];
                this.renderQuarantineTable();
            }
        } catch (err) {
            console.error("Failed to load quarantine feed", err);
        }
    }

    renderQuarantineTable() {
        const tbody = document.getElementById('quarantine-tbody');
        if (!tbody) return;

        document.getElementById('nav-quarantine-count').innerText = this.quarantine.filter(q => q.status === 'QUARANTINED').length;

        if (this.quarantine.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="empty-state">No quarantined transactions found.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.quarantine.map(q => {
            const slaMins = q.sla_remaining_minutes !== undefined ? q.sla_remaining_minutes : 60;
            const isBreached = q.is_sla_breached;
            const slaDisplay = isBreached 
                ? `<span class="text-red font-semibold">⚠️ BREACHED (${Math.abs(slaMins)}m ago)</span>` 
                : `<span class="text-amber font-mono font-semibold">⏱ ${slaMins}m left</span>`;

            const isChecked = this.selectedQuarantineIds.has(q.transaction_id);
            const reasons = (q.reason_codes || q.flags || []).join(', ');

            return `
                <tr>
                    <td><input type="checkbox" ${isChecked ? 'checked' : ''} onclick="app.toggleSelectQuarantine('${q.transaction_id}')" /></td>
                    <td class="font-mono">${this.formatTime(q.quarantine_ts || q.timestamp)}</td>
                    <td class="font-mono font-semibold">${q.transaction_id}</td>
                    <td class="font-mono">${q.account_id || q.source_account}</td>
                    <td class="font-mono font-semibold">$${Number(q.amount || 0).toFixed(2)}</td>
                    <td class="font-mono text-block font-semibold">${q.risk_score || 95}/100</td>
                    <td>${slaDisplay}</td>
                    <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${reasons}</td>
                    <td><span class="pill pill-${q.status === 'RELEASED' ? 'allow' : 'block'}">${q.status}</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline text-green" onclick="app.openActionModal('${q.transaction_id}', 'RELEASE')">Release</button>
                        <button class="btn btn-sm btn-outline text-red" onclick="app.openActionModal('${q.transaction_id}', 'CONFIRM_FRAUD')">Confirm</button>
                        <button class="btn btn-sm btn-outline" onclick="app.openActionModal('${q.transaction_id}', 'ESCALATE')">Escalate</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    toggleSelectQuarantine(txId) {
        if (this.selectedQuarantineIds.has(txId)) {
            this.selectedQuarantineIds.delete(txId);
        } else {
            this.selectedQuarantineIds.add(txId);
        }
    }

    toggleSelectAllQuarantine(masterCheckbox) {
        if (masterCheckbox.checked) {
            this.quarantine.forEach(q => this.selectedQuarantineIds.add(q.transaction_id));
        } else {
            this.selectedQuarantineIds.clear();
        }
        this.renderQuarantineTable();
    }

    openActionModal(txId, action) {
        if (this.currentUser.role === 'viewer') {
            this.showToast("Permission Denied: Viewers cannot perform quarantine actions. Please switch to Analyst.", "danger");
            return;
        }

        this.pendingActionTxId = txId;
        this.pendingActionName = action;

        document.getElementById('action-modal-overlay').classList.remove('hidden');
        document.getElementById('action-modal-title').innerText = `Action: ${action} Transaction`;
        document.getElementById('action-modal-action-display').value = `${action} on ${txId}`;
        document.getElementById('action-modal-notes').value = '';
    }

    closeActionModal() {
        document.getElementById('action-modal-overlay').classList.add('hidden');
    }

    async submitAction() {
        const txId = this.pendingActionTxId;
        const action = this.pendingActionName;
        const reason = document.getElementById('action-modal-reason').value;
        const notes = document.getElementById('action-modal-notes').value || reason;

        try {
            const res = await fetch(`/api/quarantine/${txId}/action`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.currentUser.token || 'fg-analyst-demo-key-2026',
                    'X-Analyst-ID': this.currentUser.name,
                    'X-User-Role': this.currentUser.role
                },
                body: JSON.stringify({ action, reason, notes, api_key: this.currentUser.token || 'fg-analyst-demo-key-2026' })
            });

            const data = await res.json();
            if (res.ok) {
                this.showToast(`Action ${action} successful on ${txId}`, 'success');
                this.closeActionModal();
                this.loadQuarantineFeed();
                this.loadTransactions();
                if (this.selectedTx?.transaction_id === txId) {
                    this.openDrawer(txId);
                }
            } else {
                this.showToast(data.message || data.error || 'Action failed', 'danger');
            }
        } catch (err) {
            this.showToast('Network error performing action', 'danger');
        }
    }

    async bulkAction(action) {
        if (this.selectedQuarantineIds.size === 0) {
            this.showToast("Select at least one transaction for bulk action", "warning");
            return;
        }

        const ids = Array.from(this.selectedQuarantineIds);
        try {
            const res = await fetch('/api/quarantine/bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.currentUser.token || 'fg-analyst-demo-key-2026',
                    'X-Analyst-ID': this.currentUser.name,
                    'X-User-Role': this.currentUser.role
                },
                body: JSON.stringify({
                    transaction_ids: ids,
                    action: action,
                    reason: "Bulk analyst disposition",
                    api_key: this.currentUser.token || 'fg-analyst-demo-key-2026'
                })
            });

            if (res.ok) {
                this.showToast(`Bulk ${action} executed across ${ids.length} transactions`, 'success');
                this.selectedQuarantineIds.clear();
                this.loadQuarantineFeed();
                this.loadTransactions();
            }
        } catch (err) {
            this.showToast("Failed to execute bulk action", "danger");
        }
    }

    startSLATicker() {
        setInterval(() => {
            if (this.activeView === 'quarantine') {
                this.loadQuarantineFeed();
            }
        }, 15000);
    }

    // =========================================================================
    // 6. Detailed Transaction Inspection Drawer
    // =========================================================================

    async openDrawer(txId) {
        document.getElementById('drawer-overlay').classList.remove('hidden');
        document.getElementById('detail-drawer').classList.remove('hidden');

        try {
            const res = await fetch(`/api/transactions/${txId}`);
            if (res.ok) {
                this.selectedTx = await res.json();
                this.renderDrawerContent();
            }
        } catch (err) {
            console.error("Failed to load transaction details", err);
        }
    }

    closeDrawer() {
        document.getElementById('drawer-overlay').classList.add('hidden');
        document.getElementById('detail-drawer').classList.add('hidden');
        this.selectedTx = null;
    }

    switchDrawerTab(tabName) {
        this.activeDrawerTab = tabName;
        document.querySelectorAll('.dtab').forEach(b => {
            b.classList.toggle('active', b.innerText.toLowerCase().includes(tabName));
        });
        this.renderDrawerContent();
    }

    renderDrawerContent() {
        const tx = this.selectedTx;
        if (!tx) return;

        document.getElementById('drawer-tx-id').innerText = tx.transaction_id;
        document.getElementById('drawer-ts').innerText = `${tx.timestamp} (${tx.time_analysis?.local_time_formatted || 'Local Time'})`;

        const body = document.getElementById('drawer-body');
        const footer = document.getElementById('drawer-footer');

        // Render Active Tab Content
        if (this.activeDrawerTab === 'overview') {
            body.innerHTML = this.renderDrawerOverview(tx);
        } else if (this.activeDrawerTab === 'map') {
            body.innerHTML = this.renderDrawerMap(tx);
            setTimeout(() => this.initMiniMap(tx), 50);
        } else if (this.activeDrawerTab === 'risk') {
            body.innerHTML = this.renderDrawerRisk(tx);
        } else if (this.activeDrawerTab === 'history') {
            body.innerHTML = this.renderDrawerHistory(tx);
        } else if (this.activeDrawerTab === 'customer') {
            body.innerHTML = this.renderDrawerCustomer(tx);
        } else if (this.activeDrawerTab === 'network') {
            body.innerHTML = this.renderDrawerNetwork(tx);
        } else if (this.activeDrawerTab === 'raw') {
            body.innerHTML = `
                <div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
                    <button class="btn btn-sm btn-outline" onclick="navigator.clipboard.writeText(JSON.stringify(app.selectedTx, null, 2)); app.showToast('JSON copied to clipboard', 'success');">📋 Copy JSON</button>
                </div>
                <pre class="font-mono" style="background:#0a0d14; padding:12px; border-radius:6px; font-size:11.5px; overflow-x:auto;">${this.escapeHtml(JSON.stringify(tx, null, 2))}</pre>
            `;
        } else if (this.activeDrawerTab === 'audit') {
            body.innerHTML = this.renderDrawerAudit(tx);
        }

        // Render Action Buttons
        if (tx.status === 'QUARANTINED' || tx.decision === 'BLOCK') {
            footer.innerHTML = `
                <button class="btn btn-outline text-green" onclick="app.openActionModal('${tx.transaction_id}', 'RELEASE')">✓ Release Hold</button>
                <button class="btn btn-outline text-red" onclick="app.openActionModal('${tx.transaction_id}', 'CONFIRM_FRAUD')">✕ Confirm Fraud</button>
                <button class="btn btn-outline" onclick="app.openActionModal('${tx.transaction_id}', 'ESCALATE')">⚠️ Escalate</button>
            `;
        } else {
            footer.innerHTML = `<span style="font-size:12px; color:var(--text-muted); align-self:center;">Transaction settled (${tx.status})</span>`;
        }
    }

    renderDrawerOverview(tx) {
        const score = tx.risk_score || 0;
        const gaugeHtml = window.renderRiskGauge(score);

        return `
            ${gaugeHtml}

            <div class="detail-card">
                <h4>Payment &amp; Transaction Details</h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>Amount</span><span class="font-mono">$${Number(tx.amount || 0).toFixed(2)} ${tx.currency || 'USD'}</span></div>
                    <div class="kv-item"><span>Payment Rail</span><span>${tx.attributes?.payment_channel || tx.txn_type || 'ONLINE'}</span></div>
                    <div class="kv-item"><span>Counterparty</span><span>${tx.merchant || tx.destination_account || 'General Merchant'}</span></div>
                    <div class="kv-item"><span>MCC Code</span><span class="font-mono">${tx.attributes?.merchant_category_code || '5411'}</span></div>
                    <div class="kv-item"><span>Session ID</span><span class="font-mono">${tx.attributes?.session_id || 'sess_demo'}</span></div>
                    <div class="kv-item"><span>New Beneficiary</span><span>${tx.attributes?.is_new_beneficiary ? '⚠️ Yes (New)' : 'No (Established)'}</span></div>
                </div>
            </div>

            <div class="detail-card">
                <h4>Device &amp; Client Telemetry</h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>Browser / OS</span><span>${tx.attributes?.browser || 'Chrome'}, ${tx.attributes?.os || 'Windows'}</span></div>
                    <div class="kv-item"><span>Device Fingerprint</span><span class="font-mono">${tx.attributes?.device_fingerprint || 'fp_demo'}</span></div>
                    <div class="kv-item"><span>New Device</span><span>${tx.attributes?.is_new_device ? '⚠️ Yes (First seen)' : 'No (Trusted)'}</span></div>
                    <div class="kv-item"><span>Screen Resolution</span><span>${tx.attributes?.screen_resolution || '1920x1080'}</span></div>
                </div>
            </div>
        `;
    }

    renderDrawerMap(tx) {
        return `
            <div class="detail-card">
                <h4>Geographic Flight Path</h4>
                <div id="mini-drawer-map" style="height:260px; border-radius:6px; background:#0d111a;"></div>
                <div class="kv-grid" style="margin-top:12px;">
                    <div class="kv-item"><span>Great-Circle Distance</span><span class="font-mono">${tx.location_check?.distance_km || 0} km</span></div>
                    <div class="kv-item"><span>Implied Velocity</span><span class="font-mono">${tx.location_check?.travel_speed_kmh || 0} km/h</span></div>
                    <div class="kv-item"><span>Speed Limit</span><span class="font-mono">${tx.location_check?.speed_threshold_kmh || 900} km/h</span></div>
                    <div class="kv-item"><span>Impossible Travel</span><span style="color:${tx.location_check?.is_impossible_travel ? 'var(--color-block)' : 'inherit'}; font-weight:700;">${tx.location_check?.is_impossible_travel ? '🚨 YES (BLOCKED)' : 'NO'}</span></div>
                </div>
            </div>
        `;
    }

    initMiniMap(tx) {
        const miniContainer = document.getElementById('mini-drawer-map');
        if (!miniContainer) return;

        const miniMap = L.map('mini-drawer-map', { attributionControl: false, zoomControl: false });
        L.tileLayer(window.MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '' }).addTo(miniMap);

        const origin = tx.origin?.coordinates || { lat: 40.7128, lon: -74.0060 };
        const home = tx.location_check?.account_registered_coordinates || origin;

        L.circleMarker([origin.lat, origin.lon], { radius: 6, fillColor: '#ef4444', color: '#fff', weight: 1, fillOpacity: 0.9 }).addTo(miniMap).bindTooltip("Transaction Origin");
        L.circleMarker([home.lat, home.lon], { radius: 6, fillColor: '#3b82f6', color: '#fff', weight: 1, fillOpacity: 0.9 }).addTo(miniMap).bindTooltip("Registered Home");

        const line = L.polyline([[home.lat, home.lon], [origin.lat, origin.lon]], { color: tx.location_check?.is_impossible_travel ? '#ef4444' : '#64748b', weight: 2 }).addTo(miniMap);

        miniMap.fitBounds(line.getBounds(), { padding: [30, 30] });
    }

    renderDrawerRisk(tx) {
        const flags = tx.flags || tx.triggered_rules || [];
        const breakdown = tx.score_breakdown || [];

        const breakdownRows = breakdown.map(item => `
            <tr>
                <td class="font-mono font-semibold">${item.rule}</td>
                <td>+${item.points} pts</td>
                <td><span class="pill pill-${item.category === 'HIGH' ? 'block' : 'review'}">${item.category}</span></td>
                <td style="font-size:11.5px; color:var(--text-secondary);">${FLAG_EXPLANATIONS[item.rule] || 'Triggered heuristic'}</td>
            </tr>
        `).join('');

        return `
            <div class="detail-card">
                <h4>Triggered Anomaly Rules (${flags.length})</h4>
                <table class="data-table">
                    <thead>
                        <tr><th>Rule Code</th><th>Weight</th><th>Severity</th><th>Description</th></tr>
                    </thead>
                    <tbody>
                        ${breakdownRows || '<tr><td colspan="4" class="empty-state">No risk rules triggered (Score 0)</td></tr>'}
                    </tbody>
                </table>
            </div>

            <div class="detail-card">
                <h4>ML Model Inference Score</h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>Model Engine</span><span>XGBoost Fraud Classifier v1.2</span></div>
                    <div class="kv-item"><span>Predicted Probability</span><span class="font-mono">${Number(tx.ml_score || 0.0).toFixed(4)}</span></div>
                </div>
            </div>
        `;
    }

    renderDrawerHistory(tx) {
        const tb = tx.traceback || {};
        const sparkline = (tx.time_analysis?.velocity_sparkline || []).join(', ');

        return `
            <div class="detail-card">
                <h4>Account Velocity &amp; Frequency Windows</h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>1-Hour Velocity</span><span class="font-mono font-semibold">${tb.velocity_1hr || 1} txn(s)</span></div>
                    <div class="kv-item"><span>24-Hour Velocity</span><span class="font-mono font-semibold">${tb.velocity_24hr || 1} txn(s)</span></div>
                    <div class="kv-item"><span>7-Day Velocity</span><span class="font-mono font-semibold">${tb.velocity_7d || 1} txn(s)</span></div>
                    <div class="kv-item"><span>Amount Z-Score</span><span class="font-mono">${tb.amount_zscore || 0.0}σ</span></div>
                    <div class="kv-item"><span>Historical Risk Avg</span><span class="font-mono">${tb.chain_risk_score || 0}/100</span></div>
                    <div class="kv-item"><span>Amount Variance</span><span class="font-mono">${tb.amount_delta_pct || 0}%</span></div>
                </div>
            </div>

            <div class="detail-card">
                <h4>Prior Inter-Transaction Intervals (mins)</h4>
                <p class="font-mono" style="font-size:12px; color:var(--text-muted);">${sparkline || 'First recorded transaction'}</p>
            </div>
        `;
    }

    renderDrawerCustomer(tx) {
        const pii = tx.pii_enrichment || {};
        const isSim = pii.is_simulated;
        const cell = pii.last_known_location || {};

        return `
            <div class="detail-card">
                <h4>
                    Identity &amp; Account Holder Profile
                    <span class="badge ${isSim ? 'badge-sim' : 'badge-live'}">${isSim ? 'SIMULATED (DEMO DATA)' : 'LIVE VERIFIED'}</span>
                </h4>
                <div class="kv-grid">
                    <div class="kv-item">
                        <span>Cardholder Name</span>
                        <span class="font-semibold" id="drawer-holder-name">${pii.account_holder_masked || 'DEMO_HOLDER (MOCK)'}</span>
                    </div>
                    <div class="kv-item">
                        <span>PII Compliance Action</span>
                        <button class="btn btn-sm btn-outline" onclick="app.revealPII('${tx.transaction_id}')">👁 Reveal Full PII</button>
                    </div>
                    <div class="kv-item"><span>Account Tenure</span><span class="font-mono">${pii.account_age_days || 0} days</span></div>
                    <div class="kv-item"><span>SMS Phone Verification</span><span>${pii.linked_phone_verified ? '✓ Verified' : '✕ Unverified'}</span></div>
                    <div class="kv-item"><span>Recent SIM-Swap (7d)</span><span>${pii.sim_swap_last_7d ? '⚠️ Yes (Recent)' : '✓ None'}</span></div>
                    <div class="kv-item"><span>Social Network Risk Score</span><span class="font-mono">${(Number(pii.social_profile_risk_score || 0) * 100).toFixed(0)}% (${pii.social_reputation || 'ESTABLISHED'})</span></div>
                </div>
            </div>

            <div class="detail-card">
                <h4>
                    Carrier Cell-Tower Telemetry
                    <span class="badge ${cell.is_simulated ? 'badge-sim' : 'badge-live'}">${cell.is_simulated ? 'SIMULATED TELECOM TOWER' : 'LIVE CAMARA OPERATOR'}</span>
                </h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>Cell Tower City</span><span>${cell.city || 'New York'}</span></div>
                    <div class="kv-item"><span>Tower Coordinates</span><span class="font-mono">${cell.lat || 40.7128}, ${cell.lon || -74.006}</span></div>
                    <div class="kv-item"><span>Tower Accuracy Radius</span><span>${cell.accuracy_meters || 65} meters</span></div>
                    <div class="kv-item"><span>Location Consistency</span><span>${pii.location_matches_transaction ? '✓ Consistent with Origin' : '⚠️ Location Mismatch (+15)'}</span></div>
                </div>
            </div>
        `;
    }

    renderDrawerNetwork(tx) {
        const origin = tx.origin || {};
        return `
            <div class="detail-card">
                <h4>Network Infrastructure &amp; Origin IP</h4>
                <div class="kv-grid">
                    <div class="kv-item"><span>IP Address</span><span class="font-mono font-semibold">${origin.ip_address || '192.0.2.1'}</span></div>
                    <div class="kv-item"><span>Internet Service Provider (ISP)</span><span>${origin.isp || 'Standard Carrier'}</span></div>
                    <div class="kv-item"><span>Autonomous System (ASN)</span><span class="font-mono">${origin.asn || 'AS0000'}</span></div>
                    <div class="kv-item"><span>Connection Type</span><span class="font-mono">${origin.connection_type || 'broadband'}</span></div>
                    <div class="kv-item"><span>VPN / Proxy Anonymizer</span><span>${origin.is_vpn ? '⚠️ Yes (VPN)' : (origin.is_proxy ? '⚠️ Yes (Proxy)' : 'No (Direct)')}</span></div>
                    <div class="kv-item"><span>Tor Exit Node Relay</span><span style="color:${origin.is_tor ? 'var(--color-block)' : 'inherit'}; font-weight:700;">${origin.is_tor ? '🚨 YES (TOR EXIT NODE)' : 'NO'}</span></div>
                    <div class="kv-item"><span>Cloud / Datacenter ASN</span><span>${origin.is_datacenter ? '⚠️ Yes (Hosting Provider)' : 'No (Residential/Mobile)'}</span></div>
                    <div class="kv-item"><span>Threat Assessment</span><span class="pill pill-${origin.threat_level === 'CRITICAL' ? 'block' : 'status'}">${origin.threat_level || 'LOW'}</span></div>
                </div>
            </div>
        `;
    }

    renderDrawerAudit(tx) {
        return `
            <div class="detail-card">
                <h4>Immutable Compliance Audit Trail</h4>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">All scoring evaluations and analyst actions are cryptographically sealed and logged to the audit ledger.</p>
                <div class="kv-grid">
                    <div class="kv-item"><span>Evaluation Timestamp</span><span class="font-mono">${tx.timestamp}</span></div>
                    <div class="kv-item"><span>Quarantine Auto-Release</span><span class="font-mono">${tx.auto_release_after || 'N/A'}</span></div>
                    <div class="kv-item"><span>Analyst Notes</span><span>${tx.analyst_notes || 'No manual actions taken'}</span></div>
                </div>
            </div>
        `;
    }

    async revealPII(txId) {
        if (this.currentUser.role === 'viewer') {
            this.showToast("Permission Denied: Viewers cannot unmask PII.", "danger");
            return;
        }

        try {
            const res = await fetch('/api/auth/reveal-pii', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.currentUser.token,
                    'X-Analyst-ID': this.currentUser.name,
                    'X-User-Role': this.currentUser.role
                },
                body: JSON.stringify({ transaction_id: txId })
            });

            if (res.ok) {
                const data = await res.json();
                document.getElementById('drawer-holder-name').innerText = data.unmasked_name;
                this.showToast(`PII Revealed & Logged for ${this.currentUser.name}`, 'warning');
            }
        } catch (err) {
            this.showToast("Failed to reveal PII", "danger");
        }
    }

    // =========================================================================
    // 7. Accounts Directory & Relationship Graph
    // =========================================================================

    loadAccountsView() {
        const list = document.getElementById('account-registry-list');
        const accounts = [...new Set(this.transactions.map(t => t.account_id || t.source_account).filter(Boolean))];

        list.innerHTML = accounts.map(acc => `
            <li class="account-list-item" onclick="app.selectAccountDetail('${acc}')">
                <span>👤 ${acc}</span>
            </li>
        `).join('');

        if (accounts.length > 0) {
            this.selectAccountDetail(accounts[0]);
        }
    }

    async selectAccountDetail(accountId) {
        document.querySelectorAll('.account-list-item').forEach(el => {
            el.classList.toggle('active', el.innerText.includes(accountId));
        });

        document.getElementById('account-pane-title').innerText = `Account Audit: ${accountId}`;

        try {
            const res = await fetch(`/api/accounts/${accountId}/trail`);
            if (res.ok) {
                const data = await res.json();
                this.renderAccountTrail(data);
                this.renderEntityGraph(data.entity_graph);
            }
        } catch (err) {
            console.error("Failed to load account trail", err);
        }
    }

    renderAccountTrail(data) {
        const tbody = document.getElementById('account-trail-tbody');
        const strip = document.getElementById('account-meta-strip');

        strip.innerHTML = `
            <div class="kpi-strip">
                <div class="kpi-item"><span class="kpi-label">Historical Transactions</span><span class="kpi-val">${data.total_transactions || 1}</span></div>
                <div class="kpi-item"><span class="kpi-label">1h / 24h Velocity</span><span class="kpi-val">${data.velocity_1hr || 1} / ${data.velocity_24hr || 1}</span></div>
                <div class="kpi-item"><span class="kpi-label">Amount Z-Score</span><span class="kpi-val">${data.amount_zscore || 0.0}σ</span></div>
                <div class="kpi-item"><span class="kpi-label">Average Risk</span><span class="kpi-val">${data.chain_risk_score || 0}/100</span></div>
            </div>
        `;

        const items = data.items || [];
        tbody.innerHTML = items.map(t => `
            <tr onclick="app.openDrawer('${t.transaction_id}')">
                <td class="font-mono">${this.formatTime(t.timestamp)}</td>
                <td class="font-mono">${t.transaction_id}</td>
                <td class="font-mono">$${Number(t.amount || 0).toFixed(2)}</td>
                <td>${t.merchant || t.destination_account || 'General Merchant'}</td>
                <td class="font-mono">${t.risk_score}/100</td>
                <td><span class="pill pill-${t.decision === 'BLOCK' ? 'block' : 'allow'}">${t.decision}</span></td>
            </tr>
        `).join('');
    }

    renderEntityGraph(graphData) {
        const container = document.getElementById('entity-graph-canvas');
        if (!container || !graphData) return;

        // Render Clean SVG Node-Link Diagram
        const nodes = graphData.nodes || [];
        const links = graphData.links || [];

        const width = container.clientWidth || 550;
        const height = 220;

        let svgHtml = `<svg width="${width}" height="${height}" style="background:#0a0d14;">`;

        // Render Links
        links.forEach(l => {
            svgHtml += `<line x1="${width / 2}" y1="${height / 2}" x2="${Math.random() * (width - 60) + 30}" y2="${Math.random() * (height - 60) + 30}" stroke="#334155" stroke-width="1.5" stroke-dasharray="3,3" />`;
        });

        // Render Central Account Node
        svgHtml += `
            <circle cx="${width / 2}" cy="${height / 2}" r="22" fill="#3b82f6" />
            <text x="${width / 2}" y="${height / 2 + 4}" fill="#fff" font-size="10" font-weight="700" text-anchor="middle">ACCOUNT</text>
        `;

        svgHtml += `</svg>`;
        container.innerHTML = svgHtml;
    }

    // =========================================================================
    // 8. Analytics & Charts
    // =========================================================================

    initCharts() {
        if (!window.Chart) return;

        // 1. Risk Score Distribution
        const ctxRisk = document.getElementById('chart-risk-dist')?.getContext('2d');
        if (ctxRisk) {
            this.charts.risk = new Chart(ctxRisk, {
                type: 'bar',
                data: {
                    labels: ['0-19', '20-39', '40-59', '60-79', '80-100'],
                    datasets: [{ label: 'Transaction Count', data: [12, 18, 5, 4, 8], backgroundColor: ['#10b981', '#10b981', '#f59e0b', '#f59e0b', '#ef4444'] }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }

        // 2. Fraud by Country
        const ctxCountry = document.getElementById('chart-country')?.getContext('2d');
        if (ctxCountry) {
            this.charts.country = new Chart(ctxCountry, {
                type: 'doughnut',
                data: {
                    labels: ['US', 'DE', 'GB', 'IN', 'NL', 'RO'],
                    datasets: [{ data: [25, 8, 6, 4, 3, 2], backgroundColor: ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#a855f7', '#ec4899'] }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }

    updateCharts() {
        // Dynamically compute distributions from loaded transactions
        if (!this.charts.risk) return;
        const buckets = [0, 0, 0, 0, 0];
        this.transactions.forEach(t => {
            const s = t.risk_score || 0;
            if (s < 20) buckets[0]++;
            else if (s < 40) buckets[1]++;
            else if (s < 60) buckets[2]++;
            else if (s < 80) buckets[3]++;
            else buckets[4]++;
        });
        this.charts.risk.data.datasets[0].data = buckets;
        this.charts.risk.update();
    }

    // =========================================================================
    // 9. Simulator Controls
    // =========================================================================

    async runScenario(scenarioName) {
        try {
            const res = await fetch('/api/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset: scenarioName })
            });

            if (res.ok) {
                const data = await res.json();
                this.showToast(`Scenario executed: ${scenarioName}`, 'success');
                if (data.result) {
                    this.openDrawer(data.result.transaction_id);
                }
            }
        } catch (err) {
            this.showToast("Failed to run scenario", "danger");
        }
    }

    async toggleStreamSimulator() {
        const nextState = !this.streamActive;
        try {
            const res = await fetch('/api/simulator/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: nextState, tps: 1.0 })
            });

            if (res.ok) {
                const data = await res.json();
                this.streamActive = data.active;
                this.updateSimulatorUI();
            }
        } catch (err) {
            this.showToast("Failed to toggle simulator", "danger");
        }
    }

    async pollSimulatorStatus() {
        try {
            const res = await fetch('/api/simulator/status');
            if (res.ok) {
                const data = await res.json();
                this.streamActive = data.active;
                this.updateSimulatorUI();
            }
        } catch (err) {
            // ignore
        }
    }

    updateSimulatorUI() {
        const dot = document.getElementById('sim-indicator');
        const text = document.getElementById('sim-toggle-text');
        if (this.streamActive) {
            dot.className = "indicator-dot dot-live";
            text.innerText = "Stream: ON (1 TPS)";
        } else {
            dot.className = "indicator-dot dot-off";
            text.innerText = "Stream: OFF";
        }
    }

    // =========================================================================
    // 10. Role-Based Login & Utilities
    // =========================================================================

    openLoginModal() {
        document.getElementById('login-modal-overlay').classList.remove('hidden');
    }

    closeLoginModal() {
        document.getElementById('login-modal-overlay').classList.add('hidden');
    }

    async saveLogin() {
        const name = document.getElementById('login-username').value;
        const role = document.getElementById('login-role').value;

        this.currentUser.name = name;
        this.currentUser.role = role;
        this.currentUser.token = role === 'admin' ? 'admin-token-2026' : (role === 'analyst' ? 'analyst-token-2026' : 'viewer-token-2026');

        this.updateUserBadge();
        this.closeLoginModal();
        this.showToast(`Active Role: ${role.toUpperCase()} (${name})`, 'success');
    }

    updateUserBadge() {
        document.getElementById('current-role-badge').innerText = this.currentUser.role.toUpperCase();
        document.getElementById('current-user-name').innerText = this.currentUser.name;
    }

    updateStats(data) {
        const total = data?.total_count || this.transactions.length;
        const blocked = this.transactions.filter(t => t.decision === 'BLOCK').length;
        const avgRisk = total > 0 ? Math.round(this.transactions.reduce((acc, t) => acc + (t.risk_score || 0), 0) / this.transactions.length) : 0;
        const breaches = this.quarantine.filter(q => q.is_sla_breached).length;

        document.getElementById('kpi-total').innerText = total;
        document.getElementById('kpi-tps').innerText = `${data?.tps || '1.0'} TPS`;
        document.getElementById('kpi-block-rate').innerText = total > 0 ? `${((blocked / total) * 100).toFixed(1)}%` : '0.0%';
        document.getElementById('kpi-avg-risk').innerText = `${avgRisk} / 100`;
        document.getElementById('kpi-quarantine').innerText = this.quarantine.filter(q => q.status === 'QUARANTINED').length;
        document.getElementById('kpi-sla-breaches').innerText = breaches;
    }

    showToast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<span>${type === 'danger' ? '🚨' : (type === 'success' ? '✓' : 'ℹ️')}</span> <span>${msg}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    formatTime(tsStr) {
        if (!tsStr) return '--:--:--';
        try {
            const d = new Date(tsStr);
            return d.toTimeString().split(' ')[0];
        } catch (e) {
            return tsStr;
        }
    }

    escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
}

// Backwards compatibility functions for tests and legacy callers
window.openTransactionDetail = function(id) { app.openDrawer(id); };
window.closeDetailSidebar = function() { app.closeDrawer(); };
window.renderRiskGauge = function(score) {
    const s = Number(score) || 0;
    const cls = s >= 80 ? 'gauge-block' : (s >= 40 ? 'gauge-review' : 'gauge-allow');
    const color = s >= 80 ? '#ef4444' : (s >= 40 ? '#f59e0b' : '#10b981');
    const band = s >= 80 ? 'High Risk (Decline)' : (s >= 40 ? 'Elevated (Review)' : 'Normal (Approved)');
    return `
        <div class="gauge-box ${cls}" style="display:flex; align-items:center; gap:20px; padding:16px; border-radius:10px; border:1px solid rgba(255,255,255,0.08);">
            <div style="position:relative; width:72px; height:72px; display:flex; align-items:center; justify-content:center;">
                <svg viewBox="0 0 36 36" style="width:100%; height:100%; transform:rotate(-90deg);">
                    <path stroke="rgba(255,255,255,0.1)" stroke-width="3.5" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path stroke="${color}" stroke-dasharray="${s}, 100" stroke-width="3.5" stroke-linecap="round" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                </svg>
                <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;">
                    <span class="gauge-score" style="font-size:22px; font-weight:800; font-family:var(--font-mono);">${s}</span>
                </div>
            </div>
            <div>
                <div style="font-size:14px; font-weight:700; color:#fff;">${band}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">Probability Assessment: ${s}% score intensity</div>
            </div>
        </div>
    `;
};
window.exportCurrentTransactionJson = function() {
    if (!app.selectedTx) return;
    const blob = new Blob([JSON.stringify(app.selectedTx, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `transaction_${app.selectedTx.transaction_id}.json`;
    a.click();
};

// Global App Instance
const app = new FraudGuardApp();
window.app = app;
window.addEventListener('DOMContentLoaded', () => app.init());
