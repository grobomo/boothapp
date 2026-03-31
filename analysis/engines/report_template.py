"""
Booth Visitor Analysis -- HTML Report Generator

Generates presentation-quality HTML reports for trade show booth visitor
interactions with Trend Micro Vision One branding.
"""

from __future__ import annotations

import html
import json
from datetime import datetime
from typing import Any


# ---------------------------------------------------------------------------
# Trend Micro brand palette
# ---------------------------------------------------------------------------
_BRAND = {
    "red": "#D71920",
    "dark": "#1A1A2E",
    "darker": "#12121F",
    "accent": "#E63946",
    "green": "#2D936C",
    "yellow": "#E9C46A",
    "red_badge": "#E63946",
    "light_bg": "#F8F9FA",
    "card_bg": "#FFFFFF",
    "text": "#2D3436",
    "text_muted": "#636E72",
    "border": "#DFE6E9",
}

# Confidence level -> (bg color, text color, label)
_CONFIDENCE_COLORS = {
    "high":   (_BRAND["green"],     "#FFFFFF", "HIGH"),
    "medium": (_BRAND["yellow"],    "#1A1A2E", "MEDIUM"),
    "low":    (_BRAND["red_badge"], "#FFFFFF", "LOW"),
}


def _esc(value: Any) -> str:
    return html.escape(str(value))


# ---- CSS ----------------------------------------------------------------

_CSS = f"""
/* ---------- reset & base ---------- */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

body {{
    font-family: 'Segoe UI', 'Inter', -apple-system, BlinkMacSystemFont,
                 'Helvetica Neue', Arial, sans-serif;
    background: {_BRAND['light_bg']};
    color: {_BRAND['text']};
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}}

/* ---------- header ---------- */
.report-header {{
    background: linear-gradient(135deg, {_BRAND['dark']} 0%, {_BRAND['darker']} 100%);
    color: #FFFFFF;
    padding: 32px 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}}
.report-header .brand {{
    display: flex;
    align-items: center;
    gap: 16px;
}}
.report-header .brand .logo {{
    width: 48px; height: 48px;
    background: {_BRAND['red']};
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 22px; color: #FFF;
}}
.report-header .brand h1 {{
    font-size: 22px; font-weight: 600; letter-spacing: -0.3px;
}}
.report-header .brand h1 span {{
    color: {_BRAND['red']};
}}
.report-header .meta {{
    text-align: right;
    font-size: 13px;
    opacity: 0.85;
}}
.report-header .meta .report-id {{
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    opacity: 0.7;
}}

/* ---------- container ---------- */
.container {{
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px 64px;
}}

/* ---------- section title ---------- */
.section-title {{
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: {_BRAND['text_muted']};
    margin: 32px 0 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid {_BRAND['border']};
}}

/* ---------- card ---------- */
.card {{
    background: {_BRAND['card_bg']};
    border: 1px solid {_BRAND['border']};
    border-radius: 10px;
    padding: 24px;
    margin-bottom: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}}
.card h3 {{
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    color: {_BRAND['dark']};
}}

/* ---------- key-value grid ---------- */
.kv-grid {{
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 8px 16px;
}}
.kv-grid .label {{
    font-size: 13px;
    font-weight: 600;
    color: {_BRAND['text_muted']};
    text-transform: uppercase;
    letter-spacing: 0.5px;
}}
.kv-grid .value {{
    font-size: 15px;
}}

/* ---------- badge ---------- */
.badge {{
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    vertical-align: middle;
}}

/* ---------- interest list ---------- */
.interest-item {{
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid {_BRAND['border']};
}}
.interest-item:last-child {{ border-bottom: none; }}
.interest-item .name {{
    font-weight: 600;
    min-width: 180px;
}}
.interest-item .detail {{
    color: {_BRAND['text_muted']};
    font-size: 14px;
    flex: 1;
}}

/* ---------- timeline ---------- */
.timeline {{
    position: relative;
    padding-left: 32px;
}}
.timeline::before {{
    content: '';
    position: absolute;
    left: 11px;
    top: 4px;
    bottom: 4px;
    width: 2px;
    background: {_BRAND['border']};
}}
.timeline-item {{
    position: relative;
    padding: 12px 0 12px 0;
}}
.timeline-item::before {{
    content: '';
    position: absolute;
    left: -25px;
    top: 18px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: {_BRAND['red']};
    border: 2px solid #FFFFFF;
    box-shadow: 0 0 0 2px {_BRAND['border']};
}}
.timeline-item .time {{
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 12px;
    color: {_BRAND['text_muted']};
}}
.timeline-item .product {{
    font-weight: 600;
    font-size: 15px;
    margin-top: 2px;
}}
.timeline-item .note {{
    font-size: 13px;
    color: {_BRAND['text_muted']};
    margin-top: 2px;
}}

/* ---------- actions checklist ---------- */
.action-item {{
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid {_BRAND['border']};
}}
.action-item:last-child {{ border-bottom: none; }}
.action-item input[type="checkbox"] {{
    margin-top: 4px;
    width: 16px;
    height: 16px;
    accent-color: {_BRAND['red']};
}}
.action-item .action-text {{
    font-size: 15px;
}}
.action-item .action-priority {{
    margin-left: auto;
    flex-shrink: 0;
}}

/* ---------- footer ---------- */
.report-footer {{
    text-align: center;
    padding: 24px;
    font-size: 12px;
    color: {_BRAND['text_muted']};
    border-top: 1px solid {_BRAND['border']};
    margin-top: 40px;
}}

/* ---------- print ---------- */
@media print {{
    body {{ background: #FFF; }}
    .container {{ max-width: 100%; padding: 0 16px; }}
    .report-header {{ padding: 20px 24px; }}
    .card {{ box-shadow: none; break-inside: avoid; }}
    .section-title {{ break-after: avoid; }}
    .action-item input[type="checkbox"] {{
        -webkit-appearance: none;
        appearance: none;
        width: 14px; height: 14px;
        border: 1.5px solid {_BRAND['text']};
        border-radius: 2px;
        display: inline-block;
    }}
    .report-footer {{ position: fixed; bottom: 0; width: 100%; }}
}}
"""


