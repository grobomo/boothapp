"""
Booth Visitor Analysis -- Presentation Slide Generator

Generates a dark-themed HTML slide deck from completed session analysis data.
Each slide is a full-screen section navigable with arrow keys. Designed for
internal follow-up meetings after trade show booth demos.
"""

from __future__ import annotations

import html
import os
from typing import Any


# ---------------------------------------------------------------------------
# Trend Micro brand palette (dark theme)
# ---------------------------------------------------------------------------
_BRAND = {
    "red": "#D71920",
    "dark": "#1A1A2E",
    "darker": "#12121F",
    "darkest": "#0A0A15",
    "accent": "#E63946",
    "green": "#2D936C",
    "yellow": "#E9C46A",
    "blue": "#4A90D9",
    "text": "#E8E8E8",
    "text_muted": "#8A8A9A",
    "card_bg": "#1E1E30",
    "border": "#2A2A3E",
    "bar_bg": "#2A2A3E",
}


def _esc(value: Any) -> str:
    """HTML-escape any value."""
    return html.escape(str(value))


# ---------------------------------------------------------------------------
# CSS
# ---------------------------------------------------------------------------

_SLIDE_CSS = f"""
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html, body {{
    height: 100%; overflow: hidden;
    font-family: 'Segoe UI', 'Inter', -apple-system, BlinkMacSystemFont,
                 'Helvetica Neue', Arial, sans-serif;
    background: {_BRAND['darkest']};
    color: {_BRAND['text']};
}}
.slide {{
    width: 100vw; height: 100vh;
    display: none; flex-direction: column;
    justify-content: center; align-items: center;
    padding: 60px 80px;
    position: absolute; top: 0; left: 0;
}}
.slide.active {{ display: flex; }}
.slide-counter {{
    position: fixed; bottom: 24px; right: 32px;
    font-size: 14px; color: {_BRAND['text_muted']};
    z-index: 100;
}}
.nav-hint {{
    position: fixed; bottom: 24px; left: 32px;
    font-size: 12px; color: {_BRAND['text_muted']};
    z-index: 100;
}}
.logo-badge {{
    display: inline-block;
    width: 36px; height: 36px;
    background: {_BRAND['red']};
    border-radius: 6px;
    font-weight: 700; font-size: 16px; color: #FFF;
    line-height: 36px; text-align: center;
    margin-right: 12px; vertical-align: middle;
}}
.brand-line {{
    font-size: 14px; color: {_BRAND['text_muted']};
    margin-bottom: 24px;
}}

/* -- Title slide -- */
.slide-title h1 {{
    font-size: 48px; font-weight: 700;
    line-height: 1.2; text-align: center;
    margin-bottom: 12px;
}}
.slide-title h1 .highlight {{ color: {_BRAND['red']}; }}
.slide-title .subtitle {{
    font-size: 22px; color: {_BRAND['text_muted']};
    text-align: center;
}}
.slide-title .meta {{
    font-size: 14px; color: {_BRAND['text_muted']};
    margin-top: 32px; text-align: center;
}}

/* -- Products slide -- */
.products-grid {{
    width: 100%; max-width: 900px;
}}
.product-row {{
    display: flex; align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid {_BRAND['border']};
}}
.product-row:last-child {{ border-bottom: none; }}
.product-name {{
    flex: 0 0 260px;
    font-weight: 600; font-size: 18px;
}}
.product-bar-wrap {{
    flex: 1; height: 28px;
    background: {_BRAND['bar_bg']};
    border-radius: 4px; overflow: hidden;
    margin: 0 16px;
}}
.product-bar {{
    height: 100%;
    background: linear-gradient(90deg, {_BRAND['red']}, {_BRAND['accent']});
    border-radius: 4px;
    transition: width 0.6s ease;
}}
.product-time {{
    flex: 0 0 60px;
    text-align: right; font-size: 14px;
    color: {_BRAND['text_muted']};
}}

/* -- Discussion slide -- */
.discussion-list {{
    list-style: none; max-width: 800px; width: 100%;
}}
.discussion-list li {{
    padding: 14px 20px;
    border-left: 3px solid {_BRAND['red']};
    margin-bottom: 12px;
    background: {_BRAND['card_bg']};
    border-radius: 0 6px 6px 0;
    font-size: 18px; line-height: 1.5;
}}
.discussion-list li .topic-label {{
    font-weight: 700; color: {_BRAND['red']};
    font-size: 13px; text-transform: uppercase;
    letter-spacing: 0.5px; display: block;
    margin-bottom: 4px;
}}

/* -- Competitors slide -- */
.competitor-cards {{
    display: flex; flex-wrap: wrap; gap: 20px;
    justify-content: center; max-width: 900px;
}}
.competitor-card {{
    background: {_BRAND['card_bg']};
    border: 1px solid {_BRAND['border']};
    border-radius: 8px; padding: 24px;
    min-width: 260px; flex: 1; max-width: 400px;
}}
.competitor-card .comp-name {{
    font-weight: 700; font-size: 20px;
    color: {_BRAND['yellow']}; margin-bottom: 8px;
}}
.competitor-card .comp-context {{
    font-size: 15px; color: {_BRAND['text_muted']};
    margin-bottom: 12px;
}}
.competitor-card .comp-position {{
    font-size: 15px; color: {_BRAND['text']};
    border-top: 1px solid {_BRAND['border']};
    padding-top: 12px;
}}
.no-data {{
    font-size: 20px; color: {_BRAND['text_muted']};
    text-align: center; font-style: italic;
}}

/* -- Next steps slide -- */
.steps-list {{
    list-style: none; max-width: 800px; width: 100%;
    counter-reset: step-counter;
}}
.steps-list li {{
    display: flex; align-items: flex-start;
    padding: 16px 0;
    border-bottom: 1px solid {_BRAND['border']};
    font-size: 18px;
}}
.steps-list li:last-child {{ border-bottom: none; }}
.step-num {{
    flex: 0 0 40px;
    font-weight: 700; font-size: 22px;
    color: {_BRAND['red']};
}}
.step-body {{ flex: 1; }}
.step-action {{ font-weight: 600; }}
.step-owner {{
    font-size: 14px; color: {_BRAND['text_muted']};
    margin-top: 4px;
}}
.priority-badge {{
    display: inline-block;
    font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.5px;
    padding: 2px 8px; border-radius: 3px;
    margin-left: 8px; vertical-align: middle;
}}
.priority-high {{ background: {_BRAND['red']}; color: #FFF; }}
.priority-medium {{ background: {_BRAND['yellow']}; color: #000; }}
.priority-low {{ background: {_BRAND['border']}; color: {_BRAND['text_muted']}; }}

/* -- Score slide -- */
.scorecard {{
    display: flex; flex-wrap: wrap; gap: 24px;
    justify-content: center; max-width: 900px;
}}
.score-metric {{
    background: {_BRAND['card_bg']};
    border: 1px solid {_BRAND['border']};
    border-radius: 12px; padding: 28px;
    text-align: center; min-width: 200px; flex: 1;
}}
.score-metric .metric-value {{
    font-size: 48px; font-weight: 700;
}}
.score-metric .metric-label {{
    font-size: 14px; color: {_BRAND['text_muted']};
    text-transform: uppercase; letter-spacing: 1px;
    margin-top: 8px;
}}
.score-overall {{
    width: 100%; max-width: 400px;
    text-align: center; margin-bottom: 32px;
}}
.score-ring {{
    width: 180px; height: 180px;
    margin: 0 auto 16px;
}}
.score-ring circle {{
    fill: none; stroke-width: 12;
    stroke-linecap: round;
}}
.score-ring .ring-bg {{ stroke: {_BRAND['bar_bg']}; }}
.score-ring .ring-fg {{ transition: stroke-dashoffset 0.8s ease; }}
.score-label {{
    font-size: 56px; font-weight: 700;
    fill: {_BRAND['text']};
}}
.score-sublabel {{
    font-size: 14px;
    fill: {_BRAND['text_muted']};
}}

/* Section titles */
.section-title {{
    font-size: 32px; font-weight: 700;
    margin-bottom: 32px; text-align: center;
}}
.section-title .dot {{ color: {_BRAND['red']}; }}
"""


