"""Tests for report_template.py HTML report generator."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from report_template import render_report, _svg_circular_progress, _esc


# -- Test data matching JS correlator output format --

SAMPLE_CORRELATOR = {
    "segments": [
        {
            "start": 0,
            "end": 30000,
            "engagement_score": "high",
            "topics": ["XDR"],
            "clicks": [{"timestamp": 5000, "url": "https://example.com/xdr"}],
            "transcript_text": "Let me show you how XDR correlates alerts across your entire environment.",
            "screenshot_urls": [],
        },
        {
            "start": 30000,
            "end": 60000,
            "engagement_score": "medium",
            "topics": ["Endpoint Security"],
            "clicks": [],
            "transcript_text": "The endpoint agent deploys silently and has minimal CPU impact.",
            "screenshot_urls": [],
        },
        {
            "start": 60000,
            "end": 90000,
            "engagement_score": "high",
            "topics": ["XDR", "ZTSA"],
            "clicks": [{"timestamp": 70000, "url": "https://example.com/ztsa"}],
            "transcript_text": "Zero Trust integrates directly with the XDR platform for continuous posture assessment.",
            "screenshot_urls": [],
        },
        {
            "start": 90000,
            "end": 120000,
            "engagement_score": "low",
            "topics": [],
            "clicks": [],
            "transcript_text": None,
            "screenshot_urls": [],
        },
    ],
    "summary": {
        "totalSegments": 4,
        "topics": ["XDR", "Endpoint Security", "ZTSA"],
        "avgEngagement": "medium",
        "scoreCounts": {"high": 2, "medium": 1, "low": 1},
    },
}

SAMPLE_VISITOR = {
    "name": "Alice Chen",
    "company": "Acme Corp",
    "email": "alice@acme.example.com",
    "role": "CISO",
}


class TestRenderReport(unittest.TestCase):
    """Integration tests for the full report."""

    def setUp(self):
        self.html = render_report(
            SAMPLE_CORRELATOR,
            visitor=SAMPLE_VISITOR,
            session_id="sess-001",
            generated_at="2026-03-31 10:00 UTC",
        )

    def test_is_complete_html_document(self):
        self.assertIn("<!DOCTYPE html>", self.html)
        self.assertIn("<html", self.html)
        self.assertIn("</html>", self.html)

    def test_no_external_dependencies(self):
        self.assertNotIn('<link rel="stylesheet"', self.html)
        self.assertNotIn("<script src=", self.html)

    def test_inline_css_present(self):
        self.assertIn("<style>", self.html)

    def test_header_branding(self):
        self.assertIn("Trend Micro", self.html)
        self.assertIn("BoothApp", self.html)
        self.assertIn("Visitor Analysis Report", self.html)

    def test_session_id_in_header(self):
        self.assertIn("sess-001", self.html)

    def test_visitor_info_card(self):
        self.assertIn("Alice Chen", self.html)
        self.assertIn("Acme Corp", self.html)
        self.assertIn("alice@acme.example.com", self.html)
        self.assertIn("CISO", self.html)

    def test_products_demonstrated_section(self):
        self.assertIn("Products Demonstrated", self.html)
        self.assertIn("XDR", self.html)
        self.assertIn("Endpoint Security", self.html)
        self.assertIn("ZTSA", self.html)

    def test_product_time_bars(self):
        self.assertIn("bar-fill", self.html)
        self.assertIn("bar-track", self.html)

    def test_key_moments_section(self):
        self.assertIn("Key Moments", self.html)
        self.assertIn("XDR correlates alerts", self.html)

    def test_engagement_score_svg(self):
        self.assertIn("<svg", self.html)
        self.assertIn("Engagement Score", self.html)
        # Medium engagement = 55%
        self.assertIn("55%", self.html)

    def test_followup_actions(self):
        self.assertIn("Recommended Follow-Up Actions", self.html)
        self.assertIn("Schedule a live XDR platform walkthrough", self.html)
        self.assertIn("Zero Trust architecture session", self.html)

    def test_transcript_accordion(self):
        self.assertIn("<details", self.html)
        self.assertIn("Full Transcript", self.html)
        self.assertIn("endpoint agent deploys", self.html)

    def test_accordion_collapsed_by_default(self):
        # <details> without 'open' attribute = collapsed
        idx = self.html.index("<details")
        tag_end = self.html.index(">", idx)
        tag = self.html[idx : tag_end + 1]
        self.assertNotIn("open", tag)

    def test_footer_metadata(self):
        self.assertIn("2026-03-31 10:00 UTC", self.html)
        self.assertIn("Segments: 4", self.html)

    def test_dark_theme(self):
        self.assertIn("linear-gradient", self.html)
        self.assertIn("#0f0c29", self.html)


class TestEmptyInput(unittest.TestCase):
    """Edge case: empty/missing correlator data."""

    def test_empty_correlator(self):
        html = render_report({})
        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("No product topics detected", html)

    def test_none_correlator(self):
        html = render_report(None)
        self.assertIn("<!DOCTYPE html>", html)

    def test_no_visitor(self):
        html = render_report(SAMPLE_CORRELATOR)
        self.assertIn("Anonymous", html)


class TestSvgGauge(unittest.TestCase):
    """Unit tests for the SVG circular progress."""

    def test_svg_has_circles(self):
        svg = _svg_circular_progress(75, "#00BFA6")
        self.assertIn("<svg", svg)
        self.assertIn("<circle", svg)
        self.assertIn("75%", svg)

    def test_zero_percent(self):
        svg = _svg_circular_progress(0, "#888")
        self.assertIn("0%", svg)

    def test_hundred_percent(self):
        svg = _svg_circular_progress(100, "#fff")
        self.assertIn("100%", svg)


class TestEscaping(unittest.TestCase):
    """Ensure HTML injection is prevented."""

    def test_xss_in_visitor_name(self):
        visitor = {"name": '<script>alert("xss")</script>'}
        html = render_report(SAMPLE_CORRELATOR, visitor=visitor)
        self.assertNotIn("<script>alert", html)
        self.assertIn("&lt;script&gt;", html)

    def test_xss_in_transcript(self):
        data = {
            "segments": [
                {
                    "start": 0,
                    "end": 30000,
                    "engagement_score": "high",
                    "topics": [],
                    "transcript_text": '<img onerror="alert(1)" src=x>',
                    "clicks": [],
                    "screenshot_urls": [],
                }
            ],
            "summary": {"topics": [], "avgEngagement": "low", "scoreCounts": {"high": 1, "medium": 0, "low": 0}},
        }
        html = render_report(data)
        self.assertNotIn('onerror="alert', html)


if __name__ == "__main__":
    unittest.main()
