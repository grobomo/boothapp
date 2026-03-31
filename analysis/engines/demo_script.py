"""Demo script generator -- recommends future demo scripts based on session analysis.

After analyzing a session, generates a recommended demo script for future visitors
from the same company or industry. Based on what resonated with this visitor, suggests:
opening talking points, which V1 modules to show first, questions to ask, objection
handling based on concerns raised, and closing approach.

Usage:
    python -m analysis.engines.demo_script <session_dir> [output.md]

Or as a library:
    from analysis.engines.demo_script import generate_demo_script
    md = generate_demo_script("/path/to/session")
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# V1 module display order -- most commonly demo'd first
V1_MODULES = [
    "Endpoint Security",
    "XDR",
    "Attack Surface Risk Management",
    "Risk Insights",
    "Email Security",
    "Network Security",
    "Cloud Security",
    "Workbench",
    "Threat Intelligence",
    "Zero Trust",
]

# Industry-specific openers keyed by detected keywords
INDUSTRY_OPENERS = {
    "financial": "Financial services face unique compliance pressures (PCI-DSS, SOX, GLBA) alongside sophisticated threat actors targeting transaction systems.",
    "healthcare": "Healthcare organizations must balance HIPAA compliance with defending against ransomware groups that specifically target patient data.",
    "retail": "Retail environments face PCI compliance requirements plus the challenge of securing distributed POS systems and e-commerce platforms.",
    "manufacturing": "Manufacturing and OT environments need security that bridges IT and OT without disrupting production systems.",
    "government": "Government agencies require FedRAMP-compliant solutions with strict data sovereignty and zero-trust access controls.",
    "education": "Education institutions manage massive BYOD populations and open network architectures while protecting student data under FERPA.",
    "technology": "Tech companies need security that scales with CI/CD pipelines, cloud-native workloads, and developer-friendly APIs.",
}


def _read_json(session_dir, relative_path):
    """Read a JSON file from the session directory."""
    path = os.path.join(session_dir, relative_path)
    if not os.path.exists(path):
        return {}
    with open(path, "r") as f:
        return json.load(f)


def _detect_industry(metadata, transcript_entries, summary):
    """Detect visitor industry from metadata, transcript, and summary."""
    # Check metadata first
    for field in ("company_industry", "industry", "vertical"):
        val = metadata.get(field, "")
        if val:
            return val.lower()

    # Scan transcript and summary for industry keywords
    all_text = " ".join(
        e.get("text", "") for e in transcript_entries
    ).lower()
    all_text += " " + summary.get("executive_summary", "").lower()
    all_text += " " + " ".join(summary.get("follow_up_actions", []))

    for industry in INDUSTRY_OPENERS:
        if industry in all_text:
            return industry

    # More specific keyword mapping
    industry_keywords = {
        "financial": ["bank", "trading", "investment", "fintech", "payments", "pci-dss", "sox"],
        "healthcare": ["hospital", "hipaa", "patient", "clinical", "ehr", "medical"],
        "retail": ["store", "pos", "e-commerce", "ecommerce", "point of sale", "merchant"],
        "manufacturing": ["factory", "scada", "plc", "ot ", "operational technology", "production line"],
        "government": ["agency", "fedramp", "federal", "dod", "cisa", "government"],
        "education": ["university", "school", "campus", "ferpa", "student"],
        "technology": ["saas", "devops", "ci/cd", "kubernetes", "microservices"],
    }
    for industry, keywords in industry_keywords.items():
        if any(kw in all_text for kw in keywords):
            return industry

    return "general"


def _extract_concerns(transcript_entries, competitive_insights):
    """Extract visitor concerns and objections from transcript and competitive data."""
    concerns = []

    # From transcript: look for question patterns and concern signals
    concern_signals = [
        "worried about", "concern", "problem with", "issue with",
        "pushed back", "challenge", "struggle", "pain point",
        "how does", "what about", "can you", "does it",
        "compared to", "versus", "vs ", "better than",
        "expensive", "cost", "price", "budget",
        "deploy", "migration", "integrate", "compatible",
    ]
    for entry in transcript_entries:
        if entry.get("speaker") != "Visitor":
            continue
        text = entry.get("text", "")
        text_lower = text.lower()
        for signal in concern_signals:
            if signal in text_lower:
                concerns.append({
                    "text": text,
                    "timestamp": entry.get("timestamp", ""),
                    "type": "visitor_question",
                })
                break

    # From competitive insights
    if competitive_insights and competitive_insights.get("mentions"):
        for mention in competitive_insights["mentions"]:
            if mention.get("speaker") == "Visitor":
                concerns.append({
                    "text": mention.get("passage", ""),
                    "timestamp": mention.get("timestamp", ""),
                    "type": "competitive_mention",
                    "competitor": mention.get("competitor", ""),
                    "counter": mention.get("counter_positioning", ""),
                })

    return concerns


def _rank_modules(summary, transcript_entries):
    """Rank V1 modules by how well they resonated in this session."""
    products = summary.get("products_demonstrated", [])
    interests = summary.get("key_interests", [])
    score = summary.get("session_score", 5)

    # Build a score map for each module
    module_scores = {}
    for p in products:
        module_scores[p] = module_scores.get(p, 0) + 2

    # High-confidence interests get extra weight
    for interest in interests:
        topic = interest.get("topic", "")
        confidence = interest.get("confidence", "low")
        weight = {"high": 3, "medium": 2, "low": 1}.get(confidence, 1)
        # Match interest topic to a module
        for mod in V1_MODULES:
            if mod.lower() in topic.lower() or topic.lower() in mod.lower():
                module_scores[mod] = module_scores.get(mod, 0) + weight
                break
        else:
            # Partial keyword match
            for mod in V1_MODULES:
                mod_words = set(mod.lower().split())
                topic_words = set(topic.lower().split())
                if mod_words & topic_words:
                    module_scores[mod] = module_scores.get(mod, 0) + weight
                    break

    # Sort by score descending
    ranked = sorted(module_scores.items(), key=lambda x: -x[1])
    return ranked


def _build_objection_handlers(concerns, competitive_insights):
    """Build objection handling entries from concerns and competitive data."""
    handlers = []
    seen = set()

    for concern in concerns:
        if concern["type"] == "competitive_mention":
            competitor = concern.get("competitor", "Unknown")
            key = f"competitive:{competitor}"
            if key in seen:
                continue
            seen.add(key)
            handlers.append({
                "objection": f"Visitor uses or evaluated {competitor}",
                "response": concern.get("counter", f"Highlight Vision One's differentiated value vs {competitor}."),
                "evidence": concern.get("text", ""),
            })
        elif concern["type"] == "visitor_question":
            text = concern.get("text", "")
            # Categorize the concern
            text_lower = text.lower()
            if any(w in text_lower for w in ["cost", "price", "expensive", "budget"]):
                key = "pricing"
                if key in seen:
                    continue
                seen.add(key)
                handlers.append({
                    "objection": "Pricing / cost concern",
                    "response": "Emphasize TCO advantage: Vision One consolidates multiple point products (endpoint + email + network + cloud) into a single platform license, reducing operational overhead and tool sprawl.",
                    "evidence": text,
                })
            elif any(w in text_lower for w in ["deploy", "migration", "install", "agent"]):
                key = "deployment"
                if key in seen:
                    continue
                seen.add(key)
                handlers.append({
                    "objection": "Deployment complexity / migration concern",
                    "response": "Vision One supports phased rollout: start with one sensor type (e.g., endpoint), get immediate value, then expand to email/network/cloud. No rip-and-replace required.",
                    "evidence": text,
                })
            elif any(w in text_lower for w in ["integrate", "compatible", "api", "siem"]):
                key = "integration"
                if key in seen:
                    continue
                seen.add(key)
                handlers.append({
                    "objection": "Integration / compatibility concern",
                    "response": "Vision One provides open APIs, pre-built SIEM integrations (Splunk, QRadar, Sentinel), and SOAR playbooks. The platform enhances existing investments rather than replacing them.",
                    "evidence": text,
                })
            elif any(w in text_lower for w in ["mdm", "byod", "mobile", "device"]):
                key = "byod"
                if key in seen:
                    continue
                seen.add(key)
                handlers.append({
                    "objection": "BYOD / mobile device management concern",
                    "response": "Vision One's mobile security uses a lightweight container approach -- no full MDM required. Employees keep privacy over personal data while corporate data stays isolated and encrypted.",
                    "evidence": text,
                })

    return handlers


def build_demo_script(session_dir):
    """Build a demo script recommendation from session data.

    Args:
        session_dir: Path to the session directory.

    Returns:
        dict with all demo script components.
    """
    metadata = _read_json(session_dir, "metadata.json")
    summary = _read_json(session_dir, "output/summary.json")
    follow_up = _read_json(session_dir, "output/follow-up.json")
    competitive = _read_json(session_dir, "output/competitive-insights.json")

    # Load transcript entries
    transcript_data = _read_json(session_dir, "transcript/transcript.json")
    entries = []
    if isinstance(transcript_data, list):
        entries = transcript_data
    elif isinstance(transcript_data, dict):
        for key in ("entries", "results", "items", "transcripts"):
            if isinstance(transcript_data.get(key), list):
                entries = transcript_data[key]
                break

    visitor_name = metadata.get("visitor_name", summary.get("visitor_name", "Visitor"))
    visitor_company = metadata.get("visitor_company", summary.get("visitor_company", ""))
    se_name = metadata.get("se_name", summary.get("se_name", ""))
    session_id = metadata.get("session_id", summary.get("session_id", "unknown"))

    industry = _detect_industry(metadata, entries, summary)
    concerns = _extract_concerns(entries, competitive)
    ranked_modules = _rank_modules(summary, entries)
    objection_handlers = _build_objection_handlers(concerns, competitive)

    # Build the opening
    industry_opener = INDUSTRY_OPENERS.get(industry, "")
    products_shown = summary.get("products_demonstrated", [])
    score = summary.get("session_score", 0)
    executive_summary = summary.get("executive_summary", "")

    # Questions to ask based on what resonated
    discovery_questions = []
    interests = summary.get("key_interests", [])
    for interest in interests:
        topic = interest.get("topic", "")
        confidence = interest.get("confidence", "")
        if confidence in ("high", "medium"):
            discovery_questions.append(
                f"What's your current approach to {topic.lower()}? (This resonated strongly with {visitor_name}.)"
            )
    # Add standard discovery questions
    discovery_questions.extend([
        "How many endpoints/users are you managing across your environment?",
        "What's your current security stack? Are you looking to consolidate or augment?",
        "What triggered your interest in evaluating new security solutions?",
    ])

    # Closing approach based on session score
    if score >= 7:
        closing = {
            "approach": "Direct trial close",
            "script": "Based on what we've discussed, I think a hands-on POC with your environment data would be the most valuable next step. We can set up a dedicated Vision One tenant pre-configured for your use case. Can I get that started this week?",
            "rationale": f"Session scored {score}/10 -- strong engagement signals warrant a direct ask.",
        }
    elif score >= 4:
        closing = {
            "approach": "Technical deep-dive close",
            "script": "I'd love to schedule a focused session with your team where we can go deeper on the areas you found most interesting. We can customize the demo environment to mirror your infrastructure. What does your calendar look like next week?",
            "rationale": f"Session scored {score}/10 -- moderate interest warrants a follow-up session before trial.",
        }
    else:
        closing = {
            "approach": "Content nurture close",
            "script": "I'll send you some materials specific to what we discussed today, along with a summary of this session. If any questions come up, feel free to reach out directly. Here's my card.",
            "rationale": f"Session scored {score}/10 -- lighter engagement suggests nurturing rather than pushing for a meeting.",
        }

    return {
        "session_id": session_id,
        "visitor_name": visitor_name,
        "visitor_company": visitor_company,
        "se_name": se_name,
        "industry": industry,
        "session_score": score,
        "executive_summary": executive_summary,
        "industry_opener": industry_opener,
        "products_demonstrated": products_shown,
        "ranked_modules": [{"module": m, "score": s} for m, s in ranked_modules],
        "discovery_questions": discovery_questions[:6],
        "objection_handlers": objection_handlers,
        "closing": closing,
        "interests": interests,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def render_demo_script_md(script_data):
    """Render demo script data as a Markdown document.

    Args:
        script_data: Dict from build_demo_script().

    Returns:
        Markdown string.
    """
    lines = []
    lines.append(f"# Recommended Demo Script")
    lines.append("")
    lines.append(f"**Based on session:** {script_data['session_id']} "
                 f"({script_data['visitor_name']}"
                 f"{', ' + script_data['visitor_company'] if script_data['visitor_company'] else ''})")
    lines.append(f"**Industry:** {script_data['industry'].title()}")
    lines.append(f"**Original SE:** {script_data['se_name']}")
    lines.append(f"**Session Score:** {script_data['session_score']}/10")
    lines.append(f"**Generated:** {script_data['generated_at']}")
    lines.append("")

    if script_data.get("executive_summary"):
        lines.append(f"> {script_data['executive_summary']}")
        lines.append("")

    # Opening
    lines.append("---")
    lines.append("")
    lines.append("## 1. Opening Talking Points")
    lines.append("")
    if script_data.get("industry_opener"):
        lines.append(f"**Industry context:** {script_data['industry_opener']}")
        lines.append("")

    lines.append("**Key hooks from this session:**")
    lines.append("")
    for interest in script_data.get("interests", [])[:3]:
        conf = interest.get("confidence", "")
        evidence = interest.get("evidence", "")
        lines.append(f"- **{interest.get('topic', '')}** ({conf}) -- {evidence}")
    lines.append("")

    # Module order
    lines.append("## 2. Recommended Demo Flow")
    lines.append("")
    lines.append("Show these V1 modules in this order (ranked by what resonated):")
    lines.append("")
    ranked = script_data.get("ranked_modules", [])
    if ranked:
        for i, mod in enumerate(ranked, 1):
            lines.append(f"{i}. **{mod['module']}** (relevance score: {mod['score']})")
    else:
        lines.append("No specific module ranking available -- follow standard demo flow.")
    lines.append("")

    products = script_data.get("products_demonstrated", [])
    if products:
        lines.append(f"*Modules shown in original session: {', '.join(products)}*")
        lines.append("")

    # Discovery questions
    lines.append("## 3. Discovery Questions")
    lines.append("")
    lines.append("Ask these to qualify the prospect and tailor the demo in real-time:")
    lines.append("")
    for q in script_data.get("discovery_questions", []):
        lines.append(f"- {q}")
    lines.append("")

    # Objection handling
    lines.append("## 4. Objection Handling")
    lines.append("")
    handlers = script_data.get("objection_handlers", [])
    if handlers:
        for h in handlers:
            lines.append(f"### {h['objection']}")
            lines.append("")
            lines.append(f"**Response:** {h['response']}")
            if h.get("evidence"):
                lines.append("")
                lines.append(f"*Evidence from session:* \"{h['evidence']}\"")
            lines.append("")
    else:
        lines.append("No specific objections were raised in this session.")
        lines.append("")

    # Closing
    lines.append("## 5. Closing Approach")
    lines.append("")
    closing = script_data.get("closing", {})
    lines.append(f"**Approach:** {closing.get('approach', 'Standard close')}")
    lines.append("")
    lines.append(f"**Script:**")
    lines.append("")
    lines.append(f"> {closing.get('script', '')}")
    lines.append("")
    lines.append(f"*Rationale: {closing.get('rationale', '')}*")
    lines.append("")

    # Footer
    lines.append("---")
    lines.append("")
    lines.append(f"*Generated by BoothApp Analysis Pipeline -- {script_data['generated_at']}*")
    lines.append("")

    return "\n".join(lines)


def generate_demo_script(session_dir, output_path=None):
    """Generate a recommended demo script for a session.

    Args:
        session_dir: Path to the session directory (local filesystem).
        output_path: Where to write the Markdown. Defaults to
            <session_dir>/output/recommended-demo-script.md.

    Returns:
        The Markdown string.
    """
    script_data = build_demo_script(session_dir)
    md = render_demo_script_md(script_data)

    if output_path is None:
        output_path = os.path.join(session_dir, "output", "recommended-demo-script.md")

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(md)

    logger.info("Demo script written to %s", output_path)
    return md


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m analysis.engines.demo_script <session_dir> [output.md]")
        sys.exit(1)
    session_dir = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None
    generate_demo_script(session_dir, output)
    print(f"Demo script generated for {session_dir}")
