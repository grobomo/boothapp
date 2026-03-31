# Summary: E2E Pipeline Integration Test

## What was done
Created `scripts/test/test-e2e-pipeline.sh` -- a comprehensive end-to-end test that proves the full boothapp pipeline works.

## Test flow
1. Preflight check: verifies AWS credentials and bucket access
2. Generates realistic sample session: metadata (visitor "Alex Rivera" from "Contoso Security"), 3 click events across V1 pages, 3 placeholder screenshot JPEGs, 8-entry transcript with realistic SE/visitor dialogue about XDR and endpoint security
3. Uploads all files to S3 under unique test session ID
4. Polls for `output/summary.json` (5s interval, 120s timeout)
5. Validates summary.json: valid JSON, required fields (session_id, visitor_name, key_interests, follow_up_actions, executive_summary), correct session ID and visitor name
6. Validates HTML report exists and contains `<html>` tag
7. Reports optional outputs (timeline.json, follow-up.json, .analysis-claimed)
8. Cleans up test session from S3 (unless --no-cleanup)
9. Exits 0 on success, non-zero with descriptive errors on failure

## Config
- AWS_PROFILE=hackathon, S3_BUCKET=boothapp-sessions-752266476357, AWS_REGION=us-east-1
- All configurable via env vars with sensible defaults
