# E2E Test Pipeline Script

## Goal
Create a comprehensive end-to-end test script that validates the entire BoothApp pipeline: upload session data to S3, wait for processing, verify output artifacts.

## Success Criteria
1. Script generates a unique session ID per run
2. Uploads metadata.json (status=ended), clicks.json (5 events), transcript.json (10 entries) to S3
3. Polls S3 every 10s for up to 3 minutes for output/summary.json
4. Validates summary.json contains visitor_name, products_shown, visitor_interests
5. Validates output/summary.html exists
6. Prints PASS/FAIL with details
7. Uses AWS_PROFILE=hackathon, exits 0 on pass, 1 on fail
8. Script location: scripts/test/test-demo-pipeline.sh
