"""
Visitor Company Research Enrichment

Infers company metadata from the visitor's company name:
- Estimated company size
- Likely security stack
- Industry vertical
- Relevant Trend Micro case studies to reference

No external API calls -- uses keyword heuristics and known company patterns.
"""

from __future__ import annotations

import json
import re
from typing import Any


# ---------------------------------------------------------------------------
# Industry classification rules (keyword -> vertical)
# ---------------------------------------------------------------------------
_INDUSTRY_KEYWORDS: list[tuple[list[str], str]] = [
    (["bank", "financial", "capital", "invest", "credit", "insurance",
      "fund", "asset", "wealth", "mortgage", "fidelity", "goldman",
      "jpmorgan", "citi", "hsbc", "barclays", "bnp"], "Financial Services"),
    (["health", "medical", "pharma", "biotech", "hospital", "clinic",
      "therapeutics", "genomic", "pfizer", "johnson", "merck", "roche",
      "abbott", "medtronic"], "Healthcare & Life Sciences"),
    (["tech", "software", "cloud", "data", "cyber", "digital", "ai",
      "compute", "silicon", "microsoft", "google", "amazon", "oracle",
      "salesforce", "sap", "ibm", "dell", "intel", "nvidia", "cisco",
      "vmware", "palo alto"], "Technology"),
    (["energy", "oil", "gas", "petro", "solar", "wind", "power",
      "utility", "electric", "exxon", "chevron", "shell", "bp",
      "duke energy"], "Energy & Utilities"),
    (["retail", "store", "shop", "commerce", "consumer", "brand",
      "walmart", "target", "costco", "home depot", "nike", "amazon"],
     "Retail & E-Commerce"),
    (["manufactur", "industrial", "auto", "motor", "aero",
      "boeing", "general electric", "siemens",
      "caterpillar", "3m", "honeywell"], "Manufacturing & Industrial"),
    (["telecom", "network", "wireless", "mobile", "broadband",
      "at&t", "verizon", "t-mobile", "comcast", "vodafone"],
     "Telecommunications"),
    (["media", "entertain", "broadcast", "stream", "publish", "news",
      "disney", "netflix", "warner", "paramount", "sony"], "Media & Entertainment"),
    (["education", "university", "college", "school", "academic",
      "research", "institute"], "Education & Research"),
    (["government", "federal", "state", "municipal", "public sector",
      "agency", "dept", "ministry", "defense", "lockheed", "raytheon"],
     "Government & Public Sector"),
    (["transport", "logistics", "freight", "shipping", "airline",
      "rail", "fedex", "ups", "maersk"], "Transportation & Logistics"),
    (["legal", "law", "attorney", "counsel"], "Legal & Professional Services"),
    (["real estate", "property", "reit", "construction", "building"],
     "Real Estate & Construction"),
]

# ---------------------------------------------------------------------------
# Company size heuristics (keyword indicators)
# ---------------------------------------------------------------------------
_SIZE_LARGE_INDICATORS = [
    "corp", "corporation", "global", "international", "group",
    "holdings", "enterprises", "worldwide",
]
_SIZE_MID_INDICATORS = [
    "inc", "ltd", "limited", "co", "partners", "solutions",
]

# Well-known large companies (partial match)
_KNOWN_LARGE = [
    "microsoft", "google", "amazon", "apple", "meta", "nvidia",
    "jpmorgan", "goldman", "citigroup", "hsbc", "barclays",
    "walmart", "target", "costco", "boeing", "lockheed",
    "exxon", "chevron", "shell", "pfizer", "johnson",
    "cisco", "intel", "dell", "ibm", "oracle", "sap",
    "salesforce", "vmware", "palo alto", "crowdstrike",
    "at&t", "verizon", "comcast", "disney", "netflix",
    "general electric", "siemens", "honeywell", "3m",
    "accenture", "deloitte", "pwc", "kpmg", "ernst",
]


