"""Tests for demo script generator engine."""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engines.demo_script import (
    build_demo_script,
    render_demo_script_md,
    generate_demo_script,
    _detect_industry,
    _extract_concerns,
    _rank_modules,
    _build_objection_handlers,
)


def _make_session_dir(metadata=None, transcript=None, summary=None,
                      follow_up=None, competitive=None):
    """Create a temporary session directory with test data."""
    tmpdir = tempfile.mkdtemp()
    if metadata:
        with open(os.path.join(tmpdir, "metadata.json"), "w") as f:
            json.dump(metadata, f)
    if transcript:
        os.makedirs(os.path.join(tmpdir, "transcript"), exist_ok=True)
        with open(os.path.join(tmpdir, "transcript", "transcript.json"), "w") as f:
            json.dump(transcript, f)
    output_dir = os.path.join(tmpdir, "output")
    os.makedirs(output_dir, exist_ok=True)
    if summary:
        with open(os.path.join(output_dir, "summary.json"), "w") as f:
            json.dump(summary, f)
    if follow_up:
        with open(os.path.join(output_dir, "follow-up.json"), "w") as f:
            json.dump(follow_up, f)
    if competitive:
        with open(os.path.join(output_dir, "competitive-insights.json"), "w") as f:
            json.dump(competitive, f)
    return tmpdir


SAMPLE_METADATA = {
    "session_id": "TEST-001",
    "visitor_name": "Jane Doe",
    "visitor_company": "Acme Financial",
    "se_name": "Casey Mondoux",
    "started_at": "2026-08-06T10:15:00Z",
    "ended_at": "2026-08-06T10:32:00Z",
}

SAMPLE_TRANSCRIPT = {
    "entries": [
        {"timestamp": "00:00:05", "speaker": "SE", "text": "Welcome to the Trend Micro booth."},
        {"timestamp": "00:00:15", "speaker": "Visitor", "text": "We're a mid-size financial firm with 3500 endpoints. BYOD is our biggest challenge."},
        {"timestamp": "00:00:30", "speaker": "SE", "text": "Let me show you Endpoint Security."},
        {"timestamp": "00:01:00", "speaker": "Visitor", "text": "We looked at CrowdStrike but found mobile coverage limited."},
        {"timestamp": "00:01:30", "speaker": "Visitor", "text": "Does this require installing a full MDM agent? Our employees pushed back on that."},
        {"timestamp": "00:02:00", "speaker": "Visitor", "text": "What about the cost compared to our current solution?"},
    ]
}

SAMPLE_SUMMARY = {
    "session_id": "TEST-001",
    "visitor_name": "Jane Doe",
    "session_score": 8,
    "executive_summary": "Strong engagement from a financial services prospect focused on BYOD endpoint security.",
    "products_demonstrated": ["Endpoint Security", "XDR"],
    "key_interests": [
        {"topic": "Endpoint Security", "confidence": "high", "evidence": "Asked multiple BYOD questions"},
        {"topic": "XDR", "confidence": "medium", "evidence": "Engaged during cross-layer demo"},
    ],
    "follow_up_actions": ["Schedule POC with BYOD focus", "Send mobile security datasheet"],
}

SAMPLE_COMPETITIVE = {
    "total_mentions": 1,
    "competitors_detected": ["CrowdStrike"],
    "mentions": [
        {
            "competitor": "CrowdStrike",
            "speaker": "Visitor",
            "passage": "We looked at CrowdStrike but found mobile coverage limited.",
            "timestamp": "00:01:00",
            "concern": "Feature comparison",
            "counter_positioning": "Vision One provides native XDR across email, endpoints, servers, cloud, and network.",
        }
    ],
}


def test_detect_industry_from_metadata():
    metadata = {"company_industry": "Healthcare"}
    result = _detect_industry(metadata, [], {})
    assert result == "healthcare"


def test_detect_industry_from_transcript():
    entries = [{"text": "We're a mid-size financial firm with 3500 endpoints."}]
    result = _detect_industry({}, entries, {})
    assert result == "financial"


def test_detect_industry_from_keywords():
    entries = [{"text": "Our hospital network has 200 beds and we need HIPAA compliance."}]
    result = _detect_industry({}, entries, {})
    assert result == "healthcare"


def test_detect_industry_general_fallback():
    result = _detect_industry({}, [], {})
    assert result == "general"


def test_extract_concerns_from_transcript():
    entries = [
        {"speaker": "Visitor", "text": "What about the cost?", "timestamp": "00:01:00"},
        {"speaker": "SE", "text": "Great question.", "timestamp": "00:01:05"},
        {"speaker": "Visitor", "text": "Does it integrate with Splunk?", "timestamp": "00:02:00"},
    ]
    concerns = _extract_concerns(entries, None)
    assert len(concerns) == 2
    assert all(c["type"] == "visitor_question" for c in concerns)


def test_extract_concerns_ignores_se():
    entries = [
        {"speaker": "SE", "text": "What about the cost?", "timestamp": "00:01:00"},
    ]
    concerns = _extract_concerns(entries, None)
    assert len(concerns) == 0


