"""Tests for analysis.engines.coaching."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.coaching import (
    generate_coaching,
    generate_coaching_json,
    _extract_transcript_text,
    _extract_questions_and_answers,
    _score_answer,
    _find_demonstrated_products,
    _find_missed_product_areas,
    _find_missed_buying_signals,
)


# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------

FULL_SESSION = {
    "visitor": {
        "name": "Sarah Chen",
        "title": "VP of Information Security",
        "company": "Acme Financial Corp",
    },
    "transcript": (
        "Can you tell me about your XDR capabilities? "
        "Great question, let me show you how Vision One correlates alerts across "
        "endpoints, email, and network into a single incident view. For example, "
        "if a phishing email leads to a malware download, you see the full chain. "
        "How does the pricing work for XDR? "
        "I think so, I'll have to check with our sales team on that. "
        "We're comparing you against CrowdStrike and SentinelOne. "
        "That's a good question, I'll ask the product team about competitive differences. "
        "We have a deadline by Q2 to pick a vendor. "
        "Let me show you specifically how our detection engine compares -- "
        "here's a real-world example from a customer like yours in financial services. "
        "Can you do a proof of concept for us? "
        "Absolutely, let me demonstrate how we typically set up a POC. "
        "In your case, we'd focus on the SIEM integration first. "
        "What about cloud workload protection? "
        "I'm not sure about the container features, I'll have to get back to you on that."
    ),
    "products_demonstrated": [
        {"name": "Vision One XDR", "timestamp": "14:02", "note": "SOC integration"},
        {"name": "Email Security", "timestamp": "14:10", "note": "BEC detection"},
    ],
    "interests": [
        {"topic": "XDR / SOC Modernization", "confidence": "high", "detail": "Primary"},
        {"topic": "Cloud Workload Security", "confidence": "high", "detail": "K8s runtime"},
        {"topic": "Zero Trust", "confidence": "medium", "detail": "Remote workforce"},
    ],
    "recommendations": [
        {"action": "Schedule XDR deep-dive", "priority": "high"},
        {"action": "Send container protection datasheet", "priority": "high"},
    ],
}

EMPTY_SESSION = {}

MINIMAL_SESSION = {
    "visitor": {"name": "Test User"},
    "transcript": "",
    "products_demonstrated": [],
    "interests": [],
    "recommendations": [],
}

SEGMENT_TRANSCRIPT_SESSION = {
    "transcript": [
        {"text": "How does endpoint protection work?", "timestamp": 0},
        {"text": "Let me show you our endpoint agent -- here's how it detects malware.", "timestamp": 5},
    ],
    "products_demonstrated": [],
    "interests": [],
    "recommendations": [],
}

TRANSCRIPT_SEGMENTS_SESSION = {
    "transcript_segments": [
        {"text": "What about your managed detection service?", "timestamp": 0},
        {"text": "I'm not sure about MDR pricing, I'll have to check.", "timestamp": 5},
    ],
    "products_demonstrated": [],
    "interests": [],
    "recommendations": [],
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestExtractTranscriptText(unittest.TestCase):

    def test_string_transcript(self):
        result = _extract_transcript_text({"transcript": "hello world"})
        self.assertEqual(result, "hello world")

    def test_list_transcript(self):
        data = {"transcript": [{"text": "one"}, {"text": "two"}]}
        result = _extract_transcript_text(data)
        self.assertEqual(result, "one two")

    def test_transcript_segments_fallback(self):
        data = {"transcript_segments": [{"text": "seg1"}, {"text": "seg2"}]}
        result = _extract_transcript_text(data)
        self.assertEqual(result, "seg1 seg2")

    def test_empty_data(self):
        self.assertEqual(_extract_transcript_text({}), "")

    def test_none_transcript(self):
        self.assertEqual(_extract_transcript_text({"transcript": None}), "")


class TestExtractQuestionsAndAnswers(unittest.TestCase):

    def test_basic_qa_pair(self):
        text = "What is XDR? XDR unifies detection across all vectors."
        pairs = _extract_questions_and_answers(text)
        self.assertEqual(len(pairs), 1)
        self.assertIn("What is XDR?", pairs[0]["question"])
        self.assertIn("XDR unifies", pairs[0]["answer"])

    def test_multiple_qa_pairs(self):
        text = "How does it work? Here's how. What about pricing? It varies."
        pairs = _extract_questions_and_answers(text)
        self.assertEqual(len(pairs), 2)

    def test_empty_text(self):
        self.assertEqual(_extract_questions_and_answers(""), [])

    def test_no_questions(self):
        text = "This is a statement. Another statement here."
        pairs = _extract_questions_and_answers(text)
        self.assertEqual(len(pairs), 0)

    def test_question_at_end_no_answer(self):
        text = "Some context. What about this?"
        pairs = _extract_questions_and_answers(text)
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["answer"], "")


class TestScoreAnswer(unittest.TestCase):

    def test_strong_answer(self):
        answer = "Let me show you how this works. For example, a customer like yours used it."
        rating, _ = _score_answer(answer)
        self.assertEqual(rating, "strong")

    def test_weak_answer(self):
        answer = "I'm not sure about that, I'll have to check with the team."
        rating, _ = _score_answer(answer)
        self.assertEqual(rating, "weak")

    def test_neutral_answer(self):
        answer = "The product supports that feature."
        rating, _ = _score_answer(answer)
        self.assertEqual(rating, "neutral")

    def test_empty_answer(self):
        rating, indicators = _score_answer("")
        self.assertEqual(rating, "neutral")
        self.assertEqual(indicators, [])


class TestFindDemonstratedProducts(unittest.TestCase):

    def test_extracts_product_names(self):
        data = {"products_demonstrated": [
            {"name": "Vision One XDR"},
            {"name": "Email Security"},
        ]}
        result = _find_demonstrated_products(data)
        self.assertEqual(result, {"Vision One XDR", "Email Security"})

    def test_empty_list(self):
        self.assertEqual(_find_demonstrated_products({"products_demonstrated": []}), set())

    def test_missing_key(self):
        self.assertEqual(_find_demonstrated_products({}), set())


class TestFindMissedProductAreas(unittest.TestCase):

    def test_finds_missed_products(self):
        data = {
            "transcript": "We need cloud workload protection for our Kubernetes clusters.",
            "products_demonstrated": [
                {"name": "Vision One XDR"},
            ],
            "interests": [
                {"topic": "Cloud Security", "detail": "K8s runtime protection"},
            ],
        }
        missed = _find_missed_product_areas(data)
        product_names = [m["product"] for m in missed]
        self.assertIn("Cloud Security", product_names)

    def test_no_missed_when_all_demoed(self):
        data = {
            "transcript": "Tell me about XDR.",
            "products_demonstrated": [
                {"name": "Vision One XDR"},
            ],
            "interests": [
                {"topic": "XDR", "detail": "Main interest"},
            ],
        }
        missed = _find_missed_product_areas(data)
        # Vision One XDR was demoed, so it shouldn't appear as missed
        product_names = [m["product"] for m in missed]
        self.assertNotIn("Vision One XDR", product_names)

    def test_empty_transcript(self):
        data = {
            "transcript": "",
            "products_demonstrated": [],
            "interests": [],
        }
        missed = _find_missed_product_areas(data)
        self.assertEqual(missed, [])

    def test_missed_products_have_evidence(self):
        data = {
            "transcript": "We need email phishing protection and endpoint security.",
            "products_demonstrated": [],
            "interests": [],
        }
        missed = _find_missed_product_areas(data)
        for m in missed:
            self.assertIn("evidence", m)
            self.assertIsInstance(m["evidence"], list)
            self.assertGreater(len(m["evidence"]), 0)

    def test_sorted_by_relevance(self):
        data = {
            "transcript": (
                "We need cloud container kubernetes runtime docker workload protection "
                "and also email security."
            ),
            "products_demonstrated": [],
            "interests": [],
        }
        missed = _find_missed_product_areas(data)
        if len(missed) >= 2:
            # Most relevant (most trigger matches) should be first
            self.assertGreaterEqual(
                len(missed[0]["evidence"]), len(missed[1]["evidence"])
            )


class TestFindMissedBuyingSignals(unittest.TestCase):

    def test_detects_pricing_signal(self):
        data = {
            "transcript": "How much does this cost per user?",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("Pricing inquiry", signals)

    def test_detects_timeline_signal(self):
        data = {
            "transcript": "We have a deadline by Q2 to make a decision.",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("Timeline pressure", signals)

    def test_detects_competitive_signal(self):
        data = {
            "transcript": "We're comparing you versus CrowdStrike.",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("Competitive evaluation", signals)

    def test_detects_poc_signal(self):
        data = {
            "transcript": "Can we do a proof of concept?",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("POC readiness", signals)

    def test_no_false_positives_on_empty(self):
        data = {"transcript": "", "recommendations": []}
        missed = _find_missed_buying_signals(data)
        self.assertEqual(missed, [])

    def test_addressed_signals_excluded(self):
        data = {
            "transcript": "How much does this cost per user?",
            "recommendations": [
                {"action": "Send pricing and cost breakdown"},
            ],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        # Pricing was addressed in recommendations, should not appear
        self.assertNotIn("Pricing inquiry", signals)

    def test_compliance_signal(self):
        data = {
            "transcript": "We need to meet HIPAA compliance requirements.",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("Compliance driver", signals)

    def test_pain_point_signal(self):
        data = {
            "transcript": "We had a breach last month and we're struggling to respond.",
            "recommendations": [],
        }
        missed = _find_missed_buying_signals(data)
        signals = [m["signal"] for m in missed]
        self.assertIn("Active pain", signals)


class TestGenerateCoaching(unittest.TestCase):

    def test_full_session_structure(self):
        result = generate_coaching(FULL_SESSION)
        self.assertIn("questions_answered_well", result)
        self.assertIn("questions_to_improve", result)
        self.assertIn("missed_product_areas", result)
        self.assertIn("missed_buying_signals", result)
        self.assertIn("summary", result)

    def test_summary_fields(self):
        result = generate_coaching(FULL_SESSION)
        summary = result["summary"]
        self.assertIn("total_questions_analyzed", summary)
        self.assertIn("strong_answers", summary)
        self.assertIn("weak_answers", summary)
        self.assertIn("missed_product_count", summary)
        self.assertIn("missed_signal_count", summary)
        self.assertIn("overall_rating", summary)

    def test_overall_rating_values(self):
        result = generate_coaching(FULL_SESSION)
        self.assertIn(result["summary"]["overall_rating"],
                       ["strong", "adequate", "needs_improvement"])

    def test_full_session_finds_strong_answers(self):
        result = generate_coaching(FULL_SESSION)
        self.assertGreater(len(result["questions_answered_well"]), 0)

    def test_full_session_finds_weak_answers(self):
        result = generate_coaching(FULL_SESSION)
        self.assertGreater(len(result["questions_to_improve"]), 0)

    def test_full_session_finds_missed_products(self):
        result = generate_coaching(FULL_SESSION)
        # Cloud Security and ZTSA mentioned in interests but not fully demoed
        self.assertGreater(len(result["missed_product_areas"]), 0)

    def test_full_session_finds_missed_signals(self):
        result = generate_coaching(FULL_SESSION)
        # Timeline, competitive, pricing signals in transcript
        self.assertGreater(len(result["missed_buying_signals"]), 0)

    def test_empty_session(self):
        result = generate_coaching(EMPTY_SESSION)
        self.assertEqual(result["questions_answered_well"], [])
        self.assertEqual(result["questions_to_improve"], [])
        self.assertEqual(result["missed_product_areas"], [])
        self.assertEqual(result["missed_buying_signals"], [])
        self.assertEqual(result["summary"]["overall_rating"], "needs_improvement")

    def test_minimal_session(self):
        result = generate_coaching(MINIMAL_SESSION)
        self.assertEqual(result["summary"]["total_questions_analyzed"], 0)

    def test_segment_transcript(self):
        result = generate_coaching(SEGMENT_TRANSCRIPT_SESSION)
        self.assertIsInstance(result["questions_answered_well"], list)

    def test_transcript_segments_format(self):
        result = generate_coaching(TRANSCRIPT_SEGMENTS_SESSION)
        self.assertIsInstance(result["questions_to_improve"], list)

    def test_question_entries_have_required_fields(self):
        result = generate_coaching(FULL_SESSION)
        for q in result["questions_answered_well"]:
            self.assertIn("question", q)
            self.assertIn("answer_excerpt", q)
            self.assertIn("strength", q)
        for q in result["questions_to_improve"]:
            self.assertIn("question", q)
            self.assertIn("answer_excerpt", q)
            self.assertIn("suggestion", q)

    def test_missed_product_entries_have_required_fields(self):
        result = generate_coaching(FULL_SESSION)
        for p in result["missed_product_areas"]:
            self.assertIn("product", p)
            self.assertIn("category", p)
            self.assertIn("evidence", p)
            self.assertIn("suggestion", p)

    def test_missed_signal_entries_have_required_fields(self):
        result = generate_coaching(FULL_SESSION)
        for s in result["missed_buying_signals"]:
            self.assertIn("signal", s)
            self.assertIn("description", s)
            self.assertIn("evidence", s)
            self.assertIn("recommendation", s)

    def test_summary_counts_match(self):
        result = generate_coaching(FULL_SESSION)
        summary = result["summary"]
        self.assertEqual(
            summary["total_questions_analyzed"],
            summary["strong_answers"] + summary["weak_answers"]
        )
        self.assertEqual(
            summary["missed_product_count"],
            len(result["missed_product_areas"])
        )
        self.assertEqual(
            summary["missed_signal_count"],
            len(result["missed_buying_signals"])
        )


class TestGenerateCoachingJson(unittest.TestCase):

    def test_returns_valid_json(self):
        result = generate_coaching_json(FULL_SESSION)
        parsed = json.loads(result)
        self.assertIn("questions_answered_well", parsed)
        self.assertIn("summary", parsed)

    def test_empty_session_json(self):
        result = generate_coaching_json(EMPTY_SESSION)
        parsed = json.loads(result)
        self.assertEqual(parsed["summary"]["total_questions_analyzed"], 0)


if __name__ == "__main__":
    unittest.main()
