# E2E Test at tests/e2e/test-full-pipeline.sh

## Goal
Add the E2E integration test at the requested path `tests/e2e/test-full-pipeline.sh`, based on the existing `scripts/test/test-e2e-pipeline.sh` that was merged in PR #180.

## Success Criteria
- tests/e2e/test-full-pipeline.sh exists and is executable
- Script creates mock session data matching DATA-CONTRACT.md schemas
- Script triggers analysis pipeline via S3 upload
- Script waits for output files (summary.json, summary.html, follow-up.json)
- Script validates output structure and content
- Script cleans up test data on exit
- Exit 0 on pass, non-zero on fail
- Uses AWS CLI with profile hackathon
