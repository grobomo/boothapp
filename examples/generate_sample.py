#!/usr/bin/env python3
"""Generate a sample HTML report from the included sample data."""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from analysis.engines.report_template import generate_report

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "sample_data.json")
OUT = os.path.join(HERE, "sample_report.html")

with open(DATA, "r", encoding="utf-8") as f:
    data = json.load(f)

html = generate_report(data)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print(f"Report written to {OUT} ({len(html):,} bytes)")
