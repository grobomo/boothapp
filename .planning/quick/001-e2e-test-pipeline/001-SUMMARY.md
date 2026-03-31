# E2E Test Pipeline -- Summary

## What Was Done
- Created `scripts/test/test-demo-pipeline.sh` -- comprehensive end-to-end test for the BoothApp session pipeline
- S3 paths match the data contract from hackathon26/CLAUDE.md: `sessions/<id>/metadata.json`, `clicks/clicks.json`, `transcript/transcript.json`
- Script generates unique session IDs, uploads 3 JSON files, polls for output, validates 5 checks, cleans up on exit

## Success Criteria Verification
1. Unique session ID -- YES: `test-YYYYMMDD-HHMMSS-PID` format
2. Uploads metadata (status=ended), clicks (5 events), transcript (10 entries) -- YES, validated with jq dry-run
3. Polls every 10s for up to 3 minutes -- YES: POLL_INTERVAL=10, POLL_TIMEOUT=180
4. Validates visitor_name, products_shown, visitor_interests -- YES: jq field extraction loop
5. Verifies output/summary.html exists -- YES: aws s3 ls check
6. PASS/FAIL with details -- YES: per-check pass/fail with summary block
7. AWS_PROFILE=hackathon, exit 0/1 -- YES

## Blockers
- GitHub auth not available in sandbox -- branch `feat/e2e-test-pipeline` created locally, needs push + PR from local machine

## Decisions
- Used `sessions/` prefix in S3 paths to match actual data contract (not flat `<id>/`)
- Added EXIT trap for cleanup so test sessions don't accumulate in S3
- Transcript and clicks use subdirectory paths (`clicks/clicks.json`, `transcript/transcript.json`) matching watcher expectations
