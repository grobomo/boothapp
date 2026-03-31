# CRM Export Engine

## Goal
Create analysis/engines/crm_export.py that transforms summary.json and follow-up.json into Salesforce-compatible CRM records (JSON + CSV).

## Success Criteria
1. crm_export.py reads summary.json and follow-up.json as input dicts
2. Produces output/crm-record.json with Salesforce-compatible fields:
   - Contact: name, company, email placeholder
   - Opportunity: product interest, engagement level, next steps
   - Activity: demo date, products shown, duration
   - Notes: key visitor questions, AI recommendations
3. Produces output/crm-export.csv with flattened fields
4. Handles missing/partial input gracefully (defaults for missing fields)
5. Unit tests pass covering normal and edge cases
6. Can be invoked standalone or imported as a module
