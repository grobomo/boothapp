"""Tests for analysis.engines.script_generator."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.script_generator import (
    generate_script,
    generate_script_from_files,
    _match_playbook,
    _format_elapsed,
    _interest_summary,
    _parse_time_minutes,
)


SAMPLE_DATA = {
    "report_id": "RPT-TEST-001",
    "generated_at": "2026-01-15 09:00",
    "visitor": {
        "name": "Sarah Chen",
        "title": "VP of Information Security",
        "company": "Acme Financial Corp",
        "email": "schen@acmefin.example.com",
        "industry": "Financial Services",
        "company_size": "5,000 - 10,000 employees",
        "visit_duration": "28 minutes",
    },
    "products_demonstrated": [
        {
            "name": "Vision One XDR",
            "timestamp": "14:02",
            "note": "Asked about SOC integration and SIEM correlation",
        },
        {
            "name": "Cloud Security - Container Protection",
            "timestamp": "14:10",
            "note": "Running Kubernetes in AWS EKS",
        },
        {
            "name": "Zero Trust Secure Access",
            "timestamp": "14:18",
            "note": "Evaluating ZTNA solutions for remote workforce",
        },
        {
            "name": "Email Security",
            "timestamp": "14:24",
            "note": "Recent BEC incidents",
        },
    ],
    "interests": [
        {
            "topic": "XDR / SOC Modernization",
            "confidence": "high",
            "detail": "Consolidating point products into unified platform",
        },
        {
            "topic": "Cloud Workload Security",
            "confidence": "high",
            "detail": "Active K8s deployment",
        },
        {
            "topic": "Zero Trust Network Access",
            "confidence": "medium",
            "detail": "In evaluation phase",
        },
        {
            "topic": "Email Threat Protection",
            "confidence": "medium",
            "detail": "Reactive interest after BEC incident",
        },
    ],
    "recommendations": [
        {"action": "Schedule XDR deep-dive with SOC team", "priority": "high"},
        {"action": "Send container protection datasheet", "priority": "high"},
        {"action": "Connect with ZTNA SE for PoC", "priority": "medium"},
        "Follow up in 2 weeks",
    ],
}


class TestGenerateScript(unittest.TestCase):

    def setUp(self):
        self.script = generate_script(SAMPLE_DATA)

    # -- structure --

    def test_returns_string(self):
        self.assertIsInstance(self.script, str)

    def test_has_header(self):
        self.assertIn("DEMO SCRIPT", self.script)
        self.assertIn("Trend Micro Vision One", self.script)

    def test_has_footer(self):
        self.assertIn("END OF SCRIPT", self.script)

    def test_has_visitor_profile_section(self):
        self.assertIn("VISITOR PROFILE", self.script)

    def test_has_interests_section(self):
        self.assertIn("VISITOR INTERESTS", self.script)

    def test_has_script_section(self):
        self.assertIn("SCRIPT", self.script)

    # -- visitor info --

    def test_visitor_name(self):
        self.assertIn("Sarah Chen", self.script)

    def test_visitor_title(self):
        self.assertIn("VP of Information Security", self.script)

    def test_visitor_company(self):
        self.assertIn("Acme Financial Corp", self.script)

    def test_visitor_industry(self):
        self.assertIn("Financial Services", self.script)

    def test_visitor_duration(self):
        self.assertIn("28 minutes", self.script)

    # -- timing marks --

    def test_has_opening_timing(self):
        self.assertIn("[00:00]", self.script)

    def test_product_timing_marks(self):
        # XDR at 14:02, start is 14:02, so elapsed = [00:00]
        # Cloud at 14:10, elapsed = [08:00]
        self.assertIn("[08:00]", self.script)

    def test_ztsa_timing(self):
        # ZTSA at 14:18, start 14:02, elapsed = [16:00]
        self.assertIn("[16:00]", self.script)

    def test_email_timing(self):
        # Email at 14:24, start 14:02, elapsed = [22:00]
        self.assertIn("[22:00]", self.script)

    def test_closing_timing(self):
        self.assertIn("CLOSING", self.script)

    # -- talking points --

    def test_xdr_talking_points(self):
        self.assertIn("alert fatigue", self.script)

    def test_cloud_talking_points(self):
        self.assertIn("Runtime protection", self.script)

    def test_ztsa_talking_points(self):
        self.assertIn("legacy VPN", self.script)

    def test_email_talking_points(self):
        self.assertIn("BEC detection", self.script)

    # -- questions --

    def test_opening_discovery_questions(self):
        self.assertIn("security challenges", self.script)

    def test_xdr_questions(self):
        self.assertIn("correlating alerts", self.script)

    def test_cloud_questions(self):
        self.assertIn("cloud providers", self.script)

    def test_closing_questions(self):
        self.assertIn("proof of concept", self.script)

    # -- context from original session --

    def test_session_context_notes(self):
        self.assertIn("SOC integration and SIEM correlation", self.script)
        self.assertIn("Kubernetes in AWS EKS", self.script)

    # -- transitions --

    def test_transition_hints(self):
        self.assertIn("TRANSITION", self.script)
        self.assertIn("ties nicely into", self.script)

    # -- interest summary --

    def test_interest_tldr(self):
        self.assertIn("TL;DR:", self.script)
        self.assertIn("Primary interests:", self.script)

    def test_interest_confidence_markers(self):
        self.assertIn("***", self.script)  # high
        self.assertIn("** ", self.script)  # medium

    # -- follow-up --

    def test_follow_up_section(self):
        self.assertIn("POST-DEMO FOLLOW-UP", self.script)

    def test_follow_up_actions(self):
        self.assertIn("Schedule XDR deep-dive", self.script)
        self.assertIn("Follow up in 2 weeks", self.script)

    def test_follow_up_priority_tags(self):
        self.assertIn("[HIGH]", self.script)
        self.assertIn("[MEDIUM]", self.script)

    # -- product names in caps --

    def test_product_section_headers(self):
        self.assertIn("VISION ONE XDR", self.script)
        self.assertIn("CLOUD SECURITY", self.script)
        self.assertIn("ZERO TRUST SECURE ACCESS", self.script)
        self.assertIn("EMAIL SECURITY", self.script)


class TestGenerateScriptEdgeCases(unittest.TestCase):

    def test_empty_data(self):
        script = generate_script({})
        self.assertIn("DEMO SCRIPT", script)
        self.assertIn("END OF SCRIPT", script)

    def test_minimal_visitor(self):
        script = generate_script({"visitor": {"name": "Test User"}})
        self.assertIn("Test User", script)

    def test_no_products(self):
        script = generate_script({"visitor": {"name": "X"}, "interests": []})
        self.assertIn("CLOSING", script)

    def test_no_recommendations(self):
        script = generate_script({"visitor": {"name": "X"}})
        self.assertNotIn("POST-DEMO FOLLOW-UP", script)

    def test_timeline_overrides_products(self):
        summary = {**SAMPLE_DATA, "products_demonstrated": []}
        timeline = [
            {"name": "Custom Product", "timestamp": "10:00", "note": "Custom note"}
        ]
        script = generate_script(summary, timeline)
        self.assertIn("CUSTOM PRODUCT", script)
        self.assertIn("Custom note", script)

    def test_product_without_timestamp(self):
        data = {
            "products_demonstrated": [
                {"name": "Some Product", "note": "A note"},
            ],
        }
        script = generate_script(data)
        self.assertIn("SOME PRODUCT", script)
        # Should fallback to index-based timing
        self.assertIn("[05:00]", script)

    def test_plain_string_recommendation(self):
        data = {"recommendations": ["Do this thing"]}
        script = generate_script(data)
        self.assertIn("Do this thing", script)


class TestHelpers(unittest.TestCase):

    def test_match_playbook_xdr(self):
        pb = _match_playbook("Vision One XDR")
        self.assertIn("alert fatigue", pb["talking_points"][1])

    def test_match_playbook_cloud(self):
        pb = _match_playbook("Cloud Security - Container Protection")
        self.assertIn("Runtime protection", pb["talking_points"][0])

    def test_match_playbook_unknown(self):
        pb = _match_playbook("Unknown Fancy Product")
        self.assertIn("Vision One platform", pb["talking_points"][0])

    def test_match_playbook_keyword(self):
        pb = _match_playbook("Container K8s Protection")
        # Should match Cloud Security via 'k8s' keyword
        self.assertIn("Runtime protection", pb["talking_points"][0])

    def test_parse_time_minutes(self):
        self.assertEqual(_parse_time_minutes("14:02"), 842)
        self.assertEqual(_parse_time_minutes("00:00"), 0)
        self.assertEqual(_parse_time_minutes("bad"), 0)

    def test_format_elapsed(self):
        self.assertEqual(_format_elapsed(842, 850), "[08:00]")
        self.assertEqual(_format_elapsed(100, 100), "[00:00]")
        self.assertEqual(_format_elapsed(100, 90), "[00:00]")  # negative clamped

    def test_interest_summary_high_and_medium(self):
        interests = [
            {"topic": "XDR", "confidence": "high"},
            {"topic": "ZTNA", "confidence": "medium"},
        ]
        result = _interest_summary(interests)
        self.assertIn("Primary interests: XDR", result)
        self.assertIn("Secondary interests: ZTNA", result)

    def test_interest_summary_empty(self):
        result = _interest_summary([])
        self.assertIn("No specific interests", result)


class TestGenerateScriptFromFiles(unittest.TestCase):

    def test_load_and_generate(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(SAMPLE_DATA, f)
            summary_path = f.name
        try:
            result = generate_script_from_files(summary_path)
            self.assertIn("Sarah Chen", result)
            self.assertIn("DEMO SCRIPT", result)
        finally:
            os.unlink(summary_path)

    def test_with_timeline_file(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(SAMPLE_DATA, f)
            summary_path = f.name

        timeline = [
            {"name": "Timeline Product", "timestamp": "10:00", "note": "From timeline"}
        ]
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(timeline, f)
            timeline_path = f.name

        try:
            result = generate_script_from_files(summary_path, timeline_path)
            self.assertIn("TIMELINE PRODUCT", result)
            self.assertIn("From timeline", result)
        finally:
            os.unlink(summary_path)
            os.unlink(timeline_path)

    def test_write_output_file(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(SAMPLE_DATA, f)
            summary_path = f.name

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "output", "demo-script.txt")
            result = generate_script_from_files(
                summary_path, output_path=output_path
            )
            self.assertTrue(os.path.exists(output_path))
            with open(output_path, "r") as f:
                content = f.read()
            self.assertEqual(content, result)

        os.unlink(summary_path)

    def test_nonexistent_timeline_ignored(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(SAMPLE_DATA, f)
            summary_path = f.name
        try:
            result = generate_script_from_files(
                summary_path, "/nonexistent/timeline.json"
            )
            self.assertIn("VISION ONE XDR", result)
        finally:
            os.unlink(summary_path)


if __name__ == "__main__":
    unittest.main()