def _classify_industry(company: str) -> str:
    """Classify company into an industry vertical by keyword matching.

    Short keywords (<=3 chars) require word-boundary matching to avoid
    false positives (e.g. "ai" inside "retail", "gas" inside "megastore").
    """
    lower = company.lower()
    best_vertical = "General Enterprise"
    best_score = 0
    for keywords, vertical in _INDUSTRY_KEYWORDS:
        score = 0
        for kw in keywords:
            if len(kw) <= 3:
                if re.search(rf"\b{re.escape(kw)}\b", lower):
                    score += 1
            else:
                if kw in lower:
                    score += 1
        if score > best_score:
            best_score = score
            best_vertical = vertical
    return best_vertical if best_score > 0 else "General Enterprise"


def _estimate_size(company: str) -> dict[str, Any]:
    """Estimate company size from name heuristics."""
    lower = company.lower()

    # Check known large companies
    for name in _KNOWN_LARGE:
        if name in lower:
            return {
                "estimate": "10,000+ employees",
                "category": "Enterprise",
                "confidence": "high",
            }

    # Check naming patterns
    for indicator in _SIZE_LARGE_INDICATORS:
        if indicator in lower:
            return {
                "estimate": "1,000 - 10,000 employees",
                "category": "Large",
                "confidence": "medium",
            }

    for indicator in _SIZE_MID_INDICATORS:
        if re.search(rf"\b{re.escape(indicator)}\b", lower):
            return {
                "estimate": "200 - 1,000 employees",
                "category": "Mid-Market",
                "confidence": "low",
            }

    return {
        "estimate": "Unknown",
        "category": "Unknown",
        "confidence": "low",
    }


# ---------------------------------------------------------------------------
# Security stack inference by industry
# ---------------------------------------------------------------------------
_SECURITY_STACKS: dict[str, dict[str, Any]] = {
    "Financial Services": {
        "likely_tools": [
            "SIEM (Splunk/QRadar)",
            "EDR (CrowdStrike/Carbon Black)",
            "DLP (Symantec/Forcepoint)",
            "WAF (F5/Akamai)",
            "PAM (CyberArk)",
        ],
        "compliance_frameworks": ["PCI-DSS", "SOX", "GLBA", "FFIEC"],
        "pain_points": [
            "Alert fatigue from siloed tools",
            "Regulatory compliance overhead",
            "Third-party risk management",
        ],
    },
    "Healthcare & Life Sciences": {
        "likely_tools": [
            "EDR (CrowdStrike/SentinelOne)",
            "Email Security (Proofpoint/Mimecast)",
            "Network Segmentation (Cisco ISE)",
            "Medical Device Security",
        ],
        "compliance_frameworks": ["HIPAA", "HITECH", "FDA 21 CFR Part 11"],
        "pain_points": [
            "Medical device vulnerability management",
            "PHI data protection",
            "Legacy system security",
        ],
    },
    "Technology": {
        "likely_tools": [
            "Cloud Security (Wiz/Orca)",
            "SAST/DAST (Snyk/Veracode)",
            "CSPM (Prisma Cloud)",
            "Container Security (Aqua/Sysdig)",
            "EDR (CrowdStrike/SentinelOne)",
        ],
        "compliance_frameworks": ["SOC 2", "ISO 27001", "GDPR"],
        "pain_points": [
            "Cloud-native security gaps",
            "CI/CD pipeline security",
            "Supply chain attacks",
        ],
    },
    "Energy & Utilities": {
        "likely_tools": [
            "OT/ICS Security (Claroty/Nozomi)",
            "SIEM (Splunk)",
            "Network Detection (Darktrace)",
            "EDR (CrowdStrike)",
        ],
        "compliance_frameworks": ["NERC CIP", "IEC 62443", "NIST CSF"],
        "pain_points": [
            "IT/OT convergence risks",
            "Critical infrastructure protection",
            "Remote access for field technicians",
        ],
    },
    "Retail & E-Commerce": {
        "likely_tools": [
            "WAF (Cloudflare/Akamai)",
            "Fraud Detection",
            "EDR (Various)",
            "Email Security (Proofpoint)",
        ],
        "compliance_frameworks": ["PCI-DSS", "GDPR", "CCPA"],
        "pain_points": [
            "Payment card data protection",
            "Bot and fraud prevention",
            "Seasonal traffic security scaling",
        ],
    },
    "Manufacturing & Industrial": {
        "likely_tools": [
            "OT Security (Claroty/Nozomi)",
            "EDR (CrowdStrike/Trend Micro)",
            "Network Monitoring (Darktrace)",
        ],
        "compliance_frameworks": ["NIST CSF", "IEC 62443", "ISO 27001"],
        "pain_points": [
            "Legacy OT system exposure",
            "Supply chain integrity",
            "Ransomware targeting production",
        ],
    },
    "Telecommunications": {
        "likely_tools": [
            "SIEM (Splunk/ArcSight)",
            "DDoS Mitigation (Arbor/Cloudflare)",
            "EDR (CrowdStrike)",
            "5G Security",
        ],
        "compliance_frameworks": ["SOC 2", "ISO 27001", "GDPR", "FCC regulations"],
        "pain_points": [
            "5G infrastructure security",
            "Massive IoT device management",
            "Customer data protection at scale",
        ],
    },
    "Government & Public Sector": {
        "likely_tools": [
            "EDR (CrowdStrike/Trellix)",
            "SIEM (Splunk)",
            "Zero Trust Architecture",
            "PKI/Identity Management",
        ],
        "compliance_frameworks": ["FedRAMP", "NIST 800-53", "CMMC", "FISMA"],
        "pain_points": [
            "Zero Trust mandate compliance",
            "Legacy system modernization",
            "Nation-state threat actors",
        ],
    },
}

