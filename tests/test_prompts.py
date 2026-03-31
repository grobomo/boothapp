"""Tests for analysis.engines.prompts -- competitive analysis pass."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.prompts import (
    COMPETITORS,
    generate_competitive_analysis,
    write_competitive_analysis,
    _normalize_product,
    _detect_competitors,
    _detect_features,
)


SAMPLE_DATA = {
    "report_id": "RPT-TEST-002",
    "generated_at": "2026-03-31 10:00",
    "visitor": {
        "name": "Sarah Chen",
        "title": "VP of Information Security",
        "company": "Acme Financial Corp",
        "email": "schen@acmefin.example.com",
    },
    "products_demonstrated": [
        {"name": "Vision One XDR", "timestamp": "14:02",
         "note": "Asked about SOC integration and SIEM correlation"},
        {"name": "Cloud Security - Container Protection", "timestamp": "14:10",
         "note": "Running Kubernetes in AWS EKS"},
        {"name": "Zero Trust Secure Access", "timestamp": "14:18",
         "note": "Currently evaluating ZTNA solutions"},
        {"name": "Email Security", "timestamp": "14:24",
         "note": "Recent BEC incidents"},
    ],
    "interests": [
        {"topic": "XDR / SOC Modernization", "confidence": "high",
         "detail": "Consolidating point products into unified platform"},
        {"topic": "Cloud Workload Security", "confidence": "high",
         "detail": "Active K8s deployment, evaluating runtime protection"},
        {"topic": "Zero Trust Network Access", "confidence": "medium",
         "detail": "In evaluation phase, comparing 3 vendors"},
        {"topic": "Email Threat Protection", "confidence": "medium",
         "detail": "Reactive interest after recent BEC incident"},
    ],
    "recommendations": [],
}


SAMPLE_WITH_COMPETITORS = {
    **SAMPLE_DATA,
    "interests": [
        {"topic": "XDR / SOC Modernization", "confidence": "high",
         "detail": "Currently using CrowdStrike Falcon, wants better email coverage"},
        {"topic": "Cloud Workload Security", "confidence": "high",
         "detail": "Comparing Palo Alto Prisma Cloud vs Vision One"},
    ],
}


class TestNormalizeProduct(unittest.TestCase):

    def test_xdr_variants(self):
        self.assertEqual(_normalize_product("Vision One XDR"), "XDR")
        self.assertEqual(_normalize_product("XDR"), "XDR")
        self.assertEqual(_normalize_product("SOC integration"), "XDR")

    def test_cloud_variants(self):
        self.assertEqual(_normalize_product("Cloud Security - Container"), "Cloud Security")
        self.assertEqual(_normalize_product("Kubernetes workloads"), "Cloud Security")

    def test_email_variants(self):
        self.assertEqual(_normalize_product("Email Security"), "Email Security")
        self.assertEqual(_normalize_product("BEC detection"), "Email Security")

    def test_ztna_variants(self):
        self.assertEqual(_normalize_product("Zero Trust Secure Access"), "Zero Trust Secure Access")
        self.assertEqual(_normalize_product("ZTNA solutions"), "Zero Trust Secure Access")

    def test_endpoint_variants(self):
        self.assertEqual(_normalize_product("Endpoint Protection"), "Endpoint Security")
        self.assertEqual(_normalize_product("EDR capabilities"), "Endpoint Security")

    def test_mdr_variants(self):
        self.assertEqual(_normalize_product("Managed Detection & Response"), "Managed Detection & Response")

    def test_unknown_returns_none(self):
        self.assertIsNone(_normalize_product("Unrelated Product"))
        self.assertIsNone(_normalize_product(""))


class TestDetectCompetitors(unittest.TestCase):

    def test_no_competitors(self):
        result = _detect_competitors(SAMPLE_DATA)
        self.assertEqual(result, [])

    def test_crowdstrike_detected(self):
        result = _detect_competitors(SAMPLE_WITH_COMPETITORS)
        self.assertIn("CrowdStrike", result)

    def test_palo_alto_detected(self):
        result = _detect_competitors(SAMPLE_WITH_COMPETITORS)
        self.assertIn("Palo Alto", result)

    def test_alias_detection(self):
        data = {"interests": [{"detail": "Using Falcon for EDR"}]}
        result = _detect_competitors(data)
        self.assertIn("CrowdStrike", result)

    def test_splunk_detection(self):
        data = {"interests": [{"detail": "Migrating from Splunk SIEM"}]}
        result = _detect_competitors(data)
        self.assertIn("Splunk", result)

    def test_microsoft_detection(self):
        data = {"interests": [{"detail": "Replacing Microsoft Defender"}]}
        result = _detect_competitors(data)
        self.assertIn("Microsoft Defender", result)

    def test_sentinelone_detection(self):
        data = {"interests": [{"detail": "Evaluating SentinelOne S1"}]}
        result = _detect_competitors(data)
        self.assertIn("SentinelOne", result)


class TestDetectFeatures(unittest.TestCase):

    def test_detects_from_products(self):
        features = _detect_features(SAMPLE_DATA)
        self.assertIn("XDR", features)
        self.assertIn("Cloud Security", features)
        self.assertIn("Email Security", features)
        self.assertIn("Zero Trust Secure Access", features)

    def test_detects_from_interests(self):
        data = {
            "products_demonstrated": [],
            "interests": [{"topic": "EDR capabilities", "confidence": "high", "detail": ""}],
        }
        features = _detect_features(data)
        self.assertIn("Endpoint Security", features)

    def test_detects_from_notes(self):
        data = {
            "products_demonstrated": [
                {"name": "Demo", "note": "Kubernetes runtime protection"},
            ],
            "interests": [],
        }
        features = _detect_features(data)
        self.assertIn("Cloud Security", features)

    def test_empty_data(self):
        self.assertEqual(_detect_features({}), [])

    def test_returns_sorted(self):
        features = _detect_features(SAMPLE_DATA)
        self.assertEqual(features, sorted(features))


class TestGenerateCompetitiveAnalysis(unittest.TestCase):

    def test_returns_dict(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        self.assertIsInstance(result, dict)

    def test_has_required_keys(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        for key in ["report_id", "generated_at", "visitor", "competitors_detected",
                     "competitors_analyzed", "features_demonstrated",
                     "competitive_positioning"]:
            self.assertIn(key, result)

    def test_visitor_info(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        self.assertEqual(result["visitor"]["name"], "Sarah Chen")
        self.assertEqual(result["visitor"]["company"], "Acme Financial Corp")

    def test_no_competitors_analyzes_all(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        self.assertEqual(result["competitors_detected"], [])
        self.assertEqual(len(result["competitors_analyzed"]), 5)

    def test_explicit_competitors_narrows_analysis(self):
        result = generate_competitive_analysis(SAMPLE_WITH_COMPETITORS)
        self.assertIn("CrowdStrike", result["competitors_analyzed"])
        self.assertIn("Palo Alto", result["competitors_analyzed"])
        self.assertEqual(len(result["competitors_analyzed"]), 2)

    def test_positioning_has_features(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        features = [p["feature"] for p in result["competitive_positioning"]]
        self.assertIn("XDR", features)
        self.assertIn("Cloud Security", features)

    def test_positioning_has_v1_strength(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        for pos in result["competitive_positioning"]:
            self.assertIn("v1_strength", pos)
            self.assertTrue(len(pos["v1_strength"]) > 0)

    def test_positioning_has_competitor_gaps(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        for pos in result["competitive_positioning"]:
            self.assertIn("competitor_gaps", pos)
            self.assertIsInstance(pos["competitor_gaps"], list)
            for gap in pos["competitor_gaps"]:
                self.assertIn("competitor", gap)
                self.assertIn("gap", gap)

    def test_all_five_competitors_covered(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        all_competitors = set()
        for pos in result["competitive_positioning"]:
            for gap in pos["competitor_gaps"]:
                all_competitors.add(gap["competitor"])
        for comp in ["CrowdStrike", "Palo Alto", "SentinelOne",
                      "Microsoft Defender", "Splunk"]:
            self.assertIn(comp, all_competitors)

    def test_empty_data(self):
        result = generate_competitive_analysis({})
        self.assertEqual(result["features_demonstrated"], [])
        self.assertEqual(result["competitive_positioning"], [])

    def test_report_id_preserved(self):
        result = generate_competitive_analysis(SAMPLE_DATA)
        self.assertEqual(result["report_id"], "RPT-TEST-002")


class TestWriteCompetitiveAnalysis(unittest.TestCase):

    def test_writes_json_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = write_competitive_analysis(SAMPLE_DATA, output_dir=tmpdir)
            self.assertTrue(os.path.exists(path))
            self.assertTrue(path.endswith("competitive.json"))

    def test_output_is_valid_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = write_competitive_analysis(SAMPLE_DATA, output_dir=tmpdir)
            with open(path) as f:
                data = json.load(f)
            self.assertIn("competitive_positioning", data)

    def test_creates_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            subdir = os.path.join(tmpdir, "new_output")
            path = write_competitive_analysis(SAMPLE_DATA, output_dir=subdir)
            self.assertTrue(os.path.exists(path))

    def test_default_output_dir(self):
        original_dir = os.getcwd()
        with tempfile.TemporaryDirectory() as tmpdir:
            os.chdir(tmpdir)
            try:
                path = write_competitive_analysis(SAMPLE_DATA)
                self.assertTrue(os.path.exists(path))
                self.assertIn("output", path)
            finally:
                os.chdir(original_dir)


if __name__ == "__main__":
    unittest.main()
