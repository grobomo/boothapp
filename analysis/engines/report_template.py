"""
HTML analysis report generator for BoothApp.

Produces a self-contained HTML file from correlator output with:
- Professional header (Trend Micro + BoothApp branding)
- Visitor info card
- Products Demonstrated with icons and time-spent bars
- Key Moments (transcript highlights)
- Engagement score (SVG circular progress)
- Recommended Follow-Up Actions (cards)
- Full transcript accordion (collapsed by default)
- Footer with session metadata

Dark gradient theme.  Inline CSS, zero external dependencies.
"""

import html
import json
import math
import sys
from datetime import datetime, timezone

# ---- Product metadata (mirrors JS correlator PRODUCT_TOPICS keys) ---------

PRODUCT_META = {
    "XDR": {
        "icon": "&#x1F50D;",  # mag glass (rendered as text, not emoji)
        "color": "#6C63FF",
        "action": "Schedule a live XDR platform walkthrough",
    },
    "Endpoint Security": {
        "icon": "&#x1F6E1;",
        "color": "#00BFA6",
        "action": "Start a 30-day endpoint protection trial",
    },
    "ZTSA": {
        "icon": "&#x1F512;",
        "color": "#FF6584",
        "action": "Book a Zero Trust architecture session",
    },
    "Cloud Security": {
        "icon": "&#x2601;",
        "color": "#4FC3F7",
        "action": "Request a cloud security posture assessment",
    },
    "Email Security": {
        "icon": "&#x2709;",
        "color": "#FFB74D",
        "action": "Try email threat protection free for 30 days",
    },
}

ENGAGEMENT_LABELS = {"high": "High", "medium": "Medium", "low": "Low"}
ENGAGEMENT_COLORS = {"high": "#00BFA6", "medium": "#FFB74D", "low": "#FF6584"}

# ---- SVG helpers -----------------------------------------------------------


def _svg_circular_progress(score_pct, color, size=120):
    """Return an SVG string for a circular progress gauge."""
    r = (size - 12) / 2
    cx = cy = size / 2
    circumference = 2 * math.pi * r
    offset = circumference * (1 - score_pct / 100)
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" '
        f'stroke="#2a2a3e" stroke-width="10"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" '
        f'stroke="{color}" stroke-width="10" stroke-linecap="round" '
        f'stroke-dasharray="{circumference:.1f}" '
        f'stroke-dashoffset="{offset:.1f}" '
        f'transform="rotate(-90 {cx} {cy})"/>'
        f'<text x="{cx}" y="{cy}" text-anchor="middle" '
        f'dominant-baseline="central" fill="#fff" '
        f'font-size="28" font-weight="700">{score_pct}%</text>'
        f"</svg>"
    )


# ---- HTML building blocks --------------------------------------------------


def _esc(text):
    """HTML-escape a string, handling None."""
    if text is None:
        return ""
    return html.escape(str(text))


def _css():
    """Return the full inline stylesheet."""
    return """
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #1a1a2e, #16213e);
      color: #e0e0e0;
      min-height: 100vh;
      padding: 0;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 32px 24px; }

    /* Header */
    .header {
      background: linear-gradient(90deg, #d32f2f, #b71c1c);
      padding: 28px 32px;
      border-radius: 12px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-brand { display: flex; align-items: center; gap: 16px; }
    .header-brand .logo-text {
      font-size: 28px; font-weight: 800; color: #fff; letter-spacing: -0.5px;
    }
    .header-brand .sub {
      font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 2px;
    }
    .header-badge {
      background: rgba(255,255,255,0.15); border-radius: 8px;
      padding: 8px 16px; color: #fff; font-size: 13px;
    }

    /* Cards */
    .card {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .card h2 {
      font-size: 18px; font-weight: 700; color: #fff;
      margin-bottom: 16px; padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }

    /* Visitor info */
    .visitor-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    }
    .visitor-field label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 1px;
      color: #888; display: block; margin-bottom: 4px;
    }
    .visitor-field span { font-size: 15px; color: #fff; }

    /* Product bars */
    .product-row {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 14px;
    }
    .product-icon {
      width: 36px; height: 36px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    .product-name { width: 140px; font-size: 14px; color: #ccc; flex-shrink: 0; }
    .bar-track {
      flex: 1; height: 10px; background: rgba(255,255,255,0.06);
      border-radius: 5px; overflow: hidden;
    }
    .bar-fill { height: 100%; border-radius: 5px; transition: width 0.4s; }
    .bar-label { font-size: 12px; color: #888; width: 48px; text-align: right; flex-shrink: 0; }

    /* Engagement gauge */
    .engagement-wrap {
      display: flex; align-items: center; gap: 32px;
    }
    .engagement-detail { flex: 1; }
    .engagement-detail .tier { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .engagement-detail .breakdown { font-size: 13px; color: #999; line-height: 1.8; }

    /* Key moments */
    .moment {
      border-left: 3px solid #6C63FF;
      padding: 12px 16px;
      margin-bottom: 14px;
      background: rgba(108,99,255,0.06);
      border-radius: 0 8px 8px 0;
    }
    .moment .time { font-size: 11px; color: #888; margin-bottom: 4px; }
    .moment .text { font-size: 14px; color: #ddd; line-height: 1.6; }

    /* Action cards */
    .actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .action-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 16px;
    }
    .action-card .action-topic {
      font-size: 13px; font-weight: 600; margin-bottom: 6px;
    }
    .action-card .action-text { font-size: 13px; color: #aaa; }

    /* Accordion */
    .accordion summary {
      cursor: pointer; font-size: 15px; font-weight: 600; color: #ccc;
      padding: 14px 0; list-style: none;
    }
    .accordion summary::-webkit-details-marker { display: none; }
    .accordion summary::before {
      content: '+ '; color: #6C63FF; font-weight: 700;
    }
    .accordion[open] summary::before { content: '- '; }
    .transcript-body {
      font-size: 13px; line-height: 1.8; color: #aaa;
      white-space: pre-wrap; padding: 16px;
      background: rgba(0,0,0,0.2); border-radius: 8px;
      max-height: 500px; overflow-y: auto;
    }

    /* Footer */
    .footer {
      text-align: center; padding: 24px 0; margin-top: 16px;
      border-top: 1px solid rgba(255,255,255,0.06);
      font-size: 12px; color: #555;
    }
    .footer .meta { margin-bottom: 4px; }
    """


