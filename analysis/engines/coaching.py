"""
SE Coaching Engine

Analyzes booth demo session data and generates coaching feedback for the SE.
Evaluates transcript segments, products demonstrated, and visitor signals to
identify strengths and areas for improvement.

Output sections:
  - questions_answered_well: effective SE responses
  - questions_to_improve: responses that could be stronger
  - missed_product_areas: products relevant to visitor but not demoed
  - missed_buying_signals: buying intent the SE didn't act on
"""

from __future__ import annotations

import json
import re
from typing import Any


# ---------------------------------------------------------------------------
# Product catalog -- what's available to demo
# ---------------------------------------------------------------------------
PRODUCT_CATALOG = {
    "Vision One XDR": {
        "triggers": ["xdr", "soc", "siem", "detection", "response", "incident",
                      "threat", "alert", "correlation", "unified"],
        "category": "platform",
    },
    "Endpoint Security": {
        "triggers": ["endpoint", "edr", "epp", "workstation", "laptop",
                      "desktop", "agent", "antivirus", "malware"],
        "category": "endpoint",
    },
    "Cloud Security": {
        "triggers": ["cloud", "container", "kubernetes", "k8s", "eks", "aks",
                      "gke", "docker", "serverless", "lambda", "workload",
                      "cspm", "cwpp", "runtime"],
        "category": "cloud",
    },
    "Zero Trust Secure Access": {
        "triggers": ["zero trust", "ztna", "ztsa", "remote", "vpn", "access",
                      "workforce", "hybrid work", "sase"],
        "category": "network",
    },
    "Email Security": {
        "triggers": ["email", "phishing", "bec", "spam", "mail",
                      "business email", "impersonation", "attachment"],
        "category": "email",
    },
    "Network Security": {
        "triggers": ["network", "ids", "ips", "firewall", "tippingpoint",
                      "lateral movement", "ndr", "traffic"],
        "category": "network",
    },
    "Managed XDR": {
        "triggers": ["mdr", "managed", "outsource", "soc as a service",
                      "staffing", "shortage", "24/7", "monitoring"],
        "category": "service",
    },
    "Attack Surface Management": {
        "triggers": ["attack surface", "asm", "exposure", "risk score",
                      "vulnerability", "asset", "shadow it", "internet facing"],
        "category": "platform",
    },
}

# ---------------------------------------------------------------------------
# Buying signal patterns
# ---------------------------------------------------------------------------
BUYING_SIGNALS = [
    {
        "pattern": r"\b(budget|funding|approved|allocated|fiscal)\b",
        "signal": "Budget discussion",
        "description": "Visitor mentioned budget or funding -- indicates active buying cycle",
    },
    {
        "pattern": r"\b(timeline|when|deadline|by q[1-4]|end of year|this quarter)\b",
        "signal": "Timeline pressure",
        "description": "Visitor expressed urgency or a decision timeline",
    },
    {
        "pattern": r"\b(comparing|competitive|versus|vs|alternative|other vendor|also looking)\b",
        "signal": "Competitive evaluation",
        "description": "Visitor is comparing vendors -- opportunity to differentiate",
    },
    {
        "pattern": r"\b(proof of concept|poc|pilot|trial|test|evaluate)\b",
        "signal": "POC readiness",
        "description": "Visitor wants to test the product -- strong purchase intent",
    },
    {
        "pattern": r"\b(pricing|cost|license|per seat|per user|how much|quote)\b",
        "signal": "Pricing inquiry",
        "description": "Visitor asked about pricing -- late-stage buying signal",
    },
    {
        "pattern": r"\b(decision maker|ciso|board|executive|approve|sign off)\b",
        "signal": "Decision-maker involvement",
        "description": "Visitor referenced authority or decision chain",
    },
    {
        "pattern": r"\b(pain point|struggling|incident|breach|compromised|attacked)\b",
        "signal": "Active pain",
        "description": "Visitor described a current security problem -- urgency driver",
    },
    {
        "pattern": r"\b(integrate|integration|api|connect|compatible|work with)\b",
        "signal": "Integration requirements",
        "description": "Visitor asked about integration -- they're envisioning deployment",
    },
    {
        "pattern": r"\b(roi|return on investment|value|save time|reduce|consolidat)\b",
        "signal": "ROI focus",
        "description": "Visitor is building a business case",
    },
    {
        "pattern": r"\b(compliance|regulatory|audit|gdpr|hipaa|pci|sox|nist)\b",
        "signal": "Compliance driver",
        "description": "Visitor has compliance requirements driving the purchase",
    },
]

