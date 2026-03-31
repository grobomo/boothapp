"""Tests for analysis.engines.enrichment."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.enrichment import (
    enrich_company,
    enrich_from_session,
    enrich_to_json,
)


class TestEnrichCompany(unittest.TestCase):
    """Test the core enrichment logic."""

    # -- structure --

    def test_returns_dict(self):
        result = enrich_company("Acme Corp")
        self.assertIsInstance(result, dict)

    def test_required_keys(self):
        result = enrich_company("Acme Corp")
        for key in [
            "company_name",
            "industry_vertical",
            "estimated_company_size",
            "likely_security_stack",
            "relevant_case_studies",
        ]:
            self.assertIn(key, result)

    def test_size_has_subkeys(self):
        result = enrich_company("Test Inc")
        size = result["estimated_company_size"]
        self.assertIn("estimate", size)
        self.assertIn("category", size)
        self.assertIn("confidence", size)

    def test_stack_has_subkeys(self):
        result = enrich_company("Test Inc")
        stack = result["likely_security_stack"]
        self.assertIn("likely_tools", stack)
        self.assertIn("compliance_frameworks", stack)
        self.assertIn("pain_points", stack)

    def test_case_studies_are_list(self):
        result = enrich_company("Test Inc")
        self.assertIsInstance(result["relevant_case_studies"], list)
        self.assertGreater(len(result["relevant_case_studies"]), 0)

    def test_case_study_has_fields(self):
        result = enrich_company("Goldman Sachs")
        for cs in result["relevant_case_studies"]:
            self.assertIn("title", cs)
            self.assertIn("summary", cs)
            self.assertIn("relevance", cs)

    # -- industry classification --

    def test_financial_services(self):
        result = enrich_company("Acme Financial Corp")
        self.assertEqual(result["industry_vertical"], "Financial Services")

    def test_healthcare(self):
        result = enrich_company("MedTech Health Systems")
        self.assertEqual(result["industry_vertical"], "Healthcare & Life Sciences")

    def test_technology(self):
        result = enrich_company("CloudTech Software Inc")
        self.assertEqual(result["industry_vertical"], "Technology")

    def test_energy(self):
        result = enrich_company("Pacific Gas & Energy")
        self.assertEqual(result["industry_vertical"], "Energy & Utilities")

    def test_retail(self):
        result = enrich_company("MegaStore Retail Group")
        self.assertEqual(result["industry_vertical"], "Retail & E-Commerce")

    def test_manufacturing(self):
        result = enrich_company("Allied Manufacturing Corp")
        self.assertEqual(result["industry_vertical"], "Manufacturing & Industrial")

    def test_telecom(self):
        result = enrich_company("National Telecom Inc")
        self.assertEqual(result["industry_vertical"], "Telecommunications")

    def test_government(self):
        result = enrich_company("Federal Agency Services")
        self.assertEqual(result["industry_vertical"], "Government & Public Sector")

    def test_education(self):
        result = enrich_company("State University Research")
        self.assertEqual(result["industry_vertical"], "Education & Research")

    def test_unknown_industry(self):
        result = enrich_company("XYZZY Widgets")
        self.assertEqual(result["industry_vertical"], "General Enterprise")

    # -- company size --

    def test_known_large_company(self):
        result = enrich_company("Microsoft")
        size = result["estimated_company_size"]
        self.assertEqual(size["category"], "Enterprise")
        self.assertEqual(size["confidence"], "high")

    def test_corp_suffix_large(self):
        result = enrich_company("Apex Global Corporation")
        size = result["estimated_company_size"]
        self.assertEqual(size["category"], "Large")

    def test_inc_suffix_midmarket(self):
        result = enrich_company("Acme Inc")
        size = result["estimated_company_size"]
        self.assertEqual(size["category"], "Mid-Market")

    def test_unknown_size(self):
        result = enrich_company("Zephyr")
        size = result["estimated_company_size"]
        self.assertEqual(size["category"], "Unknown")

    # -- security stack by industry --

    def test_financial_has_pci(self):
        result = enrich_company("Acme Financial Corp")
        frameworks = result["likely_security_stack"]["compliance_frameworks"]
        self.assertIn("PCI-DSS", frameworks)

    def test_healthcare_has_hipaa(self):
        result = enrich_company("City Hospital Network")
        frameworks = result["likely_security_stack"]["compliance_frameworks"]
        self.assertIn("HIPAA", frameworks)

    def test_tech_has_soc2(self):
        result = enrich_company("CloudTech Software")
        frameworks = result["likely_security_stack"]["compliance_frameworks"]
        self.assertIn("SOC 2", frameworks)

    def test_government_has_fedramp(self):
        result = enrich_company("Federal Defense Agency")
        frameworks = result["likely_security_stack"]["compliance_frameworks"]
        self.assertIn("FedRAMP", frameworks)

    def test_default_stack_for_unknown(self):
        result = enrich_company("XYZZY Widgets")
        tools = result["likely_security_stack"]["likely_tools"]
        self.assertTrue(len(tools) > 0)

    # -- case studies --

    def test_financial_case_studies(self):
        result = enrich_company("JPMorgan Chase")
        studies = result["relevant_case_studies"]
        titles = [s["title"] for s in studies]
        self.assertTrue(any("Bank" in t or "Insurance" in t for t in titles))

    def test_default_case_studies(self):
        result = enrich_company("XYZZY Widgets")
        studies = result["relevant_case_studies"]
        self.assertTrue(len(studies) > 0)

    # -- edge cases --

    def test_empty_string(self):
        result = enrich_company("")
        self.assertEqual(result["company_name"], "")
        self.assertEqual(result["industry_vertical"], "Unknown")

    def test_none_input(self):
        result = enrich_company(None)
        self.assertEqual(result["company_name"], "")

    def test_whitespace_only(self):
        result = enrich_company("   ")
        self.assertEqual(result["company_name"], "")

    def test_preserves_company_name(self):
        result = enrich_company("  Acme Financial Corp  ")
        self.assertEqual(result["company_name"], "Acme Financial Corp")

    def test_case_insensitive(self):
        result = enrich_company("MICROSOFT")
        self.assertEqual(result["estimated_company_size"]["category"], "Enterprise")


class TestEnrichFromSession(unittest.TestCase):
    """Test session data integration."""

    def test_extracts_company(self):
        data = {"visitor": {"name": "Jane", "company": "Goldman Sachs"}}
        result = enrich_from_session(data)
        self.assertEqual(result["company_name"], "Goldman Sachs")
        self.assertEqual(result["industry_vertical"], "Financial Services")

    def test_missing_visitor(self):
        result = enrich_from_session({})
        self.assertEqual(result["company_name"], "")

    def test_missing_company(self):
        result = enrich_from_session({"visitor": {"name": "Jane"}})
        self.assertEqual(result["company_name"], "")

    def test_full_sample_data(self):
        data = {
            "report_id": "RPT-001",
            "visitor": {
                "name": "Sarah Chen",
                "company": "Acme Financial Corp",
                "title": "VP Security",
            },
        }
        result = enrich_from_session(data)
        self.assertEqual(result["industry_vertical"], "Financial Services")
        self.assertIn("PCI-DSS",
                      result["likely_security_stack"]["compliance_frameworks"])


class TestEnrichToJson(unittest.TestCase):
    """Test JSON file output."""

    def test_writes_valid_json(self):
        data = {"visitor": {"company": "Microsoft"}}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            path = f.name
        try:
            enrich_to_json(data, path)
            with open(path, "r") as f:
                loaded = json.load(f)
            self.assertEqual(loaded["company_name"], "Microsoft")
            self.assertEqual(loaded["industry_vertical"], "Technology")
        finally:
            os.unlink(path)

    def test_returns_result(self):
        data = {"visitor": {"company": "Test Corp"}}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            path = f.name
        try:
            result = enrich_to_json(data, path)
            self.assertIsInstance(result, dict)
            self.assertIn("company_name", result)
        finally:
            os.unlink(path)

    def test_json_is_readable(self):
        data = {"visitor": {"company": "Pfizer Pharmaceuticals"}}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            path = f.name
        try:
            enrich_to_json(data, path)
            with open(path, "r") as f:
                content = f.read()
            # Should be pretty-printed
            self.assertIn("\n", content)
            loaded = json.loads(content)
            self.assertEqual(
                loaded["industry_vertical"], "Healthcare & Life Sciences"
            )
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
