"""Tests for analysis.engines.analyzer -- quality scoring system."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from analysis.engines.analyzer import (
    PASS_THRESHOLD,
    analyze_with_quality_gate,
    compute_quality_score,
    score_actions,
    score_products,
    score_quotes,
    score_specificity,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

RICH_ANALYSIS = {
    "products_demonstrated": [
        {"name": "Vision One XDR", "timestamp": "14:02", "note": 'Visitor said "this is exactly what we need"'},
        {"name": "Cloud Security", "timestamp": "14:10", "note": "Interested in container protection"},
        {"name": "ZTSA", "timestamp": "14:18", "note": 'Asked "can this replace our VPN?"'},
        {"name": "Email Security", "timestamp": "14:24", "note": "Recent BEC concern"},
    ],
    "interests": [
        {"topic": "XDR", "confidence": "high", "detail": 'Visitor stated "we need to consolidate tools"'},
    ],
    "recommendations": [
        {"action": "Schedule technical deep-dive demo with SOC team by April 15", "priority": "high"},
        {"action": "Send Cloud Security container protection datasheet and pricing", "priority": "high"},
        {"action": "Set up proof-of-concept for ZTSA in their lab environment", "priority": "medium"},
        {"action": "Share BEC case study and ROI calculator", "priority": "medium"},
    ],
}

POOR_ANALYSIS = {
    "products_demonstrated": [
        {"name": "Vision One", "timestamp": "10:00", "note": "Showed dashboard"},
    ],
    "interests": [],
    "recommendations": [
        {"action": "Follow up with visitor", "priority": "medium"},
    ],
}

EMPTY_ANALYSIS = {
    "products_demonstrated": [],
    "interests": [],
    "recommendations": [],
}


# ---------------------------------------------------------------------------
# Dimension scorer tests
# ---------------------------------------------------------------------------

class TestScoreProducts(unittest.TestCase):

    def test_meets_target(self):
        self.assertEqual(score_products(RICH_ANALYSIS), 1.0)

    def test_below_target(self):
        self.assertAlmostEqual(score_products(POOR_ANALYSIS), 1 / 3)

    def test_empty(self):
        self.assertEqual(score_products(EMPTY_ANALYSIS), 0.0)

    def test_exactly_target(self):
        data = {"products_demonstrated": [{"name": f"P{i}"} for i in range(3)]}
        self.assertEqual(score_products(data), 1.0)


class TestScoreActions(unittest.TestCase):

    def test_meets_target(self):
        self.assertEqual(score_actions(RICH_ANALYSIS), 1.0)

    def test_below_target(self):
        self.assertAlmostEqual(score_actions(POOR_ANALYSIS), 1 / 3)

    def test_empty(self):
        self.assertEqual(score_actions(EMPTY_ANALYSIS), 0.0)


class TestScoreQuotes(unittest.TestCase):

    def test_has_quotes(self):
        self.assertGreater(score_quotes(RICH_ANALYSIS), 0.0)

    def test_no_quotes(self):
        self.assertEqual(score_quotes(POOR_ANALYSIS), 0.0)

    def test_dedicated_quotes_field(self):
        data = {"visitor_quotes": ["quote 1", "quote 2", "quote 3"]}
        self.assertEqual(score_quotes(data), 1.0)

    def test_partial_quotes(self):
        data = {
            "products_demonstrated": [
                {"name": "X", "note": '"I really want this product"'},
            ],
            "interests": [],
        }
        self.assertEqual(score_quotes(data), 0.5)


class TestScoreSpecificity(unittest.TestCase):

    def test_specific_recs(self):
        self.assertGreater(score_specificity(RICH_ANALYSIS), 0.0)

    def test_vague_recs(self):
        data = {
            "recommendations": [
                {"action": "Follow up with the visitor"},
                {"action": "Touch base next week"},
                {"action": "Reach out to discuss"},
            ]
        }
        self.assertEqual(score_specificity(data), 0.0)

    def test_empty_recs(self):
        self.assertEqual(score_specificity(EMPTY_ANALYSIS), 0.0)

    def test_string_recs(self):
        data = {"recommendations": ["Schedule a demo for the team"]}
        self.assertGreater(score_specificity(data), 0.0)


# ---------------------------------------------------------------------------
# Composite score tests
# ---------------------------------------------------------------------------

class TestComputeQualityScore(unittest.TestCase):

    def test_rich_analysis_passes(self):
        result = compute_quality_score(RICH_ANALYSIS)
        self.assertTrue(result["passed"])
        self.assertGreaterEqual(result["total_score"], PASS_THRESHOLD)

    def test_poor_analysis_fails(self):
        result = compute_quality_score(POOR_ANALYSIS)
        self.assertFalse(result["passed"])
        self.assertLess(result["total_score"], PASS_THRESHOLD)

    def test_empty_analysis_fails(self):
        result = compute_quality_score(EMPTY_ANALYSIS)
        self.assertFalse(result["passed"])
        self.assertEqual(result["total_score"], 0.0)

    def test_has_all_dimensions(self):
        result = compute_quality_score(RICH_ANALYSIS)
        dims = result["dimensions"]
        self.assertIn("products_identified", dims)
        self.assertIn("follow_up_actions", dims)
        self.assertIn("visitor_quotes", dims)
        self.assertIn("recommendation_specificity", dims)

    def test_max_score_is_10(self):
        result = compute_quality_score(RICH_ANALYSIS)
        self.assertEqual(result["max_score"], 10)

    def test_total_within_range(self):
        result = compute_quality_score(RICH_ANALYSIS)
        self.assertGreaterEqual(result["total_score"], 0)
        self.assertLessEqual(result["total_score"], 10)

    def test_threshold_present(self):
        result = compute_quality_score(RICH_ANALYSIS)
        self.assertEqual(result["threshold"], PASS_THRESHOLD)


# ---------------------------------------------------------------------------
# Quality gate (analyze + retry + write) tests
# ---------------------------------------------------------------------------

class TestAnalyzeWithQualityGate(unittest.TestCase):

    def test_passes_first_attempt(self):
        """Good analysis passes on first try -- no retry."""
        call_count = [0]

        def mock_analyze(session_data, extra_prompt):
            call_count[0] += 1
            return RICH_ANALYSIS

        with tempfile.TemporaryDirectory() as tmpdir:
            result = analyze_with_quality_gate({}, mock_analyze, output_dir=tmpdir)
            self.assertEqual(call_count[0], 1)
            # quality.json written
            qpath = os.path.join(tmpdir, "quality.json")
            self.assertTrue(os.path.exists(qpath))
            with open(qpath) as f:
                quality = json.load(f)
            self.assertTrue(quality["passed"])
            self.assertEqual(quality["attempt"], 1)

    def test_retries_on_poor_analysis(self):
        """Poor analysis triggers a retry with enhanced prompt."""
        call_count = [0]

        def mock_analyze(session_data, extra_prompt):
            call_count[0] += 1
            if extra_prompt is None:
                return POOR_ANALYSIS
            return RICH_ANALYSIS

        with tempfile.TemporaryDirectory() as tmpdir:
            result = analyze_with_quality_gate({}, mock_analyze, output_dir=tmpdir)
            self.assertEqual(call_count[0], 2)
            qpath = os.path.join(tmpdir, "quality.json")
            with open(qpath) as f:
                quality = json.load(f)
            self.assertTrue(quality["passed"])
            self.assertEqual(quality["attempt"], 2)

    def test_keeps_best_score_on_retry(self):
        """If retry is worse, keep original."""
        def mock_analyze(session_data, extra_prompt):
            if extra_prompt is None:
                return POOR_ANALYSIS
            return EMPTY_ANALYSIS  # even worse

        with tempfile.TemporaryDirectory() as tmpdir:
            result = analyze_with_quality_gate({}, mock_analyze, output_dir=tmpdir)
            qpath = os.path.join(tmpdir, "quality.json")
            with open(qpath) as f:
                quality = json.load(f)
            self.assertEqual(quality["attempt"], 1)
            self.assertTrue("retry_attempted" in quality)

    def test_custom_threshold(self):
        """Custom threshold overrides default."""
        def mock_analyze(session_data, extra_prompt):
            return RICH_ANALYSIS

        with tempfile.TemporaryDirectory() as tmpdir:
            result = analyze_with_quality_gate(
                {}, mock_analyze, output_dir=tmpdir, threshold=100
            )
            qpath = os.path.join(tmpdir, "quality.json")
            with open(qpath) as f:
                quality = json.load(f)
            # Score can't reach 100, so retry happened
            self.assertIn("attempt", quality)

    def test_quality_json_structure(self):
        """quality.json has expected keys."""
        def mock_analyze(session_data, extra_prompt):
            return RICH_ANALYSIS

        with tempfile.TemporaryDirectory() as tmpdir:
            analyze_with_quality_gate({}, mock_analyze, output_dir=tmpdir)
            qpath = os.path.join(tmpdir, "quality.json")
            with open(qpath) as f:
                quality = json.load(f)
            self.assertIn("dimensions", quality)
            self.assertIn("total_score", quality)
            self.assertIn("max_score", quality)
            self.assertIn("threshold", quality)
            self.assertIn("passed", quality)
            self.assertIn("attempt", quality)

    def test_creates_output_dir(self):
        """Output directory is created if it doesn't exist."""
        def mock_analyze(session_data, extra_prompt):
            return RICH_ANALYSIS

        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "nested", "output")
            analyze_with_quality_gate({}, mock_analyze, output_dir=subdir)
            self.assertTrue(os.path.exists(os.path.join(subdir, "quality.json")))


if __name__ == "__main__":
    unittest.main()
