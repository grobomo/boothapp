"""
Analysis Quality Scoring System

Scores AI-generated booth visitor analyses on four dimensions:
  1. Products identified (target: 3+)
  2. Follow-up actions (target: 3+)
  3. Presence of visitor quotes
  4. Specificity of recommendations

If the total score falls below a configurable threshold, the analysis
is retried with a more detailed prompt.  Final scores are written to
output/quality.json.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

# ---------------------------------------------------------------------------
# Scoring constants
# ---------------------------------------------------------------------------

PRODUCT_TARGET = 3
ACTION_TARGET = 3
PASS_THRESHOLD = 7  # out of 10

# Dimension weights (must sum to 10)
W_PRODUCTS = 3
W_ACTIONS = 3
W_QUOTES = 2
W_SPECIFICITY = 2

MAX_RETRIES = 1  # how many times to retry a below-threshold analysis

# Words that indicate vague / generic recommendations
_VAGUE_PHRASES = re.compile(
    r"\b(follow[- ]?up|reach out|touch base|circle back|check in|"
    r"send info|share info|keep in touch|stay connected)\b",
    re.IGNORECASE,
)

# Words that indicate specific / actionable recommendations
_SPECIFIC_PHRASES = re.compile(
    r"\b(schedule|demo|POC|proof[- ]of[- ]concept|pricing|proposal|"
    r"datasheet|whitepaper|case study|ROI|benchmark|technical[- ]deep[- ]dive|"
    r"architecture review|deployment plan|trial|pilot)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Individual dimension scorers  (each returns 0.0 .. 1.0)
# ---------------------------------------------------------------------------

def score_products(analysis: dict) -> float:
    """Score based on number of products identified."""
    products = analysis.get("products_demonstrated", [])
    count = len(products)
    if count >= PRODUCT_TARGET:
        return 1.0
    return count / PRODUCT_TARGET


def score_actions(analysis: dict) -> float:
    """Score based on number of follow-up actions."""
    actions = analysis.get("recommendations", [])
    count = len(actions)
    if count >= ACTION_TARGET:
        return 1.0
    return count / ACTION_TARGET


def score_quotes(analysis: dict) -> float:
    """Score based on presence of visitor quotes in the analysis.

    Looks for quoted text in interests detail, product notes, and a
    dedicated ``visitor_quotes`` field.
    """
    quote_count = 0

    # Dedicated quotes field
    quotes_field = analysis.get("visitor_quotes", [])
    quote_count += len(quotes_field)

    # Scan notes / details for quoted strings (text inside quotation marks)
    _quote_pattern = re.compile(r'["\u201c\u201d].{4,}?["\u201c\u201d]')

    for product in analysis.get("products_demonstrated", []):
        note = product.get("note", "")
        if _quote_pattern.search(note):
            quote_count += 1

    for interest in analysis.get("interests", []):
        detail = interest.get("detail", "")
        if _quote_pattern.search(detail):
            quote_count += 1

    if quote_count >= 3:
        return 1.0
    if quote_count >= 1:
        return 0.5
    return 0.0


def score_specificity(analysis: dict) -> float:
    """Score based on how specific / actionable recommendations are.

    Penalizes vague language; rewards concrete next-step language.
    """
    recs = analysis.get("recommendations", [])
    if not recs:
        return 0.0

    specific_count = 0
    vague_count = 0

    for rec in recs:
        text = rec.get("action", "") if isinstance(rec, dict) else str(rec)
        if _SPECIFIC_PHRASES.search(text):
            specific_count += 1
        if _VAGUE_PHRASES.search(text):
            vague_count += 1

    total = len(recs)
    # Ratio of specific recs minus vague penalty
    ratio = (specific_count - 0.5 * vague_count) / total
    return max(0.0, min(1.0, ratio))


# ---------------------------------------------------------------------------
# Composite scorer
# ---------------------------------------------------------------------------

def compute_quality_score(analysis: dict) -> dict:
    """Compute a composite quality score for a visitor analysis.

    Returns a dict with per-dimension scores, the weighted total (0-10),
    and a pass/fail flag.
    """
    products = score_products(analysis)
    actions = score_actions(analysis)
    quotes = score_quotes(analysis)
    specificity = score_specificity(analysis)

    total = (
        products * W_PRODUCTS
        + actions * W_ACTIONS
        + quotes * W_QUOTES
        + specificity * W_SPECIFICITY
    )

    return {
        "dimensions": {
            "products_identified": {
                "score": round(products, 2),
                "weight": W_PRODUCTS,
                "weighted": round(products * W_PRODUCTS, 2),
                "count": len(analysis.get("products_demonstrated", [])),
                "target": PRODUCT_TARGET,
            },
            "follow_up_actions": {
                "score": round(actions, 2),
                "weight": W_ACTIONS,
                "weighted": round(actions * W_ACTIONS, 2),
                "count": len(analysis.get("recommendations", [])),
                "target": ACTION_TARGET,
            },
            "visitor_quotes": {
                "score": round(quotes, 2),
                "weight": W_QUOTES,
                "weighted": round(quotes * W_QUOTES, 2),
            },
            "recommendation_specificity": {
                "score": round(specificity, 2),
                "weight": W_SPECIFICITY,
                "weighted": round(specificity * W_SPECIFICITY, 2),
            },
        },
        "total_score": round(total, 2),
        "max_score": W_PRODUCTS + W_ACTIONS + W_QUOTES + W_SPECIFICITY,
        "threshold": PASS_THRESHOLD,
        "passed": total >= PASS_THRESHOLD,
    }


# ---------------------------------------------------------------------------
# Enhanced prompt for retry
# ---------------------------------------------------------------------------

ENHANCED_PROMPT_SUFFIX = """

