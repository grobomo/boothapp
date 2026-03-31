# Company Research Enrichment -- Summary

## What Was Done
- Added `analysis/engines/enrichment.py` -- heuristic-based company research enrichment engine
- Added `tests/test_enrichment.py` -- 39 tests covering all enrichment logic
- All 60 project tests pass (39 new + 21 existing)

## How It Works
Given a visitor company name, the engine infers:
1. **Industry vertical** -- scored keyword matching across 13 industry categories with word-boundary protection for short keywords
2. **Estimated company size** -- known company lookup, then naming pattern heuristics (Corp/Global = large, Inc/Ltd = mid-market)
3. **Likely security stack** -- industry-mapped tools, compliance frameworks, and pain points
4. **Relevant case studies** -- industry-specific Trend Micro reference stories

## API
- `enrich_company(name)` -- core enrichment from company name
- `enrich_from_session(data)` -- extracts company from session data dict (same format as report_template)
- `enrich_to_json(data, path)` -- enriches and writes to output/enrichment.json

## No External APIs
All inference is local -- keyword matching and curated lookup tables. Zero network calls.