# ---------------------------------------------------------------------------
# JavaScript for arrow-key navigation
# ---------------------------------------------------------------------------

_SLIDE_JS = """
(function() {
    var slides = document.querySelectorAll('.slide');
    var counter = document.querySelector('.slide-counter');
    var current = 0;
    var total = slides.length;

    function show(idx) {
        if (idx < 0 || idx >= total) return;
        slides[current].classList.remove('active');
        current = idx;
        slides[current].classList.add('active');
        counter.textContent = (current + 1) + ' / ' + total;
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            show(current + 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            show(current - 1);
        }
    });

    show(0);
})();
"""


# ---------------------------------------------------------------------------
# Slide renderers
# ---------------------------------------------------------------------------

def _render_title_slide(data: dict) -> str:
    visitor = data.get("visitor", {})
    name = _esc(visitor.get("name", "Visitor"))
    company = _esc(visitor.get("company", ""))
    title = _esc(visitor.get("title", ""))
    duration = _esc(visitor.get("visit_duration", ""))
    industry = _esc(visitor.get("industry", ""))
    generated = _esc(data.get("generated_at", ""))

    subtitle_parts = []
    if title:
        subtitle_parts.append(title)
    if industry:
        subtitle_parts.append(industry)
    subtitle = " | ".join(subtitle_parts)

    meta_parts = []
    if duration:
        meta_parts.append(f"Duration: {duration}")
    if generated:
        meta_parts.append(f"Generated: {generated}")
    meta = " &middot; ".join(meta_parts)

    return f"""<div class="slide slide-title active" data-slide="0">
    <div class="brand-line"><span class="logo-badge">V1</span>Trend Micro Vision One</div>
    <h1>Demo Summary<span class="highlight">.</span></h1>
    <h1><span class="highlight">{name}</span> &mdash; {company}</h1>
    <div class="subtitle">{subtitle}</div>
    <div class="meta">{meta}</div>
</div>"""


