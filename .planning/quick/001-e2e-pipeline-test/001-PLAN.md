# Plan: E2E Pipeline Integration Test

## Goal
Create `scripts/test/test-e2e-pipeline.sh` that proves the full boothapp pipeline works end-to-end: upload sample session -> watcher detects -> analysis runs -> validate output -> cleanup.

## Success Criteria
- [ ] Script generates realistic sample session (metadata, clicks, screenshots, transcript)
- [ ] Uploads to S3 under a test session ID
- [ ] Polls for output/summary.json with 120s timeout
- [ ] Validates summary.json exists and has required fields (visitor_name, key_insights, recommendations)
- [ ] Validates HTML report exists
- [ ] Cleans up test session from S3
- [ ] Exits 0 on success, non-zero with descriptive error on failure
- [ ] Uses env vars: AWS_PROFILE=hackathon, S3_BUCKET=boothapp-sessions-752266476357, AWS_REGION=us-east-1

## Approach
Model after existing `scripts/test-integration.sh` but with:
- Region us-east-1 (not us-east-2)
- Required fields from DATA-CONTRACT.md: visitor_name, key_interests, follow_up_actions (mapped from spec's "key_insights" and "recommendations")
- HTML report check (summary.html)
- Mock screenshot upload for realism
- Cleaner error messages
