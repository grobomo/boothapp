"""Tests for analysis.engines.slide_generator."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.slide_generator import (
    generate_slides,
    generate_slides_html,
    _score_color,
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
            "duration_seconds": 480,
            "note": "SOC integration demo",
        },
        {
            "name": "Cloud Security - Container Protection",
            "timestamp": "14:10",
            "duration_seconds": 360,
            "note": "Kubernetes runtime protection",
        },
        {
            "name": "Zero Trust Secure Access",
            "timestamp": "14:18",
            "duration_seconds": 300,
            "note": "ZTNA evaluation",
        },
        {
            "name": "Email Security",
            "timestamp": "14:24",
            "duration_seconds": 240,
            "note": "BEC detection",
        },
    ],
    "interests": [
        {
            "topic": "XDR / SOC Modernization",
            "confidence": "high",
            "detail": "Primary driver for evaluation",
        },
        {
            "topic": "Cloud Workload Security",
            "confidence": "high",
            "detail": "Active Kubernetes deployment in AWS EKS",
        },
        {
            "topic": "Zero Trust Network Access",
            "confidence": "medium",
            "detail": "In evaluation phase for remote workforce",
        },
    ],
    "transcript_highlights": [
        {"speaker": "Visitor", "text": "We had 3 incidents last quarter from email-based attacks"},
        {"speaker": "SE", "text": "Vision One correlates across email, endpoint, and cloud"},
        "Asked detailed questions about API integration with ServiceNow",
    ],
    "competitors": [
        {
            "name": "CrowdStrike",
            "context": "Currently using Falcon for endpoint",
            "positioning": "Vision One provides broader platform coverage including email and cloud",
        },
        {
            "name": "Palo Alto",
            "context": "Evaluated Prisma Access for ZTNA",
            "positioning": "ZTSA integrates natively with Vision One XDR for unified visibility",
        },
    ],
    "recommendations": [
        {"action": "Schedule technical deep-dive on Vision One XDR", "priority": "high", "owner": "SE Team"},
        {"action": "Send container protection datasheet", "priority": "high", "owner": "Marketing"},
        {"action": "Connect with ZTNA SE for POC", "priority": "medium", "owner": "SE Team"},
        {"action": "Share BEC case study", "priority": "medium"},
        {"action": "Follow up in 2 weeks with proposal", "priority": "high", "owner": "Account Exec"},
    ],
    "engagement_score": {
        "overall": 85,
        "interest_level": 90,
        "technical_depth": 80,
        "purchase_intent": 75,
        "time_investment": 85,
    },
}


# =========================================================================
# HTML generation
# =========================================================================

class TestGenerateSlidesHtml(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_returns_string(self):
        self.assertIsInstance(self.html, str)

    def test_valid_html_document(self):
        self.assertIn("<!DOCTYPE html>", self.html)
        self.assertIn("<html", self.html)
        self.assertIn("</html>", self.html)

    def test_has_style_block(self):
        self.assertIn("<style>", self.html)

    def test_has_script_block(self):
        self.assertIn("<script>", self.html)

    def test_dark_theme_colors(self):
        # Dark theme colors appear in the CSS
        self.assertIn("#0A0A15", self.html)  # darkest background
        self.assertIn("#1E1E30", self.html)  # card background
        self.assertIn("#2A2A3E", self.html)  # border/bar background

    def test_brand_red(self):
        self.assertIn("#D71920", self.html)

    def test_has_six_slides(self):
        count = self.html.count('data-slide="')
        self.assertEqual(count, 6)

    def test_first_slide_is_active(self):
        self.assertIn('class="slide slide-title active"', self.html)

    def test_slide_counter(self):
        self.assertIn("slide-counter", self.html)
        self.assertIn("1 / 6", self.html)

    def test_arrow_key_navigation(self):
        self.assertIn("ArrowRight", self.html)
        self.assertIn("ArrowLeft", self.html)

    def test_nav_hint(self):
        self.assertIn("Arrow keys to navigate", self.html)


# =========================================================================
# Title slide
# =========================================================================

class TestTitleSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_visitor_name(self):
        self.assertIn("Sarah Chen", self.html)

    def test_company_name(self):
        self.assertIn("Acme Financial Corp", self.html)

    def test_demo_summary_heading(self):
        self.assertIn("Demo Summary", self.html)

    def test_visitor_title(self):
        self.assertIn("VP of Information Security", self.html)

    def test_duration(self):
        self.assertIn("28 minutes", self.html)

    def test_branding(self):
        self.assertIn("Trend Micro", self.html)
        self.assertIn("Vision One", self.html)

    def test_logo_badge(self):
        self.assertIn("logo-badge", self.html)
        self.assertIn("V1", self.html)


# =========================================================================
# Products slide
# =========================================================================

class TestProductsSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_products_title(self):
        self.assertIn("Products Demonstrated", self.html)

    def test_product_names(self):
        self.assertIn("Vision One XDR", self.html)
        self.assertIn("Cloud Security", self.html)
        self.assertIn("Zero Trust", self.html)
        self.assertIn("Email Security", self.html)

    def test_time_bars_present(self):
        self.assertIn("product-bar", self.html)

    def test_time_labels(self):
        # 480s = 8m, 360s = 6m, 300s = 5m, 240s = 4m
        self.assertIn("8m", self.html)
        self.assertIn("6m", self.html)

    def test_bar_width_percentage(self):
        # Longest product (480s) should have 100% width
        self.assertIn("width:100%", self.html)

    def test_no_products(self):
        html = generate_slides_html({"products_demonstrated": []})
        self.assertIn("No products recorded", html)


# =========================================================================
# Discussion points slide
# =========================================================================

class TestDiscussionSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_discussion_title(self):
        self.assertIn("Key Discussion Points", self.html)

    def test_interests_shown(self):
        self.assertIn("XDR / SOC Modernization", self.html)
        self.assertIn("Cloud Workload Security", self.html)

    def test_confidence_shown(self):
        self.assertIn("high", self.html)

    def test_transcript_highlights(self):
        self.assertIn("3 incidents last quarter", self.html)
        self.assertIn("API integration", self.html)

    def test_speaker_labels(self):
        self.assertIn("Visitor", self.html)
        self.assertIn("SE", self.html)

    def test_no_data(self):
        html = generate_slides_html({"interests": [], "transcript_highlights": []})
        self.assertIn("No discussion points recorded", html)


# =========================================================================
# Competitors slide
# =========================================================================

class TestCompetitorsSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_competitors_title(self):
        self.assertIn("Competitive Landscape", self.html)

    def test_competitor_names(self):
        self.assertIn("CrowdStrike", self.html)
        self.assertIn("Palo Alto", self.html)

    def test_competitor_context(self):
        self.assertIn("Falcon for endpoint", self.html)

    def test_positioning(self):
        self.assertIn("broader platform coverage", self.html)

    def test_no_competitors(self):
        html = generate_slides_html({"competitors": []})
        self.assertIn("No competitor mentions detected", html)


# =========================================================================
# Next steps slide
# =========================================================================

class TestNextStepsSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_steps_title(self):
        self.assertIn("Recommended Next Steps", self.html)

    def test_actions_shown(self):
        self.assertIn("Schedule technical deep-dive", self.html)
        self.assertIn("container protection datasheet", self.html)

    def test_priority_badges(self):
        self.assertIn("priority-high", self.html)
        self.assertIn("priority-medium", self.html)

    def test_owners_shown(self):
        self.assertIn("SE Team", self.html)
        self.assertIn("Marketing", self.html)

    def test_numbered_steps(self):
        self.assertIn("step-num", self.html)

    def test_string_recommendations(self):
        data = {"recommendations": ["Do this first", "Then do that"]}
        html = generate_slides_html(data)
        self.assertIn("Do this first", html)
        self.assertIn("Then do that", html)

    def test_no_recommendations(self):
        html = generate_slides_html({"recommendations": []})
        self.assertIn("No action items recorded", html)


# =========================================================================
# Engagement score slide
# =========================================================================

class TestScoreSlide(unittest.TestCase):

    def setUp(self):
        self.html = generate_slides_html(SAMPLE_DATA)

    def test_score_title(self):
        self.assertIn("Engagement Score", self.html)

    def test_overall_score_displayed(self):
        self.assertIn(">85<", self.html)

    def test_svg_ring_gauge(self):
        self.assertIn("<svg", self.html)
        self.assertIn("score-ring", self.html)
        self.assertIn("ring-fg", self.html)

    def test_metric_cards(self):
        self.assertIn("Interest Level", self.html)
        self.assertIn("Technical Depth", self.html)
        self.assertIn("Purchase Intent", self.html)

    def test_metric_values(self):
        self.assertIn(">90<", self.html)
        self.assertIn(">80<", self.html)
        self.assertIn(">75<", self.html)

    def test_flat_score(self):
        html = generate_slides_html({"engagement_score": 72})
        self.assertIn(">72<", html)

    def test_zero_score(self):
        html = generate_slides_html({"engagement_score": 0})
        self.assertIn(">0<", html)


# =========================================================================
# Score color helper
# =========================================================================

class TestScoreColor(unittest.TestCase):

    def test_high_score_green(self):
        self.assertEqual(_score_color(85), "#2D936C")

    def test_medium_score_yellow(self):
        self.assertEqual(_score_color(65), "#E9C46A")

    def test_low_score_blue(self):
        self.assertEqual(_score_color(45), "#4A90D9")

    def test_very_low_score_accent(self):
        self.assertEqual(_score_color(20), "#E63946")


# =========================================================================
# XSS protection
# =========================================================================

class TestXssSafety(unittest.TestCase):

    def test_visitor_name_escaped(self):
        data = {"visitor": {"name": '<script>alert("xss")</script>', "company": "Safe Co"}}
        html = generate_slides_html(data)
        self.assertNotIn("<script>alert", html.split("<script>")[0])
        self.assertIn("&lt;script&gt;", html)

    def test_product_name_escaped(self):
        data = {"products_demonstrated": [{"name": '<img onerror="x">', "timestamp": "1:00"}]}
        html = generate_slides_html(data)
        self.assertIn("&lt;img", html)
        self.assertNotIn('<img onerror', html)

    def test_competitor_name_escaped(self):
        data = {"competitors": [{"name": '"><script>x</script>', "context": "test"}]}
        html = generate_slides_html(data)
        self.assertIn("&lt;script&gt;", html)


# =========================================================================
# Empty / minimal data
# =========================================================================

class TestEmptyData(unittest.TestCase):

    def test_empty_dict(self):
        html = generate_slides_html({})
        self.assertIn("<!DOCTYPE html>", html)
        self.assertEqual(html.count('data-slide="'), 6)

    def test_minimal_visitor(self):
        html = generate_slides_html({"visitor": {"name": "Test"}})
        self.assertIn("Test", html)


# =========================================================================
# File output
# =========================================================================

class TestGenerateSlides(unittest.TestCase):

    def test_creates_output_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = generate_slides(SAMPLE_DATA, output_dir=tmpdir)
            self.assertTrue(os.path.exists(path))
            self.assertTrue(path.endswith("slides.html"))

    def test_file_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = generate_slides(SAMPLE_DATA, output_dir=tmpdir)
            with open(path, encoding="utf-8") as f:
                content = f.read()
            self.assertIn("<!DOCTYPE html>", content)
            self.assertIn("Sarah Chen", content)

    def test_creates_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "new", "nested")
            path = generate_slides(SAMPLE_DATA, output_dir=subdir)
            self.assertTrue(os.path.isdir(subdir))
            self.assertTrue(os.path.exists(path))

    def test_default_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                path = generate_slides(SAMPLE_DATA)
                self.assertTrue(os.path.exists(path))
            finally:
                os.chdir(old_cwd)


if __name__ == "__main__":
    unittest.main()
