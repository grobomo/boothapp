# Watcher Retry Logic for Bedrock Failures

## Goal
Add retry logic with exponential backoff (5s, 15s, 45s) for Bedrock API errors and timeouts in the analysis pipeline watcher, and write failed status to S3 metadata for dashboard visibility.

## Success Criteria
1. Pipeline failures retry up to 3 times with delays of 5s, 15s, 45s
2. Only Bedrock API errors and timeouts trigger retries (not all errors)
3. After exhausting retries, session metadata.json gets `analysis_status: "failed"` + error details
4. Existing error.json write still happens on final failure
5. Dashboard can query metadata.json to show failed sessions
6. Existing retry behavior for non-Bedrock errors unchanged

## Changes
- `analysis/lib/retry.js`: Add `multiplier` option (default 2, use 3 for 5/15/45 pattern)
- `analysis/lib/s3.js`: Add `updateMetadata()` to merge fields into existing metadata.json
- `analysis/watcher.js`: Update retry config, add Bedrock error detection, write failed status