def test_extract_concerns_from_competitive():
    competitive = {
        "mentions": [{
            "competitor": "CrowdStrike",
            "speaker": "Visitor",
            "passage": "We use CrowdStrike.",
            "timestamp": "00:01:00",
            "counter_positioning": "Vision One is better.",
        }]
    }
    concerns = _extract_concerns([], competitive)
    assert len(concerns) == 1
    assert concerns[0]["type"] == "competitive_mention"


def test_rank_modules():
    summary = {
        "products_demonstrated": ["Endpoint Security", "XDR"],
        "key_interests": [
            {"topic": "Endpoint Security", "confidence": "high"},
            {"topic": "XDR", "confidence": "medium"},
        ],
        "session_score": 7,
    }
    ranked = _rank_modules(summary, [])
    assert len(ranked) >= 2
    # Endpoint Security should rank higher (product + high interest)
    modules = [m for m, s in ranked]
    assert modules[0] == "Endpoint Security"


def test_build_objection_handlers_competitive():
    concerns = [{
        "type": "competitive_mention",
        "competitor": "CrowdStrike",
        "text": "We use CrowdStrike.",
        "counter": "Vision One is broader.",
        "timestamp": "00:01:00",
    }]
    handlers = _build_objection_handlers(concerns, None)
    assert len(handlers) == 1
    assert "CrowdStrike" in handlers[0]["objection"]


def test_build_objection_handlers_pricing():
    concerns = [{
        "type": "visitor_question",
        "text": "What about the cost compared to CrowdStrike?",
        "timestamp": "00:01:00",
    }]
    handlers = _build_objection_handlers(concerns, None)
    assert len(handlers) == 1
    assert "Pricing" in handlers[0]["objection"]


def test_build_objection_handlers_dedup():
    concerns = [
        {"type": "visitor_question", "text": "How much does it cost?", "timestamp": "00:01:00"},
        {"type": "visitor_question", "text": "What's the price per endpoint?", "timestamp": "00:02:00"},
    ]
    handlers = _build_objection_handlers(concerns, None)
    assert len(handlers) == 1  # Deduped to one pricing objection


def test_build_demo_script_full():
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        transcript=SAMPLE_TRANSCRIPT,
        summary=SAMPLE_SUMMARY,
        competitive=SAMPLE_COMPETITIVE,
    )
    script = build_demo_script(session_dir)
    assert script["session_id"] == "TEST-001"
    assert script["visitor_name"] == "Jane Doe"
    assert script["industry"] == "financial"
    assert len(script["ranked_modules"]) >= 1
    assert len(script["discovery_questions"]) >= 1
    assert script["closing"]["approach"] == "Direct trial close"  # score=8


def test_build_demo_script_low_score():
    summary = dict(SAMPLE_SUMMARY)
    summary["session_score"] = 3
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        summary=summary,
    )
    script = build_demo_script(session_dir)
    assert script["closing"]["approach"] == "Content nurture close"


def test_build_demo_script_medium_score():
    summary = dict(SAMPLE_SUMMARY)
    summary["session_score"] = 5
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        summary=summary,
    )
    script = build_demo_script(session_dir)
    assert script["closing"]["approach"] == "Technical deep-dive close"


def test_render_demo_script_md():
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        transcript=SAMPLE_TRANSCRIPT,
        summary=SAMPLE_SUMMARY,
        competitive=SAMPLE_COMPETITIVE,
    )
    script = build_demo_script(session_dir)
    md = render_demo_script_md(script)
    assert "# Recommended Demo Script" in md
    assert "TEST-001" in md
    assert "Jane Doe" in md
    assert "Financial" in md
    assert "Opening Talking Points" in md
    assert "Recommended Demo Flow" in md
    assert "Discovery Questions" in md
    assert "Objection Handling" in md
    assert "Closing Approach" in md
    assert "Endpoint Security" in md


def test_generate_demo_script_writes_file():
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        transcript=SAMPLE_TRANSCRIPT,
        summary=SAMPLE_SUMMARY,
    )
    md = generate_demo_script(session_dir)
    output_path = os.path.join(session_dir, "output", "recommended-demo-script.md")
    assert os.path.exists(output_path)
    with open(output_path) as f:
        content = f.read()
    assert content == md
    assert "# Recommended Demo Script" in content


def test_generate_demo_script_custom_output():
    session_dir = _make_session_dir(
        metadata=SAMPLE_METADATA,
        summary=SAMPLE_SUMMARY,
    )
    tmpdir = tempfile.mkdtemp()
    output_path = os.path.join(tmpdir, "custom-script.md")
    md = generate_demo_script(session_dir, output_path=output_path)
    assert os.path.exists(output_path)
    assert "# Recommended Demo Script" in md


def test_empty_session_dir():
    session_dir = _make_session_dir()
    script = build_demo_script(session_dir)
    assert script["session_id"] == "unknown"
    assert script["industry"] == "general"
    md = render_demo_script_md(script)
    assert "# Recommended Demo Script" in md
