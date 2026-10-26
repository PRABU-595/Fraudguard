import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Theme Colors
    BG_COLOR = RGBColor(11, 15, 25)         # #0B0F19 Deep Cyber Navy
    CARD_BG = RGBColor(17, 24, 39)          # #111827 Dark Surface
    CARD_BORDER = RGBColor(30, 41, 59)      # #1E293B Border
    CYAN = RGBColor(6, 182, 212)            # #06B6D4 Cyber Cyan
    CYAN_LIGHT = RGBColor(103, 232, 249)    # #67E8F9 Light Cyan
    TEXT_WHITE = RGBColor(255, 255, 255)    # #FFFFFF
    TEXT_MUTED = RGBColor(148, 163, 184)    # #94A3B8 Slate Gray
    EMERALD = RGBColor(16, 185, 129)        # #10B981 Green
    ROSE = RGBColor(239, 68, 68)            # #EF4444 Red
    AMBER = RGBColor(245, 158, 11)          # #F59E0B Amber
    PURPLE = RGBColor(168, 85, 247)         # #A855F7 Purple

    def set_slide_background(slide):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = BG_COLOR
        bg.line.color.rgb = BG_COLOR
        return bg

    def add_header(slide, category: str, title: str, subtitle: str = ""):
        # Category Badge
        cat_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.5), Inches(0.35))
        tf_c = cat_box.text_frame
        tf_c.word_wrap = True
        p_c = tf_c.paragraphs[0]
        p_c.text = category.upper()
        p_c.font.size = Pt(10)
        p_c.font.bold = True
        p_c.font.color.rgb = CYAN
        p_c.font.name = "Arial"

        # Main Title
        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(11.5), Inches(0.6))
        tf_t = title_box.text_frame
        tf_t.word_wrap = True
        p_t = tf_t.paragraphs[0]
        p_t.text = title
        p_t.font.size = Pt(22)
        p_t.font.bold = True
        p_t.font.color.rgb = TEXT_WHITE
        p_t.font.name = "Arial"

        if subtitle:
            sub_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.25), Inches(11.5), Inches(0.4))
            tf_s = sub_box.text_frame
            tf_s.word_wrap = True
            p_s = tf_s.paragraphs[0]
            p_s.text = subtitle
            p_s.font.size = Pt(12)
            p_s.font.color.rgb = TEXT_MUTED
            p_s.font.name = "Arial"

    def add_card(slide, left, top, width, height, title="", border_color=CARD_BORDER):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = CARD_BG
        card.line.color.rgb = border_color
        card.line.width = Pt(1.5)

        if title:
            tb = slide.shapes.add_textbox(left + Inches(0.2), top + Inches(0.15), width - Inches(0.4), Inches(0.4))
            tf = tb.text_frame
            p = tf.paragraphs[0]
            p.text = title
            p.font.size = Pt(14)
            p.font.bold = True
            p.font.color.rgb = CYAN_LIGHT
            p.font.name = "Arial"
        return card

    # ==========================================================
    # SLIDE 1: TITLE SLIDE
    # ==========================================================
    s1 = prs.slides.add_slide(blank_layout)
    set_slide_background(s1)

    # Accent decorative banner
    accent = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.6), Inches(0.12), Inches(4.2))
    accent.fill.solid()
    accent.fill.fore_color.rgb = CYAN
    accent.line.fill.background()

    tb1 = s1.shapes.add_textbox(Inches(1.2), Inches(1.5), Inches(11.0), Inches(4.5))
    tf1 = tb1.text_frame
    tf1.word_wrap = True

    p_badge = tf1.paragraphs[0]
    p_badge.text = "ENTERPRISE FINTECH CYBERSECURITY  |  AUTONOMOUS FRAUD DEFENSE"
    p_badge.font.size = Pt(12)
    p_badge.font.bold = True
    p_badge.font.color.rgb = CYAN
    p_badge.font.name = "Arial"

    p_title = tf1.add_paragraph()
    p_title.text = "FraudGuard SOC"
    p_title.font.size = Pt(46)
    p_title.font.bold = True
    p_title.font.color.rgb = TEXT_WHITE
    p_title.font.name = "Arial"
    p_title.space_before = Pt(10)

    p_sub = tf1.add_paragraph()
    p_sub.text = "Next-Generation Real-Time Threat Telemetry, Cloud-Native Ingestion &\nAutonomous AI Copilot Operations Center"
    p_sub.font.size = Pt(18)
    p_sub.font.color.rgb = TEXT_MUTED
    p_sub.font.name = "Arial"
    p_sub.space_before = Pt(12)

    p_foot = tf1.add_paragraph()
    p_foot.text = "Technical Architecture, AWS Cloud Implementation & 3-Engineer Ownership Blueprint"
    p_foot.font.size = Pt(13)
    p_foot.font.color.rgb = CYAN_LIGHT
    p_foot.font.name = "Arial"
    p_foot.space_before = Pt(28)

    # ==========================================================
    # SLIDE 2: PROBLEM STATEMENT
    # ==========================================================
    s2 = prs.slides.add_slide(blank_layout)
    set_slide_background(s2)
    add_header(s2, "Industry Challenges & Threat Landscape", "The Modern Financial Fraud Crisis", "Traditional rule-based fraud detection systems fail against sophisticated, high-velocity adversary tactics.")

    card_data_s2 = [
        ("High-Velocity Evasion Attacks", "Synthetic identity rings and botnets execute automated micro-transactions across hundreds of proxy IPs in sub-second intervals, overwhelming legacy batch pipelines.", ROSE),
        ("Cellular & Geo Discrepancies", "Attackers mask identities via Tor exit nodes and GPS spoofing while executing transactions across impossible physical distances without physical tower correlation.", AMBER),
        ("Analyst Burnout & High MTTR", "SOC fraud analysts drown in fragmented alert lists with zero automated entity linkage, resulting in high Mean Time To Resolution (MTTR) and breached SLAs.", CYAN),
        ("Telemetry Latency & CPU Lockups", "Real-time analytics frequently choke on quadratic time-series date parsing, leading to UI freezing, lagged KPI visibility, and delayed incident blocks.", PURPLE)
    ]

    for idx, (title, desc, color) in enumerate(card_data_s2):
        col = idx % 2
        row = idx // 2
        l = Inches(0.8 + col * 5.9)
        t = Inches(1.8 + row * 2.6)
        add_card(s2, l, t, Inches(5.6), Inches(2.3), title, color)

        tb = s2.shapes.add_textbox(l + Inches(0.2), t + Inches(0.7), Inches(5.2), Inches(1.4))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = desc
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_MUTED
        p.font.name = "Arial"

    # ==========================================================
    # SLIDE 3: PROPOSED SOLUTION
    # ==========================================================
    s3 = prs.slides.add_slide(blank_layout)
    set_slide_background(s3)
    add_header(s3, "Architectural Solution", "FraudGuard Autonomous SOC Platform", "A unified, multi-layered cloud-native architecture combining algorithmic heuristics, ML scoring, and generative AI.")

    sol_cards = [
        ("Sub-15ms Ingestion & Scoring", [
            "Evaluates multi-variable risk heuristics and ML inference concurrently.",
            "Instant categorization into ALLOW (<40), REVIEW (40-79), or BLOCK (>=80).",
            "Zero lag streaming via Server-Sent Events (SSE) to connected SOC dashboards."
        ], CYAN),
        ("Cell-Tower Triangulation (GIS)", [
            "Computes Haversine distance between device GPS and cellular base stations.",
            "Flags Impossible Travel speed deviations (>900 km/h) across consecutive fixes.",
            "Detects high-anonymity Tor exit nodes, data center IPs, and proxy hops."
        ], EMERALD),
        ("SLA-Governed Quarantine Case Queue", [
            "60-minute countdown SLA with automated escalation and visual timer rings.",
            "Mandatory 4-Eyes dual control confirmation for releasing high-risk items (>=80).",
            "Deterministic CASE-XXXX identity preserved across all tab transitions."
        ], AMBER),
        ("Bedrock Generative AI Copilot", [
            "Automated incident briefing generation from raw multi-layer telemetry.",
            "Produces plain-English forensic rationale for compliance auditors.",
            "Instant drafting of FINCEN-compliant Suspicious Activity Reports (SAR)."
        ], PURPLE)
    ]

    for idx, (title, bullets, color) in enumerate(sol_cards):
        col = idx % 2
        row = idx // 2
        l = Inches(0.8 + col * 5.9)
        t = Inches(1.8 + row * 2.6)
        add_card(s3, l, t, Inches(5.6), Inches(2.3), title, color)

        tb = s3.shapes.add_textbox(l + Inches(0.2), t + Inches(0.65), Inches(5.2), Inches(1.5))
        tf = tb.text_frame
        tf.word_wrap = True
        for b_idx, bullet in enumerate(bullets):
            p = tf.paragraphs[0] if b_idx == 0 else tf.add_paragraph()
            p.text = f"• {bullet}"
            p.font.size = Pt(11)
            p.font.color.rgb = TEXT_MUTED
            p.font.name = "Arial"
            if b_idx > 0:
                p.space_before = Pt(4)

    # ==========================================================
    # SLIDE 4: SYSTEM ARCHITECTURE
    # ==========================================================
    s4 = prs.slides.add_slide(blank_layout)
    set_slide_background(s4)
    add_header(s4, "End-to-End Workflow Pipeline", "FraudGuard System Architecture", "High-throughput transaction ingestion, distributed evaluation, streaming broadcast, and persistence.")

    arch_steps = [
        ("1. INGESTION", "Transactions arrive via HTTP POST / SQS surge buffer into EC2 daemon pipeline.", CYAN),
        ("2. ENRICHMENT", "Cell-tower triangulation, Haversine velocity, Tor check, and PII masking applied.", EMERALD),
        ("3. RISK SCORING", "Multi-rule weight engine + score evaluation in <15ms. Dispositions calculated.", AMBER),
        ("4. REAL-TIME BROADCAST", "SSE engine pushes live updates to React client; memory buffer capped at 100 txns.", PURPLE),
        ("5. CASE MANAGEMENT", "Blocked & review items routed to DynamoDB quarantine queue with 60-min SLA timer.", ROSE)
    ]

    for idx, (step_title, step_desc, color) in enumerate(arch_steps):
        l = Inches(0.8 + idx * 2.38)
        t = Inches(1.9)
        add_card(s4, l, t, Inches(2.25), Inches(4.8), step_title, color)

        tb = s4.shapes.add_textbox(l + Inches(0.15), t + Inches(0.8), Inches(1.95), Inches(3.8))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = step_desc
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_MUTED
        p.font.name = "Arial"
        p.space_before = Pt(8)

    # ==========================================================
    # SLIDE 5: AWS SERVICES USED & IMPLEMENTATION
    # ==========================================================
    s5 = prs.slides.add_slide(blank_layout)
    set_slide_background(s5)
    add_header(s5, "Cloud Native Infrastructure", "AWS Services Architecture & Utilization", "Enterprise cloud stack orchestrating persistence, event streaming, GenAI reasoning, and security.")

    aws_cards = [
        ("AWS EC2 (Amazon Linux 2023)", "Hosts production backend, Threaded HTTPServer, SSE broadcaster, and static Vite assets. Zero idle cost on Free Tier (t3.micro).", CYAN),
        ("Amazon DynamoDB", "Dual-table NoSQL persistence: 'fraud-transactions' and 'fraud-quarantine' with automatic Time-to-Live (TTL) record expiration.", EMERALD),
        ("Amazon Bedrock", "Generative AI LLM Copilot generating autonomous incident briefings, risk explanations, and regulatory SAR drafts in seconds.", PURPLE),
        ("AWS Lambda", "Serverless microservice execution for asynchronous transaction enrichment, geo-tower lookups, and routing functions.", AMBER),
        ("Amazon SQS", "Decouples ingestion surges from downstream analytics with automated Dead-Letter Queue (DLQ) failover.", ROSE),
        ("AWS Step Functions", "Multi-step state machine orchestrating analyst escalation workflows, SLA timeouts, and auto-release logic.", CYAN),
        ("Amazon Cognito", "Role-Based Access Control (RBAC) issuing JWT credentials to verify Analyst vs Admin privileges and 4-Eyes approvals.", EMERALD),
        ("Amazon CloudWatch & Redis", "Custom telemetry metrics (QuarantineCount, BlockRate) + ElastiCache Redis for sub-millisecond account velocity caching.", PURPLE)
    ]

    for idx, (svc_title, svc_desc, color) in enumerate(aws_cards):
        col = idx % 4
        row = idx // 4
        l = Inches(0.8 + col * 2.95)
        t = Inches(1.8 + row * 2.6)
        add_card(s5, l, t, Inches(2.8), Inches(2.3), svc_title, color)

        tb = s5.shapes.add_textbox(l + Inches(0.15), t + Inches(0.65), Inches(2.5), Inches(1.5))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = svc_desc
        p.font.size = Pt(11)
        p.font.color.rgb = TEXT_MUTED
        p.font.name = "Arial"

    # ==========================================================
    # SLIDE 6: PLATFORM FEATURES
    # ==========================================================
    s6 = prs.slides.add_slide(blank_layout)
    set_slide_background(s6)
    add_header(s6, "Operational Capabilities", "Core Platform Features & SOC Tooling", "Comprehensive suite of real-time monitoring, visual forensics, and administrative controls.")

    feat_cards = [
        ("Interactive Threat Map", "Dark Leaflet canvas with custom pulsating radar glow dots, flight path replay, and cell-tower accuracy radius rings.", CYAN),
        ("Live Ingestion Buffer", "High-throughput live event stream capped to 100 entries for zero UI lag; instant scenario injection for adversary attacks.", EMERALD),
        ("Quarantine Case Center", "Full case status tabs (Open, At-Risk, Breached, Escalated, Released, Confirmed Fraud) with 60-minute SLA ticker.", AMBER),
        ("Entity Link Topology Graph", "Interactive SVG network visualization highlighting shared device hashes, IP subnets, and counterparty connections.", PURPLE),
        ("Instant Analytics Engine", "Reconciled volume-over-time and risk score histograms responding in <10ms across 1H, 24H, 7D, and 30D intervals.", ROSE),
        ("Dynamic Rule Governance", "Operator console to adjust heuristic weights, disable rules, and perform dry-run simulations against historical records.", CYAN)
    ]

    for idx, (title, desc, color) in enumerate(feat_cards):
        col = idx % 3
        row = idx // 3
        l = Inches(0.8 + col * 3.95)
        t = Inches(1.8 + row * 2.6)
        add_card(s6, l, t, Inches(3.75), Inches(2.3), title, color)

        tb = s6.shapes.add_textbox(l + Inches(0.2), t + Inches(0.65), Inches(3.35), Inches(1.5))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = desc
        p.font.size = Pt(11.5)
        p.font.color.rgb = TEXT_MUTED
        p.font.name = "Arial"

    # ==========================================================
    # SLIDE 7: DEDICATED TRACK 1 - FRONTEND & SOC CONSOLE
    # ==========================================================
    s7 = prs.slides.add_slide(blank_layout)
    set_slide_background(s7)
    add_header(s7, "Team Track 1  |  Lead: Frontend & SOC Experience Engineer", "Frontend & SOC Console Engineering", "Crafting responsive, high-performance cybersecurity dashboards with sub-millisecond state updates.")

    s7_left = add_card(s7, Inches(0.8), Inches(1.8), Inches(5.6), Inches(5.0), "Codebase & Core Modules", CYAN)
    tb_s7_l = s7.shapes.add_textbox(Inches(1.0), Inches(2.5), Inches(5.2), Inches(4.0))
    tf_s7_l = tb_s7_l.text_frame
    tf_s7_l.word_wrap = True
    s7_files = [
        ("frontend/src/App.tsx", "Global application state, optimistic dispatchers, navigation"),
        ("frontend/src/components/ThreatMap.tsx", "Leaflet GIS canvas, radar markers, flight trajectory paths"),
        ("frontend/src/components/LiveIngestionTable.tsx", "100-event circular buffer table, zero DOM freeze"),
        ("frontend/src/components/TransactionDetailDrawer.tsx", "Forensic trace drawer, quick-action Block & Quarantine"),
        ("frontend/src/components/QuarantinePage.tsx", "Analyst disposition tabs, SLA countdown, 4-Eyes modal"),
        ("frontend/src/components/AccountRegistryPage.tsx", "Interactive SVG entity link topology graph, PII reveal")
    ]
    for idx, (file_name, desc) in enumerate(s7_files):
        p = tf_s7_l.paragraphs[0] if idx == 0 else tf_s7_l.add_paragraph()
        p.text = f"• {file_name}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = CYAN_LIGHT
        p.font.name = "Arial"
        p_sub = tf_s7_l.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    s7_right = add_card(s7, Inches(6.7), Inches(1.8), Inches(5.8), Inches(5.0), "Key Technical Achievements", EMERALD)
    tb_s7_r = s7.shapes.add_textbox(Inches(6.9), Inches(2.5), Inches(5.4), Inches(4.0))
    tf_s7_r = tb_s7_r.text_frame
    tf_s7_r.word_wrap = True
    s7_achievements = [
        ("Optimistic Multi-Surface State Sync (<1ms)", "Clicking 'Block & Quarantine' instantly updates the table badge (ALLOW -> BLOCK), drawer button state, and top KPI counters before network returns."),
        ("Clean Radar Marker Visuals", "Replaced visual text clutter with 16px pulsating circular radar dots with translucent glow rings for high-density geographic clarity."),
        ("4-Eyes Dual-Control Compliance Modal", "Enforces administrative secondary approval when releasing transactions with Risk Score >= 80, preventing rogue insider actions."),
        ("Deterministic Auto-Tab Case Routing", "When dispositions are committed, the UI shifts automatically to the target tab (Escalated, Released, Confirmed) with stable CASE-XXXX IDs.")
    ]
    for idx, (title, desc) in enumerate(s7_achievements):
        p = tf_s7_r.paragraphs[0] if idx == 0 else tf_s7_r.add_paragraph()
        p.text = f"✔ {title}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = EMERALD
        p.font.name = "Arial"
        p_sub = tf_s7_r.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    # ==========================================================
    # SLIDE 8: DEDICATED TRACK 2 - BACKEND & DETECTION ENGINE
    # ==========================================================
    s8 = prs.slides.add_slide(blank_layout)
    set_slide_background(s8)
    add_header(s8, "Team Track 2  |  Lead: Backend & Detection Engine Engineer", "Backend & Detection Engine Engineering", "Real-time stream evaluation, high-performance analytics, and algorithmic risk telemetry.")

    add_card(s8, Inches(0.8), Inches(1.8), Inches(5.6), Inches(5.0), "Codebase & Core Modules", AMBER)
    tb_s8_l = s8.shapes.add_textbox(Inches(1.0), Inches(2.5), Inches(5.2), Inches(4.0))
    tf_s8_l = tb_s8_l.text_frame
    tf_s8_l.word_wrap = True
    s8_files = [
        ("src/stream_monitor.py", "HTTP REST engine, SSE broadcast hub, route handlers"),
        ("src/rule_engine.py", "Weighted heuristic detection rule engine"),
        ("src/analytics_aggregator.py", "O(1) time-series aggregation, mathematical reconciliation"),
        ("src/quarantine_manager.py", "Case queue state machine, SLA computation, action audits"),
        ("src/tower_geo_helper.py", "Cellular base station Haversine distance & velocity check"),
        ("src/simulator_engine.py", "Adversary attack injector: ATM Velocity, Tor, Travel")
    ]
    for idx, (file_name, desc) in enumerate(s8_files):
        p = tf_s8_l.paragraphs[0] if idx == 0 else tf_s8_l.add_paragraph()
        p.text = f"• {file_name}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = AMBER
        p.font.name = "Arial"
        p_sub = tf_s8_l.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    add_card(s8, Inches(6.7), Inches(1.8), Inches(5.8), Inches(5.0), "Key Technical Achievements", PURPLE)
    tb_s8_r = s8.shapes.add_textbox(Inches(6.9), Inches(2.5), Inches(5.4), Inches(4.0))
    tf_s8_r = tb_s8_r.text_frame
    tf_s8_r.word_wrap = True
    s8_achievements = [
        ("O(1) Analytics Engine Optimization", "Replaced quadratic 72,000+ date string parse loops with direct epoch index arithmetic. Reduced 7D/30D query times from >5000ms to 9ms."),
        ("Strict Mathematical Reconciliation Invariants", "Guarantees sum(volume_over_time) == total_events == sum(risk_histogram) across all time windows, preventing KPI divergence."),
        ("Deterministic Case ID Generation", "Derived permanent Case IDs from transaction digits, eliminating renumbering glitches during disposition actions."),
        ("Adversary Attack Simulation Suite", "Integrated multi-scenario attack simulator generating synthetic fraud vectors on demand for live operator training.")
    ]
    for idx, (title, desc) in enumerate(s8_achievements):
        p = tf_s8_r.paragraphs[0] if idx == 0 else tf_s8_r.add_paragraph()
        p.text = f"✔ {title}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = PURPLE
        p.font.name = "Arial"
        p_sub = tf_s8_r.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    # ==========================================================
    # SLIDE 9: DEDICATED TRACK 3 - CLOUD INFRA & AI ENGINE
    # ==========================================================
    s9 = prs.slides.add_slide(blank_layout)
    set_slide_background(s9)
    add_header(s9, "Team Track 3  |  Lead: Cloud Infra & AI/ML Engineer", "Cloud Infrastructure & AI Copilot Engineering", "Provisioning scalable AWS services, serverless workflows, GenAI Copilot, and DevOps automation.")

    add_card(s9, Inches(0.8), Inches(1.8), Inches(5.6), Inches(5.0), "Codebase & Cloud Modules", ROSE)
    tb_s9_l = s9.shapes.add_textbox(Inches(1.0), Inches(2.5), Inches(5.2), Inches(4.0))
    tf_s9_l = tb_s9_l.text_frame
    tf_s9_l.word_wrap = True
    s9_files = [
        ("src/db_client.py", "DynamoDB client, schema partitioning, auto-fallback engine"),
        ("src/cloud_bedrock_copilot.py", "Amazon Bedrock LLM prompts, incident briefing, SAR drafts"),
        ("src/cloud_sqs_adapter.py", "Amazon SQS surge buffer, dead-letter queue handler"),
        ("src/cloud_step_functions.py", "AWS Step Functions human-in-the-loop state machine"),
        ("src/cloud_cognito_auth.py", "Cognito JWT validator, RBAC Analyst/Admin resolution"),
        ("src/cloud_redis_feature_store.py", "ElastiCache Redis sub-millisecond velocity feature cache")
    ]
    for idx, (file_name, desc) in enumerate(s9_files):
        p = tf_s9_l.paragraphs[0] if idx == 0 else tf_s9_l.add_paragraph()
        p.text = f"• {file_name}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = ROSE
        p.font.name = "Arial"
        p_sub = tf_s9_l.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    add_card(s9, Inches(6.7), Inches(1.8), Inches(5.8), Inches(5.0), "Key Technical Achievements", CYAN)
    tb_s9_r = s9.shapes.add_textbox(Inches(6.9), Inches(2.5), Inches(5.4), Inches(4.0))
    tf_s9_r = tb_s9_r.text_frame
    tf_s9_r.word_wrap = True
    s9_achievements = [
        ("Amazon Bedrock Autonomous Copilot", "Generates contextual plain-English incident briefings and compliant SAR narrative drafts directly from multi-layer telemetry."),
        ("DynamoDB Schema & TTL Lifecycle", "Designed dual-table partition strategy with automated TTL expiration, keeping query latency <4ms while preventing unbounded storage growth."),
        ("Zero-Downtime EC2 Deployment Pipeline", "Automated tarball packaging, asset minification, and zero-downtime service restarts over secure SSH tunnels."),
        ("Cognito RBAC & Dual-Control Security", "Enforces cryptographic JWT signature verification and role claims, safeguarding high-privilege SOC operator endpoints.")
    ]
    for idx, (title, desc) in enumerate(s9_achievements):
        p = tf_s9_r.paragraphs[0] if idx == 0 else tf_s9_r.add_paragraph()
        p.text = f"✔ {title}"
        p.font.size = Pt(11)
        p.font.bold = True
        p.font.color.rgb = CYAN
        p.font.name = "Arial"
        p_sub = tf_s9_r.add_paragraph()
        p_sub.text = f"   {desc}"
        p_sub.font.size = Pt(10)
        p_sub.font.color.rgb = TEXT_MUTED
        p_sub.font.name = "Arial"
        p_sub.space_before = Pt(1)

    # ==========================================================
    # SLIDE 10: BENCHMARKS & METRICS
    # ==========================================================
    s10 = prs.slides.add_slide(blank_layout)
    set_slide_background(s10)
    add_header(s10, "Empirical Performance & Verification", "Benchmark Results & Operational Metrics", "Rigorous load-testing and verification across ingestion, UI responsiveness, and cloud resource efficiency.")

    metrics = [
        ("12.4 ms", "Avg Evaluation Latency", "End-to-end rule evaluation, cell-tower calculation, and ML scoring.", EMERALD),
        ("9.1 ms", "7D/30D Analytics Query", "Aggregating 3,000+ records into zero-filled time buckets.", CYAN),
        ("< 1 ms", "UI State Flip Time", "Optimistic state update across Table, Drawer, and Header KPIs.", PURPLE),
        ("95.4%", "SLA Compliance Rate", "Quarantined cases resolved within the 60-minute target SLA.", AMBER),
        ("0.0%", "Reconciliation Error", "Strict mathematical invariant between volume, events, and histograms.", EMERALD),
        ("$0.00", "Total AWS Cloud Cost", "Engineered to run completely within AWS Free-Tier limits on t3.micro.", ROSE)
    ]

    for idx, (val, title, desc, color) in enumerate(metrics):
        col = idx % 3
        row = idx // 3
        l = Inches(0.8 + col * 3.95)
        t = Inches(1.8 + row * 2.6)
        add_card(s10, l, t, Inches(3.75), Inches(2.3), "", color)

        tb = s10.shapes.add_textbox(l + Inches(0.2), t + Inches(0.15), Inches(3.35), Inches(2.0))
        tf = tb.text_frame
        tf.word_wrap = True

        p_v = tf.paragraphs[0]
        p_v.text = val
        p_v.font.size = Pt(32)
        p_v.font.bold = True
        p_v.font.color.rgb = color
        p_v.font.name = "Arial"

        p_t = tf.add_paragraph()
        p_t.text = title
        p_t.font.size = Pt(13)
        p_t.font.bold = True
        p_t.font.color.rgb = TEXT_WHITE
        p_t.font.name = "Arial"
        p_t.space_before = Pt(4)

        p_d = tf.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(10.5)
        p_d.font.color.rgb = TEXT_MUTED
        p_d.font.name = "Arial"
        p_d.space_before = Pt(2)

    # ==========================================================
    # SLIDE 11: CONCLUSION & FUTURE ROADMAP
    # ==========================================================
    s11 = prs.slides.add_slide(blank_layout)
    set_slide_background(s11)
    add_header(s11, "Project Summary & Future Vision", "Conclusion & Engineering Roadmap", "FraudGuard delivers an enterprise-ready, cost-effective, autonomous fraud defense platform.")

    concl_cards = [
        ("Production Readiness", "Fully containerizable, multi-threaded architecture with persistent DynamoDB storage, robust error handling, and complete telemetry logging.", CYAN),
        ("Graph Neural Networks (Roadmap)", "Transitioning Entity Link graphs to AWS Neptune + Graph Neural Networks (GNN) for automated multi-hop fraud ring detection.", EMERALD),
        ("Multi-Region Active-Active VPC", "Deploying Global DynamoDB Tables and Route 53 latency routing for cross-continental redundancy and <5ms localized latency.", PURPLE),
        ("Automated Card Network Integrations", "Direct integration with Visa Direct and Mastercard Send APIs for real-time chargeback reversals and automated dispute filings.", AMBER)
    ]

    for idx, (title, desc, color) in enumerate(concl_cards):
        col = idx % 2
        row = idx // 2
        l = Inches(0.8 + col * 5.9)
        t = Inches(1.8 + row * 2.6)
        add_card(s11, l, t, Inches(5.6), Inches(2.3), title, color)

        tb = s11.shapes.add_textbox(l + Inches(0.2), t + Inches(0.65), Inches(5.2), Inches(1.5))
        tf = tb.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = desc
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_MUTED
        p.font.name = "Arial"

    out_path = "E:/My Papers/Fraudguard_AbhiSharma/FraudGuard_Architecture_Presentation.pptx"
    prs.save(out_path)
    print(f"Presentation successfully created at: {out_path}")

if __name__ == "__main__":
    create_deck()
