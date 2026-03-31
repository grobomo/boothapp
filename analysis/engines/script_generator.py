"""
Demo Script Generator

Takes completed session analysis data (summary + timeline) and generates
a narrated demo script that an SE can follow to recreate a similar demo.
Includes timing marks, talking points aligned with visitor interests,
and discovery questions to ask.
"""

from __future__ import annotations

import json
import os
from typing import Any


# ---------------------------------------------------------------------------
# Product knowledge base -- talking points and questions per topic
# ---------------------------------------------------------------------------

_PRODUCT_PLAYBOOK: dict[str, dict[str, Any]] = {
    "Vision One XDR": {
        "keywords": ["xdr", "soc", "siem", "correlation", "detection", "response"],
        "talking_points": [
            "Unified visibility across endpoints, email, network, and cloud",
            "Native sensor integration reduces alert fatigue by 70%",
            "Automated root cause analysis with attack chain visualization",
            "Bi-directional SIEM integration (Splunk, Sentinel, QRadar)",
        ],
        "questions": [
            "How many security tools are you correlating alerts across today?",
            "What's your mean time to investigate an alert right now?",
            "Are you looking to consolidate point products or augment existing SIEM?",
        ],
    },
    "Cloud Security": {
        "keywords": ["cloud", "container", "kubernetes", "k8s", "eks", "aks", "gke",
                      "runtime", "workload", "serverless", "ecr"],
        "talking_points": [
            "Runtime protection for containers and Kubernetes workloads",
            "Image scanning integrated into CI/CD pipeline",
            "Cloud Security Posture Management (CSPM) for misconfig detection",
            "Supports EKS, AKS, GKE, and self-managed clusters",
        ],
        "questions": [
            "Which cloud providers and orchestration platforms are you running?",
            "Do you have visibility into what's running inside your containers today?",
            "How are you handling image scanning in your build pipeline?",
        ],
    },
    "Zero Trust Secure Access": {
        "keywords": ["ztna", "zero trust", "ztsa", "remote", "vpn", "access",
                      "workforce"],
        "talking_points": [
            "Replace legacy VPN with identity-aware, app-level access",
            "Continuous risk assessment -- not just authenticate-and-forget",
            "Integrates with Vision One risk scores for adaptive policies",
            "Browser-based access for unmanaged devices",
        ],
        "questions": [
            "What percentage of your workforce is remote or hybrid?",
            "Are you currently using a VPN, and what pain points do you see?",
            "How do you handle access from unmanaged/contractor devices?",
        ],
    },
    "Email Security": {
        "keywords": ["email", "bec", "phishing", "spam", "o365", "exchange",
                      "collaboration"],
        "talking_points": [
            "AI-powered BEC detection analyzing writing style and intent",
            "Sandboxing for URL and attachment detonation",
            "Protection for Microsoft 365, Google Workspace, and on-prem Exchange",
            "Integrated with XDR for cross-layer correlation of phishing campaigns",
        ],
        "questions": [
            "How many BEC or phishing incidents did you handle last quarter?",
            "Are you using Microsoft Defender for Office 365 or a third-party?",
            "Do you have visibility when a phishing link is clicked on a mobile device?",
        ],
    },
    "Endpoint Security": {
        "keywords": ["endpoint", "edr", "epp", "agent", "ransomware", "malware"],
        "talking_points": [
            "Single lightweight agent for EPP + EDR",
            "Virtual patching protects unpatched systems immediately",
            "Behavioral analysis catches fileless and living-off-the-land attacks",
            "Rollback capability for ransomware recovery",
        ],
        "questions": [
            "How quickly can you patch critical vulnerabilities across your fleet?",
            "Have you experienced any ransomware incidents in the past year?",
            "Are you managing both Windows and Linux endpoints?",
        ],
    },
    "Managed Detection & Response": {
        "keywords": ["mdr", "managed", "soc", "outsource", "staffing"],
        "talking_points": [
            "24/7 monitoring and response by Trend Micro threat experts",
            "Augments internal SOC -- not a rip-and-replace",
            "Proactive threat hunting using global threat intelligence",
            "Co-managed model with full visibility into analyst actions",
        ],
        "questions": [
            "Do you have 24/7 SOC coverage today, or business-hours only?",
            "How many analysts are on your security team?",
            "Are you looking to fully outsource detection or augment your team?",
        ],
    },
}

