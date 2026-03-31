# E2E Pipeline Test

## Goal
Create `scripts/test/test-pipeline.sh` that performs an automated end-to-end test of the full boothapp analysis pipeline by uploading test data to S3 and verifying the output.

## Success Criteria
1. Script generates a unique session ID (e.g., E2E-TEST-{random})
2. Uploads metadata.json, clicks/clicks.json, and transcript/transcript.json to S3 under sessions/{id}/
3. Waits up to 3 minutes (polling) for output/summary.json to appear in S3
4. Validates summary.json contains `visitor_name` and `products_shown` fields
5. Exits 0 on pass, 1 on fail
6. Cleans up test data from S3 after test completes

## Approach
- Follow patterns from existing `scripts/preflight.sh` (color output, check functions)
- Use AWS CLI for S3 operations (put-object, head-object, get-object)
- Generate synthetic but realistic test data matching the existing session format
- Poll every 10 seconds for summary.json (18 attempts = 3 minutes)