# ---------------------------------------------------------------------------
# Question quality patterns
# ---------------------------------------------------------------------------
GOOD_ANSWER_INDICATORS = [
    r"\b(great question|let me show you|here's how|for example|specifically)\b",
    r"\b(in your case|given your|based on what you said|for .+ like yours)\b",
    r"\b(let me demonstrate|watch this|you can see here)\b",
    r"\b(customers like .+ have|similar to|real-world example)\b",
    r"\b(the key difference|what sets us apart|unique advantage)\b",
]

WEAK_ANSWER_INDICATORS = [
    r"\b(i'm not sure|i don't know|i'll have to check|get back to you)\b",
    r"\b(i think so|probably|maybe|might be)\b",
    r"\b(that's a good question|let me find out|i'll ask)\b",
    r"\b(it depends|it varies|hard to say)\b",
    r"\b(i believe|i assume|not certain)\b",
]


def _normalize(text: str) -> str:
    """Lowercase and collapse whitespace."""
    return re.sub(r"\s+", " ", text.lower().strip())


def _extract_transcript_text(data: dict) -> str:
    """Pull combined transcript text from session data.

    Supports multiple formats:
      - data["transcript"] as a plain string
      - data["transcript"] as a list of segment dicts with "text" keys
      - data["transcript_segments"] as a list of segment dicts
    """
    transcript = data.get("transcript")
    if isinstance(transcript, str) and transcript:
        return transcript
    if isinstance(transcript, list):
        return " ".join(seg.get("text", "") for seg in transcript if isinstance(seg, dict))
    segments = data.get("transcript_segments", [])
    if isinstance(segments, list) and segments:
        return " ".join(seg.get("text", "") for seg in segments if isinstance(seg, dict))
    if isinstance(transcript, str):
        return transcript
    return ""


def _extract_questions_and_answers(transcript_text: str) -> list[dict]:
    """Identify question-answer pairs from transcript text.

    Looks for lines ending with '?' as questions, and the following
    non-question text as the answer.
    """
    if not transcript_text:
        return []

    sentences = re.split(r"(?<=[.!?])\s+", transcript_text)
    pairs = []
    i = 0
    while i < len(sentences):
        s = sentences[i].strip()
        if s.endswith("?"):
            answer_parts = []
            j = i + 1
            # Cap at 3 sentences to avoid mixing in other speakers' content
            max_answer_sentences = 3
            while (j < len(sentences)
                   and not sentences[j].strip().endswith("?")
                   and len(answer_parts) < max_answer_sentences):
                answer_parts.append(sentences[j].strip())
                j += 1
            answer = " ".join(answer_parts)
            pairs.append({"question": s, "answer": answer})
            i = j
        else:
            i += 1
    return pairs


def _score_answer(answer: str) -> tuple[str, list[str]]:
    """Score an answer as 'strong', 'weak', or 'neutral'.

    Returns (rating, list of matched indicator descriptions).
    """
    lower = _normalize(answer)
    good_matches = []
    for pattern in GOOD_ANSWER_INDICATORS:
        if re.search(pattern, lower):
            good_matches.append(pattern)

    weak_matches = []
    for pattern in WEAK_ANSWER_INDICATORS:
        if re.search(pattern, lower):
            weak_matches.append(pattern)

    if good_matches and not weak_matches:
        return "strong", good_matches
    if weak_matches and not good_matches:
        return "weak", weak_matches
    if good_matches and weak_matches:
        return "weak" if len(weak_matches) >= len(good_matches) else "strong", weak_matches or good_matches
    return "neutral", []


def _find_demonstrated_products(data: dict) -> set[str]:
    """Get the set of product names that were demonstrated."""
    products = data.get("products_demonstrated", [])
    return {p.get("name", "") for p in products if isinstance(p, dict)}


def _find_missed_product_areas(data: dict) -> list[dict]:
    """Identify products that match visitor interests but weren't demoed."""
    demonstrated = _find_demonstrated_products(data)
    demonstrated_lower = {_normalize(p) for p in demonstrated}

    # Combine all text sources to find topic mentions
    text_sources = []
    text_sources.append(_extract_transcript_text(data))
    for interest in data.get("interests", []):
        if isinstance(interest, dict):
            text_sources.append(interest.get("topic", ""))
            text_sources.append(interest.get("detail", ""))
    combined_text = _normalize(" ".join(text_sources))

    missed = []
    for product_name, info in PRODUCT_CATALOG.items():
        # Skip if already demonstrated
        if _normalize(product_name) in demonstrated_lower:
            continue
        # Check if any demo'd product is a substring match
        already_shown = False
        for demo_name in demonstrated_lower:
            if _normalize(product_name) in demo_name or demo_name in _normalize(product_name):
                already_shown = True
                break
        if already_shown:
            continue

        # Check if triggers appear in the session text
        matching_triggers = []
        for trigger in info["triggers"]:
            if trigger in combined_text:
                matching_triggers.append(trigger)

        if matching_triggers:
            missed.append({
                "product": product_name,
                "category": info["category"],
                "evidence": matching_triggers,
                "suggestion": f"Visitor interest in {', '.join(matching_triggers[:3])} "
                              f"suggests {product_name} would have been relevant to show.",
            })

    # Sort by number of matching triggers (most relevant first)
    missed.sort(key=lambda x: len(x["evidence"]), reverse=True)
    return missed


