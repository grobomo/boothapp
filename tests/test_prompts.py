"""Tests for analysis.engines.prompts (visitor sentiment analysis)."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.prompts import analyze_sentiment, analyze_and_write


SAMPLE_DATA = {
    "report_id": "RPT-TEST-002",
    "generated_at": "2026-03-31 14:00",
    "visitor": {
        "name": "Sarah Chen",
        "title": "VP of Information Security",
        "company": "Acme Financial Corp",
        "industry": "Financial Services",
        "visit_duration": "28 minutes",
    },
    "products_demonstrated": [
        {
            "name": "Vision One XDR",
            "timestamp": "14:02",
            "note": "Asked about SOC integration and SIEM correlation",
        },
        {
            "name": "Cloud Security",
            "timestamp": "14:10",
            "note": "Running Kubernetes in AWS EKS, interested in runtime protection",
        },
        {
            "name": "Zero Trust Secure Access",
            "timestamp": "14:18",
            "note": "Currently evaluating ZTNA solutions, comparing 3 vendors",
        },
        {
            "name": "Email Security",
            "timestamp": "14:24",
            "note": "Recent BEC incidents, wants AI-powered detection",
        },
    ],
    "interests": [
        {"topic": "XDR", "confidence": "high", "detail": "Primary driver"},
        {"topic": "Cloud Security", "confidence": "high", "detail": "Active K8s deployment"},
        {"topic": "ZTNA", "confidence": "medium", "detail": "Evaluating, comparing vendors"},
        {"topic": "Email", "confidence": "medium", "detail": "Reactive after incident"},
        {"topic": "MDR", "confidence": "low", "detail": "Mentioned briefly, internal SOC"},
    ],
    "recommendations": [
        {"action": "Schedule XDR deep-dive", "priority": "high"},
        {"action": "Send container datasheet", "priority": "high"},
        {"action": "ZTNA POC discussion", "priority": "medium"},
        {"action": "Share BEC case study", "priority": "medium"},
        {"action": "Follow up in 2 weeks", "priority": "high"},
        {"action": "Add to webinar list", "priority": "low"},
    ],
}


class TestAnalyzeSentiment(unittest.TestCase):

    def setUp(self):
        self.result = analyze_sentiment(SAMPLE_DATA)

    def test_returns_dict(self):
        self.assertIsInstance(self.result, dict)

    def test_has_required_keys(self):
        required = [
            "initial_engagement",
            "peak_interest_moments",
            "hesitation_signals",
            "buying_temperature",
            "timeline",
            "summary",
        ]
        for key in required:
            self.assertIn(key, self.result, f"Missing key: {key}")

    def test_visitor_name(self):
        self.assertEqual(self.result["visitor_name"], "Sarah Chen")

    def test_report_id(self):
        self.assertEqual(self.result["report_id"], "RPT-TEST-002")

    # -- initial engagement --

    def test_initial_engagement_level(self):
        self.assertIn(self.result["initial_engagement"], ["high", "medium", "low"])

    def test_long_visit_high_interest_is_high_engagement(self):
        self.assertEqual(self.result["initial_engagement"], "high")

    def test_short_visit_low_engagement(self):
        minimal = {
            "visitor": {"visit_duration": "3 minutes"},
            "products_demonstrated": [{"name": "X", "note": ""}],
            "interests": [],
            "recommendations": [],
        }
        result = analyze_sentiment(minimal)
        self.assertEqual(result["initial_engagement"], "low")

    # -- peak interest moments --

    def test_peak_moments_are_list(self):
        self.assertIsInstance(self.result["peak_interest_moments"], list)

    def test_peak_moments_have_product_and_timestamp(self):
        for m in self.result["peak_interest_moments"]:
            self.assertIn("product", m)
            self.assertIn("timestamp", m)
            self.assertIn("signal_strength", m)

    def test_peak_moments_sorted_by_strength(self):
        strengths = [m["signal_strength"] for m in self.result["peak_interest_moments"]]
        self.assertEqual(strengths, sorted(strengths, reverse=True))

    # -- hesitation signals --

    def test_hesitation_signals_are_list(self):
        self.assertIsInstance(self.result["hesitation_signals"], list)

    def test_detects_hesitation_in_evaluating(self):
        # "evaluating" and "comparing" in ZTNA product note
        products_with_hesitation = [
            h for h in self.result["hesitation_signals"]
            if h.get("product") == "Zero Trust Secure Access"
        ]
        self.assertTrue(len(products_with_hesitation) > 0)

    # -- buying temperature --

    def test_temperature_valid_value(self):
        self.assertIn(self.result["buying_temperature"], ["cold", "warm", "hot"])

    def test_score_is_float(self):
        self.assertIsInstance(self.result["buying_temperature_score"], float)

    def test_score_in_range(self):
        score = self.result["buying_temperature_score"]
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)

    def test_high_interest_visitor_is_warm_or_hot(self):
        self.assertIn(self.result["buying_temperature"], ["warm", "hot"])

    # -- timeline --

    def test_timeline_matches_products(self):
        self.assertEqual(len(self.result["timeline"]), 4)

    def test_timeline_entries_have_sentiment(self):
        for entry in self.result["timeline"]:
            self.assertIn(entry["sentiment"], ["positive", "neutral", "skeptical"])

    # -- summary --

    def test_summary_is_string(self):
        self.assertIsInstance(self.result["summary"], str)

    def test_summary_mentions_temperature(self):
        temp = self.result["buying_temperature"].upper()
        self.assertIn(temp, self.result["summary"])

    # -- edge cases --

    def test_empty_data(self):
        result = analyze_sentiment({})
        self.assertEqual(result["initial_engagement"], "low")
        self.assertEqual(result["buying_temperature"], "cold")
        self.assertEqual(result["timeline"], [])

    def test_no_products(self):
        data = {
            "visitor": {"name": "Test", "visit_duration": "5 minutes"},
            "interests": [{"topic": "X", "confidence": "high", "detail": "Wants it"}],
            "recommendations": [],
        }
        result = analyze_sentiment(data)
        self.assertIn(result["buying_temperature"], ["cold", "warm", "hot"])


class TestAnalyzeAndWrite(unittest.TestCase):

    def test_writes_json_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "sentiment.json")
            result = analyze_and_write(SAMPLE_DATA, output_path=path)

            self.assertTrue(os.path.exists(path))
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertEqual(loaded["visitor_name"], "Sarah Chen")
            self.assertEqual(loaded["report_id"], "RPT-TEST-002")
            self.assertIn("buying_temperature", loaded)

    def test_returns_same_as_file_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "sentiment.json")
            result = analyze_and_write(SAMPLE_DATA, output_path=path)

            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            self.assertEqual(result, loaded)

    def test_creates_output_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = os.path.join(tmpdir, "nested", "dir", "sentiment.json")
            analyze_and_write(SAMPLE_DATA, output_path=path)
            self.assertTrue(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
