SYSTEM_FACTUAL = """You are analyzing a recorded product demo session for Trend Micro Vision One.

Your job is to extract ONLY what is directly evidenced by the transcript, click events, and screenshots provided.

Rules:
- Do NOT hallucinate products or features not shown in the session data
- The "products_demonstrated" list must ONLY include products actually demonstrated (not just mentioned in passing)
- Cite specific timestamps or click events as evidence
- If something is unclear or ambiguous, omit it rather than guess
- The output must be valid JSON with no trailing commas or comments"""

SYSTEM_RECOMMENDATIONS = """You are a senior sales analyst helping the SDR team follow up after a Trend Micro Vision One product demo.

Based on the factual extraction from Pass 1, generate personalized follow-up recommendations.

Rules:
- Recommendations must be specific and actionable — not generic ("send a follow-up email" is not acceptable)
- Visitor interests must cite specific evidence from the session (transcript quotes, pages visited)
- SDR notes should be concise and include key facts: visitor role, company size if known, specific concerns raised, competing products mentioned
- Confidence levels: "high" = visitor explicitly asked about topic or spent significant time on it; "medium" = indirect signals; "low" = brief mention only
- session_score (1-10): 1-3 = passive/minimal engagement, 4-6 = moderate interest with some interaction, 7-8 = strong engagement with questions and deep exploration, 9-10 = exceptional — multiple product areas explored deeply, strong buying signals, specific use-case discussions
- executive_summary must be exactly 2 sentences suitable for a sales manager email — lead with the most important takeaway
- The output must be valid JSON with no trailing commas or comments"""

FACTUAL_EXTRACTION_PROMPT = """Analyze this Vision One demo session and extract factual information.

Vision One modules -- use these exact names when identifying products demonstrated:
- Endpoint Security (endpoint protection, EDR, server & workload protection)
- Email Security (email threat detection, BEC protection, phishing prevention)
- Network Security (network detection, IDS/IPS, lateral movement detection)
- Cloud Security (container security, cloud workload protection, CSPM)
- XDR (cross-layer detection & response, correlated alerts, investigation workbench)
- Risk Insights (risk scoring, vulnerability assessment, risk index)
- Workbench (alert triage, investigation tools, response actions, case management)
- Threat Intelligence (threat reports, IoC sweeping, campaign tracking)
- Zero Trust (Zero Trust Secure Access, device posture, identity risk)
- Attack Surface Risk Management (ASRM, internet-facing asset discovery, CVE prioritization)

Session timeline (transcript + click events):
{timeline_json}

Session metadata:
{metadata_json}

Return a JSON object with exactly these fields:
{{
  "products_demonstrated": ["list of Vision One modules actually demonstrated -- use the exact module names listed above"],
  "features_demonstrated": [
    {{"feature": "feature name", "timestamp_rel": "MM:SS", "evidence": "specific transcript or click evidence"}}
  ],
  "visitor_questions": [
    {{"question": "paraphrased question", "timestamp_rel": "MM:SS", "speaker_text": "exact quote from transcript"}}
  ],
  "key_moments": [
    {{"timestamp_rel": "MM:SS", "screenshot_file": "filename or null", "description": "what happened", "impact": "why this moment mattered for the visitor"}}
  ]  (select the top 3 most impactful demo moments — prioritize visitor reactions, deep-dive requests, and aha-moments),
  "session_stats": {{
    "duration_seconds": 0,
    "click_count": 0,
    "transcript_entries": 0
  }}
}}"""

