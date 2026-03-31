"""CRM export engine -- transforms analysis output into Salesforce-compatible records.

Reads summary and follow-up data and produces:
  - output/crm-record.json  (structured Salesforce import format)
  - output/crm-export.csv   (flat CSV for bulk import)
"""

import csv
import json
import os
from datetime import datetime


def _get(data, key, default=""):
    """Safely get a value from a dict, returning default if missing/None."""
    if not data or not isinstance(data, dict):
        return default
    val = data.get(key)
    return val if val is not None else default


def _list_to_str(val):
    """Convert a list to semicolon-separated string, or pass through strings."""
    if isinstance(val, list):
        return "; ".join(str(v) for v in val)
    return str(val) if val else ""


def build_crm_record(summary, followup):
    """Build a Salesforce-compatible CRM record from summary and follow-up data.

    Args:
        summary: dict from summary.json (visitor info, demo details, products)
        followup: dict from follow-up.json (next steps, recommendations, questions)

    Returns:
        dict with Contact, Opportunity, Activity, and Notes sections.
    """
    summary = summary or {}
    followup = followup or {}

    contact = {
        "Name": _get(summary, "visitor_name", _get(summary, "name", "")),
        "Company": _get(summary, "company", ""),
        "Email": _get(summary, "email", "{{EMAIL_PLACEHOLDER}}"),
    }

    opportunity = {
        "ProductInterest": _list_to_str(
            _get(summary, "product_interest", _get(summary, "products", []))
        ),
        "EngagementLevel": _get(summary, "engagement_level", _get(summary, "engagement", "")),
        "NextSteps": _list_to_str(_get(followup, "next_steps", _get(followup, "actions", []))),
    }

    activity = {
        "DemoDate": _get(summary, "demo_date", _get(summary, "date", "")),
        "ProductsShown": _list_to_str(
            _get(summary, "products_shown", _get(summary, "products_demo", []))
        ),
        "Duration": _get(summary, "duration", ""),
    }

    notes = {
        "KeyVisitorQuestions": _list_to_str(
            _get(followup, "key_questions", _get(followup, "visitor_questions", []))
        ),
        "AIRecommendations": _list_to_str(
            _get(followup, "ai_recommendations", _get(followup, "recommendations", []))
        ),
    }

    return {
        "Contact": contact,
        "Opportunity": opportunity,
        "Activity": activity,
        "Notes": notes,
    }


def flatten_record(record):
    """Flatten nested CRM record into a single-level dict for CSV export."""
    flat = {}
    for section, fields in record.items():
        for key, value in fields.items():
            flat[f"{section}_{key}"] = value
    return flat


def export_json(record, output_path):
    """Write CRM record to JSON file."""
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2, ensure_ascii=False)


def export_csv(record, output_path):
    """Write flattened CRM record to CSV file."""
    flat = flatten_record(record)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=flat.keys())
        writer.writeheader()
        writer.writerow(flat)


def process(summary, followup, output_dir="output"):
    """Main entry point: build CRM record and export both JSON and CSV.

    Args:
        summary: dict (or None) from summary.json
        followup: dict (or None) from follow-up.json
        output_dir: directory for output files

    Returns:
        The CRM record dict.
    """
    record = build_crm_record(summary, followup)
    json_path = os.path.join(output_dir, "crm-record.json")
    csv_path = os.path.join(output_dir, "crm-export.csv")
    export_json(record, json_path)
    export_csv(record, csv_path)
    return record


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export CRM records from analysis output")
    parser.add_argument("--summary", default="output/summary.json", help="Path to summary.json")
    parser.add_argument("--followup", default="output/follow-up.json", help="Path to follow-up.json")
    parser.add_argument("--output-dir", default="output", help="Output directory")
    args = parser.parse_args()

    summary_data = None
    followup_data = None

    if os.path.exists(args.summary):
        with open(args.summary, "r", encoding="utf-8") as f:
            summary_data = json.load(f)

    if os.path.exists(args.followup):
        with open(args.followup, "r", encoding="utf-8") as f:
            followup_data = json.load(f)

    result = process(summary_data, followup_data, args.output_dir)
    print(json.dumps(result, indent=2))
