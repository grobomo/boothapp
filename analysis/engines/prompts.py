SYSTEM_FACTUAL = """You are analyzing a recorded product demo session for Trend Micro Vision One.

Your job is to extract ONLY what is directly evidenced by the transcript, click events, and screenshots provided.

Rules:
- Do NOT hallucinate products or features not shown in the session data
- The "products_shown" list must ONLY include products actually demonstrated (not just mentioned in passing)
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

Session timeline (transcript + click events):
{timeline_json}

Session metadata:
{metadata_json}

Return a JSON object with exactly these fields:
{{
  "products_shown": ["list of Vision One products/modules actually demonstrated"],
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

Return a JSON object with exactly these fields:
{{
  "session_score": 7,
  "executive_summary": "Two sentences for a sales manager. Lead with the key takeaway, then the recommended action.",
  "visitor_interests": [
    {{"topic": "specific topic", "confidence": "high|medium|low", "evidence": "specific quote or action from session"}}
  ],
  "recommended_follow_up": [
    "specific actionable follow-up item 1",
    "specific actionable follow-up item 2"
  ],
  "sdr_notes": "concise paragraph with key facts: visitor background, main interests, concerns, competing products, urgency signals"
}}"""


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
    """Return CSS color for engagement score 1-10."""
    if score >= 8:
        return "#4ade80"
    if score >= 6:
        return "#fbbf24"
    if score >= 4:
        return "#fb923c"
    return "#f87171"


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
            f'style="color:#60a5fa;text-decoration:none">{_esc(tenant_url)}</a>'
            '<div style="color:#475569;margin-top:6px;font-size:12px">'
            'This tenant is preserved for 30 days after your demo.</div></div></div>'
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
        "duration_minutes": str(summary.get("demo_duration_minutes", 0)),
        "click_count": str(stats.get("click_count", summary.get("click_count", 0))),
        "transcript_count": str(stats.get("transcript_entries", summary.get("transcript_entries", 0))),
        "priority": _esc(priority),
        "priority_color": _priority_color(priority),
        "product_tags_html": _build_product_tags(summary.get("products_shown", [])),
        "timeline_html": _build_timeline(key_moments, features),
        "interests_html": _build_interests_rows(summary.get("visitor_interests", [])),
        "followup_html": _build_followup_cards(
            summary.get("recommended_follow_up", []), priority
        ),
        "sdr_notes": _esc(follow_up.get("sdr_notes", "No SDR notes recorded.")),
        "tenant_link_html": tenant_html,
    }

    html = HTML_REPORT_TEMPLATE
    for key, value in replacements.items():
        html = html.replace("{" + key + "}", value)
    return html


# ── HTML Report Template ─────────────────────────────────────────
# Trade-show quality: dark theme, engagement gauge, timeline strip,
# product interest tags, follow-up recommendations with priority.

HTML_REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Report -- {visitor_name}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0b1120;color:#cbd5e1;line-height:1.6;min-height:100vh}
.wrap{max-width:900px;margin:0 auto;padding:0 24px 60px}