RECOMMENDATIONS_PROMPT = """Based on the factual analysis of this Vision One demo session, generate follow-up recommendations.

Visitor name: {visitor_name}
SE name: {se_name}

Factual analysis from Pass 1:
{factual_json}

When crafting follow-up actions, reference specific Vision One capabilities the visitor should explore next:
- If they saw Endpoint Security, suggest exploring EDR investigation or Server & Workload Protection policies
- If they saw XDR, suggest a Workbench deep-dive with correlated alerts across email + endpoint + network
- If they saw Risk Insights, suggest reviewing their Attack Surface Risk Management dashboard and CVE prioritization
- If they saw Email Security, suggest configuring BEC detection rules or reviewing quarantine policies
- If they saw Network Security, suggest enabling lateral movement detection or reviewing IDS/IPS rule tuning
- If they saw Cloud Security, suggest a container image scanning demo or CSPM compliance check
- If they saw Threat Intelligence, suggest scheduling an IoC sweep against their environment
- If they saw Zero Trust, suggest a Zero Trust Secure Access policy walkthrough with device posture checks
- For any module, suggest how XDR ties it together with cross-layer visibility in the Workbench

Return a JSON object with exactly these fields (use these EXACT field names):
{{
  "session_score": 7,
  "executive_summary": "Two sentences for a sales manager. Lead with the key takeaway, then the recommended action.",
  "key_interests": [
    {{"topic": "specific Vision One module or feature", "confidence": "high|medium|low", "evidence": "specific quote or action from session"}}
  ],
  "follow_up_actions": [
    "specific actionable follow-up referencing a Vision One feature by name",
    "specific actionable follow-up referencing a Vision One feature by name"
  ],
  "sdr_notes": "concise paragraph with key facts: visitor background, main interests mapped to Vision One modules, concerns, competing products, urgency signals"
}}

IMPORTANT: Use exactly the field names shown above. "key_interests" (not "visitor_interests"), "follow_up_actions" (not "recommended_follow_up")."""


