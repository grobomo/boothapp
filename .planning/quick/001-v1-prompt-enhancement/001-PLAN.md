# Plan: Vision One Product Name Enhancement in Analysis Prompts

## Goal
Update Claude analysis prompts in `analysis/engines/prompts.py` to explicitly list all Vision One module names in the factual extraction prompt and reference specific V1 features in the recommendations prompt, making hackathon demo output more impressive.

## Success Criteria
1. FACTUAL_EXTRACTION_PROMPT lists all 10 V1 modules by name: Endpoint Security, Email Security, Network Security, Cloud Security, XDR, Risk Insights, Workbench, Threat Intelligence, Zero Trust, Attack Surface Risk Management
2. RECOMMENDATIONS_PROMPT references specific V1 features when suggesting follow-up actions
3. Existing JSON output schema is unchanged (no breaking changes)
4. Prompt formatting is clean and readable