def _render_products_slide(data: dict) -> str:
    products = data.get("products_demonstrated", [])
    if not products:
        return f"""<div class="slide" data-slide="1">
    <div class="section-title">Products Demonstrated<span class="dot">.</span></div>
    <div class="no-data">No products recorded</div>
</div>"""

    # Calculate time-spent percentages from duration_seconds or use equal bars
    max_seconds = 0
    for p in products:
        secs = p.get("duration_seconds", 0)
        if secs > max_seconds:
            max_seconds = secs

    rows = []
    for p in products:
        name = _esc(p.get("name", ""))
        secs = p.get("duration_seconds", 0)
        if max_seconds > 0:
            pct = int((secs / max_seconds) * 100)
            time_label = f"{secs // 60}m" if secs >= 60 else f"{secs}s"
        else:
            # No duration data -- distribute evenly
            pct = 70
            time_label = _esc(p.get("timestamp", ""))

        rows.append(f"""    <div class="product-row">
        <div class="product-name">{name}</div>
        <div class="product-bar-wrap"><div class="product-bar" style="width:{pct}%"></div></div>
        <div class="product-time">{time_label}</div>
    </div>""")

    return f"""<div class="slide" data-slide="1">
    <div class="section-title">Products Demonstrated<span class="dot">.</span></div>
    <div class="products-grid">
{chr(10).join(rows)}
    </div>
</div>"""


def _render_discussion_slide(data: dict) -> str:
    interests = data.get("interests", [])
    highlights = data.get("transcript_highlights", [])

    items = []
    for interest in interests:
        topic = _esc(interest.get("topic", ""))
        detail = _esc(interest.get("detail", ""))
        confidence = _esc(interest.get("confidence", ""))
        items.append(f"""    <li>
        <span class="topic-label">{topic} ({confidence})</span>
        {detail}
    </li>""")

    for highlight in highlights:
        if isinstance(highlight, str):
            items.append(f"    <li>{_esc(highlight)}</li>")
        elif isinstance(highlight, dict):
            text = _esc(highlight.get("text", highlight.get("quote", "")))
            speaker = _esc(highlight.get("speaker", ""))
            label = f'<span class="topic-label">{speaker}</span>' if speaker else ""
            items.append(f"    <li>{label}{text}</li>")

    if not items:
        return f"""<div class="slide" data-slide="2">
    <div class="section-title">Key Discussion Points<span class="dot">.</span></div>
    <div class="no-data">No discussion points recorded</div>
</div>"""

    return f"""<div class="slide" data-slide="2">
    <div class="section-title">Key Discussion Points<span class="dot">.</span></div>
    <ul class="discussion-list">
{chr(10).join(items)}
    </ul>
</div>"""


def _render_competitors_slide(data: dict) -> str:
    competitors = data.get("competitors", [])

    if not competitors:
        return f"""<div class="slide" data-slide="3">
    <div class="section-title">Competitive Landscape<span class="dot">.</span></div>
    <div class="no-data">No competitor mentions detected</div>
</div>"""

    cards = []
    for comp in competitors:
        name = _esc(comp.get("name", "Unknown"))
        context = _esc(comp.get("context", ""))
        positioning = _esc(comp.get("positioning", comp.get("response", "")))

        context_html = f'<div class="comp-context">{context}</div>' if context else ""
        position_html = (
            f'<div class="comp-position">{positioning}</div>' if positioning else ""
        )

        cards.append(f"""    <div class="competitor-card">
        <div class="comp-name">{name}</div>
        {context_html}
        {position_html}
    </div>""")

    return f"""<div class="slide" data-slide="3">
    <div class="section-title">Competitive Landscape<span class="dot">.</span></div>
    <div class="competitor-cards">
{chr(10).join(cards)}
    </div>
</div>"""


