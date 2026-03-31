"""Tests for sentiment timeline analysis and report rendering."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.sentiment_timeline import (
    analyze_transcript,
    classify_segment,
)
from analysis.engines.report_template import generate_report


# ---------------------------------------------------------------------------
# classify_segment tests
# ---------------------------------------------------------------------------

class TestClassifySegment(unittest.TestCase):

    def test_positive_excited(self):
        self.assertEqual(classify_segment("I'm really excited about this"), "positive")

    def test_positive_impressed(self):
        self.assertEqual(classify_segment("Very impressed with the demo"), "positive")

    def test_positive_show_me(self):
        self.assertEqual(classify_segment("Please show me the dashboard"), "positive")

    def test_positive_sign_me_up(self):
        self.assertEqual(classify_segment("Sign me up for the trial"), "positive")

    def test_neutral_plain(self):
        self.assertEqual(classify_segment("We use AWS for our cloud infrastructure"), "neutral")

    def test_neutral_empty(self):
        self.assertEqual(classify_segment(""), "neutral")

    def test_hesitation_not_sure(self):
        self.assertEqual(classify_segment("I'm not sure if that fits our needs"), "hesitation")

    def test_hesitation_maybe(self):
        self.assertEqual(classify_segment("Maybe we could look at this later"), "hesitation")

    def test_hesitation_need_to_discuss(self):
        self.assertEqual(classify_segment("I need to discuss this with my team"), "hesitation")

    def test_skepticism_expensive(self):
        self.assertEqual(classify_segment("That sounds expensive, what's the cost?"), "skepticism")

    def test_skepticism_competitor(self):
        self.assertEqual(classify_segment("How does this compare to the competitor?"), "skepticism")

    def test_skepticism_doubt(self):
        self.assertEqual(classify_segment("I doubt this would work for us, it's complicated"), "skepticism")

    def test_mixed_positive_wins(self):
        # More positive signals than negative
        self.assertEqual(
            classify_segment("Excellent demo, absolutely love the interface"),
            "positive",
        )

    def test_mixed_skepticism_beats_hesitation(self):
        # When skepticism and hesitation tie, skepticism wins
        self.assertEqual(
            classify_segment("Maybe, but I have concerns about the cost"),
            "skepticism",
        )

    def test_case_insensitive(self):
        self.assertEqual(classify_segment("DEFINITELY interested"), "positive")


# ---------------------------------------------------------------------------
# analyze_transcript tests
# ---------------------------------------------------------------------------

class TestAnalyzeTranscript(unittest.TestCase):

    def test_empty_input(self):
        self.assertEqual(analyze_transcript([]), [])

    def test_single_segment(self):
        result = analyze_transcript([
            {"timestamp": "14:00", "text": "This is great!"}
        ])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["timestamp"], "14:00")
        self.assertEqual(result[0]["sentiment"], "positive")

    def test_preserves_fields(self):
        result = analyze_transcript([
            {"timestamp": "10:05", "text": "Just a regular comment"}
        ])
        self.assertEqual(result[0]["timestamp"], "10:05")
        self.assertEqual(result[0]["text"], "Just a regular comment")
        self.assertEqual(result[0]["sentiment"], "neutral")

    def test_multiple_segments(self):
        result = analyze_transcript([
            {"timestamp": "14:00", "text": "Wow, amazing product"},
            {"timestamp": "14:05", "text": "We use cloud services"},
            {"timestamp": "14:10", "text": "I'm not sure about pricing"},
            {"timestamp": "14:15", "text": "This is too expensive and complicated"},
        ])
        self.assertEqual(len(result), 4)
        self.assertEqual(result[0]["sentiment"], "positive")
        self.assertEqual(result[1]["sentiment"], "neutral")
        self.assertEqual(result[2]["sentiment"], "hesitation")
        self.assertEqual(result[3]["sentiment"], "skepticism")

    def test_missing_text_field(self):
        result = analyze_transcript([{"timestamp": "14:00"}])
        self.assertEqual(result[0]["sentiment"], "neutral")
        self.assertEqual(result[0]["text"], "")


# ---------------------------------------------------------------------------
# Report rendering tests for sentiment timeline
# ---------------------------------------------------------------------------

class TestSentimentTimelineRendering(unittest.TestCase):

    def _data_with_sentiment(self, timeline):
        return {
            "report_id": "RPT-TEST",
            "generated_at": "2026-01-01",
            "visitor": {"name": "Test User"},
            "sentiment_timeline": timeline,
        }

    def test_no_timeline_no_section(self):
        html = generate_report({"visitor": {"name": "A"}})
        self.assertNotIn("Visitor Sentiment Timeline", html)
        # CSS defines .sentiment-bar but the actual bar div shouldn't render
        self.assertNotIn('class="sentiment-bar"', html)

    def test_empty_timeline_no_section(self):
        data = self._data_with_sentiment([])
        html = generate_report(data)
        self.assertNotIn("Visitor Sentiment Timeline", html)

    def test_section_title_present(self):
        data = self._data_with_sentiment([
            {"timestamp": "14:00", "text": "Hello", "sentiment": "neutral"}
        ])
        html = generate_report(data)
        self.assertIn("Visitor Sentiment Timeline", html)

    def test_bar_rendered(self):
        data = self._data_with_sentiment([
            {"timestamp": "14:00", "text": "Great!", "sentiment": "positive"},
            {"timestamp": "14:05", "text": "Hmm", "sentiment": "hesitation"},
        ])
        html = generate_report(data)
        self.assertIn('class="sentiment-bar"', html)
        self.assertIn('data-s="positive"', html)
        self.assertIn('data-s="hesitation"', html)

    def test_all_four_sentiments(self):
        data = self._data_with_sentiment([
            {"timestamp": "1", "text": "a", "sentiment": "positive"},
            {"timestamp": "2", "text": "b", "sentiment": "neutral"},
            {"timestamp": "3", "text": "c", "sentiment": "hesitation"},
            {"timestamp": "4", "text": "d", "sentiment": "skepticism"},
        ])
        html = generate_report(data)
        self.assertIn('data-s="positive"', html)
        self.assertIn('data-s="neutral"', html)
        self.assertIn('data-s="hesitation"', html)
        self.assertIn('data-s="skepticism"', html)

    def test_legend_present(self):
        data = self._data_with_sentiment([
            {"timestamp": "14:00", "text": "x", "sentiment": "positive"}
        ])
        html = generate_report(data)
        self.assertIn("sentiment-legend", html)
        self.assertIn("Positive", html)
        self.assertIn("Neutral", html)
        self.assertIn("Hesitation", html)
        self.assertIn("Skepticism", html)

    def test_detail_rows_present(self):
        data = self._data_with_sentiment([
            {"timestamp": "14:00", "text": "Some remark", "sentiment": "neutral"}
        ])
        html = generate_report(data)
        self.assertIn("sentiment-details", html)
        self.assertIn("14:00", html)
        self.assertIn("Some remark", html)

    def test_html_escaping_in_sentiment(self):
        data = self._data_with_sentiment([
            {"timestamp": "14:00", "text": '<script>alert("xss")</script>', "sentiment": "positive"}
        ])
        html = generate_report(data)
        body = html.split("<style>")[0] + html.split("</style>")[1]
        self.assertNotIn("<script>alert", body)
        self.assertIn("&lt;script&gt;", body)

    def test_sentiment_colors_in_css(self):
        html = generate_report(self._data_with_sentiment([
            {"timestamp": "1", "text": "x", "sentiment": "positive"}
        ]))
        self.assertIn("#2D936C", html)   # positive green
        self.assertIn("#B2BEC3", html)   # neutral gray
        self.assertIn("#E9C46A", html)   # hesitation yellow
        self.assertIn("#E63946", html)   # skepticism red

    def test_existing_sections_still_render(self):
        data = {
            "report_id": "RPT-001",
            "generated_at": "2026-01-01",
            "visitor": {"name": "Jane"},
            "products_demonstrated": [
                {"name": "XDR", "timestamp": "09:00", "note": "demo"}
            ],
            "sentiment_timeline": [
                {"timestamp": "09:00", "text": "Great", "sentiment": "positive"}
            ],
            "interests": [
                {"topic": "XDR", "confidence": "high", "detail": "Primary"}
            ],
            "recommendations": [
                {"action": "Follow up", "priority": "high"}
            ],
        }
        html = generate_report(data)
        self.assertIn("Products Demonstrated", html)
        self.assertIn("Visitor Sentiment Timeline", html)
        self.assertIn("Visitor Interests", html)
        self.assertIn("Recommended Follow-Up Actions", html)


if __name__ == "__main__":
    unittest.main()
