"""
Visitor Sentiment Timeline -- Emotional indicator analysis.

Scans transcript segments for emotional signals and classifies each into
one of four sentiment categories: positive, neutral, hesitation, skepticism.
Returns a timeline suitable for rendering as a color-coded bar in the
session report.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Signal keyword lists
# ---------------------------------------------------------------------------
_POSITIVE_SIGNALS = [
    r"\bexcited\b", r"\bimpressed\b", r"\bgreat\b", r"\bexcellent\b",
    r"\bperfect\b", r"\blove\b", r"\bfantastic\b", r"\bawesome\b",
    r"\binterested\b", r"\bwow\b", r"\bamazing\b", r"\bdefinitely\b",
    r"\babsolutely\b", r"\byes\b", r"\bplease\b", r"\bshow me\b",
    r"\btell me more\b", r"\bthat's exactly\b", r"\bsolves\b",
    r"\bsign me up\b", r"\bnice\b", r"\bwell done\b",
]

_HESITATION_SIGNALS = [
    r"\bmaybe\b", r"\bnot sure\b", r"\bperhaps\b", r"\bmight\b",
    r"\bpossibly\b", r"\bi guess\b", r"\blet me think\b",
    r"\bwe'll see\b", r"\bunclear\b", r"\bhmm\b", r"\buh\b",
    r"\bi don't know\b", r"\bneed to check\b", r"\bneed to discuss\b",
    r"\bthat depends\b", r"\bwhat if\b",
]

_SKEPTICISM_SIGNALS = [
    r"\bbut\b", r"\bhowever\b", r"\bdoubt\b", r"\bconcern\b",
    r"\bworried\b", r"\bskeptical\b", r"\breally\?", r"\bhard to believe\b",
    r"\bsounds too good\b", r"\bwhat about\b", r"\bcompetitor\b",
    r"\balternative\b", r"\bcost\b", r"\bexpensive\b", r"\bprice\b",
    r"\bcomplicated\b", r"\bdifficult\b", r"\bchallenge\b",
    r"\bwhy not\b", r"\bwhat's the catch\b",
]


def _count_matches(text: str, patterns: list[str]) -> int:
    """Count how many distinct patterns match in the text."""
    total = 0
    lower = text.lower()
    for pat in patterns:
        if re.search(pat, lower):
            total += 1
    return total


def classify_segment(text: str) -> str:
    """Classify a transcript segment into a sentiment category.

    Returns one of: 'positive', 'neutral', 'hesitation', 'skepticism'.
    """
    pos = _count_matches(text, _POSITIVE_SIGNALS)
    hes = _count_matches(text, _HESITATION_SIGNALS)
    skp = _count_matches(text, _SKEPTICISM_SIGNALS)

    # Skepticism wins ties with hesitation (stronger negative signal)
    if skp > pos and skp >= hes:
        return "skepticism"
    if hes > pos and hes > skp:
        return "hesitation"
    if pos > 0 and pos >= hes and pos >= skp:
        return "positive"
    return "neutral"


def analyze_transcript(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Analyze a list of transcript segments and return sentiment timeline.

    Args:
        segments: List of dicts with at minimum:
            - timestamp (str): Time label, e.g. "14:02"
            - text (str): Transcript text for this segment

    Returns:
        List of dicts, each with:
            - timestamp (str)
            - text (str)
            - sentiment ('positive' | 'neutral' | 'hesitation' | 'skepticism')
    """
    timeline = []
    for seg in segments:
        text = seg.get("text", "")
        sentiment = classify_segment(text)
        timeline.append({
            "timestamp": seg.get("timestamp", ""),
            "text": text,
            "sentiment": sentiment,
        })
    return timeline