/* -- Header --------------------------------------------------- */
.hdr{background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);border-bottom:2px solid #1e40af;padding:36px 0 32px;position:relative}
.hdr::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#ec4899,#3b82f6);background-size:200% 100%;animation:shimmer 4s linear infinite}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.hdr-inner{max-width:900px;margin:0 auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.hdr-left{display:flex;align-items:center;gap:20px}
.logo-box{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 14px rgba(59,130,246,.35)}
.logo-box svg{width:28px;height:28px;fill:#fff}
.hdr-title{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.15em}
.hdr-name{font-size:28px;font-weight:800;color:#f1f5f9;margin-top:2px}
.hdr-company{font-size:15px;color:#94a3b8;margin-top:2px}
.hdr-right{text-align:right;font-size:13px;color:#64748b}
.hdr-right strong{color:#94a3b8}
.company-logo{width:80px;height:80px;border-radius:16px;background:#1e293b;border:1px solid #334155;display:flex;align-items:center;justify-content:center;font-size:11px;color:#475569;text-align:center;padding:8px}

/* -- Cards ---------------------------------------------------- */
.card{background:#111827;border:1px solid #1e293b;border-radius:14px;padding:28px 28px 24px;margin-top:24px}
.card h2{font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.card h2 .ico{font-size:16px;color:#3b82f6;font-family:monospace}

/* -- Engagement Gauge ----------------------------------------- */
.gauge-row{display:flex;align-items:center;gap:32px;flex-wrap:wrap}
.gauge{position:relative;width:130px;height:130px;flex-shrink:0}
.gauge svg{width:130px;height:130px;transform:rotate(-90deg)}
.gauge-bg{fill:none;stroke:#1e293b;stroke-width:8}
.gauge-fill{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .8s ease}
.gauge-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.gauge-num{font-size:36px;font-weight:800;line-height:1}
.gauge-sub{font-size:11px;color:#64748b;margin-top:2px}
.gauge-text{flex:1;min-width:200px}
.gauge-text .summary{font-size:15px;color:#94a3b8;line-height:1.7}
.gauge-text .exec{font-size:14px;color:#64748b;margin-top:8px;font-style:italic}

/* -- Session Meta --------------------------------------------- */
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:16px}
.meta-item{background:#0f172a;border-radius:10px;padding:14px 16px;border:1px solid #1e293b}
.meta-item .label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#475569;margin-bottom:4px}
.meta-item .value{font-size:18px;font-weight:700;color:#e2e8f0}

/* -- Timeline Strip ------------------------------------------- */
.timeline{position:relative;padding-left:24px}
.timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,#3b82f6 0%,#8b5cf6 50%,#ec4899 100%);border-radius:1px}
.tl-item{position:relative;padding:10px 0 10px 20px;font-size:14px}
.tl-dot{position:absolute;left:-20px;top:14px;width:12px;height:12px;border-radius:50%;border:2px solid #0b1120}
.tl-dot.click{background:#3b82f6}
.tl-dot.speech{background:#8b5cf6}
.tl-dot.moment{background:#ec4899;box-shadow:0 0 8px rgba(236,72,153,.5)}
.tl-time{font-size:11px;color:#475569;font-family:monospace}
.tl-desc{color:#cbd5e1}
.tl-impact{font-size:12px;color:#a78bfa;margin-top:2px}
.tl-label{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;margin-right:6px}
.tl-label.click-label{background:#1e3a5f;color:#60a5fa}
.tl-label.speech-label{background:#2e1065;color:#c084fc}

/* -- Product Tags --------------------------------------------- */
.tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;border:1px solid}
.tag-0{background:#172554;border-color:#1e40af;color:#60a5fa}
.tag-1{background:#1e1b4b;border-color:#4338ca;color:#a78bfa}
.tag-2{background:#171717;border-color:#a16207;color:#fbbf24}
.tag-3{background:#14532d;border-color:#15803d;color:#4ade80}
.tag-4{background:#4a1d2e;border-color:#9d174d;color:#fb7185}
.tag-5{background:#164e63;border-color:#0e7490;color:#22d3ee}
.tag .dot{width:8px;height:8px;border-radius:50%}
.tag-0 .dot{background:#3b82f6}
.tag-1 .dot{background:#8b5cf6}
.tag-2 .dot{background:#f59e0b}
.tag-3 .dot{background:#22c55e}
.tag-4 .dot{background:#f43f5e}
.tag-5 .dot{background:#06b6d4}

/* -- Interests Table ------------------------------------------ */
.int-table{width:100%;border-collapse:collapse}
.int-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#475569;padding:8px 12px;border-bottom:1px solid #1e293b}
.int-table td{padding:10px 12px;border-bottom:1px solid #1e293b;font-size:14px}
.conf-high{color:#4ade80;font-weight:700}
.conf-medium{color:#fbbf24;font-weight:600}
.conf-low{color:#64748b}

/* -- Follow-up Cards ------------------------------------------ */
.fu-card{display:flex;gap:14px;padding:16px;background:#0f172a;border:1px solid #1e293b;border-radius:10px;margin-bottom:10px;align-items:flex-start}
.fu-num{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0}
.fu-num.p-high{background:#14532d;color:#4ade80;border:1px solid #15803d}
.fu-num.p-medium{background:#422006;color:#fbbf24;border:1px solid #a16207}
.fu-num.p-low{background:#1e293b;color:#94a3b8;border:1px solid #334155}
.fu-text{font-size:14px;color:#cbd5e1;flex:1}
.fu-priority{display:inline-block;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;margin-left:8px}
.fu-priority.p-high{background:#14532d;color:#4ade80}
.fu-priority.p-medium{background:#422006;color:#fbbf24}
.fu-priority.p-low{background:#1e293b;color:#94a3b8}

/* -- SDR Notes ------------------------------------------------ */
.sdr-box{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:18px 20px;font-size:14px;color:#94a3b8;line-height:1.7}

/* -- Footer --------------------------------------------------- */
.footer{text-align:center;padding:32px 0;font-size:12px;color:#334155;border-top:1px solid #1e293b;margin-top:40px}

/* -- Responsive ----------------------------------------------- */
@media(max-width:640px){
  .hdr-inner{flex-direction:column;align-items:flex-start}
  .hdr-right{text-align:left}
  .gauge-row{flex-direction:column;align-items:flex-start}
  .meta-grid{grid-template-columns:1fr 1fr}
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
  Generated by BoothApp Analysis Pipeline -- Trend Micro -- {generated_at}
</div>
</div>
</body>
</html>"""
