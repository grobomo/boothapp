"""Tests for analysis.engines.integrity -- session data integrity checker."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.integrity import (
    IntegrityError,
    IntegrityResult,
    validate_session,
    validate_session_or_raise,
)


def _valid_session(**overrides):
    """Build a minimal valid session, with optional overrides."""
    base = {
        "session_start": 1000,
        "session_end": 9000,
        "clicks": [
            {"timestamp": 2000, "url": "https://a.com", "x": 10, "y": 20},
            {"timestamp": 3000, "url": "https://b.com", "x": 30, "y": 40},
        ],
        "transcript": [
            {"text": "Hello there"},
            {"text": "Tell me about XDR"},
        ],
        "metadata": {"visitor_name": "Jane Doe"},
    }
    base.update(overrides)
    return base


class TestIntegrityResult(unittest.TestCase):

    def test_empty_result_is_ok(self):
        r = IntegrityResult()
        self.assertTrue(r.ok)
        self.assertEqual(r.warnings, [])
        self.assertEqual(r.failures, [])

    def test_warning_does_not_fail(self):
        r = IntegrityResult()
        r.warn("something minor")
        self.assertTrue(r.ok)
        self.assertEqual(len(r.warnings), 1)

    def test_failure_makes_not_ok(self):
        r = IntegrityResult()
        r.fail("critical issue")
        self.assertFalse(r.ok)
        self.assertEqual(len(r.failures), 1)


# -- Valid session passes --------------------------------------------------

class TestValidSession(unittest.TestCase):

    def test_valid_session_passes(self):
        result, cleaned = validate_session(_valid_session())
        self.assertTrue(result.ok)
        self.assertEqual(len(result.warnings), 0)
        self.assertEqual(len(result.failures), 0)

    def test_valid_session_preserves_clicks(self):
        session = _valid_session()
        _, cleaned = validate_session(session)
        self.assertEqual(len(cleaned["clicks"]), 2)


# -- Click timestamp checks (hard failure) ---------------------------------

class TestClickTimestamps(unittest.TestCase):

    def test_click_before_session_start(self):
        session = _valid_session(clicks=[
            {"timestamp": 500, "url": "https://a.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertIn("outside session range", result.failures[0])

    def test_click_after_session_end(self):
        session = _valid_session(clicks=[
            {"timestamp": 99999, "url": "https://a.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertFalse(result.ok)

    def test_click_at_exact_boundaries_passes(self):
        session = _valid_session(clicks=[
            {"timestamp": 1000, "url": "https://a.com", "x": 0, "y": 0},
            {"timestamp": 9000, "url": "https://b.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertTrue(result.ok)

    def test_click_missing_timestamp(self):
        session = _valid_session(clicks=[
            {"url": "https://a.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertIn("missing timestamp", result.failures[0])

    def test_click_non_numeric_timestamp(self):
        session = _valid_session(clicks=[
            {"timestamp": "not-a-number", "url": "https://a.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertIn("not a number", result.failures[0])

    def test_multiple_bad_clicks_report_all(self):
        session = _valid_session(clicks=[
            {"timestamp": 500, "url": "https://a.com", "x": 0, "y": 0},
            {"timestamp": 99999, "url": "https://b.com", "x": 0, "y": 0},
        ])
        result, _ = validate_session(session)
        self.assertEqual(len(result.failures), 2)

    def test_empty_clicks_passes(self):
        session = _valid_session(clicks=[])
        result, _ = validate_session(session)
        self.assertTrue(result.ok)


# -- Transcript checks (soft failure / warning) ----------------------------

class TestTranscriptEntries(unittest.TestCase):

    def test_empty_text_warns(self):
        session = _valid_session(transcript=[
            {"text": ""},
        ])
        result, _ = validate_session(session)
        self.assertTrue(result.ok)  # soft failure
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("empty text", result.warnings[0])

    def test_whitespace_only_text_warns(self):
        session = _valid_session(transcript=[
            {"text": "   "},
        ])
        result, _ = validate_session(session)
        self.assertEqual(len(result.warnings), 1)

    def test_missing_text_key_warns(self):
        session = _valid_session(transcript=[
            {"speaker": "someone"},
        ])
        result, _ = validate_session(session)
        self.assertEqual(len(result.warnings), 1)

    def test_valid_transcript_no_warning(self):
        session = _valid_session(transcript=[
            {"text": "Hello"},
            {"text": "World"},
        ])
        result, _ = validate_session(session)
        self.assertEqual(len(result.warnings), 0)

    def test_mixed_valid_and_empty(self):
        session = _valid_session(transcript=[
            {"text": "Valid"},
            {"text": ""},
            {"text": "Also valid"},
        ])
        result, _ = validate_session(session)
        self.assertEqual(len(result.warnings), 1)

    def test_empty_transcript_passes(self):
        session = _valid_session(transcript=[])
        result, _ = validate_session(session)
        self.assertTrue(result.ok)
        self.assertEqual(len(result.warnings), 0)


# -- Duplicate click checks (soft failure) ---------------------------------

class TestDuplicateClicks(unittest.TestCase):

    def test_exact_duplicate_removed(self):
        click = {"timestamp": 2000, "url": "https://a.com", "x": 10, "y": 20}
        session = _valid_session(clicks=[click, click.copy()])
        result, cleaned = validate_session(session)
        self.assertTrue(result.ok)  # soft failure
        self.assertEqual(len(result.warnings), 1)
        self.assertIn("duplicate", result.warnings[0])
        self.assertEqual(len(cleaned["clicks"]), 1)

    def test_different_clicks_kept(self):
        session = _valid_session(clicks=[
            {"timestamp": 2000, "url": "https://a.com", "x": 10, "y": 20},
            {"timestamp": 2001, "url": "https://a.com", "x": 10, "y": 20},
        ])
        result, cleaned = validate_session(session)
        self.assertEqual(len(cleaned["clicks"]), 2)
        self.assertEqual(len(result.warnings), 0)

    def test_three_duplicates_reports_count(self):
        click = {"timestamp": 2000, "url": "https://a.com", "x": 10, "y": 20}
        session = _valid_session(clicks=[click, click.copy(), click.copy()])
        result, cleaned = validate_session(session)
        self.assertIn("2 duplicate", result.warnings[0])
        self.assertEqual(len(cleaned["clicks"]), 1)


# -- Visitor name checks (hard failure) ------------------------------------

class TestVisitorName(unittest.TestCase):

    def test_empty_name_fails(self):
        session = _valid_session(metadata={"visitor_name": ""})
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertIn("visitor_name", result.failures[0])

    def test_missing_name_fails(self):
        session = _valid_session(metadata={})
        result, _ = validate_session(session)
        self.assertFalse(result.ok)

    def test_whitespace_name_fails(self):
        session = _valid_session(metadata={"visitor_name": "   "})
        result, _ = validate_session(session)
        self.assertFalse(result.ok)

    def test_valid_name_passes(self):
        session = _valid_session(metadata={"visitor_name": "Jane"})
        result, _ = validate_session(session)
        self.assertTrue(result.ok)

    def test_missing_metadata_key_fails(self):
        session = _valid_session()
        del session["metadata"]
        result, _ = validate_session(session)
        self.assertFalse(result.ok)


# -- validate_session_or_raise convenience ---------------------------------

class TestValidateOrRaise(unittest.TestCase):

    def test_valid_returns_cleaned(self):
        cleaned = validate_session_or_raise(_valid_session())
        self.assertIn("clicks", cleaned)

    def test_hard_failure_raises(self):
        session = _valid_session(metadata={"visitor_name": ""})
        with self.assertRaises(IntegrityError) as ctx:
            validate_session_or_raise(session)
        self.assertIn("visitor_name", str(ctx.exception))
        self.assertIsInstance(ctx.exception.failures, list)

    def test_soft_failure_does_not_raise(self):
        session = _valid_session(transcript=[{"text": ""}])
        cleaned = validate_session_or_raise(session)
        self.assertIsNotNone(cleaned)


# -- Combined scenarios ----------------------------------------------------

class TestCombinedScenarios(unittest.TestCase):

    def test_hard_and_soft_together(self):
        session = _valid_session(
            metadata={"visitor_name": ""},
            transcript=[{"text": ""}],
        )
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertEqual(len(result.failures), 1)  # visitor_name
        self.assertEqual(len(result.warnings), 1)  # empty transcript

    def test_multiple_hard_failures(self):
        session = _valid_session(
            metadata={"visitor_name": ""},
            clicks=[{"timestamp": 500, "url": "https://a.com", "x": 0, "y": 0}],
        )
        result, _ = validate_session(session)
        self.assertFalse(result.ok)
        self.assertGreaterEqual(len(result.failures), 2)

    def test_all_soft_failures_still_ok(self):
        click = {"timestamp": 2000, "url": "https://a.com", "x": 10, "y": 20}
        session = _valid_session(
            clicks=[click, click.copy()],
            transcript=[{"text": ""}, {"text": "valid"}],
        )
        result, _ = validate_session(session)
        self.assertTrue(result.ok)
        self.assertGreaterEqual(len(result.warnings), 2)


if __name__ == "__main__":
    unittest.main()