# ---- HTML helpers -------------------------------------------------------

def _badge(level: str) -> str:
    """Render a confidence badge."""
    key = level.lower().strip()
    bg, fg, label = _CONFIDENCE_COLORS.get(key, ("#B2BEC3", "#2D3436", key.upper()))
    return (
        f'<span class="badge" style="background:{bg};color:{fg};">'
        f'{_esc(label)}</span>'
    )


def _kv_row(label: str, value: str) -> str:
    return (
        f'<div class="label">{_esc(label)}</div>'
        f'<div class="value">{_esc(value)}</div>'
    )


# ---- Section renderers --------------------------------------------------

def _render_header(data: dict) -> str:
    visitor = data.get("visitor", {})
    name = visitor.get("name", "Visitor")
    report_id = data.get("report_id", "")
    generated = data.get("generated_at", datetime.now().strftime("%Y-%m-%d %H:%M"))
    return f"""
    <div class="report-header">
        <div class="brand">
            <div class="logo">V1</div>
            <div>
                <h1>Trend Micro <span>Vision One</span></h1>
                <div style="font-size:14px;opacity:0.8;">Booth Visitor Analysis Report</div>
            </div>
        </div>
        <div class="meta">
            <div style="font-size:16px;font-weight:600;">{_esc(name)}</div>
            <div>{_esc(generated)}</div>
            <div class="report-id">{_esc(report_id)}</div>
        </div>
    </div>
    """


