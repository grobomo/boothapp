"""Tests for the follow-up email template generator."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from analysis.engines.email_template import (
    render_follow_up_email,
    _esc,
    _build_product_rows,
    _build_recommendation_rows,
)

SAMPLE_SUMMARY = {
    "session_id": "TEST-001",
    "visitor_name": "Jane Doe",
    "se_name": "Casey M",
    "demo_duration_seconds": 1020,
    "session_score": 8,
    "executive_summary": "Strong interest in endpoint security. Recommend scheduling a deep-dive.",
    "products_demonstrated": ["Endpoint Security", "XDR", "Cloud Security"],
    "key_interests": [
        {"topic": "BYOD Policy", "confidence": "high", "evidence": "Asked 3 questions about BYOD"},
        {"topic": "XDR Workbench", "confidence": "medium", "evidence": "Explored workbench deeply"},
    ],
    "follow_up_actions": ["Send POC guide for endpoint", "Schedule deep-dive on XDR"],
    "key_moments": [],
    "v1_tenant_link": "https://portal.xdr.trendmicro.com/test",
    "generated_at": "2026-08-06T10:35:00Z",
}

SAMPLE_FOLLOW_UP = {
    "priority": "high",
    "tenant_url": "https://portal.xdr.trendmicro.com/test",
    "summary_url": "https://boothapp.trendmicro.com/sessions/TEST-001/summary.html",
    "sdr_notes": "CISO, 5000 endpoints.",
    "tags": ["byod", "xdr"],
}

SAMPLE_METADATA = {
    "session_id": "TEST-001",
    "visitor_name": "Jane Doe",
    "se_name": "Casey M",
    "started_at": "2026-08-06T10:00:00Z",
}


class TestEscapeHtml(unittest.TestCase):
    def test_escapes_angle_brackets(self):
        self.assertEqual(_esc("<b>bold</b>"), "&lt;b&gt;bold&lt;/b&gt;")

    def test_escapes_ampersand(self):
        self.assertEqual(_esc("A & B"), "A &amp; B")

    def test_none_returns_empty(self):
        self.assertEqual(_esc(None), "")

    def test_escapes_quotes(self):
        self.assertEqual(_esc('"hello"'), "&quot;hello&quot;")


class TestBuildProductRows(unittest.TestCase):
    def test_renders_products(self):
        html = _build_product_rows(["XDR", "Endpoint Security"])
        self.assertIn("XDR", html)
        self.assertIn("Endpoint Security", html)
        self.assertEqual(html.count("<tr>"), 2)

    def test_empty_products(self):
        self.assertEqual(_build_product_rows([]), "")

    def test_none_products(self):
        self.assertEqual(_build_product_rows(None), "")


class TestBuildRecommendationRows(unittest.TestCase):
    def test_renders_interests_and_actions(self):
        interests = [{"topic": "BYOD", "confidence": "high", "evidence": "Asked about it"}]
        actions = ["Send guide"]
        html = _build_recommendation_rows(interests, actions)
        self.assertIn("BYOD", html)
        self.assertIn("Asked about it", html)
        self.assertIn("Send guide", html)

    def test_limits_to_three_each(self):
        interests = [{"topic": f"T{i}", "confidence": "low", "evidence": ""} for i in range(5)]
        actions = [f"Action {i}" for i in range(5)]
        html = _build_recommendation_rows(interests, actions)
        # 3 interests + 3 actions = 6 rows
        self.assertEqual(html.count("<tr>"), 6)

    def test_empty_both(self):
        self.assertEqual(_build_recommendation_rows([], []), "")


class TestRenderFollowUpEmail(unittest.TestCase):
    def setUp(self):
        self.html = render_follow_up_email(SAMPLE_SUMMARY, SAMPLE_FOLLOW_UP, SAMPLE_METADATA)

    def test_contains_visitor_name(self):
        self.assertIn("Jane Doe", self.html)

    def test_contains_greeting(self):
        self.assertIn("Hi Jane Doe", self.html)

    def test_contains_products(self):
        self.assertIn("Endpoint Security", self.html)
        self.assertIn("XDR", self.html)
        self.assertIn("Cloud Security", self.html)

    def test_contains_recommendations(self):
        self.assertIn("BYOD Policy", self.html)
        self.assertIn("Send POC guide", self.html)

    def test_contains_executive_summary(self):
        self.assertIn("Strong interest in endpoint security", self.html)

    def test_contains_cta(self):
        self.assertIn("Schedule a Follow-Up Meeting", self.html)
        self.assertIn("portal.xdr.trendmicro.com/test", self.html)

    def test_contains_trend_micro_branding(self):
        self.assertIn("TREND MICRO", self.html)
        self.assertIn("Vision One", self.html)

    def test_contains_se_name_in_signoff(self):
        self.assertIn("Casey M", self.html)

    def test_contains_tenant_note(self):
        self.assertIn("30 days", self.html)

    def test_valid_html_structure(self):
        self.assertTrue(self.html.startswith("<!DOCTYPE html>"))
        self.assertIn("</html>", self.html)

    def test_no_xss(self):
        xss_summary = dict(SAMPLE_SUMMARY, visitor_name="<script>alert(1)</script>")
        html = render_follow_up_email(xss_summary, SAMPLE_FOLLOW_UP)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_minimal_data(self):
        html = render_follow_up_email({"visitor_name": "Min"}, {})
        self.assertIn("Hi Min", html)
        self.assertIn("TREND MICRO", html)
        # No products section when empty
        self.assertNotIn("What We Covered", html)

    def test_fallback_visitor_name(self):
        html = render_follow_up_email({}, {})
        self.assertIn("Valued Visitor", html)

    def test_no_tenant_note_without_url(self):
        html = render_follow_up_email(SAMPLE_SUMMARY, {"priority": "medium"})
        self.assertNotIn("30 days", html)

    def test_email_table_layout(self):
        # Email clients need table-based layout
        self.assertIn('role="presentation"', self.html)
        self.assertIn("cellpadding", self.html)

    def test_mso_conditional(self):
        # Outlook compatibility
        self.assertIn("<!--[if mso]>", self.html)


if __name__ == "__main__":
    unittest.main()
