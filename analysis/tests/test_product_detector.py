"""Tests for product_detector engine."""

import json
import os
import tempfile
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from analysis.engines.product_detector import detect_products, detect_products_from_file


SAMPLE_CLICKS = os.path.join(
    os.path.dirname(__file__), "..", "sample_data", "sample_clicks.json"
)

CONFIG = {
    "path_patterns": {
        "/app/xdr": "XDR",
        "/app/xdr/workbench": "Workbench",
        "/app/search": "Search",
        "/app/cloud-security": "Cloud Security",
        "/app/risk-insights": "Risk Insights",
        "/app/endpoint-security": "Endpoint Security",
        "/app/email-security": "Email Security",
        "/app/network-security": "Network Security",
    },
    "keyword_patterns": {},
}


def test_detect_products_basic():
    """Detect products from minimal click data."""
    clicks = {
        "session_id": "TEST-001",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:00.000Z",
                "type": "click",
                "element": {"text": "XDR", "href": "/app/xdr"},
                "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
                "screenshot_file": "screenshots/click-001.jpg",
            },
            {
                "index": 2,
                "timestamp": "2026-08-06T10:01:30.000Z",
                "type": "click",
                "element": {"text": "Workbench", "href": "/app/xdr/workbench"},
                "page_url": "https://portal.xdr.trendmicro.com/app/xdr",
                "screenshot_file": "screenshots/click-002.jpg",
            },
            {
                "index": 3,
                "timestamp": "2026-08-06T10:03:00.000Z",
                "type": "click",
                "element": {"text": "Risk Insights", "href": "/app/risk-insights"},
                "page_url": "https://portal.xdr.trendmicro.com/app/xdr/workbench",
                "screenshot_file": "",
            },
        ],
    }
    result = detect_products(clicks, CONFIG)
    assert result["session_id"] == "TEST-001"
    products = result["products_demonstrated"]
    names = [p["name"] for p in products]
    assert "XDR" in names
    assert "Workbench" in names
    assert "Risk Insights" in names


def test_time_calculation():
    """Time spent = delta to next click."""
    clicks = {
        "session_id": "TEST-002",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:00.000Z",
                "type": "click",
                "element": {"text": "XDR", "href": "/app/xdr"},
                "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
                "screenshot_file": "",
            },
            {
                "index": 2,
                "timestamp": "2026-08-06T10:02:00.000Z",
                "type": "click",
                "element": {"text": "Search", "href": "/app/search"},
                "page_url": "https://portal.xdr.trendmicro.com/app/xdr",
                "screenshot_file": "",
            },
        ],
    }
    result = detect_products(clicks, CONFIG)
    xdr = next(p for p in result["products_demonstrated"] if p["name"] == "XDR")
    assert xdr["time_spent_seconds"] == 120.0


def test_screenshot_count():
    """Count screenshots per product."""
    clicks = {
        "session_id": "TEST-003",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:00.000Z",
                "type": "click",
                "element": {"href": "/app/endpoint-security"},
                "page_url": "https://portal.xdr.trendmicro.com/app/dashboard",
                "screenshot_file": "screenshots/click-001.jpg",
            },
            {
                "index": 2,
                "timestamp": "2026-08-06T10:01:00.000Z",
                "type": "click",
                "element": {"href": "/app/endpoint-security/policies"},
                "page_url": "https://portal.xdr.trendmicro.com/app/endpoint-security",
                "screenshot_file": "screenshots/click-002.jpg",
            },
            {
                "index": 3,
                "timestamp": "2026-08-06T10:02:00.000Z",
                "type": "click",
                "element": {"href": None},
                "page_url": "https://portal.xdr.trendmicro.com/app/endpoint-security",
                "screenshot_file": "",
            },
        ],
    }
    result = detect_products(clicks, CONFIG)
    ep = next(p for p in result["products_demonstrated"] if p["name"] == "Endpoint Security")
    assert ep["screenshots_count"] == 2
    assert ep["click_count"] == 3


def test_empty_events():
    """Empty events returns empty products."""
    result = detect_products({"session_id": "EMPTY", "events": []}, CONFIG)
    assert result["products_demonstrated"] == []


def test_unmatched_urls():
    """URLs that don't match any pattern are excluded."""
    clicks = {
        "session_id": "TEST-004",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:00.000Z",
                "type": "click",
                "element": {"href": "/app/unknown-page"},
                "page_url": "https://portal.xdr.trendmicro.com/app/settings",
                "screenshot_file": "",
            },
        ],
    }
    result = detect_products(clicks, CONFIG)
    assert result["products_demonstrated"] == []


def test_file_output():
    """detect_products_from_file writes JSON output."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        outpath = f.name
    try:
        result = detect_products_from_file(SAMPLE_CLICKS, outpath)
        assert result["session_id"] == "B291047"
        assert len(result["products_demonstrated"]) > 0
        with open(outpath) as f:
            written = json.load(f)
        assert written == result
    finally:
        os.unlink(outpath)


def test_sorted_by_time():
    """Products are sorted by time_spent_seconds descending."""
    clicks = {
        "session_id": "TEST-005",
        "events": [
            {
                "index": 1,
                "timestamp": "2026-08-06T10:00:00.000Z",
                "type": "click",
                "element": {"href": "/app/xdr"},
                "page_url": "",
                "screenshot_file": "",
            },
            {
                "index": 2,
                "timestamp": "2026-08-06T10:00:30.000Z",
                "type": "click",
                "element": {"href": "/app/search"},
                "page_url": "",
                "screenshot_file": "",
            },
            {
                "index": 3,
                "timestamp": "2026-08-06T10:05:00.000Z",
                "type": "click",
                "element": {"href": "/app/risk-insights"},
                "page_url": "",
                "screenshot_file": "",
            },
        ],
    }
    result = detect_products(clicks, CONFIG)
    times = [p["time_spent_seconds"] for p in result["products_demonstrated"]]
    assert times == sorted(times, reverse=True)


if __name__ == "__main__":
    test_detect_products_basic()
    test_time_calculation()
    test_screenshot_count()
    test_empty_events()
    test_unmatched_urls()
    test_file_output()
    test_sorted_by_time()
    print("All tests passed!")