_DEFAULT_STACK: dict[str, Any] = {
    "likely_tools": [
        "EDR (Various)",
        "Email Security (Various)",
        "Firewall (Palo Alto/Fortinet)",
        "SIEM (Splunk/Elastic)",
    ],
    "compliance_frameworks": ["ISO 27001", "SOC 2"],
    "pain_points": [
        "Tool consolidation",
        "Visibility gaps across hybrid environments",
        "Alert fatigue",
    ],
}


def _infer_security_stack(industry: str) -> dict[str, Any]:
    """Return likely security stack based on industry vertical."""
    return _SECURITY_STACKS.get(industry, _DEFAULT_STACK)


# ---------------------------------------------------------------------------
# Case study mapping by industry
# ---------------------------------------------------------------------------
_CASE_STUDIES: dict[str, list[dict[str, str]]] = {
    "Financial Services": [
        {
            "title": "Global Bank Consolidates Security with Vision One",
            "summary": "Reduced mean time to detect from 48h to 30min by "
                       "unifying XDR across 50,000 endpoints.",
            "relevance": "Platform consolidation, SOC efficiency",
        },
        {
            "title": "Insurance Leader Stops BEC Attacks with Email Security",
            "summary": "Blocked 99.7% of phishing attempts and eliminated "
                       "business email compromise losses.",
            "relevance": "Email protection, fraud prevention",
        },
    ],
    "Healthcare & Life Sciences": [
        {
            "title": "Hospital Network Protects Patient Data with Vision One",
            "summary": "Achieved HIPAA compliance while reducing security "
                       "tool sprawl from 12 to 3 platforms.",
            "relevance": "Compliance, tool consolidation",
        },
        {
            "title": "Pharma Company Secures Research IP",
            "summary": "Prevented data exfiltration attempts targeting "
                       "clinical trial data across hybrid cloud.",
            "relevance": "Data protection, cloud security",
        },
    ],
    "Technology": [
        {
            "title": "SaaS Provider Secures Cloud-Native Infrastructure",
            "summary": "Deployed container security across 2,000+ pods with "
                       "zero production impact.",
            "relevance": "Container security, DevSecOps",
        },
        {
            "title": "Tech Firm Unifies XDR Across Multi-Cloud",
            "summary": "Single pane of glass across AWS, Azure, and GCP "
                       "with automated response playbooks.",
            "relevance": "Multi-cloud visibility, automation",
        },
    ],
    "Energy & Utilities": [
        {
            "title": "Utility Company Bridges IT/OT Security Gap",
            "summary": "Deployed Vision One across IT and OT networks, "
                       "achieving unified threat visibility.",
            "relevance": "IT/OT convergence, critical infrastructure",
        },
    ],
    "Retail & E-Commerce": [
        {
            "title": "Retailer Achieves PCI Compliance with Endpoint Security",
            "summary": "Secured 15,000 POS terminals across 800 locations "
                       "with centralized management.",
            "relevance": "PCI-DSS, endpoint protection",
        },
    ],
    "Manufacturing & Industrial": [
        {
            "title": "Manufacturer Prevents Ransomware on Production Floor",
            "summary": "Detected and contained ransomware in 4 minutes, "
                       "preventing production shutdown.",
            "relevance": "Ransomware, OT protection",
        },
    ],
    "Government & Public Sector": [
        {
            "title": "Federal Agency Implements Zero Trust with Vision One",
            "summary": "Met executive order Zero Trust mandates while "
                       "maintaining operational continuity.",
            "relevance": "Zero Trust, compliance",
        },
    ],
}

