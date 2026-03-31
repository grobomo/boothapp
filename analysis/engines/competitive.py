"""Competitive intelligence engine for booth demo transcripts.

Scans transcript entries for mentions of competitor products and generates
counter-positioning insights using Trend Micro Vision One strengths.

Usage:
    python -m analysis.engines.competitive <transcript.json> [output.json]
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

# Competitor definitions: name -> {aliases, patterns, strengths_counter}
COMPETITORS = {
    "CrowdStrike": {
        "aliases": ["CrowdStrike", "Falcon", "CrowdStrike Falcon"],
        "patterns": [
            re.compile(r"\bcrowd\s*strike\b", re.IGNORECASE),
            re.compile(r"\bfalcon\b(?!\s+(?:heavy|9|rocket))", re.IGNORECASE),
        ],
        "counter_points": [
            "Vision One provides native XDR across email, endpoints, servers, cloud, and network — CrowdStrike requires third-party integrations for non-endpoint telemetry.",
            "Vision One's attack surface risk management (ASRM) offers continuous risk scoring across the full environment, not just endpoints.",
            "Trend Micro consistently leads in third-party evaluations (MITRE ATT&CK) with zero configuration changes and zero delayed detections.",
        ],
    },
    "Palo Alto Networks": {
        "aliases": ["Palo Alto", "PANW", "Cortex XDR", "Cortex XSIAM", "XSIAM"],
        "patterns": [
            re.compile(r"\bpalo\s*alto\b", re.IGNORECASE),
            re.compile(r"\bcortex\s*xdr\b", re.IGNORECASE),
            re.compile(r"\bcortex\s*xsiam\b", re.IGNORECASE),
            re.compile(r"\bxsiam\b", re.IGNORECASE),
            re.compile(r"\bpanw\b", re.IGNORECASE),
        ],
        "counter_points": [
            "Vision One delivers unified XDR without requiring a costly SIEM migration — Cortex XSIAM bundles SIEM replacement, increasing cost and complexity.",
            "Trend Micro offers flexible deployment (SaaS, hybrid, on-prem) while Palo Alto pushes cloud-only, leaving gaps for regulated industries.",
            "Vision One's managed XDR (MDR) is included, while Palo Alto charges separately for Unit 42 MDR services.",
        ],
    },
    "SentinelOne": {
        "aliases": ["SentinelOne", "S1", "Singularity"],
        "patterns": [
            re.compile(r"\bsentinel\s*one\b", re.IGNORECASE),
            re.compile(r"\bsingularity\s*(?:xdr|platform)?\b", re.IGNORECASE),
            re.compile(r"\b(?<!\w)S1\b"),
        ],
        "counter_points": [
            "Vision One provides native email, network, and cloud telemetry — SentinelOne is primarily endpoint-focused and relies on integrations for broader visibility.",
            "Trend Micro has 35+ years of threat intelligence and zero-day research through ZDI, the world's largest vendor-agnostic bug bounty program.",
            "Vision One's virtual patching via Trend Micro's IPS provides immediate protection while SentinelOne lacks native network-layer defense.",
        ],
    },
    "Microsoft Defender": {
        "aliases": ["Microsoft Defender", "Defender for Endpoint", "Defender XDR", "Microsoft 365 Defender", "MDE"],
        "patterns": [
            re.compile(r"\bmicrosoft\s+defender\b", re.IGNORECASE),
            re.compile(r"\bdefender\s+(?:for\s+)?(?:endpoint|xdr|365)\b", re.IGNORECASE),
            re.compile(r"\b(?<!\w)MDE\b"),
        ],
        "counter_points": [
            "Vision One provides cross-platform protection (Windows, Mac, Linux, cloud workloads) with equal feature parity — Defender prioritizes the Windows ecosystem.",
            "Trend Micro operates as an independent security vendor, avoiding the conflict of interest inherent in securing the same OS you also build.",
            "Vision One offers superior third-party cloud and hybrid environment coverage where Microsoft's telemetry has blind spots.",
        ],
    },
    "Fortinet": {
        "aliases": ["Fortinet", "FortiEDR", "FortiXDR", "FortiGate"],
        "patterns": [
            re.compile(r"\bfortinet\b", re.IGNORECASE),
            re.compile(r"\bforti\s*(?:edr|xdr|gate|siem)\b", re.IGNORECASE),
        ],
        "counter_points": [
            "Vision One's XDR is purpose-built with native sensors — Fortinet's XDR bolts onto a network-first architecture with limited endpoint depth.",
            "Trend Micro provides deeper email security and cloud workload protection, areas where Fortinet relies on acquisitions and integrations.",
            "Vision One's risk-based approach (ASRM) prioritizes threats by business impact, while Fortinet focuses on network perimeter defense.",
        ],
    },
}


def _extract_context(text, match_start, match_end, context_chars=150):
    """Extract a passage surrounding the match with context."""
    start = max(0, match_start - context_chars)
    end = min(len(text), match_end + context_chars)
    # Extend to word boundaries
    if start > 0:
        space = text.rfind(" ", 0, start)
        if space > start - 30:
            start = space + 1
    if end < len(text):
        space = text.find(" ", end)
        if space != -1 and space < end + 30:
            end = space
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def _classify_concern(passage):
    """Identify the concern or comparison point from the passage text."""
    passage_lower = passage.lower()

    concern_patterns = [
        (r"\b(?:price|pricing|cost|expensive|cheaper|budget|license)\b", "Pricing/cost comparison"),
        (r"\b(?:feature|capability|function|missing|lack|gap)\b", "Feature comparison"),
        (r"\b(?:deploy|migration|migrate|switch|replace|rip.and.replace)\b", "Migration/deployment concern"),
        (r"\b(?:performance|speed|fast|slow|latency|resource)\b", "Performance concern"),
        (r"\b(?:support|service|sla|response time|customer)\b", "Support/service comparison"),
        (r"\b(?:integrat\w*|api|compatible|interop|ecosystem)\b", "Integration/ecosystem concern"),
        (r"\b(?:leader|gartner|forrester|magic quadrant|wave)\b", "Market positioning"),
        (r"\b(?:already|currently|existing|using|running|have)\b", "Incumbent displacement"),
        (r"\b(?:better|worse|compare|versus|vs|than)\b", "Direct comparison"),
    ]

    for pattern, label in concern_patterns:
        if re.search(pattern, passage_lower):
            return label

    return "General competitor mention"


def analyze_transcript(transcript_data):
    """Analyze transcript for competitive mentions.

    Args:
        transcript_data: Parsed transcript.json (dict with entries/results/items
            list, or a raw list of entries).

    Returns:
        dict with competitor_mentions list and metadata.
    """
    # Normalize transcript entries
    entries = transcript_data
    if isinstance(transcript_data, dict):
        for key in ("entries", "results", "items", "transcripts"):
            if isinstance(transcript_data.get(key), list):
                entries = transcript_data[key]
                break
        else:
            entries = []
    if not isinstance(entries, list):
        entries = []

    mentions = []
    seen_passages = set()

    for entry in entries:
        speaker = entry.get("speaker", "")
        text = entry.get("text", "")
        timestamp = entry.get("timestamp", "")

        if not text:
            continue

        for competitor_name, config in COMPETITORS.items():
            for pattern in config["patterns"]:
                for match in pattern.finditer(text):
                    passage = _extract_context(text, match.start(), match.end())

                    # Deduplicate near-identical passages
                    passage_key = f"{competitor_name}:{passage[:80]}"
                    if passage_key in seen_passages:
                        continue
                    seen_passages.add(passage_key)

                    concern = _classify_concern(passage)

                    # Pick the most relevant counter-point based on concern
                    counter_points = config["counter_points"]
                    counter_point = counter_points[0]
                    if "integration" in concern.lower() or "ecosystem" in concern.lower():
                        counter_point = counter_points[0]  # breadth point
                    elif "pricing" in concern.lower() or "cost" in concern.lower():
                        counter_point = counter_points[min(2, len(counter_points) - 1)]
                    elif len(counter_points) > 1:
                        counter_point = counter_points[1]

                    mentions.append({
                        "competitor": competitor_name,
                        "matched_term": match.group(),
                        "timestamp": timestamp,
                        "speaker": speaker,
                        "passage": passage,
                        "concern": concern,
                        "counter_positioning": counter_point,
                    })

    # Sort by timestamp
    mentions.sort(key=lambda m: m.get("timestamp", ""))

    # Build competitor summary
    competitor_summary = {}
    for m in mentions:
        name = m["competitor"]
        if name not in competitor_summary:
            competitor_summary[name] = {
                "mention_count": 0,
                "concerns": [],
                "speakers": set(),
            }
        competitor_summary[name]["mention_count"] += 1
        if m["concern"] not in competitor_summary[name]["concerns"]:
            competitor_summary[name]["concerns"].append(m["concern"])
        competitor_summary[name]["speakers"].add(m["speaker"])

    # Convert sets to lists for JSON serialization
    summary_list = []
    for name, data in sorted(competitor_summary.items(), key=lambda x: -x[1]["mention_count"]):
        summary_list.append({
            "competitor": name,
            "mention_count": data["mention_count"],
            "concerns": data["concerns"],
            "speakers": sorted(data["speakers"]),
        })

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_mentions": len(mentions),
        "competitors_detected": [s["competitor"] for s in summary_list],
        "competitor_summary": summary_list,
        "mentions": mentions,
    }


def analyze_from_file(transcript_path, output_path=None):
    """Analyze a transcript file for competitive mentions.

    Args:
        transcript_path: Path to transcript.json.
        output_path: Optional path to write competitive-insights.json.

    Returns:
        Competitive analysis result dict.
    """
    with open(transcript_path, "r") as f:
        transcript_data = json.load(f)

    result = analyze_transcript(transcript_data)

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m analysis.engines.competitive <transcript.json> [output.json]")
        sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else None
    result = analyze_from_file(sys.argv[1], out)
    if not out:
        print(json.dumps(result, indent=2))
