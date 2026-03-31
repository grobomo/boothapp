# Competitive Analysis Pass

## Goal
Add a third analysis pass in `analysis/engines/prompts.py` that maps Vision One features demonstrated during a booth visit to specific visitor pain points relative to competitors (CrowdStrike, Palo Alto, SentinelOne, Microsoft Defender, Splunk). Output to `output/competitive.json`.

## Success Criteria
1. `analysis/engines/prompts.py` exists with a `generate_competitive_analysis()` function
2. Function accepts the same session data dict used by report_template
3. Output is a structured JSON file at `output/competitive.json`
4. JSON contains per-feature entries mapping V1 capabilities to competitor weaknesses
5. Covers all 5 competitors: CrowdStrike, Palo Alto, SentinelOne, Microsoft Defender, Splunk
6. Tests pass in `tests/test_prompts.py`
7. Sample data produces valid output
