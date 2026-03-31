"""Tests for analysis.engines.email_drafter."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.email_drafter import (
    draft_email,
    generate_email_html,
    generate_email_text,
    _first_name,
    _match_resources,
    _build_next_steps,
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
            "note": "Running Kubernetes in AWS EKS, interested in runtime protection",
        },
        {
            "name": "Zero Trust Secure Access",
            "timestamp": "14:18",
            "note": "Currently evaluating ZTNA solutions for remote workforce",
        },
        {
            "name": "Email Security",
            "timestamp": "14:24",
            "note": "Recent BEC incidents, wants AI-powered detection",
        },
    ],
    "interests": [
        {
            "topic": "XDR / SOC Modernization",
            "confidence": "high",
            "detail": "Primary driver",
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
            "detail": "Reactive interest after recent BEC incident",
        },
    ],
    "recommendations": [
        {"action": "Schedule technical deep-dive on Vision One XDR", "priority": "high"},
        {"action": "Send Cloud Security container protection datasheet", "priority": "high"},
        {"action": "Connect with ZTNA SE for proof-of-concept", "priority": "medium"},
        {"action": "Share BEC case study and Email Security ROI calculator", "priority": "medium"},
        {"action": "Follow up in 2 weeks with consolidated proposal", "priority": "high"},
        {"action": "Add to Vision One webinar invite list", "priority": "low"},
    ],
}

SE_CONTACT = {
    "name": "Alex Rivera",
    "title": "Senior Solutions Engineer",
    "email": "arivera@trendmicro.example.com",
    "phone": "+1 (555) 123-4567",
}


# =========================================================================
# HTML generation
# =========================================================================

class TestGenerateEmailHtml(unittest.TestCase):

    def setUp(self):
        self.html = generate_email_html(SAMPLE_DATA, se_contact=SE_CONTACT)

    def test_returns_string(self):
        self.assertIsInstance(self.html, str)

    def test_valid_html_document(self):
        self.assertIn("<!DOCTYPE html>", self.html)
        self.assertIn("<html", self.html)
        self.assertIn("</html>", self.html)

    def test_has_style_block(self):
        self.assertIn("<style>", self.html)

    def test_header_branding(self):
        self.assertIn("Trend Micro", self.html)
        self.assertIn("Vision One", self.html)

    def test_brand_colors_present(self):
        self.assertIn("#D71920", self.html)
        self.assertIn("#1A1A2E", self.html)

    def test_logo_present(self):
        self.assertIn("V1", self.html)

    def test_addresses_by_first_name(self):
        self.assertIn("Hi Sarah,", self.html)

    def test_greeting_present(self):
        self.assertIn("connecting with you", self.html)

    def test_products_listed(self):
        self.assertIn("Vision One XDR", self.html)
        self.assertIn("Cloud Security", self.html)
        self.assertIn("Zero Trust", self.html)
        self.assertIn("Email Security", self.html)

    def test_product_notes_included(self):
        self.assertIn("SOC integration", self.html)
        self.assertIn("Kubernetes", self.html)

    def test_what_we_covered_label(self):
        self.assertIn("What We Covered", self.html)

    def test_next_steps_present(self):
        self.assertIn("Next Steps", self.html)

    def test_next_steps_from_recommendations(self):
        self.assertIn("Schedule technical deep-dive", self.html)

    def test_next_steps_capped_at_five(self):
        steps_section = self.html.split("Next Steps")[1].split("section-label")[0]
        step_count = steps_section.count("<li>")
        self.assertLessEqual(step_count, 5)

    def test_resource_links_present(self):
        self.assertIn("Resources", self.html)
        self.assertIn("href=", self.html)
        self.assertIn("trendmicro.com", self.html)

    def test_xdr_resource_matched(self):
        self.assertIn("XDR Platform Overview", self.html)

    def test_cloud_resource_matched(self):
        self.assertIn("Cloud Security", self.html)

    def test_email_resource_matched(self):
        self.assertIn("Email Security", self.html)

    def test_contact_name(self):
        self.assertIn("Alex Rivera", self.html)

    def test_contact_title(self):
        self.assertIn("Senior Solutions Engineer", self.html)

    def test_contact_email(self):
        self.assertIn("arivera@trendmicro.example.com", self.html)

    def test_contact_phone(self):
        self.assertIn("+1 (555) 123-4567", self.html)

    def test_contact_mailto(self):
        self.assertIn("mailto:", self.html)

    def test_footer(self):
        self.assertIn("Securing Your Connected World", self.html)

    def test_html_escaping(self):
        xss_data = {
            "visitor": {"name": '<script>alert("xss")</script>'},
            "products_demonstrated": [
                {"name": '<img onerror="alert(1)">', "note": "normal"}
            ],
            "interests": [],
            "recommendations": [],
        }
        result = generate_email_html(xss_data)
        body = result.split("<style>")[0] + result.split("</style>")[1]
        self.assertNotIn("<script>alert", body)
        self.assertNotIn("<img onerror", body)
        self.assertIn("&lt;script&gt;", body)

    def test_empty_data(self):
        result = generate_email_html({})
        self.assertIn("<!DOCTYPE html>", result)
        self.assertIn("Hi there,", result)

    def test_default_se_contact(self):
        result = generate_email_html(SAMPLE_DATA)
        self.assertIn("Your Trend Micro SE", result)


# =========================================================================
# Plain text generation
# =========================================================================

class TestGenerateEmailText(unittest.TestCase):

    def setUp(self):
        self.text = generate_email_text(SAMPLE_DATA, se_contact=SE_CONTACT)

    def test_returns_string(self):
        self.assertIsInstance(self.text, str)

    def test_addresses_by_first_name(self):
        self.assertIn("Hi Sarah,", self.text)

    def test_intro_paragraph(self):
        self.assertIn("connecting with you", self.text)

    def test_products_section(self):
        self.assertIn("WHAT WE COVERED", self.text)
        self.assertIn("Vision One XDR", self.text)

    def test_product_notes(self):
        self.assertIn("SOC integration", self.text)

    def test_next_steps_section(self):
        self.assertIn("SUGGESTED NEXT STEPS", self.text)

    def test_numbered_steps(self):
        self.assertIn("1.", self.text)
        self.assertIn("2.", self.text)

    def test_resources_section(self):
        self.assertIn("RESOURCES", self.text)
        self.assertIn("trendmicro.com", self.text)

    def test_contact_section(self):
        self.assertIn("YOUR CONTACT", self.text)
        self.assertIn("Alex Rivera", self.text)
        self.assertIn("arivera@trendmicro.example.com", self.text)

    def test_footer(self):
        self.assertIn("Securing Your Connected World", self.text)

    def test_no_html_tags(self):
        self.assertNotIn("<div", self.text)
        self.assertNotIn("<span", self.text)
        self.assertNotIn("<style", self.text)

    def test_empty_data(self):
        result = generate_email_text({})
        self.assertIn("Hi there,", result)


# =========================================================================
# Helper functions
# =========================================================================

class TestFirstName(unittest.TestCase):

    def test_extracts_first(self):
        self.assertEqual(_first_name("Sarah Chen"), "Sarah")

    def test_single_name(self):
        self.assertEqual(_first_name("Sarah"), "Sarah")

    def test_empty_string(self):
        self.assertEqual(_first_name(""), "there")

    def test_whitespace(self):
        self.assertEqual(_first_name("   "), "there")


class TestMatchResources(unittest.TestCase):

    def test_matches_xdr(self):
        data = {"products_demonstrated": [{"name": "XDR Platform", "note": ""}], "interests": []}
        result = _match_resources(data)
        urls = [r["url"] for r in result]
        self.assertTrue(any("vision-one" in u for u in urls))

    def test_matches_email(self):
        data = {"products_demonstrated": [{"name": "Email Security", "note": "BEC"}], "interests": []}
        result = _match_resources(data)
        urls = [r["url"] for r in result]
        self.assertTrue(any("email" in u for u in urls))

    def test_no_duplicates(self):
        data = {
            "products_demonstrated": [{"name": "Zero Trust", "note": "ZTNA eval"}],
            "interests": [{"topic": "ZTSA", "detail": ""}],
        }
        result = _match_resources(data)
        urls = [r["url"] for r in result]
        self.assertEqual(len(urls), len(set(urls)))

    def test_empty_data(self):
        result = _match_resources({})
        self.assertEqual(result, [])


class TestBuildNextSteps(unittest.TestCase):

    def test_pulls_high_medium_recs(self):
        steps = _build_next_steps(SAMPLE_DATA)
        self.assertTrue(len(steps) >= 3)
        self.assertTrue(len(steps) <= 5)

    def test_caps_at_five(self):
        data = {
            "recommendations": [
                {"action": f"Step {i}", "priority": "high"} for i in range(10)
            ],
            "interests": [],
        }
        steps = _build_next_steps(data)
        self.assertEqual(len(steps), 5)

    def test_fills_from_interests(self):
        data = {
            "recommendations": [{"action": "One step", "priority": "high"}],
            "interests": [
                {"topic": "XDR", "detail": ""},
                {"topic": "Cloud", "detail": ""},
                {"topic": "Email", "detail": ""},
            ],
        }
        steps = _build_next_steps(data)
        self.assertTrue(len(steps) >= 3)

    def test_empty_data(self):
        steps = _build_next_steps({})
        self.assertEqual(steps, [])


# =========================================================================
# File output (draft_email)
# =========================================================================

class TestDraftEmail(unittest.TestCase):

    def test_creates_output_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            html_path, text_path = draft_email(SAMPLE_DATA, output_dir=tmpdir, se_contact=SE_CONTACT)
            self.assertTrue(os.path.exists(html_path))
            self.assertTrue(os.path.exists(text_path))
            self.assertTrue(html_path.endswith("draft-email.html"))
            self.assertTrue(text_path.endswith("draft-email.txt"))

    def test_html_file_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            html_path, _ = draft_email(SAMPLE_DATA, output_dir=tmpdir)
            with open(html_path, encoding="utf-8") as f:
                content = f.read()
            self.assertIn("<!DOCTYPE html>", content)
            self.assertIn("Sarah", content)

    def test_text_file_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            _, text_path = draft_email(SAMPLE_DATA, output_dir=tmpdir)
            with open(text_path, encoding="utf-8") as f:
                content = f.read()
            self.assertIn("Hi Sarah,", content)
            self.assertNotIn("<html", content)

    def test_creates_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "new", "nested")
            html_path, text_path = draft_email(SAMPLE_DATA, output_dir=subdir)
            self.assertTrue(os.path.isdir(subdir))
            self.assertTrue(os.path.exists(html_path))

    def test_default_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                html_path, text_path = draft_email(SAMPLE_DATA)
                self.assertTrue(os.path.exists(html_path))
                self.assertTrue(os.path.exists(text_path))
            finally:
                os.chdir(old_cwd)


if __name__ == "__main__":
    unittest.main()