IMPORTANT -- The previous analysis scored below quality threshold.
Please provide a MORE DETAILED analysis that includes:
- At least 3 specific products discussed (with timestamps and context)
- At least 3 concrete follow-up actions (with owner, deadline, deliverable)
- Direct quotes from the visitor where possible (use quotation marks)
- Specific, actionable recommendations (e.g. "Schedule a POC for Cloud
  Security by April 15" instead of "follow up on cloud security")
"""


# ---------------------------------------------------------------------------
# Analyze-with-retry orchestrator
# ---------------------------------------------------------------------------

def analyze_with_quality_gate(
    session_data: dict,
    analyze_fn: Callable[[dict, str | None], dict],
    output_dir: str = "output",
    threshold: int | None = None,
    prompt_suffix: str | None = None,
) -> dict:
    """Run analysis, score it, and retry once if below threshold.

    Args:
        session_data:  Raw session data (transcript, clicks, badge, etc.)
        analyze_fn:    Callable(session_data, extra_prompt) -> analysis dict.
                       The analysis dict must follow the report_template schema
                       (products_demonstrated, recommendations, interests, etc.)
        output_dir:    Directory to write quality.json into.
        threshold:     Override the default pass threshold.
        prompt_suffix: Override the default enhanced-prompt suffix for retry.

    Returns:
        The final analysis dict (may be from the retry attempt).
    """
    effective_threshold = threshold if threshold is not None else PASS_THRESHOLD
    retry_suffix = prompt_suffix or ENHANCED_PROMPT_SUFFIX

    # -- First attempt --
    analysis = analyze_fn(session_data, None)
    quality = compute_quality_score(analysis)
    quality["attempt"] = 1

    # -- Retry if below threshold --
    if not quality["passed"] or quality["total_score"] < effective_threshold:
        retry_analysis = analyze_fn(session_data, retry_suffix)
        retry_quality = compute_quality_score(retry_analysis)
        retry_quality["attempt"] = 2
        retry_quality["previous_score"] = quality["total_score"]

        # Keep whichever attempt scored higher
        if retry_quality["total_score"] >= quality["total_score"]:
            analysis = retry_analysis
            quality = retry_quality
        else:
            quality["retry_attempted"] = True
            quality["retry_score"] = retry_quality["total_score"]

    # -- Write quality.json --
    os.makedirs(output_dir, exist_ok=True)
    quality_path = os.path.join(output_dir, "quality.json")
    with open(quality_path, "w", encoding="utf-8") as f:
        json.dump(quality, f, indent=2)

    return analysis
