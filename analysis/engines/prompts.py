"""
Visitor Sentiment Analysis Engine

Analyzes visitor emotional state throughout a booth demo interaction:
- Initial engagement level
- Peak interest moments
- Hesitation or skepticism signals
- Overall buying temperature (cold/warm/hot)

Writes structured output to output/sentiment.json.
"""

from __future__ import annotations

import json
import os
from typing import Any


# ---------------------------------------------------------------------------
# Confidence-to-engagement mapping
# ---------------------------------------------------------------------------
_ENGAGEMENT_SCORES = {"high": 3, "medium": 2, "low": 1}

# Skepticism / hesitation signal words in notes
_HESITATION_SIGNALS = [
    "evaluating",
    "comparing",
    "concerned",
    "worried",
    "unsure",
    "hesitant",
    "budget",
    "cost",
    "expensive",
    "complex",
    "difficult",
    "risk",
    "maybe",
    "not sure",
    "internal",
    "briefly",
    "low priority",
]

# High-interest signal words in notes
_INTEREST_SIGNALS = [
    "interested",
    "wants",
    "active",
    "primary",
    "driver",
    "consolidating",
    "asked about",
    "currently",
    "running",
    "recent",
    "incidents",
    "need",
    "urgent",
    "asap",
    "immediately",
]


def _score_text(text: str, signals: list[str]) -> int:
    """Count how many signal phrases appear in text (case-insensitive)."""
    lower = text.lower()
    return sum(1 for s in signals if s in lower)


def _classify_temperature(score: float) -> str:
    """Map a 0-1 normalized score to buying temperature."""
    if score >= 0.65:
        return "hot"
    if score >= 0.35:
        return "warm"
    return "cold"


def analyze_sentiment(data: dict) -> dict[str, Any]:
    """Analyze visitor sentiment from booth interaction data.

    Args:
        data: Same schema as report_template input -- visitor info,
              products_demonstrated, interests, recommendations.

    Returns:
        Sentiment analysis dict with keys:
            - initial_engagement
            - peak_interest_moments
            - hesitation_signals
            - buying_temperature
            - timeline (per-product sentiment)
            - summary
    """
    products = data.get("products_demonstrated", [])
    interests = data.get("interests", [])
    recommendations = data.get("recommendations", [])
    visitor = data.get("visitor", {})

    # --- Initial engagement ---
    # Based on first product interaction and visit duration
    visit_duration = visitor.get("visit_duration", "")
    duration_minutes = 0
    for word in visit_duration.split():
        if word.isdigit():
            duration_minutes = int(word)
            break

    first_product = products[0] if products else {}
    first_note = first_product.get("note", "")
    first_interest_score = _score_text(first_note, _INTEREST_SIGNALS)

    if duration_minutes >= 20 and first_interest_score > 0:
        initial_engagement = "high"
    elif duration_minutes >= 10 or first_interest_score > 0:
        initial_engagement = "medium"
    else:
        initial_engagement = "low"

    # --- Per-product timeline sentiment ---
    timeline = []
    for p in products:
        note = p.get("note", "")
        interest_hits = _score_text(note, _INTEREST_SIGNALS)
        hesitation_hits = _score_text(note, _HESITATION_SIGNALS)
        net = interest_hits - hesitation_hits

        if net > 0:
            sentiment = "positive"
        elif net < 0:
            sentiment = "skeptical"
        else:
            sentiment = "neutral"

        timeline.append({
            "product": p.get("name", ""),
            "timestamp": p.get("timestamp", ""),
            "sentiment": sentiment,
            "interest_signals": interest_hits,
            "hesitation_signals": hesitation_hits,
        })

    # --- Peak interest moments ---
    peak_moments = []
    for entry in timeline:
        if entry["interest_signals"] >= 1 and entry["sentiment"] == "positive":
            peak_moments.append({
                "product": entry["product"],
                "timestamp": entry["timestamp"],
                "signal_strength": entry["interest_signals"],
            })
    peak_moments.sort(key=lambda x: x["signal_strength"], reverse=True)

    # --- Hesitation / skepticism signals ---
    hesitation_details = []
    for entry in timeline:
        if entry["hesitation_signals"] > 0:
            hesitation_details.append({
                "product": entry["product"],
                "timestamp": entry["timestamp"],
                "signal_count": entry["hesitation_signals"],
            })
    for i in interests:
        detail = i.get("detail", "")
        hits = _score_text(detail, _HESITATION_SIGNALS)
        if hits > 0:
            hesitation_details.append({
                "topic": i.get("topic", ""),
                "confidence": i.get("confidence", ""),
                "signal_count": hits,
            })

    # --- Buying temperature ---
    # Weighted score from multiple signals
    high_confidence_count = sum(
        1 for i in interests if i.get("confidence", "").lower() == "high"
    )
    total_interests = max(len(interests), 1)
    high_priority_recs = sum(
        1 for r in recommendations
        if isinstance(r, dict) and r.get("priority", "").lower() == "high"
    )
    total_recs = max(len(recommendations), 1)

    confidence_ratio = high_confidence_count / total_interests
    priority_ratio = high_priority_recs / total_recs
    duration_factor = min(duration_minutes / 30.0, 1.0)
    interest_signals_total = sum(e["interest_signals"] for e in timeline)
    hesitation_total = sum(e["hesitation_signals"] for e in timeline)
    signal_ratio = (
        interest_signals_total / max(interest_signals_total + hesitation_total, 1)
    )

    raw_score = (
        confidence_ratio * 0.30
        + priority_ratio * 0.20
        + duration_factor * 0.20
        + signal_ratio * 0.30
    )
    buying_temp = _classify_temperature(raw_score)

    # --- Summary ---
    summary = (
        f"Visitor showed {initial_engagement} initial engagement. "
        f"{len(peak_moments)} peak interest moment(s) detected. "
        f"{len(hesitation_details)} hesitation signal(s) found. "
        f"Overall buying temperature: {buying_temp.upper()}."
    )

    return {
        "visitor_name": visitor.get("name", "Unknown"),
        "report_id": data.get("report_id", ""),
        "initial_engagement": initial_engagement,
        "peak_interest_moments": peak_moments,
        "hesitation_signals": hesitation_details,
        "buying_temperature": buying_temp,
        "buying_temperature_score": round(raw_score, 3),
        "timeline": timeline,
        "summary": summary,
    }


def analyze_and_write(
    data: dict,
    output_path: str | None = None,
) -> dict[str, Any]:
    """Analyze sentiment and write results to JSON.

    Args:
        data: Visitor interaction data (same schema as report_template).
        output_path: Where to write. Defaults to output/sentiment.json
                     relative to the project root.

    Returns:
        The sentiment analysis dict.
    """
    result = analyze_sentiment(data)

    if output_path is None:
        project_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        output_path = os.path.join(project_root, "output", "sentiment.json")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    return result
