"""Tests for the session recap HTML generator."""

import json
import os
import tempfile

import pytest

from analysis.engines.recap_generator import (
    build_slides,
    generate_recap,
    render_recap_html,
    _pick_quotes_for_click,
    _format_duration,
    _timestamp_to_seconds,
    TITLE_DURATION_MS,
    CLICK_DURATION_MS,
    SUMMARY_DURATION_MS,
)

SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "test-data", "sample-session")


@pytest.fixture
def sample_session(tmp_path):
    """Create a minimal session directory for testing."""
    (tmp_path / "clicks").mkdir()
    (tmp_path / "transcript").mkdir()
    (tmp_path / "output").mkdir()

    metadata = {
        "session_id": "TEST001",
        "visitor_name": "Alice TestUser",
        "se_name": "Bob SE",
        "started_at": "2026-08-06T10:00:00Z",
        "ended_at": "2026-08-06T10:15:00Z",
        "status": "completed",
    }
    (tmp_path / "metadata.json").write_text(json.dumps(metadata))

    clicks = {
        "session_id": "TEST001",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:30Z",
                "type": "click",
                "dom_path": "nav > a",
                "element": {"tag": "a", "text": "Endpoint Security", "href": "/app/ep"},
                "page_url": "https://example.com/dashboard",
                "page_title": "Dashboard",
                "screenshot_file": "screenshots/click-001.jpg",
            },
            {
                "index": 2,
                "timestamp": "2026-08-06T10:02:00Z",
                "type": "click",
                "dom_path": "div > button",
                "element": {"tag": "button", "text": "XDR Workbench", "href": None},
                "page_url": "https://example.com/xdr",
                "page_title": "XDR",
                "screenshot_file": "screenshots/click-002.jpg",
            },
        ],
    }
    (tmp_path / "clicks" / "clicks.json").write_text(json.dumps(clicks))

    transcript = {
        "session_id": "TEST001",
        "entries": [
            {"timestamp": "00:00:10", "speaker": "SE", "text": "Welcome, let me show you the platform."},
            {"timestamp": "00:00:25", "speaker": "Visitor", "text": "I'm interested in endpoint protection."},
            {"timestamp": "00:02:05", "speaker": "Visitor", "text": "How fast is the correlation?"},
        ],
    }
    (tmp_path / "transcript" / "transcript.json").write_text(json.dumps(transcript))

    summary = {
        "session_id": "TEST001",
        "visitor_name": "Alice TestUser",
        "products_demonstrated": ["Endpoint Security", "XDR"],
        "key_interests": [
            {"topic": "Endpoint Protection", "confidence": "high", "evidence": "Asked questions"},
            {"topic": "XDR Speed", "confidence": "medium", "evidence": "Compared to SIEM"},
        ],
        "follow_up_actions": ["Send EP guide", "Schedule POC"],
        "session_score": 8,
        "executive_summary": "Strong interest in EP and XDR correlation speed.",
    }
    (tmp_path / "output" / "summary.json").write_text(json.dumps(summary))

    return tmp_path


