# Analysis Error Handling

## Goal
Add robust error handling to the analysis pipeline: retry with backoff, per-stage timeouts, S3 error reporting, and Bedrock fallback.

## Success Criteria
1. `analysis/lib/retry.js` exists with exponential backoff utility (jitter, configurable maxRetries/delay/shouldRetry)
2. `analysis/pipeline-run.js` wraps pipeline with 5-minute per-stage timeout
3. `analysis/watcher.js` uses retry.js for up to 2 retries, writes error.json to S3 on failure
4. `analysis/analyze.py` handles Bedrock errors with fallback response
5. Tests pass for retry.js and pipeline-run.js
6. All existing tests still pass
