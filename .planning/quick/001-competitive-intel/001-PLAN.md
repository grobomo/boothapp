# Competitive Intelligence Module

## Goal
Create `analysis/engines/competitive.py` that detects competitor product mentions in session transcripts and generates counter-positioning insights using Trend Micro Vision One strengths.

## Success Criteria
1. Detects mentions of: CrowdStrike (Falcon), Palo Alto (Cortex XDR/XSIAM), SentinelOne, Microsoft Defender, Fortinet
2. For each mention: quotes the passage, identifies the concern/comparison point, generates a counter-positioning talking point
3. Outputs to `output/competitive-insights.json`
4. Integrates into `analyze.py` as an optional post-analysis step (--competitive flag)
5. Tests pass
