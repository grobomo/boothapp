"""Tests for analysis.engines.report_template."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.report_template import generate_report, generate_report_from_json


SAMPLE_DATA = {
    "report_id": "RPT-TEST-001",
    "generated_at": "2026-01-15 09:00",
    "visitor": {
        "name": "Jane Doe",
        "title": "CISO",
        "company": "TestCorp",
        "email": "jdoe@testcorp.example.com",
        "industry": "Technology",
        "company_size": "1,000+",
        "visit_duration": "15 minutes",
    },
    "products_demonstrated": [
        {"name": "Vision One XDR", "timestamp": "09:01", "note": "Demo note"},
        {"name": "Email Security", "timestamp": "09:08", "note": ""},
    ],
    "interests": [
        {"topic": "XDR", "confidence": "high", "detail": "Primary interest"},
        {"topic": "ZTNA", "confidence": "medium", "detail": "Evaluating"},
        {"topic": "MDR", "confidence": "low", "detail": "Low priority"},
    ],
    "recommendations": [
        {"action": "Schedule follow-up call", "priority": "high"},
        {"action": "Send datasheet", "priority": "medium"},
        "Plain string recommendation",
    ],
}


class TestGenerateReport(unittest.TestCase):

    def setUp(self):
        self.html = generate_report(SAMPLE_DATA)

    # -- structural checks --

    def test_returns_string(self):
        self.assertIsInstance(self.html, str)

    def test_is_valid_html_document(self):
        self.assertIn("<!DOCTYPE html>", self.html)
        self.assertIn("<html", self.html)
        self.assertIn("</html>", self.html)
        self.assertIn("<head>", self.html)
        self.assertIn("</head>", self.html)
        self.assertIn("<body>", self.html)
        self.assertIn("</body>", self.html)

    def test_has_style_block(self):
        self.assertIn("<style>", self.html)
        self.assertIn("</style>", self.html)

    # -- branding --

    def test_header_branding(self):
        self.assertIn("Trend Micro", self.html)
        self.assertIn("Vision One", self.html)
        self.assertIn("report-header", self.html)

    def test_dark_header_gradient(self):
        self.assertIn("#1A1A2E", self.html)
        self.assertIn("linear-gradient", self.html)

    # -- visitor info --

    def test_visitor_name(self):
        self.assertIn("Jane Doe", self.html)

    def test_visitor_fields(self):
        self.assertIn("CISO", self.html)
        self.assertIn("TestCorp", self.html)
        self.assertIn("Technology", self.html)

    # -- products timeline --

    def test_timeline_present(self):
        self.assertIn("timeline", self.html)
        self.assertIn("Vision One XDR", self.html)
        self.assertIn("Email Security", self.html)

    def test_timeline_timestamps(self):
        self.assertIn("09:01", self.html)
        self.assertIn("09:08", self.html)

    # -- confidence badges --

    def test_high_badge_green(self):
        self.assertIn("#2D936C", self.html)
        self.assertIn("HIGH", self.html)

    def test_medium_badge_yellow(self):
        self.assertIn("#E9C46A", self.html)
        self.assertIn("MEDIUM", self.html)

    def test_low_badge_red(self):
        self.assertIn("#E63946", self.html)
        self.assertIn("LOW", self.html)

    # -- recommendations --

    def test_checkboxes(self):
        self.assertIn('type="checkbox"', self.html)

    def test_recommendation_text(self):
        self.assertIn("Schedule follow-up call", self.html)
        self.assertIn("Plain string recommendation", self.html)

    # -- print CSS --

    def test_print_media_query(self):
        self.assertIn("@media print", self.html)
        self.assertIn("break-inside: avoid", self.html)

    # -- card layout --

    def test_card_class(self):
        self.assertIn('class="card"', self.html)
        self.assertIn("border-radius: 10px", self.html)

    # -- footer --

    def test_footer(self):
        self.assertIn("report-footer", self.html)

    # -- XSS safety --

    def test_html_escaping(self):
        xss_data = {
            "report_id": "<script>alert(1)</script>",
            "generated_at": "now",
            "visitor": {"name": '<img onerror="alert(1)">'},
            "products_demonstrated": [],
            "interests": [],
            "recommendations": [],
        }
        result = generate_report(xss_data)
        # Verify dangerous characters are escaped (angle brackets become entities)
        body = result.split("<style>")[0] + result.split("</style>")[1]
        self.assertNotIn("<script>alert", body)
        self.assertNotIn("<img onerror", body)
        # Escaped forms should be present
        self.assertIn("&lt;script&gt;", body)
        self.assertIn("&lt;img onerror", body)

    # -- empty data --

    def test_empty_data(self):
        result = generate_report({})
        self.assertIn("<!DOCTYPE html>", result)

    def test_minimal_data(self):
        result = generate_report({"visitor": {"name": "Test"}})
        self.assertIn("Test", result)


class TestGenerateReportFromJson(unittest.TestCase):

    def test_loads_and_generates(self):
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            json.dump(SAMPLE_DATA, f)
            path = f.name
        try:
            result = generate_report_from_json(path)
            self.assertIn("Jane Doe", result)
            self.assertIn("<!DOCTYPE html>", result)
        finally:
            os.unlink(path)


class TestVisitorAvatar(unittest.TestCase):
    """Tests for the visitor photo / initials avatar feature."""

    def test_initials_avatar_in_header_no_photo(self):
        """Without badge_photo_url, header shows initials circle."""
        result = generate_report(SAMPLE_DATA)
        self.assertIn("avatar--initials", result)
        # Jane Doe -> "JD"
        self.assertIn(">JD</div>", result)

    def test_photo_avatar_in_header(self):
        """With badge_photo_url, header shows img tag."""
        data = {**SAMPLE_DATA, "visitor": {
            **SAMPLE_DATA["visitor"],
            "badge_photo_url": "https://s3.example.com/sessions/123/badge.jpg",
        }}
        result = generate_report(data)
        self.assertIn("avatar--img", result)
        self.assertIn("badge.jpg", result)
        # Body should use img tags, not initials divs (CSS defs don't count)
        body = result.split("</style>")[1]
        self.assertNotIn("avatar--initials", body)

    def test_avatar_has_drop_shadow(self):
        """Avatar CSS includes box-shadow for subtle depth."""
        result = generate_report(SAMPLE_DATA)
        self.assertIn("box-shadow", result)

    def test_avatar_is_circular(self):
        """Avatar CSS uses border-radius: 50%."""
        result = generate_report(SAMPLE_DATA)
        self.assertIn("border-radius: 50%", result)

    def test_avatar_has_border(self):
        """Avatar CSS includes a border."""
        result = generate_report(SAMPLE_DATA)
        # Both header and visitor-info avatars get borders
        self.assertIn("border: 2.5px solid", result)

    def test_visitor_info_section_has_avatar(self):
        """Visitor Information card shows an avatar."""
        result = generate_report(SAMPLE_DATA)
        self.assertIn("visitor-info-avatar", result)
        self.assertIn("visitor-header", result)

    def test_initials_single_name(self):
        """Single-word name produces one initial."""
        data = {"visitor": {"name": "Madonna"}}
        result = generate_report(data)
        self.assertIn(">M</div>", result)

    def test_initials_empty_name(self):
        """Empty/missing name falls back to ?."""
        data = {"visitor": {"name": ""}}
        result = generate_report(data)
        self.assertIn(">?</div>", result)

    def test_photo_url_is_escaped(self):
        """Photo URL with special chars is HTML-escaped."""
        data = {"visitor": {
            "name": "Test",
            "badge_photo_url": 'https://example.com/photo?a=1&b=2',
        }}
        result = generate_report(data)
        self.assertIn("&amp;b=2", result)


if __name__ == "__main__":
    unittest.main()
