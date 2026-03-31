# Summary: Watcher Retry Logic for Bedrock Failures

## What Was Done
- Added `multiplier` and `isRetryable` options to `withRetry()` in `lib/retry.js`
- Added `updateMetadata()` to `lib/s3.js` for read-modify-write on metadata.json
- Updated `watcher.js` pipeline retry: 3 retries with 5s/15s/45s backoff (3x multiplier)
- Added `isBedrockRetryable()` to detect throttling, timeouts, and connection errors
- On final failure: writes `analysis_status: "failed"` + error details to metadata.json
- Added 4 new tests (Tests 6-9) to `retry-test.js` covering multiplier and isRetryable

## PR
https://github.com/altarr/boothapp/pull/227

## Decisions
- Used `multiplier` option (not hardcoded 3x) to keep retry lib generic
- `isRetryable` returns false -> immediate throw (no wasted retries on bad input)
- Failed status goes in metadata.json (dashboard-queryable) AND error.json (detailed stack)
- `analysis_retryable` field in metadata tells dashboard if manual retry might help