class TestBuildSlides:
    def test_slide_count(self, sample_session):
        slides = build_slides(str(sample_session))
        # 1 title + 2 clicks + 1 summary = 4
        assert len(slides) == 4

    def test_title_slide(self, sample_session):
        slides = build_slides(str(sample_session))
        title = slides[0]
        assert title["type"] == "title"
        assert title["visitor_name"] == "Alice TestUser"
        assert title["se_name"] == "Bob SE"
        assert title["duration_ms"] == TITLE_DURATION_MS
        assert title["session_id"] == "TEST001"

    def test_click_slides(self, sample_session):
        slides = build_slides(str(sample_session))
        click1 = slides[1]
        assert click1["type"] == "click"
        assert click1["index"] == 1
        assert click1["element_text"] == "Endpoint Security"
        assert click1["page_title"] == "Dashboard"
        assert click1["duration_ms"] == CLICK_DURATION_MS
        # No actual screenshot files, so b64 is None
        assert click1["screenshot_b64"] is None

        click2 = slides[2]
        assert click2["index"] == 2
        assert click2["element_text"] == "XDR Workbench"

    def test_summary_slide(self, sample_session):
        slides = build_slides(str(sample_session))
        summary = slides[-1]
        assert summary["type"] == "summary"
        assert summary["score"] == 8
        assert "Endpoint Security" in summary["products"]
        assert len(summary["key_interests"]) == 2
        assert summary["duration_ms"] == SUMMARY_DURATION_MS

    def test_quotes_attached_to_clicks(self, sample_session):
        slides = build_slides(str(sample_session))
        # Click 1 at T+30s should pick up transcript entries near 00:00:25
        click1 = slides[1]
        assert len(click1["quotes"]) > 0
        speakers = [q["speaker"] for q in click1["quotes"]]
        assert "Visitor" in speakers

    def test_empty_session(self, tmp_path):
        """Handles session with no data gracefully."""
        (tmp_path / "clicks").mkdir()
        (tmp_path / "transcript").mkdir()
        (tmp_path / "output").mkdir()
        slides = build_slides(str(tmp_path))
        # Title + summary only (no clicks)
        assert len(slides) == 2
        assert slides[0]["type"] == "title"
        assert slides[1]["type"] == "summary"


class TestRenderRecapHtml:
    def test_produces_valid_html(self, sample_session):
        slides = build_slides(str(sample_session))
        html = render_recap_html(slides)
        assert "<!DOCTYPE html>" in html
        assert "SESSION RECAP" in html
        assert "Alice TestUser" in html

    def test_contains_all_slide_types(self, sample_session):
        slides = build_slides(str(sample_session))
        html = render_recap_html(slides)
        assert 'class="slide slide-title"' in html
        assert 'class="slide slide-click"' in html
        assert 'class="slide slide-summary"' in html

    def test_autoplay_js(self, sample_session):
        slides = build_slides(str(sample_session))
        html = render_recap_html(slides)
        assert "scheduleNext" in html
        assert "btn-play" in html
        assert "ArrowLeft" in html
        assert "ArrowRight" in html

    def test_products_in_summary(self, sample_session):
        slides = build_slides(str(sample_session))
        html = render_recap_html(slides)
        assert "Endpoint Security" in html
        assert "XDR" in html

    def test_score_displayed(self, sample_session):
        slides = build_slides(str(sample_session))
        html = render_recap_html(slides)
        assert "8<span" in html  # score display
        assert "/10" in html


class TestGenerateRecap:
    def test_writes_output_file(self, sample_session):
        output_path = str(sample_session / "output" / "recap.html")
        html = generate_recap(str(sample_session), output_path)
        assert os.path.exists(output_path)
        with open(output_path) as f:
            content = f.read()
        assert content == html
        assert len(content) > 500

    def test_default_output_path(self, sample_session):
        generate_recap(str(sample_session))
        assert os.path.exists(sample_session / "output" / "recap.html")

    def test_with_real_sample_data(self):
        """Run against the project's sample-session test data."""
        if not os.path.exists(SAMPLE_DIR):
            pytest.skip("sample-session test data not found")
        with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
            out = f.name
        try:
            html = generate_recap(SAMPLE_DIR, out)
            assert "Priya Sharma" in html
            assert "Endpoint Security" in html
            assert "SESSION RECAP" in html
            assert "SESSION COMPLETE" in html
            assert os.path.getsize(out) > 1000
        finally:
            os.unlink(out)


class TestHelpers:
    def test_format_duration(self):
        assert _format_duration(0) == "0:00"
        assert _format_duration(90) == "1:30"
        assert _format_duration(3661) == "61:01"

    def test_timestamp_to_seconds(self):
        assert _timestamp_to_seconds("00:01:30") == 90.0
        assert _timestamp_to_seconds("01:30") == 90.0
        assert _timestamp_to_seconds("30") == 30.0
        assert _timestamp_to_seconds("bad") == 0.0

    def test_pick_quotes_empty(self):
        assert _pick_quotes_for_click("2026-01-01T00:00:00Z", [], "2026-01-01T00:00:00Z") == []
        assert _pick_quotes_for_click("", [{"timestamp": "00:00:05", "speaker": "SE", "text": "Hi"}], "") == []
