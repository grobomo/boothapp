# E2E Pipeline Test -- Summary

## What Was Done
Created `scripts/test/test-pipeline.sh` -- an automated end-to-end test that:

1. Generates a unique session ID (`E2E-TEST-{timestamp}-{pid}`)
2. Uploads synthetic metadata.json, clicks/clicks.json, and transcript/transcript.json to S3
3. Polls for output/summary.json (every 10s, up to 3 minutes)
4. Validates `visitor_name` is present and non-empty
5. Validates `products_shown` (or `products_demonstrated` in fallback mode) exists as an array
6. Cleans up all test data from S3 via EXIT trap
7. Exits 0 on pass, 1 on fail

## Verified
- Ran the test successfully against the live pipeline
- summary.json appeared within ~20 seconds
- visitor_name correctly populated from uploaded metadata
- products field detected in fallback summary format
- Cleanup removed all test artifacts from S3

## Notes
- The pipeline produces `products_shown` for AI-analyzed summaries and `products_demonstrated` for fallback summaries -- the test accepts both field names
- AWS credentials handled via instance role (no --profile needed) with optional AWS_PROFILE override
- Uses temp files for S3 uploads since `aws s3api put-object --body` requires file paths