def _esc(val):
    """HTML-escape a string value."""
    if val is None:
        return ""
    return (
        str(val)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _score_color(score):
    """Return CSS color for engagement score 1-10 on a smooth gradient."""
    colors = [
        "#ef4444", "#f97316", "#f59e0b", "#eab308",
        "#a3e635", "#22c55e", "#10b981", "#14b8a6",
        "#06b6d4", "#8b5cf6",
    ]
    idx = max(0, min(9, int(score) - 1))
    return colors[idx]


def _score_summary(score):
    if score >= 8:
        return "Strong engagement -- high-priority follow-up recommended"
    if score >= 6:
        return "Good engagement -- visitor showed clear interest"
    if score >= 4:
        return "Moderate engagement -- some interest signals detected"
    return "Light engagement -- brief interaction or limited data"


def _gauge_dasharray(score):
    """SVG circle r=40, circumference ~251.3. Score is 1-10."""
    circ = 2 * 3.14159265 * 40
    filled = (score / 10.0) * circ
    return f"{filled:.1f} {circ:.1f}"


def _priority_color(priority):
    p = (priority or "medium").lower()
    if p == "high":
        return "#4ade80"
    if p == "medium":
        return "#fbbf24"
    return "#94a3b8"


def _build_product_tags(products):
    tag_classes = ["tag-0", "tag-1", "tag-2", "tag-3", "tag-4", "tag-5"]
    lines = []
    for i, p in enumerate(products or []):
        cls = tag_classes[i % len(tag_classes)]
        lines.append(
            f'    <span class="tag {cls}"><span class="dot"></span>{_esc(p)}</span>'
        )
    return "\n".join(lines) if lines else '    <span style="color:#475569">No products recorded</span>'


def _build_timeline(key_moments, features):
    """Build timeline HTML from key_moments and features_demonstrated."""
    items = []
    for m in (key_moments or []):
        ts = m.get("timestamp", m.get("timestamp_rel", ""))
        items.append(
            f'    <div class="tl-item">'
            f'<div class="tl-dot moment"></div>'
            f'<div class="tl-time">{_esc(ts)}</div>'
            f'<div class="tl-desc"><span class="tl-label speech-label">KEY</span>{_esc(m.get("description", ""))}</div>'
            f'<div class="tl-impact">{_esc(m.get("impact", ""))}</div>'
            f'</div>'
        )
    for f in (features or []):
        ts = f.get("timestamp_rel", "")
        items.append(
            f'    <div class="tl-item">'
            f'<div class="tl-dot click"></div>'
            f'<div class="tl-time">{_esc(ts)}</div>'
            f'<div class="tl-desc"><span class="tl-label click-label">DEMO</span>{_esc(f.get("feature", ""))}</div>'
            f'</div>'
        )
    return "\n".join(items) if items else '    <div style="color:#475569;padding:12px">No timeline events recorded</div>'


def _build_interests_rows(interests):
    rows = []
    for i in (interests or []):
        conf = (i.get("confidence") or "low").lower()
        cls = f"conf-{conf}"
        rows.append(
            f'      <tr><td>{_esc(i.get("topic", ""))}</td>'
            f'<td><span class="{cls}">{_esc(conf)}</span></td>'
            f'<td style="color:#94a3b8;font-size:13px">{_esc(i.get("evidence", ""))}</td></tr>'
        )
    return "\n".join(rows) if rows else '      <tr><td colspan="3" style="color:#475569">No interests recorded</td></tr>'


def _build_followup_cards(actions, priority):
    p = (priority or "medium").lower()
    cards = []
    for idx, action in enumerate(actions or []):
        pri_tag = ""
        if idx == 0:
            pri_tag = f' <span class="fu-priority p-{p}">{_esc(priority or "medium")}</span>'
        cards.append(
            f'  <div class="fu-card">'
            f'<div class="fu-num p-{p}">{idx + 1}</div>'
            f'<div class="fu-text">{_esc(action)}{pri_tag}</div>'
            f'</div>'
        )
    return "\n".join(cards) if cards else '  <div style="color:#475569;padding:12px">No follow-up actions</div>'


def render_html_report(summary, follow_up, factual=None):
    """Render the HTML report from summary.json, follow-up.json, and optional factual data.

    Returns the full HTML string ready to write to disk.
    """
    score = summary.get("session_score", 0)
    priority = follow_up.get("priority", "medium")

    # Merge key_moments from summary with features from factual for timeline
    key_moments = summary.get("key_moments", [])
    features = (factual or {}).get("features_demonstrated", [])
    stats = (factual or {}).get("session_stats", {})

    tenant_url = summary.get("v1_tenant_link", "")
    tenant_html = ""
    if tenant_url:
        tenant_html = (
            '<div class="card">'
            '<h2><span class="ico">-></span> Your Vision One Tenant</h2>'
            f'<div class="sdr-box"><a href="{_esc(tenant_url)}" '
            f'style="color:#60a5fa;text-decoration:none;font-weight:600">{_esc(tenant_url)}</a>'
            '<div style="color:#484f58;margin-top:8px;font-size:13px">'
            'This tenant is preserved for 30 days after your demo.</div></div></div>'
        )

    # Build score-steps JS to highlight active gradient steps
    score_steps_js = (
        "<script>"
        f"document.querySelectorAll('.score-step').forEach(function(el,i)"
        f"{{if(i>={int(score)})el.style.background='#21262d';"
        f"else el.classList.add('active')}});"
        "</script>"
    )

    replacements = {
        "visitor_name": _esc(summary.get("visitor_name", "Unknown Visitor")),
        "visitor_company": _esc(follow_up.get("visitor_company", summary.get("visitor_company", ""))),
        "session_id": _esc(summary.get("session_id", "")),
        "se_name": _esc(summary.get("se_name", follow_up.get("se_name", ""))),
        "generated_at": _esc(summary.get("generated_at", "")),
        "company_logo_html": "Company<br>Logo",
        "session_score": str(score),
        "score_color": _score_color(score),
        "score_dasharray": _gauge_dasharray(score),
        "score_summary": _score_summary(score),
        "executive_summary": _esc(summary.get("executive_summary", "")),
        "duration_minutes": str(summary.get("demo_duration_seconds", 0) // 60),
        "click_count": str(stats.get("click_count", summary.get("click_count", 0))),
        "transcript_count": str(stats.get("transcript_entries", summary.get("transcript_entries", 0))),
        "priority": _esc(priority),
        "priority_color": _priority_color(priority),
        "product_tags_html": _build_product_tags(summary.get("products_demonstrated", [])),
        "timeline_html": _build_timeline(key_moments, features),
        "interests_html": _build_interests_rows(summary.get("key_interests", [])),
        "followup_html": _build_followup_cards(
            summary.get("follow_up_actions", []), priority
        ),
        "sdr_notes": _esc(follow_up.get("sdr_notes", "No SDR notes recorded.")),
        "tenant_link_html": tenant_html,
        "score_steps_js": score_steps_js,
    }

    html = HTML_REPORT_TEMPLATE
    for key, value in replacements.items():
        html = html.replace("{" + key + "}", value)
    return html


# ── HTML Report Template ─────────────────────────────────────────
# Trade-show quality: dark theme (#1a1a2e), large headings, engagement
# gauge with 1-10 color gradient, timeline strip, product interest
# badges, follow-up recommendations with priority.  All CSS inline.

HTML_REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Report -- {visitor_name}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif;background:#1a1a2e;color:#c9d1d9;line-height:1.65;min-height:100vh}
.wrap{max-width:940px;margin:0 auto;padding:0 28px 64px}

/* -- Header --------------------------------------------------- */
.hdr{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 40%,#0f3460 100%);border-bottom:3px solid #e94560;padding:44px 0 40px;position:relative;overflow:hidden}
.hdr::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#e94560,#8b5cf6,#06b6d4,#e94560);background-size:300% 100%;animation:shimmer 6s linear infinite}
.hdr::after{content:'';position:absolute;top:-60%;right:-10%;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(233,69,96,.08) 0%,transparent 70%);pointer-events:none}
@keyframes shimmer{0%{background-position:300% 0}100%{background-position:-300% 0}}
.hdr-inner{max-width:940px;margin:0 auto;padding:0 28px;display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap;position:relative;z-index:1}
.hdr-left{display:flex;align-items:center;gap:22px}
.logo-box{width:60px;height:60px;border-radius:16px;background:linear-gradient(135deg,#e94560,#c2185b);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 6px 20px rgba(233,69,96,.4)}
.logo-box svg{width:32px;height:32px;fill:#fff}
.hdr-title{font-size:12px;font-weight:700;color:#e94560;text-transform:uppercase;letter-spacing:.2em}
.hdr-name{font-size:34px;font-weight:800;color:#ffffff;margin-top:4px;letter-spacing:-.02em}
.hdr-company{font-size:16px;color:#8b949e;margin-top:4px}
.hdr-right{text-align:right;font-size:13px;color:#8b949e}
.hdr-right strong{color:#c9d1d9}
.company-logo{width:80px;height:80px;border-radius:16px;background:#16213e;border:1px solid #30363d;display:flex;align-items:center;justify-content:center;font-size:11px;color:#484f58;text-align:center;padding:8px}

/* -- Cards ---------------------------------------------------- */
.card{background:linear-gradient(145deg,#16213e 0%,#1a1a2e 100%);border:1px solid #30363d;border-radius:16px;padding:32px 32px 28px;margin-top:28px;box-shadow:0 4px 24px rgba(0,0,0,.3)}
.card h2{font-size:24px;font-weight:800;color:#ffffff;margin-bottom:20px;display:flex;align-items:center;gap:12px;letter-spacing:-.01em}
.card h2 .ico{font-size:18px;color:#e94560;font-family:'Courier New',monospace;font-weight:400}

/* -- Engagement Gauge ----------------------------------------- */
.gauge-row{display:flex;align-items:center;gap:36px;flex-wrap:wrap}
.gauge{position:relative;width:160px;height:160px;flex-shrink:0}
.gauge svg{width:160px;height:160px;transform:rotate(-90deg)}
.gauge-bg{fill:none;stroke:#30363d;stroke-width:10}
.gauge-fill{fill:none;stroke-width:10;stroke-linecap:round;filter:drop-shadow(0 0 6px currentColor)}
.gauge-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-num{font-size:48px;font-weight:900;line-height:1;letter-spacing:-.03em}
.gauge-sub{font-size:13px;color:#484f58;margin-top:4px;font-weight:600}
.gauge-text{flex:1;min-width:220px}
.gauge-text .summary{font-size:17px;color:#c9d1d9;line-height:1.7;font-weight:600}
.gauge-text .exec{font-size:15px;color:#8b949e;margin-top:10px;font-style:italic;line-height:1.6;border-left:3px solid #e94560;padding-left:14px}

/* -- Score Steps ---------------------------------------------- */
.score-steps{display:flex;gap:4px;margin-top:14px}
.score-step{flex:1;height:6px;border-radius:3px;background:#21262d}
.score-step.active{box-shadow:0 0 8px currentColor}

/* -- Session Meta --------------------------------------------- */
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-top:18px}
.meta-item{background:#1a1a2e;border-radius:12px;padding:18px 20px;border:1px solid #30363d}
.meta-item .label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#484f58;margin-bottom:6px;font-weight:600}
.meta-item .value{font-size:22px;font-weight:800;color:#ffffff}

/* -- Timeline Strip ------------------------------------------- */
.timeline{position:relative;padding-left:28px}
.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#e94560 0%,#8b5cf6 40%,#06b6d4 100%);border-radius:2px;box-shadow:0 0 10px rgba(233,69,96,.3)}
.tl-item{position:relative;padding:14px 0 14px 24px;font-size:14px;border-bottom:1px solid rgba(48,54,61,.5)}
.tl-item:last-child{border-bottom:none}
.tl-dot{position:absolute;left:-22px;top:18px;width:14px;height:14px;border-radius:50%;border:3px solid #1a1a2e}
.tl-dot.click{background:#06b6d4;box-shadow:0 0 8px rgba(6,182,212,.4)}
.tl-dot.speech{background:#8b5cf6;box-shadow:0 0 8px rgba(139,92,246,.4)}
.tl-dot.moment{background:#e94560;box-shadow:0 0 12px rgba(233,69,96,.6)}
.tl-time{font-size:12px;color:#484f58;font-family:'Courier New',monospace;font-weight:700;margin-bottom:2px}
.tl-desc{color:#c9d1d9;font-size:15px}
.tl-impact{font-size:13px;color:#a78bfa;margin-top:4px;font-style:italic}
.tl-label{display:inline-block;padding:2px 10px;border-radius:6px;font-size:10px;font-weight:800;text-transform:uppercase;margin-right:8px;letter-spacing:.05em}
.tl-label.click-label{background:rgba(6,182,212,.15);color:#06b6d4;border:1px solid rgba(6,182,212,.3)}
.tl-label.speech-label{background:rgba(233,69,96,.15);color:#e94560;border:1px solid rgba(233,69,96,.3)}

/* -- Product Tags --------------------------------------------- */
.tags{display:flex;flex-wrap:wrap;gap:10px}
.tag{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:24px;font-size:14px;font-weight:700;border:1px solid;backdrop-filter:blur(4px);transition:transform .15s ease,box-shadow .15s ease}
.tag:hover{transform:translateY(-1px)}
.tag-0{background:rgba(59,130,246,.12);border-color:rgba(59,130,246,.4);color:#60a5fa;box-shadow:0 2px 12px rgba(59,130,246,.15)}
.tag-1{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.4);color:#a78bfa;box-shadow:0 2px 12px rgba(139,92,246,.15)}
.tag-2{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:#fbbf24;box-shadow:0 2px 12px rgba(245,158,11,.15)}
.tag-3{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.4);color:#4ade80;box-shadow:0 2px 12px rgba(34,197,94,.15)}
.tag-4{background:rgba(233,69,96,.12);border-color:rgba(233,69,96,.4);color:#fb7185;box-shadow:0 2px 12px rgba(233,69,96,.15)}
.tag-5{background:rgba(6,182,212,.12);border-color:rgba(6,182,212,.4);color:#22d3ee;box-shadow:0 2px 12px rgba(6,182,212,.15)}
.tag .dot{width:10px;height:10px;border-radius:50%;box-shadow:0 0 6px currentColor}
.tag-0 .dot{background:#3b82f6}
.tag-1 .dot{background:#8b5cf6}
.tag-2 .dot{background:#f59e0b}
.tag-3 .dot{background:#22c55e}
.tag-4 .dot{background:#e94560}
.tag-5 .dot{background:#06b6d4}

/* -- Interests Table ------------------------------------------ */
.int-table{width:100%;border-collapse:collapse}
.int-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#484f58;padding:10px 14px;border-bottom:2px solid #30363d;font-weight:700}
.int-table td{padding:12px 14px;border-bottom:1px solid #21262d;font-size:14px}
.int-table tr:hover td{background:rgba(233,69,96,.04)}
.conf-high{color:#4ade80;font-weight:800;text-transform:uppercase;font-size:12px;letter-spacing:.05em}
.conf-medium{color:#fbbf24;font-weight:700;text-transform:uppercase;font-size:12px;letter-spacing:.05em}
.conf-low{color:#484f58;text-transform:uppercase;font-size:12px;letter-spacing:.05em}

/* -- Follow-up Cards ------------------------------------------ */
.fu-card{display:flex;gap:16px;padding:20px;background:#1a1a2e;border:1px solid #30363d;border-radius:12px;margin-bottom:12px;align-items:flex-start;transition:border-color .15s ease}
.fu-card:hover{border-color:#e94560}
.fu-num{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;flex-shrink:0}
.fu-num.p-high{background:rgba(34,197,94,.15);color:#4ade80;border:2px solid rgba(34,197,94,.4)}
.fu-num.p-medium{background:rgba(245,158,11,.15);color:#fbbf24;border:2px solid rgba(245,158,11,.4)}
.fu-num.p-low{background:#21262d;color:#8b949e;border:2px solid #30363d}
.fu-text{font-size:15px;color:#c9d1d9;flex:1;line-height:1.6}
.fu-priority{display:inline-block;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:800;text-transform:uppercase;margin-left:10px;letter-spacing:.05em}
.fu-priority.p-high{background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3)}
.fu-priority.p-medium{background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3)}
.fu-priority.p-low{background:#21262d;color:#8b949e;border:1px solid #30363d}

/* -- SDR Notes ------------------------------------------------ */
.sdr-box{background:#1a1a2e;border:1px solid #30363d;border-radius:12px;padding:22px 24px;font-size:15px;color:#8b949e;line-height:1.75;border-left:4px solid #e94560}

/* -- Footer --------------------------------------------------- */
.footer{text-align:center;padding:36px 0;font-size:12px;color:#30363d;border-top:1px solid #21262d;margin-top:48px;letter-spacing:.05em}
.footer strong{color:#484f58}

/* -- Responsive ----------------------------------------------- */
@media(max-width:640px){
  .hdr-inner{flex-direction:column;align-items:flex-start}
  .hdr-name{font-size:26px}
  .hdr-right{text-align:left}
  .gauge-row{flex-direction:column;align-items:flex-start}
  .gauge{width:120px;height:120px}
  .gauge svg{width:120px;height:120px}
  .gauge-num{font-size:36px}
  .meta-grid{grid-template-columns:1fr 1fr}
  .card{padding:22px 20px 18px}
  .card h2{font-size:20px}
  .company-logo{display:none}
}
</style>
</head>
<body>

<!-- ========== HEADER ========== -->
<div class="hdr">
  <div class="hdr-inner">
    <div class="hdr-left">
      <div class="logo-box">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <div>
        <div class="hdr-title">Booth Demo Report</div>
        <div class="hdr-name">{visitor_name}</div>
        <div class="hdr-company">{visitor_company}</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:20px">
      <div class="hdr-right">
        <div>Session <strong>{session_id}</strong></div>
        <div>SE: <strong>{se_name}</strong></div>
        <div>{generated_at}</div>
      </div>
      <div class="company-logo">{company_logo_html}</div>
    </div>
  </div>
</div>

<div class="wrap">

<!-- ========== ENGAGEMENT GAUGE ========== -->
<div class="card">
  <h2><span class="ico">///</span> Engagement Score</h2>
  <div class="gauge-row">
    <div class="gauge">
      <svg viewBox="0 0 100 100">
        <circle class="gauge-bg" cx="50" cy="50" r="40"/>
        <circle class="gauge-fill" cx="50" cy="50" r="40"
                stroke="{score_color}"
                stroke-dasharray="{score_dasharray}"
                stroke-dashoffset="0"/>
      </svg>
      <div class="gauge-label">
        <span class="gauge-num" style="color:{score_color}">{session_score}</span>
        <span class="gauge-sub">/ 10</span>
      </div>
    </div>
    <div class="gauge-text">
      <div class="summary">{score_summary}</div>
      <div class="exec">{executive_summary}</div>
    </div>
  </div>
  <div class="score-steps">
    <div class="score-step" style="background:#ef4444"></div>
    <div class="score-step" style="background:#f97316"></div>
    <div class="score-step" style="background:#f59e0b"></div>
    <div class="score-step" style="background:#eab308"></div>
    <div class="score-step" style="background:#a3e635"></div>
    <div class="score-step" style="background:#22c55e"></div>
    <div class="score-step" style="background:#10b981"></div>
    <div class="score-step" style="background:#14b8a6"></div>
    <div class="score-step" style="background:#06b6d4"></div>
    <div class="score-step" style="background:#8b5cf6"></div>
  </div>
</div>

<!-- ========== SESSION META ========== -->
<div class="card">
  <h2><span class="ico">[i]</span> Session Details</h2>
  <div class="meta-grid">
    <div class="meta-item"><div class="label">Duration</div><div class="value">{duration_minutes} min</div></div>
    <div class="meta-item"><div class="label">Clicks</div><div class="value">{click_count}</div></div>
    <div class="meta-item"><div class="label">Transcript</div><div class="value">{transcript_count} entries</div></div>
    <div class="meta-item"><div class="label">Priority</div><div class="value" style="color:{priority_color}">{priority}</div></div>
  </div>
</div>

<!-- ========== PRODUCT INTEREST TAGS ========== -->
<div class="card">
  <h2><span class="ico">#</span> Products Demonstrated</h2>
  <div class="tags">
{product_tags_html}
  </div>
</div>

<!-- ========== TIMELINE STRIP ========== -->
<div class="card">
  <h2><span class="ico">|></span> Demo Timeline</h2>
  <div class="timeline">
{timeline_html}
  </div>
</div>

<!-- ========== VISITOR INTERESTS ========== -->
<div class="card">
  <h2><span class="ico">*</span> Visitor Interests</h2>
  <table class="int-table">
    <thead><tr><th>Topic</th><th>Confidence</th><th>Evidence</th></tr></thead>
    <tbody>
{interests_html}
    </tbody>
  </table>
</div>

<!-- ========== FOLLOW-UP RECOMMENDATIONS ========== -->
<div class="card">
  <h2><span class="ico">>></span> Recommended Follow-Up</h2>
{followup_html}
</div>

<!-- ========== SDR NOTES ========== -->
<div class="card">
  <h2><span class="ico">@</span> SDR Notes</h2>
  <div class="sdr-box">{sdr_notes}</div>
</div>

{tenant_link_html}

<div class="footer">
  Generated by <strong>BoothApp</strong> Analysis Pipeline -- Trend Micro -- {generated_at}
</div>
</div>
{score_steps_js}
</body>
</html>"""
