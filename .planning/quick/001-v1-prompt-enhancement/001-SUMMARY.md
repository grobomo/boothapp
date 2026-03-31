# Summary: Vision One Product Name Enhancement in Analysis Prompts

## What Was Done
Updated `analysis/engines/prompts.py` to make Claude analysis output more specific about Vision One product names.

### FACTUAL_EXTRACTION_PROMPT
Added a reference list of all 10 Vision One modules with parenthetical descriptions:
- Endpoint Security, Email Security, Network Security, Cloud Security, XDR
- Risk Insights, Workbench, Threat Intelligence, Zero Trust, Attack Surface Risk Management

Updated `products_demonstrated` field description to instruct the LLM to use exact module names.

### RECOMMENDATIONS_PROMPT
Added a module-to-feature mapping block that tells the LLM to suggest specific V1 capabilities based on what was demonstrated (e.g., "If they saw XDR, suggest a Workbench deep-dive with correlated alerts").

Updated field descriptions to reference V1 features by name in key_interests, follow_up_actions, and sdr_notes.

## What Was NOT Changed
- JSON output schema (same fields, same structure)
- SYSTEM_FACTUAL and SYSTEM_RECOMMENDATIONS system prompts
- HTML report template and rendering functions

## Verification
- All 10 module names confirmed present in FACTUAL_EXTRACTION_PROMPT
- V1 feature references confirmed in RECOMMENDATIONS_PROMPT
- JSON schema fields unchanged (products_demonstrated, key_interests, follow_up_actions, etc.)

## PR
https://github.com/altarr/boothapp/pull/280