# Fallback for products not in the playbook
_DEFAULT_PLAYBOOK = {
    "talking_points": [
        "Integrated into the Vision One platform for unified visibility",
        "Reduces operational complexity with a single console",
    ],
    "questions": [
        "What's your biggest security challenge right now?",
        "Which capabilities are you evaluating across vendors?",
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _match_playbook(product_name: str) -> dict[str, Any]:
    """Find the best matching playbook entry for a product name."""
    name_lower = product_name.lower()
    for key, playbook in _PRODUCT_PLAYBOOK.items():
        if key.lower() in name_lower:
            return playbook
        for kw in playbook.get("keywords", []):
            if kw in name_lower:
                return playbook
    return _DEFAULT_PLAYBOOK


def _parse_time_minutes(ts: str) -> int:
    """Parse HH:MM timestamp and return total minutes from midnight."""
    try:
        parts = ts.strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return 0


def _format_elapsed(start_min: int, current_min: int) -> str:
    """Format elapsed time as [MM:SS]."""
    diff = max(0, current_min - start_min)
    return f"[{diff:02d}:00]"


def _interest_summary(interests: list[dict]) -> str:
    """Build a quick summary of what the visitor cares about."""
    high = [i["topic"] for i in interests if i.get("confidence") == "high"]
    medium = [i["topic"] for i in interests if i.get("confidence") == "medium"]
    parts = []
    if high:
        parts.append(f"Primary interests: {', '.join(high)}")
    if medium:
        parts.append(f"Secondary interests: {', '.join(medium)}")
    return ". ".join(parts) if parts else "No specific interests identified"


def _divider(char: str = "-", width: int = 72) -> str:
    return char * width


# ---------------------------------------------------------------------------
# Core generator
# ---------------------------------------------------------------------------

def generate_script(summary: dict, timeline: list[dict] | None = None) -> str:
    """Generate a demo script from session analysis data.

    Args:
        summary: Session summary dict with keys: visitor, interests,
                 products_demonstrated, recommendations, visit_duration, etc.
                 Compatible with the sample_data.json / result.json format.
        timeline: Optional timeline events list. Each entry has:
                  timestamp, product/topic, note. If None, falls back to
                  products_demonstrated from summary.

    Returns:
        Plain-text demo script string.
    """
    visitor = summary.get("visitor", {})
    interests = summary.get("interests", [])
    products = timeline or summary.get("products_demonstrated", [])
    recommendations = summary.get("recommendations", [])
    visit_duration = visitor.get("visit_duration", "")

    lines: list[str] = []

    # === HEADER ===
    lines.append(_divider("="))
    lines.append("  DEMO SCRIPT -- Trend Micro Vision One")
    lines.append(_divider("="))
    lines.append("")

    # === VISITOR CONTEXT ===
    lines.append("VISITOR PROFILE")
    lines.append(_divider())
    if visitor.get("name"):
        lines.append(f"  Name:     {visitor['name']}")
    if visitor.get("title"):
        lines.append(f"  Title:    {visitor['title']}")
    if visitor.get("company"):
        lines.append(f"  Company:  {visitor['company']}")
    if visitor.get("industry"):
        lines.append(f"  Industry: {visitor['industry']}")
    if visitor.get("company_size"):
        lines.append(f"  Size:     {visitor['company_size']}")
    if visit_duration:
        lines.append(f"  Duration: {visit_duration}")
    lines.append("")

    # === INTEREST SUMMARY ===
    lines.append("VISITOR INTERESTS")
    lines.append(_divider())
    for interest in interests:
        topic = interest.get("topic", "")
        confidence = interest.get("confidence", "").upper()
        detail = interest.get("detail", "")
        marker = {"HIGH": "***", "MEDIUM": "** ", "LOW": "*  "}.get(confidence, "   ")
        lines.append(f"  {marker} {topic}")
        if detail:
            lines.append(f"       {detail}")
    lines.append("")
    lines.append(f"  TL;DR: {_interest_summary(interests)}")
    lines.append("")

    # === OPENING ===
    lines.append(_divider("="))
    lines.append("  SCRIPT")
    lines.append(_divider("="))
    lines.append("")

    # Compute start time from first product
    start_min = 0
    if products:
        first_ts = products[0].get("timestamp", "")
        start_min = _parse_time_minutes(first_ts) if first_ts else 0

    # --- Opening segment ---
    lines.append(f"[00:00] OPENING (1-2 minutes)")
    lines.append(_divider())
    lines.append("")
    lines.append("  TALKING POINTS:")
    lines.append(f'    - "Welcome! I\'d love to understand your environment before')
    lines.append(f'       we dive in. What brings you to the booth today?"')
    if visitor.get("company"):
        lines.append(f'    - Reference their company: "{visitor["company"]}"')
    if visitor.get("industry"):
        lines.append(f'    - Tailor language to {visitor["industry"]} use cases')
    lines.append("")
    lines.append("  DISCOVERY QUESTIONS:")
    lines.append('    - "What are the top 2-3 security challenges keeping you up at night?"')
    lines.append('    - "How is your security team structured today?"')
    lines.append('    - "Are you evaluating any new solutions this quarter?"')
    lines.append("")

    # --- Product segments ---
    for idx, product in enumerate(products):
        product_name = product.get("name", product.get("topic", "Unknown"))
        timestamp = product.get("timestamp", "")
        note = product.get("note", "")
        playbook = _match_playbook(product_name)

        # Calculate elapsed time
        if timestamp:
            current_min = _parse_time_minutes(timestamp)
            elapsed = _format_elapsed(start_min, current_min)
        else:
            elapsed = f"[{(idx + 1) * 5:02d}:00]"

        lines.append(f"{elapsed} {product_name.upper()}")
        lines.append(_divider())
        lines.append("")

        # Context from the original session
        if note:
            lines.append(f"  CONTEXT FROM ORIGINAL SESSION:")
            lines.append(f"    {note}")
            lines.append("")

        # Talking points
        lines.append(f"  TALKING POINTS:")
        for tp in playbook.get("talking_points", []):
            lines.append(f"    - {tp}")
        lines.append("")

        # Suggested questions
        lines.append(f"  QUESTIONS TO ASK:")
        for q in playbook.get("questions", []):
            lines.append(f'    - "{q}"')
        lines.append("")

        # Transition hint (except last product)
        if idx < len(products) - 1:
            next_name = products[idx + 1].get(
                "name", products[idx + 1].get("topic", "")
            )
            lines.append(f"  TRANSITION:")
            lines.append(f'    - "That ties nicely into {next_name}, '
                         f'let me show you how they work together..."')
            lines.append("")

    # --- Closing segment ---
    if products:
        last_ts = products[-1].get("timestamp", "")
        if last_ts:
            close_min = _parse_time_minutes(last_ts) - start_min + 3
        else:
            close_min = len(products) * 5 + 3
    else:
        close_min = 5
    lines.append(f"[{close_min:02d}:00] CLOSING")
    lines.append(_divider())
    lines.append("")
    lines.append("  TALKING POINTS:")
    lines.append('    - Summarize the key capabilities shown')
    lines.append('    - Connect back to their stated challenges')
    lines.append('    - "Based on what we discussed, I think [product] addresses')
    lines.append('       your [challenge] -- would you agree?"')
    lines.append("")
    lines.append("  CLOSING QUESTIONS:")
    lines.append('    - "What resonated most with what you saw today?"')
    lines.append('    - "Who else on your team should see this?"')
    lines.append('    - "What would a successful proof of concept look like for you?"')
    lines.append('    - "Can we schedule a deeper technical session next week?"')
    lines.append("")

    # === FOLLOW-UP ACTIONS ===
    if recommendations:
        lines.append(_divider("="))
        lines.append("  POST-DEMO FOLLOW-UP")
        lines.append(_divider("="))
        lines.append("")
        for rec in recommendations:
            if isinstance(rec, str):
                text, priority = rec, ""
            else:
                text = rec.get("action", "")
                priority = rec.get("priority", "")
            tag = f" [{priority.upper()}]" if priority else ""
            lines.append(f"  [ ]{tag} {text}")
        lines.append("")

    # === FOOTER ===
    lines.append(_divider("="))
    lines.append("  END OF SCRIPT")
    lines.append(_divider("="))

    return "\n".join(lines)


def generate_script_from_files(
    summary_path: str,
    timeline_path: str | None = None,
    output_path: str | None = None,
) -> str:
    """Load JSON files and generate a demo script.

    Args:
        summary_path: Path to summary.json (or sample_data.json / result.json).
        timeline_path: Optional path to timeline.json.
        output_path: Optional path to write the script. If None, returns string only.

    Returns:
        The generated script text.
    """
    with open(summary_path, "r", encoding="utf-8") as f:
        summary = json.load(f)

    timeline = None
    if timeline_path and os.path.exists(timeline_path):
        with open(timeline_path, "r", encoding="utf-8") as f:
            timeline = json.load(f)

    script = generate_script(summary, timeline)

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(script)

    return script