def _render_next_steps_slide(data: dict) -> str:
    recommendations = data.get("recommendations", [])

    if not recommendations:
        return f"""<div class="slide" data-slide="4">
    <div class="section-title">Recommended Next Steps<span class="dot">.</span></div>
    <div class="no-data">No action items recorded</div>
</div>"""

    items = []
    for i, rec in enumerate(recommendations, 1):
        if isinstance(rec, str):
            action = _esc(rec)
            priority = "medium"
            owner = ""
        else:
            action = _esc(rec.get("action", ""))
            priority = rec.get("priority", "medium").lower()
            owner = _esc(rec.get("owner", ""))

        badge_cls = f"priority-{priority}" if priority in ("high", "medium", "low") else "priority-medium"
        badge = f'<span class="priority-badge {badge_cls}">{_esc(priority)}</span>'
        owner_html = f'<div class="step-owner">Owner: {owner}</div>' if owner else ""

        items.append(f"""    <li>
        <div class="step-num">{i}</div>
        <div class="step-body">
            <span class="step-action">{action}</span>{badge}
            {owner_html}
        </div>
    </li>""")

    return f"""<div class="slide" data-slide="4">
    <div class="section-title">Recommended Next Steps<span class="dot">.</span></div>
    <ul class="steps-list">
{chr(10).join(items)}
    </ul>
</div>"""


def _score_color(score: int) -> str:
    """Return color for a 0-100 score."""
    if score >= 80:
        return _BRAND["green"]
    if score >= 60:
        return _BRAND["yellow"]
    if score >= 40:
        return _BRAND["blue"]
    return _BRAND["accent"]


def _render_score_slide(data: dict) -> str:
    score_data = data.get("engagement_score", {})

    # Support both flat score and structured score object
    if isinstance(score_data, (int, float)):
        overall = int(score_data)
        metrics = {}
    else:
        overall = int(score_data.get("overall", score_data.get("score", 0)))
        metrics = {k: v for k, v in score_data.items() if k not in ("overall", "score")}

    color = _score_color(overall)

    # SVG ring gauge
    radius = 72
    circumference = 2 * 3.14159 * radius
    offset = circumference - (overall / 100) * circumference

    ring_svg = f"""<svg class="score-ring" viewBox="0 0 180 180">
        <circle class="ring-bg" cx="90" cy="90" r="{radius}"/>
        <circle class="ring-fg" cx="90" cy="90" r="{radius}"
            stroke="{color}"
            stroke-dasharray="{circumference:.1f}"
            stroke-dashoffset="{offset:.1f}"
            transform="rotate(-90 90 90)"/>
        <text class="score-label" x="90" y="90" text-anchor="middle" dominant-baseline="central">{overall}</text>
        <text class="score-sublabel" x="90" y="118" text-anchor="middle">/ 100</text>
    </svg>"""

    # Metric cards
    metric_cards = []
    for label, value in metrics.items():
        display_label = _esc(label.replace("_", " ").title())
        if isinstance(value, (int, float)):
            display_value = str(int(value))
            val_color = _score_color(int(value))
        else:
            display_value = _esc(str(value))
            val_color = _BRAND["text"]
        metric_cards.append(f"""    <div class="score-metric">
        <div class="metric-value" style="color:{val_color}">{display_value}</div>
        <div class="metric-label">{display_label}</div>
    </div>""")

    metrics_html = f"""<div class="scorecard">
{chr(10).join(metric_cards)}
    </div>""" if metric_cards else ""

    return f"""<div class="slide" data-slide="5">
    <div class="section-title">Engagement Score<span class="dot">.</span></div>
    <div class="score-overall">
        {ring_svg}
    </div>
    {metrics_html}
</div>"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_slides_html(data: dict) -> str:
    """Generate a complete HTML slide deck from session analysis data.

    Args:
        data: Analysis dictionary with keys: visitor, products_demonstrated,
              interests, transcript_highlights, competitors, recommendations,
              engagement_score.

    Returns:
        Complete HTML document as a string with 6 navigable slides.
    """
    slides = [
        _render_title_slide(data),
        _render_products_slide(data),
        _render_discussion_slide(data),
        _render_competitors_slide(data),
        _render_next_steps_slide(data),
        _render_score_slide(data),
    ]

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Demo Summary Slides</title>
    <style>{_SLIDE_CSS}</style>
</head>
<body>
{chr(10).join(slides)}
<div class="slide-counter">1 / {len(slides)}</div>
<div class="nav-hint">Arrow keys to navigate</div>
<script>{_SLIDE_JS}</script>
</body>
</html>"""


def generate_slides(
    data: dict,
    output_dir: str = "output",
) -> str:
    """Generate slide deck and write to file.

    Args:
        data: Analysis dictionary.
        output_dir: Directory to write output. Created if missing.

    Returns:
        Path to the written slides.html file.
    """
    os.makedirs(output_dir, exist_ok=True)

    html_content = generate_slides_html(data)
    output_path = os.path.join(output_dir, "slides.html")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    return output_path
