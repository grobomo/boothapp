"""Tests for the HTML report renderer in engines/prompts.py."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from analysis.engines.prompts import (
    render_html_report,
    _esc,
    _score_color,
    _score_summary,
    _gauge_dasharray,
    _build_product_tags,
    _build_timeline,
    _build_interests_rows,
    _build_followup_cards,
)

SAMPLE_SUMMARY = {
    "session_id": "TEST-001",
    "visitor_name": "Jane Doe",
    "se_name": "Casey M",
    "demo_duration_minutes": 17,
    "session_score": 8,
    "executive_summary": "Strong interest in endpoint security.",
    "products_shown": ["Endpoint Security", "XDR"],
    "visitor_interests": [
        {"topic": "BYOD", "confidence": "high", "evidence": "Asked 3 questions"},
        {"topic": "XDR", "confidence": "medium", "evidence": "Explored workbench"},
    ],
    "recommended_follow_up": ["Send POC guide", "Schedule deep-dive"],
    "key_moments": [
        {"timestamp": "02:30", "description": "Asked about BYOD", "impact": "Key concern"},
    ],
    "v1_tenant_link": "https://portal.xdr.trendmicro.com/test",
    "generated_at": "2026-08-06T10:35:00Z",
}

SAMPLE_FOLLOW_UP = {
    "priority": "high",
    "sdr_notes": "CISO, 5000 endpoints, comparing CrowdStrike.",
    "tags": ["byod", "xdr"],
}

SAMPLE_FACTUAL = {
    "features_demonstrated": [
        {"feature": "BYOD Policy", "timestamp_rel": "01:02", "evidence": "Navigated to EP"},
    ],
    "session_stats": {"duration_seconds": 1020, "click_count": 10, "transcript_entries": 20},
}


class TestEscapeHtml(unittest.TestCase):
    def test_escapes_angle_brackets(self):
        self.assertEqual(_esc("<b>bold</b>"), "&lt;b&gt;bold&lt;/b&gt;")

    def test_escapes_ampersand(self):
        self.assertEqual(_esc("A & B"), "A &amp; B")

    def test_none_returns_empty(self):
        self.assertEqual(_esc(None), "")


class TestScoreColor(unittest.TestCase):
    def test_high_score_green(self):
        self.assertEqual(_score_color(8), "#4ade80")
        self.assertEqual(_score_color(10), "#4ade80")

    def test_medium_score_yellow(self):
        self.assertEqual(_score_color(6), "#fbbf24")
        self.assertEqual(_score_color(7), "#fbbf24")

    def test_low_score_orange(self):
        self.assertEqual(_score_color(4), "#fb923c")

    def test_very_low_score_red(self):
        self.assertEqual(_score_color(1), "#f87171")
        self.assertEqual(_score_color(0), "#f87171")


class TestGaugeDasharray(unittest.TestCase):
    def test_full_score(self):
        da = _gauge_dasharray(10)
        parts = da.split()
        self.assertEqual(len(parts), 2)
        self.assertAlmostEqual(float(parts[0]), float(parts[1]), delta=0.5)

    def test_zero_score(self):
        da = _gauge_dasharray(0)
        self.assertTrue(da.startswith("0.0"))

    def test_half_score(self):
        da = _gauge_dasharray(5)
        parts = da.split()
        self.assertAlmostEqual(float(parts[0]), float(parts[1]) / 2, delta=0.5)


class TestBuildProductTags(unittest.TestCase):
    def test_renders_tags(self):
        html = _build_product_tags(["XDR", "EP"])
        self.assertIn("tag-0", html)
        self.assertIn("XDR", html)
        self.assertIn("EP", html)

    def test_empty_products(self):
        html = _build_product_tags([])
        self.assertIn("No products", html)

    def test_none_products(self):
        html = _build_product_tags(None)
        self.assertIn("No products", html)


class TestBuildTimeline(unittest.TestCase):
    def test_key_moments(self):
        moments = [{"timestamp": "02:30", "description": "Asked Q", "impact": "Important"}]
        html = _build_timeline(moments, [])
        self.assertIn("KEY", html)
        self.assertIn("Asked Q", html)
        self.assertIn("Important", html)

    def test_features(self):
        features = [{"feature": "BYOD", "timestamp_rel": "01:00"}]
        html = _build_timeline([], features)
        self.assertIn("DEMO", html)
        self.assertIn("BYOD", html)

    def test_empty(self):
        html = _build_timeline([], [])
        self.assertIn("No timeline", html)


class TestBuildInterestsRows(unittest.TestCase):
    def test_renders_rows(self):
        interests = [{"topic": "BYOD", "confidence": "high", "evidence": "Asked"}]
        html = _build_interests_rows(interests)
        self.assertIn("conf-high", html)
        self.assertIn("BYOD", html)

    def test_empty(self):
        html = _build_interests_rows([])
        self.assertIn("No interests", html)


class TestBuildFollowupCards(unittest.TestCase):
    def test_renders_cards(self):
        html = _build_followup_cards(["Do X", "Do Y"], "high")
        self.assertIn("fu-card", html)
        self.assertIn("Do X", html)
        self.assertIn("p-high", html)

    def test_priority_on_first_only(self):
        html = _build_followup_cards(["A", "B"], "high")
        self.assertEqual(html.count("fu-priority"), 1)

    def test_empty(self):
        html = _build_followup_cards([], "medium")
        self.assertIn("No follow-up", html)


class TestRenderHtmlReport(unittest.TestCase):
    def setUp(self):
        self.html = render_html_report(SAMPLE_SUMMARY, SAMPLE_FOLLOW_UP, SAMPLE_FACTUAL)

    def test_contains_visitor_name(self):
        self.assertIn("Jane Doe", self.html)

    def test_contains_session_id(self):
        self.assertIn("TEST-001", self.html)

    def test_contains_gauge(self):
        self.assertIn("gauge-fill", self.html)
        self.assertIn(">8</span>", self.html)

    def test_contains_timeline(self):
        self.assertIn("tl-item", self.html)

    def test_contains_product_tags(self):
        self.assertIn("Endpoint Security", self.html)

    def test_contains_interests(self):
        self.assertIn("conf-high", self.html)

    def test_contains_followup(self):
        self.assertIn("fu-card", self.html)

    def test_contains_sdr_notes(self):
        self.assertIn("CrowdStrike", self.html)

    def test_contains_tenant_link(self):
        self.assertIn("portal.xdr.trendmicro.com/test", self.html)

    def test_no_unresolved_placeholders(self):
        # Check none of our template keys remain
        for key in ["visitor_name", "session_id", "score_color", "score_dasharray"]:
            self.assertNotIn("{" + key + "}", self.html)

    def test_dark_theme(self):
        self.assertIn("#0b1120", self.html)

    def test_responsive(self):
        self.assertIn("@media", self.html)

    def test_xss_escaped(self):
        xss_summary = dict(SAMPLE_SUMMARY, visitor_name="<script>alert(1)</script>")
        html = render_html_report(xss_summary, SAMPLE_FOLLOW_UP)
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_minimal_data(self):
        html = render_html_report({"visitor_name": "Min"}, {})
        self.assertIn("Min", html)
        self.assertIn("No products", html)

    def test_valid_html_structure(self):
        self.assertTrue(self.html.startswith("<!DOCTYPE html>"))
        self.assertIn("</html>", self.html)


if __name__ == "__main__":
    unittest.main()