def _render_visitor_info(data: dict) -> str:
    v = data.get("visitor", {})
    if not v:
        return ""
    rows = []
    field_map = [
        ("Name", "name"),
        ("Title", "title"),
        ("Company", "company"),
        ("Email", "email"),
        ("Industry", "industry"),
        ("Company Size", "company_size"),
        ("Visit Duration", "visit_duration"),
    ]
    for label, key in field_map:
        val = v.get(key)
        if val:
            rows.append(_kv_row(label, val))
    if not rows:
        return ""
    return f"""
    <div class="section-title">Visitor Information</div>
    <div class="card">
        <div class="kv-grid">
            {"".join(rows)}
        </div>
    </div>
    """


def _render_products(data: dict) -> str:
    products = data.get("products_demonstrated", [])
    if not products:
        return ""
    items = []
    for p in products:
        name = _esc(p.get("name", ""))
        time = _esc(p.get("timestamp", ""))
        note = _esc(p.get("note", ""))
        note_html = f'<div class="note">{note}</div>' if note else ""
        items.append(f"""
            <div class="timeline-item">
                <div class="time">{time}</div>
                <div class="product">{name}</div>
                {note_html}
            </div>
        """)
    return f"""
    <div class="section-title">Products Demonstrated</div>
    <div class="card">
        <div class="timeline">
            {"".join(items)}
        </div>
    </div>
    """


def _render_interests(data: dict) -> str:
    interests = data.get("interests", [])
    if not interests:
        return ""
    items = []
    for i in interests:
        name = _esc(i.get("topic", ""))
        confidence = i.get("confidence", "medium")
        detail = _esc(i.get("detail", ""))
        items.append(f"""
            <div class="interest-item">
                <span class="name">{name}</span>
                {_badge(confidence)}
                <span class="detail">{detail}</span>
            </div>
        """)
    return f"""
    <div class="section-title">Visitor Interests</div>
    <div class="card">
        {"".join(items)}
    </div>
    """


def _render_recommendations(data: dict) -> str:
    recs = data.get("recommendations", [])
    if not recs:
        return ""
    items = []
    for r in recs:
        if isinstance(r, str):
            text, priority = r, "medium"
        else:
            text = r.get("action", "")
            priority = r.get("priority", "medium")
        items.append(f"""
            <div class="action-item">
                <input type="checkbox" />
                <span class="action-text">{_esc(text)}</span>
                <span class="action-priority">{_badge(priority)}</span>
            </div>
        """)
    return f"""
    <div class="section-title">Recommended Follow-Up Actions</div>
    <div class="card">
        {"".join(items)}
    </div>
    """


# ---- Public API ---------------------------------------------------------

def generate_report(data: dict) -> str:
    """Generate a complete HTML report from visitor analysis data.

    Args:
        data: Dictionary with keys:
            - report_id (str): Unique report identifier
            - generated_at (str): Timestamp string
            - visitor (dict): name, title, company, email, industry,
              company_size, visit_duration
            - products_demonstrated (list[dict]): each with name, timestamp, note
            - interests (list[dict]): each with topic, confidence (high/medium/low),
              detail
            - recommendations (list[dict|str]): each with action, priority
              (high/medium/low) -- or plain strings

    Returns:
        Complete HTML document as a string.
    """
    sections = [
        _render_header(data),
        '<div class="container">',
        _render_visitor_info(data),
        _render_products(data),
        _render_interests(data),
        _render_recommendations(data),
        f"""
        <div class="report-footer">
            Trend Micro Vision One &mdash; Booth Visitor Analysis &mdash;
            Generated {_esc(data.get("generated_at", ""))}
        </div>
        """,
        '</div>',
    ]

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Visitor Report &mdash; {_esc(data.get("visitor", {}).get("name", ""))}</title>
    <style>{_CSS}</style>
</head>
<body>
{"".join(sections)}
</body>
</html>"""


def generate_report_from_json(json_path: str) -> str:
    """Load JSON file and generate report HTML."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return generate_report(data)
