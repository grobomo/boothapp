# Fix Bedrock JSON Parsing

## Goal
Fix "Expecting value: line 1 column 1 (char 0)" error when parsing Bedrock/Claude responses that contain markdown fences or extra text around JSON.

## Success Criteria
- [ ] `_extract_json` handles markdown code fences (```json ... ```)
- [ ] `_extract_json` handles extra text before/after JSON object
- [ ] Raw response text logged (first 200 chars) for debugging
- [ ] On parse failure, retry with explicit "respond with only JSON" instruction
- [ ] Both pass1 (factual) and pass2 (recommendations) use robust extraction
- [ ] Syntax check passes