def _find_missed_buying_signals(data: dict) -> list[dict]:
    """Identify buying signals in the transcript the SE didn't address."""
    transcript_text = _normalize(_extract_transcript_text(data))
    if not transcript_text:
        return []

    # Collect what the SE followed up on (from recommendations)
    recommendations_text = _normalize(" ".join(
        r.get("action", "") if isinstance(r, dict) else str(r)
        for r in data.get("recommendations", [])
    ))

    missed = []
    for signal_def in BUYING_SIGNALS:
        matches = re.findall(signal_def["pattern"], transcript_text)
        if matches:
            # Check if recommendations already address this signal
            signal_lower = _normalize(signal_def["signal"])
            addressed = False
            for keyword in signal_def["pattern"].strip(r"\b()").split("|"):
                keyword = keyword.strip()
                if keyword and keyword in recommendations_text:
                    addressed = True
                    break

            if not addressed:
                missed.append({
                    "signal": signal_def["signal"],
                    "description": signal_def["description"],
                    "evidence": list(set(matches))[:5],
                    "recommendation": f"Follow up on the {signal_def['signal'].lower()} "
                                      f"signal detected in the conversation.",
                })

    return missed


def _analyze_questions(data: dict) -> tuple[list[dict], list[dict]]:
    """Analyze Q&A pairs and split into well-answered and needs-improvement."""
    transcript_text = _extract_transcript_text(data)
    pairs = _extract_questions_and_answers(transcript_text)

    well_answered = []
    needs_improvement = []

    for pair in pairs:
        rating, indicators = _score_answer(pair["answer"])
        entry = {
            "question": pair["question"],
            "answer_excerpt": pair["answer"][:200] + ("..." if len(pair["answer"]) > 200 else ""),
        }
        if rating == "strong":
            entry["strength"] = "Demonstrated product knowledge with specific examples"
            well_answered.append(entry)
        elif rating == "weak":
            entry["suggestion"] = (
                "Consider preparing a more concrete answer with product-specific "
                "examples or a live demonstration."
            )
            needs_improvement.append(entry)
        # neutral answers are omitted -- no coaching value

    return well_answered, needs_improvement


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_coaching(data: dict) -> dict:
    """Generate SE coaching analysis from session data.

    Args:
        data: Session data dictionary. Expected keys:
            - transcript (str or list[dict]): conversation transcript
            - transcript_segments (list[dict]): alternative transcript format
            - products_demonstrated (list[dict]): products shown during demo
            - interests (list[dict]): detected visitor interests
            - recommendations (list[dict|str]): follow-up recommendations
            - visitor (dict): visitor metadata

    Returns:
        Dictionary with coaching analysis:
            - questions_answered_well (list[dict])
            - questions_to_improve (list[dict])
            - missed_product_areas (list[dict])
            - missed_buying_signals (list[dict])
            - summary (dict): counts and overall assessment
    """
    well_answered, to_improve = _analyze_questions(data)
    missed_products = _find_missed_product_areas(data)
    missed_signals = _find_missed_buying_signals(data)

    # Overall assessment
    total_questions = len(well_answered) + len(to_improve)
    if total_questions > 0:
        strong_ratio = len(well_answered) / total_questions
    else:
        strong_ratio = 0.0

    if strong_ratio >= 0.7:
        overall = "strong"
    elif strong_ratio >= 0.4:
        overall = "adequate"
    else:
        overall = "needs_improvement"

    return {
        "questions_answered_well": well_answered,
        "questions_to_improve": to_improve,
        "missed_product_areas": missed_products,
        "missed_buying_signals": missed_signals,
        "summary": {
            "total_questions_analyzed": total_questions,
            "strong_answers": len(well_answered),
            "weak_answers": len(to_improve),
            "missed_product_count": len(missed_products),
            "missed_signal_count": len(missed_signals),
            "overall_rating": overall,
        },
    }


def generate_coaching_json(data: dict) -> str:
    """Generate coaching analysis and return as formatted JSON string."""
    result = generate_coaching(data)
    return json.dumps(result, indent=2, ensure_ascii=False)
