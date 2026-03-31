"""Session recap HTML generator -- creates a scrolling autoplay "video" recap.

Given a completed session directory (local or S3), generates a self-contained
HTML page that presents the session as a story:
  1. Title card with visitor name and company (3s)
  2. Each click shown as a screenshot with annotation overlay (2s each)
  3. Key transcript quotes overlaid at relevant points
  4. Final summary card with products demonstrated and scores
  5. Autoplay mode that cycles through the whole session

Usage:
  python -m analysis.engines.recap_generator /path/to/session

Or as a library:
  from analysis.engines.recap_generator import generate_recap
  html = generate_recap("/path/to/session")
"""

import base64
import json
import logging
import os
import sys
from datetime import datetime

logger = logging.getLogger(__name__)

# Timing constants (milliseconds)
TITLE_DURATION_MS = 3000
CLICK_DURATION_MS = 2000
SUMMARY_DURATION_MS = 5000


def _read_json(session_dir, relative_path):
    """Read a JSON file from the session directory."""
    path = os.path.join(session_dir, relative_path)
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def _load_screenshot_b64(session_dir, screenshot_file):
    """Load a screenshot as base64 data URI. Returns None if not found."""
    if not screenshot_file:
        return None
    path = os.path.join(session_dir, screenshot_file)
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        data = f.read()
    ext = screenshot_file.rsplit(".", 1)[-1].lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}.get(ext, "image/jpeg")
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _timestamp_to_seconds(ts_str):
    """Convert HH:MM:SS or MM:SS timestamp to total seconds."""
    parts = ts_str.replace(",", ".").split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(parts[0])
    except (ValueError, IndexError):
        return 0.0


