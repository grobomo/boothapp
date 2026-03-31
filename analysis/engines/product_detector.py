"""Detect V1 products demonstrated in a session from clicks.json data.

Reads click events, maps URLs to V1 products using v1_features.json config,
and calculates per-product stats: time spent, click count, screenshot count.

Usage:
    python -m analysis.engines.product_detector <clicks.json> [output.json]
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime

from .timeline_builder import load_feature_config

CONFIG_PATH = os.path.join(
    os.path.dirname(__file__), "..", "config", "v1_features.json"
)


def _parse_iso(ts_str):
    """Parse ISO-8601 timestamp to datetime."""
    ts_str = ts_str.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(ts_str)
    except ValueError:
        return None


def _match_url_to_product(page_url, href, path_patterns):
    """Match a URL to a product name using path patterns. Longest match wins."""
    best_match = None
    best_len = 0
    for url in (href, page_url):
        if not url:
            continue
        path = url
        if "://" in url:
            path = "/" + url.split("://", 1)[1].split("/", 1)[-1]
        for pattern, product in path_patterns.items():
            if pattern in path and len(pattern) > best_len:
                best_match = product
                best_len = len(pattern)
    return best_match


def detect_products(clicks_data, config=None):
    """Detect products demonstrated from clicks data.

    Args:
        clicks_data: parsed clicks.json dict
        config: V1 feature config dict (loaded from file if None)

    Returns:
        dict with session_id and products_demonstrated array
    """
    if config is None:
        config = load_feature_config(CONFIG_PATH)

    path_patterns = config.get("path_patterns", {})
    events = clicks_data.get("events", [])
    session_id = clicks_data.get("session_id", "unknown")

    # Tag each event with its product
    tagged = []
    for event in events:
        element = event.get("element", {})
        page_url = event.get("page_url", "")
        href = element.get("href")
        product = _match_url_to_product(page_url, href, path_patterns)
        ts = _parse_iso(event.get("timestamp", ""))
        has_screenshot = bool(event.get("screenshot_file"))
        tagged.append({
            "product": product,
            "timestamp": ts,
            "has_screenshot": has_screenshot,
        })

    # Aggregate per product
    product_stats = defaultdict(lambda: {
        "timestamps": [],
        "click_count": 0,
        "screenshots_count": 0,
    })

    for t in tagged:
        if t["product"] is None:
            continue
        stats = product_stats[t["product"]]
        stats["click_count"] += 1
        if t["timestamp"]:
            stats["timestamps"].append(t["timestamp"])
        if t["has_screenshot"]:
            stats["screenshots_count"] += 1

    # Calculate time spent per product
    # Time on a product = time from first click in that product region
    # until the next click on a DIFFERENT product (or end of session)
    products_time = defaultdict(float)
    for i, t in enumerate(tagged):
        if t["product"] is None or t["timestamp"] is None:
            continue
        # Find next event with a different product (or end)
        next_ts = None
        for j in range(i + 1, len(tagged)):
            if tagged[j]["timestamp"] is not None:
                next_ts = tagged[j]["timestamp"]
                break
        if next_ts and t["timestamp"]:
            delta = (next_ts - t["timestamp"]).total_seconds()
            # Cap at 5 minutes per click to avoid outliers from breaks
            if 0 < delta < 300:
                products_time[t["product"]] += delta

    # Build output
    products_demonstrated = []
    for name in sorted(product_stats.keys()):
        stats = product_stats[name]
        products_demonstrated.append({
            "name": name,
            "time_spent_seconds": round(products_time.get(name, 0), 1),
            "click_count": stats["click_count"],
            "screenshots_count": stats["screenshots_count"],
        })

    # Sort by time spent descending (most demonstrated first)
    products_demonstrated.sort(key=lambda p: p["time_spent_seconds"], reverse=True)

    return {
        "session_id": session_id,
        "products_demonstrated": products_demonstrated,
    }


def detect_products_from_file(clicks_path, output_path=None, config_path=None):
    """Detect products from a clicks.json file. Writes to output_path if given."""
    with open(clicks_path, "r") as f:
        clicks_data = json.load(f)

    config = load_feature_config(config_path) if config_path else None
    result = detect_products(clicks_data, config)

    if output_path:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m analysis.engines.product_detector <clicks.json> [output.json]")
        sys.exit(1)
    output = sys.argv[2] if len(sys.argv) > 2 else None
    result = detect_products_from_file(sys.argv[1], output)
    if not output:
        print(json.dumps(result, indent=2))
