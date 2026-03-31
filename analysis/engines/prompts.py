"""
Booth Visitor Analysis -- Competitive Analysis Pass

Identifies which Vision One features demonstrated during a booth visit
address specific visitor pain points compared to competitors they may
be evaluating (CrowdStrike, Palo Alto, SentinelOne, Microsoft Defender,
Splunk).

Writes structured output to output/competitive.json.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any


# ---------------------------------------------------------------------------
# Competitor knowledge base
# ---------------------------------------------------------------------------

COMPETITORS = {
    "CrowdStrike": {
        "aliases": ["crowdstrike", "falcon", "cs"],
        "weaknesses": {
            "XDR": "Agent-heavy; limited native network and email telemetry",
            "Cloud Security": "CNAPP acquired (Bionic) -- still integrating; no unified console",
            "Email Security": "No native email protection; relies on third-party integrations",
            "Zero Trust Secure Access": "No native ZTNA offering; identity-focused only",
            "Endpoint Security": "Premium pricing; limited OS coverage outside Windows/macOS/Linux",
            "Managed Detection & Response": "OverWatch is human-only; higher cost per endpoint",
        },
    },
    "Palo Alto": {
        "aliases": ["palo alto", "paloalto", "panw", "cortex", "prisma", "xsiam"],
        "weaknesses": {
            "XDR": "XSIAM requires full Palo Alto stack for best results; complex deployment",
            "Cloud Security": "Prisma Cloud UI complexity; steep learning curve",
            "Email Security": "No native email security; acquired assets not fully integrated",
            "Zero Trust Secure Access": "Prisma Access pricing tied to bandwidth; cost unpredictable",
            "Endpoint Security": "Cortex XDR agent conflicts with existing EDR in migrations",
            "Managed Detection & Response": "Unit 42 retainer-based; expensive for mid-market",
        },
    },
    "SentinelOne": {
        "aliases": ["sentinelone", "sentinel one", "s1"],
        "weaknesses": {
            "XDR": "Singularity data lake is new; limited cross-pillar correlation",
            "Cloud Security": "Cloud workload protection lacks container runtime depth",
            "Email Security": "No email security offering at all",
            "Zero Trust Secure Access": "No ZTNA product; relies on partner integrations",
            "Endpoint Security": "Autonomous response can cause false-positive disruptions",
            "Managed Detection & Response": "Vigilance MDR limited to endpoint telemetry only",
        },
    },
    "Microsoft Defender": {
        "aliases": ["microsoft defender", "defender", "microsoft", "mde", "m365 defender"],
        "weaknesses": {
            "XDR": "Tightly coupled to M365; poor visibility outside Microsoft ecosystem",
            "Cloud Security": "Defender for Cloud noisy alerts; requires extensive tuning",
            "Email Security": "Defender for O365 misses advanced BEC; high false-negative rate",
            "Zero Trust Secure Access": "Conditional Access requires Entra ID P2; licensing complexity",
            "Endpoint Security": "Resource-heavy agent; performance issues on older hardware",
            "Managed Detection & Response": "Experts for XDR limited availability; waitlist common",
        },
    },
    "Splunk": {
        "aliases": ["splunk"],
        "weaknesses": {
            "XDR": "SIEM-first architecture; no native endpoint telemetry for XDR",
            "Cloud Security": "No native cloud workload protection; log-analysis only",
            "Email Security": "No email security product; ingests email logs only",
            "Zero Trust Secure Access": "No ZTNA offering; pure analytics platform",
            "Endpoint Security": "No endpoint agent; depends on third-party EDR data",
            "Managed Detection & Response": "No MDR service; customer must build own SOC",
        },
    },
}

# Map common product name variants to canonical V1 feature names
_PRODUCT_ALIASES: dict[str, str] = {
    "xdr": "XDR",
    "vision one xdr": "XDR",
    "extended detection": "XDR",
    "soc": "XDR",
    "siem": "XDR",
    "cloud security": "Cloud Security",
    "container": "Cloud Security",
    "kubernetes": "Cloud Security",
    "k8s": "Cloud Security",
    "cloud workload": "Cloud Security",
    "cnapp": "Cloud Security",
    "email security": "Email Security",
    "email threat": "Email Security",
    "bec": "Email Security",
    "phishing": "Email Security",
    "zero trust": "Zero Trust Secure Access",
    "ztna": "Zero Trust Secure Access",
    "ztsa": "Zero Trust Secure Access",
    "secure access": "Zero Trust Secure Access",
    "endpoint": "Endpoint Security",
    "edr": "Endpoint Security",
    "epp": "Endpoint Security",
    "apex one": "Endpoint Security",
    "mdr": "Managed Detection & Response",
    "managed detection": "Managed Detection & Response",
    "managed response": "Managed Detection & Response",
}

# V1 differentiators per feature area
_V1_STRENGTHS: dict[str, str] = {
    "XDR": (
        "Native cross-layer correlation across endpoint, email, network, cloud, "
        "and identity from a single platform with unified data lake"
    ),
    "Cloud Security": (
        "Unified CNAPP with runtime container protection, CSPM, and agentless "
        "scanning -- all managed from the Vision One console"
    ),
    "Email Security": (
        "AI-powered BEC detection, writing-style analysis, and deep URL/attachment "
        "inspection with native Vision One integration"
    ),
    "Zero Trust Secure Access": (
        "Integrated ZTNA with continuous risk assessment fed by Vision One's "
        "risk insights engine -- no separate identity provider required"
    ),
    "Endpoint Security": (
        "Lightweight agent with combined EPP+EDR, virtual patching, and "
        "application control -- managed from Vision One with cross-layer context"
    ),
    "Managed Detection & Response": (
        "24/7 MDR with cross-layer visibility across all Vision One telemetry, "
        "not limited to endpoint-only data"
    ),
}


def _normalize_product(name: str) -> str | None:
    """Map a product name string to a canonical V1 feature name."""
    lower = name.lower().strip()
    for alias, canonical in _PRODUCT_ALIASES.items():
        if alias in lower:
            return canonical
    return None


def _detect_competitors(data: dict) -> list[str]:
    """Detect which competitors are mentioned anywhere in the session data."""
    text = json.dumps(data).lower()
    found = []
    for comp_name, comp_info in COMPETITORS.items():
        for alias in comp_info["aliases"]:
            if alias in text:
                found.append(comp_name)
                break
    return found


def _detect_features(data: dict) -> list[str]:
    """Detect which V1 features were demonstrated or discussed."""
    features: set[str] = set()

    for product in data.get("products_demonstrated", []):
        name = product.get("name", "")
        canonical = _normalize_product(name)
        if canonical:
            features.add(canonical)
        note = product.get("note", "")
        canonical = _normalize_product(note)
        if canonical:
            features.add(canonical)

    for interest in data.get("interests", []):
        topic = interest.get("topic", "")
        canonical = _normalize_product(topic)
        if canonical:
            features.add(canonical)
        detail = interest.get("detail", "")
        canonical = _normalize_product(detail)
        if canonical:
            features.add(canonical)

    return sorted(features)


def generate_competitive_analysis(data: dict) -> dict:
    """Generate competitive analysis from session data.

    Args:
        data: Session data dict (same format as report_template input).

    Returns:
        Structured dict with competitive positioning per feature.
    """
    detected_competitors = _detect_competitors(data)
    detected_features = _detect_features(data)

    # If no competitors explicitly mentioned, include all for proactive positioning
    competitors_to_analyze = detected_competitors if detected_competitors else list(COMPETITORS.keys())

    feature_analyses = []
    for feature in detected_features:
        competitor_gaps = []
        for comp_name in competitors_to_analyze:
            comp = COMPETITORS[comp_name]
            weakness = comp["weaknesses"].get(feature)
            if weakness:
                competitor_gaps.append({
                    "competitor": comp_name,
                    "gap": weakness,
                })

        feature_analyses.append({
            "feature": feature,
            "v1_strength": _V1_STRENGTHS.get(feature, ""),
            "competitor_gaps": competitor_gaps,
        })

    visitor = data.get("visitor", {})

    return {
        "report_id": data.get("report_id", ""),
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "visitor": {
            "name": visitor.get("name", ""),
            "company": visitor.get("company", ""),
        },
        "competitors_detected": detected_competitors,
        "competitors_analyzed": competitors_to_analyze,
        "features_demonstrated": detected_features,
        "competitive_positioning": feature_analyses,
    }


def write_competitive_analysis(data: dict, output_dir: str = "output") -> str:
    """Generate competitive analysis and write to output/competitive.json.

    Args:
        data: Session data dict.
        output_dir: Directory to write output file.

    Returns:
        Path to the written JSON file.
    """
    analysis = generate_competitive_analysis(data)
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "competitive.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, indent=2, ensure_ascii=False)
    return output_path
