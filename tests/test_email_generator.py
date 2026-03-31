"""Tests for analysis.engines.email_generator."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.email_generator import build_email_html, generate_email, _esc


SAMPLE_SUMMARY = {
    "visitor_name": "Sarah Chen",
    "company": "Acme Corp",
    "demos": [
        "Vision One XDR platform",
        "Cloud Security posture management",
    ],
    "takeaways": [
        "Unified visibility reduces MTTD by 60%",
        "Automated playbooks contain lateral movement",
    ],
}

SAMPLE_FOLLOWUP = {
    "actions": [
        {
            "title": "Vision One Free Trial",
            "url": "https://www.trendmicro.com/en_us/business/products/one-platform.html",
            "description": "Start a 30-day free trial.",
        }
    ],
    "next_steps": ["Review the trial dashboard"],
    "suggested_times": ["Tuesday, April 8 at 10:00 AM ET"],
}


class TestBuildEmailHtml(unittest.TestCase):
    def test_contains_visitor_name(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("Hi Sarah Chen", html)

    def test_contains_company(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("Acme Corp", html)

    def test_contains_demos(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("Vision One XDR platform", html)
        self.assertIn("Cloud Security posture management", html)

    def test_contains_takeaways(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("MTTD by 60%", html)

    def test_contains_action_links(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("trendmicro.com", html)
        self.assertIn("Vision One Free Trial", html)

    def test_contains_next_steps(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("Review the trial dashboard", html)

    def test_contains_meeting_times(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn("April 8", html)

    def test_inline_css_present(self):
        html = build_email_html(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertIn('style="', html)
        # No <style> block -- all inline
        self.assertNotIn("<style>", html)

    def test_missing_company_no_crash(self):
        summary = {**SAMPLE_SUMMARY}
        del summary["company"]
        html = build_email_html(summary, SAMPLE_FOLLOWUP)
        self.assertIn("Hi Sarah Chen", html)
        self.assertNotIn("at </", html)  # no dangling "at"

    def test_empty_inputs(self):
        html = build_email_html({}, {})
        self.assertIn("Hi there", html)  # fallback name
        self.assertIn("Trend Micro", html)

    def test_no_suggested_times(self):
        followup = {**SAMPLE_FOLLOWUP, "suggested_times": []}
        html = build_email_html(SAMPLE_SUMMARY, followup)
        self.assertIn("Hi Sarah Chen", html)


class TestEsc(unittest.TestCase):
    def test_escapes_html(self):
        self.assertEqual(_esc('<script>alert("xss")</script>'),
                         "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;")

    def test_escapes_ampersand(self):
        self.assertEqual(_esc("A & B"), "A &amp; B")


class TestGenerateEmail(unittest.TestCase):
    def test_writes_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            summary_path = os.path.join(tmpdir, "summary.json")
            followup_path = os.path.join(tmpdir, "followup.json")
            output_path = os.path.join(tmpdir, "out", "email.html")

            with open(summary_path, "w") as f:
                json.dump(SAMPLE_SUMMARY, f)
            with open(followup_path, "w") as f:
                json.dump(SAMPLE_FOLLOWUP, f)

            result = generate_email(summary_path, followup_path, output_path)
            self.assertTrue(os.path.exists(result))
            content = open(result).read()
            self.assertIn("Sarah Chen", content)
            self.assertGreater(len(content), 1000)


if __name__ == "__main__":
    unittest.main()
