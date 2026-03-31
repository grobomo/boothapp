# Company Research Enrichment

## Goal
Add a visitor company research enrichment engine to the analysis pipeline. Given a company name from visitor badge data, infer company size, likely security stack, industry vertical, and relevant Trend Micro case studies. Output to `output/enrichment.json`.

## Success Criteria
1. New engine `analysis/engines/enrichment.py` that takes a company name and returns structured enrichment data
2. Output includes: estimated_company_size, likely_security_stack, industry_vertical, relevant_case_studies
3. No external API calls -- all inference from company name heuristics and keyword matching
4. Results stored in `output/enrichment.json` format
5. Tests pass for the enrichment engine
6. Integrates with existing pipeline data flow (accepts same session data dict)
