"""Tests for analysis.engines.crm_export."""

import csv
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from analysis.engines.crm_export import (
    build_crm_record,
    export_csv,
    export_json,
    flatten_record,
    process,
)

SAMPLE_SUMMARY = {
    "visitor_name": "Jane Doe",
    "company": "Acme Corp",
    "email": "jane@acme.com",
    "product_interest": ["Endpoint Protection", "XDR"],
    "engagement_level": "High",
    "demo_date": "2026-03-30",
    "products_shown": ["Vision One", "Apex One"],
    "duration": "25 min",
}

SAMPLE_FOLLOWUP = {
    "next_steps": ["Send pricing sheet", "Schedule technical deep-dive"],
    "key_questions": ["Does it integrate with Splunk?", "What about Linux support?"],
    "ai_recommendations": ["Upsell Cloud One bundle", "Offer 30-day POC"],
}


class TestBuildCrmRecord(unittest.TestCase):

    def test_full_data(self):
        rec = build_crm_record(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        self.assertEqual(rec["Contact"]["Name"], "Jane Doe")
        self.assertEqual(rec["Contact"]["Company"], "Acme Corp")
        self.assertEqual(rec["Contact"]["Email"], "jane@acme.com")
        self.assertIn("Endpoint Protection", rec["Opportunity"]["ProductInterest"])
        self.assertEqual(rec["Opportunity"]["EngagementLevel"], "High")
        self.assertIn("Send pricing sheet", rec["Opportunity"]["NextSteps"])
        self.assertEqual(rec["Activity"]["DemoDate"], "2026-03-30")
        self.assertIn("Vision One", rec["Activity"]["ProductsShown"])
        self.assertEqual(rec["Activity"]["Duration"], "25 min")
        self.assertIn("Splunk", rec["Notes"]["KeyVisitorQuestions"])
        self.assertIn("Upsell", rec["Notes"]["AIRecommendations"])

    def test_none_inputs(self):
        rec = build_crm_record(None, None)
        self.assertEqual(rec["Contact"]["Name"], "")
        self.assertEqual(rec["Contact"]["Email"], "{{EMAIL_PLACEHOLDER}}")
        self.assertEqual(rec["Opportunity"]["ProductInterest"], "")
        self.assertEqual(rec["Notes"]["KeyVisitorQuestions"], "")

    def test_empty_dicts(self):
        rec = build_crm_record({}, {})
        self.assertEqual(rec["Contact"]["Name"], "")
        self.assertEqual(rec["Contact"]["Email"], "{{EMAIL_PLACEHOLDER}}")

    def test_alternate_field_names(self):
        """Supports alternate key names (name vs visitor_name, etc.)."""
        summary = {"name": "Bob", "products": ["CloudOne"], "engagement": "Medium", "date": "2026-01-01"}
        followup = {"actions": ["Call back"], "visitor_questions": ["Price?"], "recommendations": ["Bundle"]}
        rec = build_crm_record(summary, followup)
        self.assertEqual(rec["Contact"]["Name"], "Bob")
        self.assertIn("CloudOne", rec["Opportunity"]["ProductInterest"])
        self.assertEqual(rec["Opportunity"]["EngagementLevel"], "Medium")
        self.assertIn("Call back", rec["Opportunity"]["NextSteps"])
        self.assertEqual(rec["Activity"]["DemoDate"], "2026-01-01")
        self.assertIn("Price?", rec["Notes"]["KeyVisitorQuestions"])

    def test_string_values_not_lists(self):
        summary = {"visitor_name": "X", "product_interest": "Single Product"}
        rec = build_crm_record(summary, {})
        self.assertEqual(rec["Opportunity"]["ProductInterest"], "Single Product")


class TestFlattenRecord(unittest.TestCase):

    def test_flatten(self):
        rec = build_crm_record(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        flat = flatten_record(rec)
        self.assertIn("Contact_Name", flat)
        self.assertIn("Opportunity_ProductInterest", flat)
        self.assertIn("Activity_DemoDate", flat)
        self.assertIn("Notes_AIRecommendations", flat)
        self.assertEqual(flat["Contact_Name"], "Jane Doe")


class TestExport(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_export_json(self):
        rec = build_crm_record(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        path = os.path.join(self.tmpdir, "crm-record.json")
        export_json(rec, path)
        with open(path, "r") as f:
            loaded = json.load(f)
        self.assertEqual(loaded["Contact"]["Name"], "Jane Doe")

    def test_export_csv(self):
        rec = build_crm_record(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP)
        path = os.path.join(self.tmpdir, "crm-export.csv")
        export_csv(rec, path)
        with open(path, "r") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["Contact_Name"], "Jane Doe")
        self.assertIn("Opportunity_NextSteps", rows[0])

    def test_process_creates_both_files(self):
        out_dir = os.path.join(self.tmpdir, "output")
        process(SAMPLE_SUMMARY, SAMPLE_FOLLOWUP, out_dir)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "crm-record.json")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "crm-export.csv")))

    def test_process_with_none(self):
        out_dir = os.path.join(self.tmpdir, "empty_output")
        rec = process(None, None, out_dir)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "crm-record.json")))
        self.assertEqual(rec["Contact"]["Email"], "{{EMAIL_PLACEHOLDER}}")


if __name__ == "__main__":
    unittest.main()