def _format_duration(seconds):
    """Format seconds as M:SS."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def _pick_quotes_for_click(click_ts_iso, transcript_entries, session_start_iso, window_s=30):
    """Find transcript quotes near a click timestamp (within window_s seconds)."""
    if not transcript_entries or not click_ts_iso:
        return []
    try:
        click_dt = datetime.fromisoformat(click_ts_iso.replace("Z", "+00:00"))
        start_dt = datetime.fromisoformat(session_start_iso.replace("Z", "+00:00"))
        click_offset = (click_dt - start_dt).total_seconds()
    except (ValueError, TypeError):
        return []

    matches = []
    for entry in transcript_entries:
        entry_offset = _timestamp_to_seconds(entry.get("timestamp", "0"))
        if abs(entry_offset - click_offset) <= window_s:
            speaker = entry.get("speaker", "")
            text = entry.get("text", "")
            if speaker == "Visitor" or (speaker == "SE" and len(text) < 80):
                matches.append({"speaker": speaker, "text": text})
    return matches[:2]


def build_slides(session_dir):
    """Build the ordered list of slides from session data.

    Returns:
        list of dicts, each with: type, duration_ms, and type-specific fields.
    """
    metadata = _read_json(session_dir, "metadata.json")
    clicks = _read_json(session_dir, "clicks/clicks.json")
    transcript = _read_json(session_dir, "transcript/transcript.json")
    summary = _read_json(session_dir, "output/summary.json")

    slides = []

    # -- Title card --
    visitor_name = metadata.get("visitor_name", summary.get("visitor_name", "Visitor"))
    se_name = metadata.get("se_name", summary.get("se_name", ""))
    started_at = metadata.get("started_at", "")
    ended_at = metadata.get("ended_at", "")
    duration_s = 0
    if started_at and ended_at:
        try:
            s = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            e = datetime.fromisoformat(ended_at.replace("Z", "+00:00"))
            duration_s = (e - s).total_seconds()
        except ValueError:
            pass

    slides.append({
        "type": "title",
        "duration_ms": TITLE_DURATION_MS,
        "visitor_name": visitor_name,
        "se_name": se_name,
        "session_id": metadata.get("session_id", summary.get("session_id", "")),
        "duration_display": _format_duration(duration_s) if duration_s else "",
        "date": started_at[:10] if started_at else "",
    })

    # -- Click slides --
    click_events = clicks.get("events", [])
    transcript_entries = transcript.get("entries", [])
    session_start_iso = metadata.get("started_at", "")

    for click in click_events:
        screenshot_b64 = _load_screenshot_b64(session_dir, click.get("screenshot_file", ""))
        element = click.get("element", {})
        quotes = _pick_quotes_for_click(
            click.get("timestamp", ""),
            transcript_entries,
            session_start_iso,
        )
        slides.append({
            "type": "click",
            "duration_ms": CLICK_DURATION_MS,
            "index": click.get("index", 0),
            "element_text": element.get("text", ""),
            "page_title": click.get("page_title", ""),
            "screenshot_b64": screenshot_b64,
            "screenshot_file": click.get("screenshot_file", ""),
            "quotes": quotes,
        })

    # -- Summary card --
    products = summary.get("products_demonstrated", [])
    score = summary.get("session_score", 0)
    exec_summary = summary.get("executive_summary", "")
    key_interests = summary.get("key_interests", [])
    follow_up = summary.get("follow_up_actions", [])

    slides.append({
        "type": "summary",
        "duration_ms": SUMMARY_DURATION_MS,
        "visitor_name": visitor_name,
        "products": products,
        "score": score,
        "executive_summary": exec_summary,
        "key_interests": key_interests[:3],
        "follow_up_actions": follow_up[:3],
    })

    return slides


def _escape_html(text):
    """Escape HTML special characters."""
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def render_recap_html(slides):
    """Render slides list into a self-contained HTML string."""
    slides_json = json.dumps(slides, indent=None)

    # Build slide HTML fragments
    slide_fragments = []
    for i, slide in enumerate(slides):
        if slide["type"] == "title":
            slide_fragments.append(f'''
<div class="slide slide-title" data-index="{i}" data-duration="{slide['duration_ms']}">
  <div class="title-content">
    <div class="title-badge">SESSION RECAP</div>
    <h1 class="title-name">{_escape_html(slide['visitor_name'])}</h1>
    <div class="title-meta">
      {('<span>SE: ' + _escape_html(slide['se_name']) + '</span>') if slide.get('se_name') else ''}
      {('<span>' + _escape_html(slide['date']) + '</span>') if slide.get('date') else ''}
      {('<span>' + _escape_html(slide['duration_display']) + '</span>') if slide.get('duration_display') else ''}
    </div>
    <div class="title-session-id">{_escape_html(slide.get('session_id', ''))}</div>
  </div>
</div>''')

        elif slide["type"] == "click":
            screenshot_html = ""
            if slide.get("screenshot_b64"):
                screenshot_html = f'<img class="click-screenshot" src="{slide["screenshot_b64"]}" alt="Screenshot #{slide["index"]}">'
            else:
                screenshot_html = f'''<div class="click-placeholder">
                  <div class="placeholder-icon">&#9634;</div>
                  <div class="placeholder-label">{_escape_html(slide.get('screenshot_file', 'screenshot'))}</div>
                </div>'''

            quotes_html = ""
            for q in slide.get("quotes", []):
                speaker_class = "quote-visitor" if q["speaker"] == "Visitor" else "quote-se"
                quotes_html += f'''<div class="quote {speaker_class}">
                  <span class="quote-speaker">{_escape_html(q['speaker'])}:</span>
                  <span class="quote-text">"{_escape_html(q['text'])}"</span>
                </div>'''

            slide_fragments.append(f'''
<div class="slide slide-click" data-index="{i}" data-duration="{slide['duration_ms']}">
  <div class="click-header">
    <span class="click-number">#{slide['index']}</span>
    <span class="click-element">{_escape_html(slide['element_text'])}</span>
    <span class="click-page">{_escape_html(slide['page_title'])}</span>
  </div>
  <div class="click-body">
    {screenshot_html}
    {('<div class="click-quotes">' + quotes_html + '</div>') if quotes_html else ''}
  </div>
</div>''')

        elif slide["type"] == "summary":
            products_html = "".join(
                f'<span class="product-tag">{_escape_html(p)}</span>' for p in slide.get("products", [])
            )
            interests_html = ""
            for interest in slide.get("key_interests", []):
                conf = interest.get("confidence", "medium")
                interests_html += f'''<div class="interest-item interest-{_escape_html(conf)}">
                  <span class="interest-topic">{_escape_html(interest.get('topic', ''))}</span>
                  <span class="interest-conf">{_escape_html(conf)}</span>
                </div>'''

            actions_html = "".join(
                f'<li>{_escape_html(a)}</li>' for a in slide.get("follow_up_actions", [])
            )

            score = slide.get("score", 0)
            score_class = "score-high" if score >= 7 else "score-mid" if score >= 4 else "score-low"

            slide_fragments.append(f'''
<div class="slide slide-summary" data-index="{i}" data-duration="{slide['duration_ms']}">
  <div class="summary-content">
    <div class="summary-header">
      <div class="summary-badge">SESSION COMPLETE</div>
      <div class="summary-score {score_class}">{score}<span class="score-max">/10</span></div>
    </div>
    <p class="summary-exec">{_escape_html(slide.get('executive_summary', ''))}</p>
    <div class="summary-section">
      <h3>Products Demonstrated</h3>
      <div class="products-list">{products_html}</div>
    </div>
    <div class="summary-section">
      <h3>Key Interests</h3>
      <div class="interests-list">{interests_html}</div>
    </div>
    {('<div class="summary-section"><h3>Follow-Up Actions</h3><ul class="actions-list">' + actions_html + '</ul></div>') if actions_html else ''}
  </div>
</div>''')

    all_slides_html = "\n".join(slide_fragments)

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Session Recap</title>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}

:root {{
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --green: #3fb950;
  --orange: #d29922;
  --red: #f85149;
  --purple: #bc8cff;
  --tm-red: #ef4444;
}}

body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow: hidden;
}}

/* -- Controls bar -- */
.controls {{
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  display: flex; align-items: center; gap: 12px;
  background: rgba(13,17,23,0.95); border-bottom: 1px solid var(--border);
  padding: 10px 20px; backdrop-filter: blur(8px);
}}
.controls button {{
  background: var(--surface); color: var(--text); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 14px; font-size: 0.85rem; cursor: pointer;
}}
.controls button:hover {{ background: var(--border); }}
.controls button.active {{ background: var(--accent); color: #000; border-color: var(--accent); }}
.progress-bar {{
  flex: 1; height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden;
}}
.progress-fill {{
  height: 100%; background: var(--accent); width: 0%; transition: width 0.3s linear;
}}
.slide-counter {{
  color: var(--text-muted); font-size: 0.85rem; min-width: 60px; text-align: right;
}}

/* -- Slide container -- */
.slides-container {{
  position: fixed; top: 52px; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; justify-content: center;
}}
.slide {{
  display: none; width: 100%; height: 100%;
  flex-direction: column; align-items: center; justify-content: center;
  padding: 40px;
  animation: fadeIn 0.4s ease;
}}
.slide.active {{ display: flex; }}

@keyframes fadeIn {{
  from {{ opacity: 0; transform: translateY(12px); }}
  to {{ opacity: 1; transform: translateY(0); }}
}}

/* -- Title slide -- */
.slide-title {{
  background: radial-gradient(ellipse at center, #1a2332 0%, var(--bg) 70%);
}}
.title-content {{ text-align: center; }}
.title-badge {{
  display: inline-block; background: var(--tm-red); color: #fff;
  padding: 4px 16px; border-radius: 20px; font-size: 0.75rem;
  font-weight: 700; letter-spacing: 2px; margin-bottom: 24px;
}}
.title-name {{
  font-size: 3rem; font-weight: 700; margin-bottom: 16px;
  background: linear-gradient(135deg, var(--text), var(--accent));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}}
.title-meta {{
  display: flex; gap: 20px; justify-content: center;
  color: var(--text-muted); font-size: 1rem;
}}
.title-meta span::before {{ content: "\\2022 "; color: var(--border); }}
.title-meta span:first-child::before {{ content: ""; }}
.title-session-id {{
  margin-top: 24px; color: var(--text-muted); font-size: 0.8rem;
  font-family: monospace; opacity: 0.6;
}}

/* -- Click slide -- */
.slide-click {{ padding: 20px 40px; }}
.click-header {{
  display: flex; align-items: center; gap: 12px;
  padding: 12px 0; border-bottom: 1px solid var(--border); width: 100%; max-width: 1100px;
}}
.click-number {{
  background: var(--accent); color: #000; font-weight: 700;
  padding: 2px 10px; border-radius: 12px; font-size: 0.85rem;
}}
.click-element {{ font-weight: 600; font-size: 1.1rem; }}
.click-page {{ color: var(--text-muted); font-size: 0.9rem; margin-left: auto; }}
.click-body {{
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; width: 100%; max-width: 1100px; gap: 16px;
  overflow: hidden;
}}
.click-screenshot {{
  max-width: 100%; max-height: calc(100vh - 200px);
  border: 1px solid var(--border); border-radius: 8px;
  object-fit: contain;
}}
.click-placeholder {{
  width: 100%; max-width: 900px; aspect-ratio: 16/9;
  background: var(--surface); border: 2px dashed var(--border); border-radius: 12px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--text-muted);
}}
.placeholder-icon {{ font-size: 3rem; margin-bottom: 8px; opacity: 0.4; }}
.placeholder-label {{ font-size: 0.85rem; opacity: 0.5; }}

.click-quotes {{
  width: 100%; max-width: 900px;
}}
.quote {{
  padding: 8px 14px; margin: 4px 0; border-radius: 8px;
  font-size: 0.9rem; line-height: 1.4;
  background: rgba(88,166,255,0.08); border-left: 3px solid var(--accent);
}}
.quote-visitor {{
  background: rgba(63,185,80,0.08); border-left-color: var(--green);
}}
.quote-speaker {{ font-weight: 600; margin-right: 6px; }}
.quote-text {{ font-style: italic; color: var(--text-muted); }}

/* -- Summary slide -- */
.slide-summary {{
  background: radial-gradient(ellipse at center, #1a2332 0%, var(--bg) 70%);
  overflow-y: auto;
}}
.summary-content {{
  max-width: 700px; width: 100%;
}}
.summary-header {{
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;
}}
.summary-badge {{
  display: inline-block; background: var(--green); color: #000;
  padding: 4px 16px; border-radius: 20px; font-size: 0.75rem;
  font-weight: 700; letter-spacing: 2px;
}}
.summary-score {{
  font-size: 2.5rem; font-weight: 800;
}}
.score-max {{ font-size: 1rem; color: var(--text-muted); font-weight: 400; }}
.score-high {{ color: var(--green); }}
.score-mid {{ color: var(--orange); }}
.score-low {{ color: var(--red); }}

.summary-exec {{
  color: var(--text-muted); font-size: 1rem; line-height: 1.6;
  margin-bottom: 24px; padding: 16px;
  background: var(--surface); border-radius: 8px; border: 1px solid var(--border);
}}
.summary-section {{ margin-bottom: 20px; }}
.summary-section h3 {{
  font-size: 0.85rem; color: var(--accent); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 8px;
}}
.products-list {{ display: flex; flex-wrap: wrap; gap: 8px; }}
.product-tag {{
  background: var(--surface); border: 1px solid var(--border);
  padding: 4px 12px; border-radius: 16px; font-size: 0.85rem;
}}
.interests-list {{ display: flex; flex-direction: column; gap: 6px; }}
.interest-item {{
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; background: var(--surface); border-radius: 6px;
  border: 1px solid var(--border);
}}
.interest-topic {{ font-weight: 500; }}
.interest-conf {{
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; letter-spacing: 0.5px;
}}
.interest-high .interest-conf {{ background: rgba(63,185,80,0.15); color: var(--green); }}
.interest-medium .interest-conf {{ background: rgba(210,153,34,0.15); color: var(--orange); }}
.interest-low .interest-conf {{ background: rgba(139,148,158,0.15); color: var(--text-muted); }}

.actions-list {{
  list-style: none; padding: 0;
}}
.actions-list li {{
  padding: 6px 0; color: var(--text-muted); font-size: 0.9rem;
  border-bottom: 1px solid rgba(48,54,61,0.5);
}}
.actions-list li::before {{ content: "\\2192 "; color: var(--accent); }}
</style>
</head>
<body>

<div class="controls">
  <button id="btn-prev" title="Previous">&larr;</button>
  <button id="btn-play" class="active" title="Play/Pause">&#9654; Play</button>
  <button id="btn-next" title="Next">&rarr;</button>
  <div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
  <div class="slide-counter" id="counter">1 / {len(slides)}</div>
</div>

<div class="slides-container">
  {all_slides_html}
</div>

<script>
(function() {{
  var slides = document.querySelectorAll('.slide');
  var total = slides.length;
  var current = 0;
  var playing = true;
  var timer = null;

  var btnPlay = document.getElementById('btn-play');
  var btnPrev = document.getElementById('btn-prev');
  var btnNext = document.getElementById('btn-next');
  var progress = document.getElementById('progress');
  var counter = document.getElementById('counter');

  function show(idx) {{
    for (var i = 0; i < total; i++) {{
      slides[i].classList.remove('active');
    }}
    slides[idx].classList.add('active');
    counter.textContent = (idx + 1) + ' / ' + total;
    progress.style.width = (((idx + 1) / total) * 100) + '%';
  }}

  function advance() {{
    current = (current + 1) % total;
    show(current);
    scheduleNext();
  }}

  function scheduleNext() {{
    if (timer) clearTimeout(timer);
    if (!playing) return;
    var duration = parseInt(slides[current].getAttribute('data-duration')) || 2000;
    timer = setTimeout(advance, duration);
  }}

  function togglePlay() {{
    playing = !playing;
    btnPlay.textContent = playing ? '\\u25B6 Play' : '\\u23F8 Pause';
    btnPlay.classList.toggle('active', playing);
    if (playing) scheduleNext();
    else if (timer) clearTimeout(timer);
  }}

  btnPlay.addEventListener('click', togglePlay);
  btnPrev.addEventListener('click', function() {{
    current = (current - 1 + total) % total;
    show(current);
    if (playing) scheduleNext();
  }});
  btnNext.addEventListener('click', function() {{
    current = (current + 1) % total;
    show(current);
    if (playing) scheduleNext();
  }});

  document.addEventListener('keydown', function(e) {{
    if (e.key === 'ArrowLeft') btnPrev.click();
    else if (e.key === 'ArrowRight') btnNext.click();
    else if (e.key === ' ') {{ e.preventDefault(); togglePlay(); }}
  }});

  show(0);
  scheduleNext();
}})();
</script>
</body>
</html>'''


def generate_recap(session_dir, output_path=None):
    """Generate a recap HTML file for a session.

    Args:
        session_dir: Path to the session directory (local filesystem).
        output_path: Where to write the HTML. Defaults to <session_dir>/output/recap.html.

    Returns:
        The HTML string.
    """
    slides = build_slides(session_dir)
    html = render_recap_html(slides)

    if output_path is None:
        output_path = os.path.join(session_dir, "output", "recap.html")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(html)

    logger.info("Recap written to %s (%d slides)", output_path, len(slides))
    return html


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m analysis.engines.recap_generator <session_dir> [output.html]")
        sys.exit(1)
    session_dir = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None
    generate_recap(session_dir, output)
    print(f"Recap generated for {session_dir}")
