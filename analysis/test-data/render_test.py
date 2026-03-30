#!/usr/bin/env python3
"""Test the HTML report renderer with sample data (no API calls needed)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engines.prompts import render_html_report

# Simulated summary.json (what the analyzer would produce)
summary = {
    "session_id": "B291047",
    "visitor_name": "Priya Sharma",
    "demo_duration_minutes": 17,
    "session_score": 8,
    "executive_summary": "Priya showed strong interest in BYOD containerization and automated risk response for her 3,500-endpoint financial firm. Schedule a POC scoping call within the week to capitalize on competitive evaluation against CrowdStrike.",
    "products_shown": ["Endpoint Security", "XDR", "Risk Insights"],
    "visitor_interests": [
        {"topic": "BYOD Container Policy", "confidence": "high", "evidence": "Asked 3 detailed questions about MDM-free enrollment and platform-specific policies"},
        {"topic": "Automated Risk Remediation", "confidence": "high", "evidence": "Said 'That automated response is what we need' after seeing workflow demo"},
        {"topic": "XDR Correlation Speed", "confidence": "medium", "evidence": "Compared 20-min SIEM correlation to V1's sub-2-minute detection"},
        {"topic": "Splunk Integration", "confidence": "medium", "evidence": "Asked specifically about native Splunk app and API push"},
        {"topic": "EU Data Residency", "confidence": "low", "evidence": "Brief question about regulatory requirements at end of session"},
    ],
    "recommended_follow_up": [
        "Send BYOD container deployment guide with iOS/Android comparison matrix",
        "Schedule POC scoping call for 3,500-endpoint environment within 5 business days",
        "Provide competitive comparison: V1 BYOD vs CrowdStrike Falcon Go mobile coverage",
        "Share EU data residency documentation and DPA template",
        "Connect with Splunk integration team for pre-POC architecture review",
    ],
    "key_moments": [
        {"timestamp": "01:20", "screenshot": "click-003.jpg", "description": "Visitor asked if BYOD requires full MDM — key differentiator moment", "impact": "Previous MobileIron pushback makes lightweight container a strong selling point"},
        {"timestamp": "04:35", "screenshot": "click-006.jpg", "description": "Visitor compared V1 correlation speed to their 20-minute SIEM", "impact": "Direct pain point — current tooling too slow for incident response"},
        {"timestamp": "09:05", "screenshot": "click-009.jpg", "description": "Visitor called automated remediation 'what we need'", "impact": "Strong buying signal — manual process taking hours today"},
    ],
    "v1_tenant_link": "https://portal.xdr.trendmicro.com/tenants/demo-B291047",
    "generated_at": "2026-08-06T10:35:00Z",
    "se_name": "Casey Mondoux",
}

# Simulated follow-up.json
follow_up = {
    "session_id": "B291047",
    "visitor_email": "priya.sharma@example.com",
    "subject": "Your Vision One Demo Summary",
    "summary_url": "https://boothapp.trendmicro.com/sessions/B291047/summary.html",
    "tenant_url": "https://portal.xdr.trendmicro.com/tenants/demo-B291047",
    "priority": "high",
    "tags": ["byod", "xdr", "risk", "endpoint"],
    "sdr_notes": "Priya Sharma is evaluating endpoint security for a mid-size financial firm (3,500 endpoints). Primary pain point is BYOD management — previous MobileIron deployment failed due to employee pushback. Currently comparing V1 against CrowdStrike Falcon Go. Strong interest in automated risk remediation (manual process taking hours). EU data residency is a regulatory requirement. Requested POC information. Urgency: active evaluation cycle.",
}

# Simulated factual extraction (for timeline enrichment)
factual = {
    "products_shown": ["Endpoint Security", "XDR", "Risk Insights"],
    "features_demonstrated": [
        {"feature": "BYOD Policy Configuration", "timestamp_rel": "01:02", "evidence": "Navigated to Endpoint Security > BYOD Policy panel"},
        {"feature": "Device Enrollment Settings", "timestamp_rel": "02:44", "evidence": "Clicked Device Enrollment Settings button, showed PIN and OS requirements"},
        {"feature": "XDR Workbench", "timestamp_rel": "05:12", "evidence": "Opened Workbench, showed Suspicious PowerShell Execution alert"},
        {"feature": "Attack Chain Visualization", "timestamp_rel": "05:45", "evidence": "Demonstrated lateral movement and process spawn visualization"},
        {"feature": "BYOD Device Exposure", "timestamp_rel": "09:18", "evidence": "Showed Risk Insights tile with 47 elevated-risk devices"},
        {"feature": "Automated Remediation Workflow", "timestamp_rel": "11:05", "evidence": "Demonstrated threshold-based container quarantine with notifications"},
    ],
    "session_stats": {
        "duration_seconds": 1020,
        "click_count": 10,
        "transcript_entries": 20,
    },
}

html = render_html_report(summary, follow_up, factual)

out_dir = os.path.join(os.path.dirname(__file__), "sample-session", "output")
os.makedirs(out_dir, exist_ok=True)

# Write JSON files too (for completeness)
with open(os.path.join(out_dir, "summary.json"), "w") as f:
    json.dump(summary, f, indent=2)
with open(os.path.join(out_dir, "follow-up.json"), "w") as f:
    json.dump(follow_up, f, indent=2)

html_path = os.path.join(out_dir, "summary.html")
with open(html_path, "w") as f:
    f.write(html)

print(f"HTML report: {len(html)} bytes")
print(f"Written to: {html_path}")
print(f"Sections: gauge, timeline ({len(factual['features_demonstrated'])} features + {len(summary['key_moments'])} key moments), {len(summary['products_shown'])} product tags, {len(summary['visitor_interests'])} interests, {len(summary['recommended_follow_up'])} follow-ups")
print("OK")