_DEFAULT_CASE_STUDIES: list[dict[str, str]] = [
    {
        "title": "Enterprise Consolidates Security with Vision One Platform",
        "summary": "Reduced security tool count by 60% while improving "
                   "detection and response capabilities.",
        "relevance": "Platform consolidation, operational efficiency",
    },
    {
        "title": "Organization Stops Advanced Threats with XDR",
        "summary": "Automated cross-layer detection and response reduced "
                   "investigation time by 80%.",
        "relevance": "XDR, threat detection",
    },
]


def _get_case_studies(industry: str) -> list[dict[str, str]]:
    """Return relevant case studies for the industry."""
    return _CASE_STUDIES.get(industry, _DEFAULT_CASE_STUDIES)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def enrich_company(company_name: str) -> dict[str, Any]:
    """Generate enrichment data for a visitor's company.

    Args:
        company_name: The company name from badge data.

    Returns:
        Dictionary with keys:
            - company_name (str)
            - industry_vertical (str)
            - estimated_company_size (dict): estimate, category, confidence
            - likely_security_stack (dict): likely_tools, compliance_frameworks,
              pain_points
            - relevant_case_studies (list[dict]): title, summary, relevance
    """
    if not company_name or not company_name.strip():
        return {
            "company_name": "",
            "industry_vertical": "Unknown",
            "estimated_company_size": {
                "estimate": "Unknown",
                "category": "Unknown",
                "confidence": "none",
            },
            "likely_security_stack": _DEFAULT_STACK,
            "relevant_case_studies": _DEFAULT_CASE_STUDIES,
        }

    company_name = company_name.strip()
    industry = _classify_industry(company_name)
    size = _estimate_size(company_name)
    stack = _infer_security_stack(industry)
    case_studies = _get_case_studies(industry)

    return {
        "company_name": company_name,
        "industry_vertical": industry,
        "estimated_company_size": size,
        "likely_security_stack": stack,
        "relevant_case_studies": case_studies,
    }


def enrich_from_session(session_data: dict) -> dict[str, Any]:
    """Extract company name from session data and enrich.

    Args:
        session_data: Session data dict (same format as report_template input).
            Expects visitor.company field.

    Returns:
        Enrichment dictionary (same as enrich_company output).
    """
    visitor = session_data.get("visitor", {})
    company = visitor.get("company", "")
    return enrich_company(company)


def enrich_to_json(session_data: dict, output_path: str) -> dict[str, Any]:
    """Enrich company data and write to JSON file.

    Args:
        session_data: Session data dict.
        output_path: Path to write enrichment.json.

    Returns:
        Enrichment dictionary.
    """
    result = enrich_from_session(session_data)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    return result