# ---- Section builders ------------------------------------------------------


def _header_html(session_id, generated_at):
    """Render the branded header bar."""
    ts = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return (
        '<div class="header">'
        '  <div class="header-brand">'
        '    <div>'
        '      <div class="logo-text">Trend Micro &middot; BoothApp</div>'
        f'      <div class="sub">Visitor Analysis Report</div>'
        "    </div>"
        "  </div>"
        f'  <div class="header-badge">Session {_esc(session_id or "N/A")}</div>'
        "</div>"
    )


def _visitor_card(visitor):
    """Render the visitor info card."""
    v = visitor or {}
    fields = [
        ("Name", v.get("name", "Anonymous")),
        ("Company", v.get("company", "N/A")),
        ("Email", v.get("email", "N/A")),
        ("Role", v.get("role", "N/A")),
    ]
    rows = "".join(
        f'<div class="visitor-field"><label>{_esc(lbl)}</label>'
        f"<span>{_esc(val)}</span></div>"
        for lbl, val in fields
    )
    return (
        '<div class="card">'
        "  <h2>Visitor</h2>"
        f'  <div class="visitor-grid">{rows}</div>'
        "</div>"
    )


def _products_section(segments):
    """Render Products Demonstrated with time bars."""
    topic_time = {}
    for seg in segments:
        duration = (seg.get("end", 0) - seg.get("start", 0)) / 1000  # seconds
        for t in seg.get("topics", []):
            topic_time[t] = topic_time.get(t, 0) + duration

    if not topic_time:
        return (
            '<div class="card"><h2>Products Demonstrated</h2>'
            '<p style="color:#888">No product topics detected.</p></div>'
        )

    max_time = max(topic_time.values()) or 1
    rows = []
    for topic, secs in sorted(topic_time.items(), key=lambda x: -x[1]):
        meta = PRODUCT_META.get(topic, {"icon": "&#x2022;", "color": "#888"})
        pct = min(secs / max_time * 100, 100)
        mins = int(secs // 60)
        remaining = int(secs % 60)
        label = f"{mins}m {remaining}s" if mins else f"{remaining}s"
        rows.append(
            f'<div class="product-row">'
            f'  <div class="product-icon" style="background:{meta["color"]}20">{meta["icon"]}</div>'
            f'  <div class="product-name">{_esc(topic)}</div>'
            f'  <div class="bar-track"><div class="bar-fill" style="width:{pct:.0f}%;background:{meta["color"]}"></div></div>'
            f'  <div class="bar-label">{label}</div>'
            f"</div>"
        )
    return (
        '<div class="card"><h2>Products Demonstrated</h2>'
        + "".join(rows)
        + "</div>"
    )


def _engagement_section(summary):
    """Render the engagement score gauge and breakdown."""
    avg = summary.get("avgEngagement", "low")
    counts = summary.get("scoreCounts", {})
    total = sum(counts.values()) or 1
    high_n = counts.get("high", 0)
    med_n = counts.get("medium", 0)
    low_n = counts.get("low", 0)

    # Score percentage: high=100, medium=50, low=10
    score_map = {"high": 90, "medium": 55, "low": 20}
    pct = score_map.get(avg, 20)
    color = ENGAGEMENT_COLORS.get(avg, "#888")

    svg = _svg_circular_progress(pct, color)

    return (
        '<div class="card"><h2>Engagement Score</h2>'
        '<div class="engagement-wrap">'
        f"  {svg}"
        '  <div class="engagement-detail">'
        f'    <div class="tier" style="color:{color}">{ENGAGEMENT_LABELS.get(avg, avg)}</div>'
        '    <div class="breakdown">'
        f"      High segments: {high_n}/{total}<br>"
        f"      Medium segments: {med_n}/{total}<br>"
        f"      Low segments: {low_n}/{total}"
        "    </div>"
        "  </div>"
        "</div></div>"
    )


def _key_moments(segments, max_moments=5):
    """Render notable transcript passages."""
    moments = []
    for seg in segments:
        if seg.get("engagement_score") == "high" and seg.get("transcript_text"):
            text = seg["transcript_text"]
            if len(text) > 250:
                text = text[:247] + "..."
            start_sec = seg.get("start", 0) / 1000
            mins = int(start_sec // 60)
            secs = int(start_sec % 60)
            moments.append((f"{mins}:{secs:02d}", text))
        if len(moments) >= max_moments:
            break

    if not moments:
        return (
            '<div class="card"><h2>Key Moments</h2>'
            '<p style="color:#888">No high-engagement moments captured.</p></div>'
        )

    items = "".join(
        f'<div class="moment">'
        f'  <div class="time">{_esc(t)}</div>'
        f'  <div class="text">{_esc(txt)}</div>'
        f"</div>"
        for t, txt in moments
    )
    return f'<div class="card"><h2>Key Moments</h2>{items}</div>'


def _followup_actions(topics):
    """Render recommended follow-up action cards."""
    if not topics:
        return (
            '<div class="card"><h2>Recommended Follow-Up Actions</h2>'
            '<p style="color:#888">No specific actions -- general follow-up recommended.</p></div>'
        )

    cards = []
    for topic in topics:
        meta = PRODUCT_META.get(topic)
        if not meta:
            continue
        cards.append(
            f'<div class="action-card">'
            f'  <div class="action-topic" style="color:{meta["color"]}">{_esc(topic)}</div>'
            f'  <div class="action-text">{_esc(meta["action"])}</div>'
            f"</div>"
        )

    if not cards:
        return ""

    return (
        '<div class="card"><h2>Recommended Follow-Up Actions</h2>'
        f'<div class="actions-grid">{"".join(cards)}</div>'
        "</div>"
    )


def _transcript_accordion(segments):
    """Render the full transcript in a collapsed accordion."""
    lines = []
    for seg in segments:
        if seg.get("transcript_text"):
            start_sec = seg.get("start", 0) / 1000
            mins = int(start_sec // 60)
            secs = int(start_sec % 60)
            lines.append(f"[{mins}:{secs:02d}] {seg['transcript_text']}")
    if not lines:
        return ""
    body = "\n\n".join(lines)
    return (
        '<div class="card">'
        '<details class="accordion">'
        "  <summary>Full Transcript</summary>"
        f'  <div class="transcript-body">{_esc(body)}</div>'
        "</details></div>"
    )


def _footer(session_id, generated_at, segment_count):
    """Render session metadata footer."""
    ts = generated_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return (
        '<div class="footer">'
        f'  <div class="meta">Session: {_esc(session_id or "N/A")} | '
        f"Segments: {segment_count} | Generated: {_esc(ts)}</div>"
        "  <div>Trend Micro BoothApp &mdash; Visitor Analysis Engine</div>"
        "</div>"
    )


# ---- Public API -------------------------------------------------------------


def render_report(correlator_output, visitor=None, session_id=None,
                  generated_at=None):
    """
    Generate a self-contained HTML report string.

    Args:
        correlator_output: dict with ``segments`` list and ``summary`` dict
                           (output of correlator.correlate()).
        visitor:           optional dict with name, company, email, role.
        session_id:        optional session identifier string.
        generated_at:      optional timestamp string for the footer.

    Returns:
        A complete HTML document string (self-contained, inline CSS).
    """
    data = correlator_output or {}
    segments = data.get("segments", [])
    summary = data.get("summary", {})
    topics = summary.get("topics", [])

    parts = [
        "<!DOCTYPE html>",
        '<html lang="en">',
        "<head>",
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        "  <title>BoothApp Visitor Report</title>",
        f"  <style>{_css()}</style>",
        "</head>",
        "<body>",
        '<div class="container">',
        _header_html(session_id, generated_at),
        _visitor_card(visitor),
        _engagement_section(summary),
        _products_section(segments),
        _key_moments(segments),
        _followup_actions(topics),
        _transcript_accordion(segments),
        _footer(session_id, generated_at, len(segments)),
        "</div>",
        "</body>",
        "</html>",
    ]
    return "\n".join(parts)


def main():
    """CLI: reads JSON correlator output from stdin, writes HTML to stdout."""
    raw = sys.stdin.read()
    if not raw.strip():
        print("Error: empty input", file=sys.stderr)
        sys.exit(1)

    payload = json.loads(raw)
    correlator_output = payload.get("correlator_output", payload)
    visitor = payload.get("visitor")
    session_id = payload.get("session_id")

    print(render_report(correlator_output, visitor=visitor,
                        session_id=session_id))


if __name__ == "__main__":
    main()
