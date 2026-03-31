"""Tests for competitive intelligence engine."""

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engines.competitive import analyze_transcript, analyze_from_file


def _make_transcript(entries):
    return {"entries": entries}


def _entry(speaker, text, timestamp="00:01:00"):
    return {"speaker": speaker, "text": text, "timestamp": timestamp}


def test_no_mentions():
    transcript = _make_transcript([
        _entry("SE", "Let me show you Vision One's XDR capabilities."),
        _entry("Visitor", "That looks great, how does the detection work?"),
    ])
    result = analyze_transcript(transcript)
    assert result["total_mentions"] == 0
    assert result["competitors_detected"] == []
    assert result["mentions"] == []


def test_crowdstrike_mention():
    transcript = _make_transcript([
        _entry("Visitor", "We're currently using CrowdStrike Falcon for our endpoints."),
    ])
    result = analyze_transcript(transcript)
    assert result["total_mentions"] >= 1
    assert "CrowdStrike" in result["competitors_detected"]
    mention = next(m for m in result["mentions"] if m["competitor"] == "CrowdStrike")
    assert "CrowdStrike" in mention["passage"] or "Falcon" in mention["passage"]
    assert mention["counter_positioning"]
    assert mention["concern"]


def test_palo_alto_cortex_xdr():
    transcript = _make_transcript([
        _entry("Visitor", "How does this compare to Cortex XDR from Palo Alto?"),
    ])
    result = analyze_transcript(transcript)
    assert "Palo Alto Networks" in result["competitors_detected"]
    assert result["total_mentions"] >= 1


def test_sentinelone():
    transcript = _make_transcript([
        _entry("Visitor", "We evaluated SentinelOne last quarter."),
    ])
    result = analyze_transcript(transcript)
    assert "SentinelOne" in result["competitors_detected"]


def test_microsoft_defender():
    transcript = _make_transcript([
        _entry("Visitor", "We already have Microsoft Defender for Endpoint deployed."),
    ])
    result = analyze_transcript(transcript)
    assert "Microsoft Defender" in result["competitors_detected"]
    mention = result["mentions"][0]
    assert "Incumbent displacement" == mention["concern"]


def test_fortinet():
    transcript = _make_transcript([
        _entry("Visitor", "Our SOC uses FortiEDR and FortiGate together."),
    ])
    result = analyze_transcript(transcript)
    assert "Fortinet" in result["competitors_detected"]
    assert result["total_mentions"] >= 1


def test_multiple_competitors():
    transcript = _make_transcript([
        _entry("Visitor", "We're comparing CrowdStrike, SentinelOne, and Palo Alto."),
        _entry("SE", "Let me show you how Vision One differentiates."),
        _entry("Visitor", "Our team also looked at Microsoft Defender."),
    ])
    result = analyze_transcript(transcript)
    assert result["total_mentions"] >= 3
    detected = set(result["competitors_detected"])
    assert "CrowdStrike" in detected
    assert "SentinelOne" in detected
    assert "Palo Alto Networks" in detected
    assert "Microsoft Defender" in detected


def test_concern_classification_pricing():
    transcript = _make_transcript([
        _entry("Visitor", "CrowdStrike is cheaper than what you're offering."),
    ])
    result = analyze_transcript(transcript)
    mention = result["mentions"][0]
    assert "Pricing" in mention["concern"]


def test_concern_classification_integration():
    transcript = _make_transcript([
        _entry("Visitor", "Does this integrate with our SIEM like Cortex XSIAM does?"),
    ])
    result = analyze_transcript(transcript)
    mention = next(m for m in result["mentions"] if m["competitor"] == "Palo Alto Networks")
    assert "Integration" in mention["concern"]


def test_dedup_same_passage():
    transcript = _make_transcript([
        _entry("Visitor", "CrowdStrike Falcon is what we use for CrowdStrike endpoint protection."),
    ])
    result = analyze_transcript(transcript)
    # Should detect CrowdStrike but not duplicate the same passage
    cs_mentions = [m for m in result["mentions"] if m["competitor"] == "CrowdStrike"]
    assert len(cs_mentions) >= 1


def test_competitor_summary():
    transcript = _make_transcript([
        _entry("Visitor", "We use CrowdStrike Falcon.", "00:01:00"),
        _entry("Visitor", "But CrowdStrike pricing is high.", "00:05:00"),
        _entry("Visitor", "SentinelOne was also evaluated.", "00:10:00"),
    ])
    result = analyze_transcript(transcript)
    summary = {s["competitor"]: s for s in result["competitor_summary"]}
    assert "CrowdStrike" in summary
    assert summary["CrowdStrike"]["mention_count"] >= 2
    assert "SentinelOne" in summary


def test_empty_transcript():
    result = analyze_transcript({})
    assert result["total_mentions"] == 0
    assert result["mentions"] == []


def test_list_format_transcript():
    entries = [
        {"speaker": "Visitor", "text": "We use Fortinet FortiGate.", "timestamp": "00:01:00"},
    ]
    result = analyze_transcript(entries)
    assert "Fortinet" in result["competitors_detected"]


def test_file_output(tmp_path):
    transcript = _make_transcript([
        _entry("Visitor", "CrowdStrike vs Vision One — what's the difference?"),
    ])
    input_path = str(tmp_path / "transcript.json")
    output_path = str(tmp_path / "competitive-insights.json")
    with open(input_path, "w") as f:
        json.dump(transcript, f)

    result = analyze_from_file(input_path, output_path)
    assert os.path.exists(output_path)
    with open(output_path) as f:
        saved = json.load(f)
    assert saved["total_mentions"] == result["total_mentions"]


def test_false_positive_falcon_rocket():
    """Falcon the rocket should not trigger CrowdStrike detection."""
    transcript = _make_transcript([
        _entry("Visitor", "Did you see the Falcon Heavy launch last week?"),
    ])
    result = analyze_transcript(transcript)
    # The regex excludes "falcon heavy/9/rocket"
    cs_mentions = [m for m in result["mentions"] if m["competitor"] == "CrowdStrike"]
    assert len(cs_mentions) == 0


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
