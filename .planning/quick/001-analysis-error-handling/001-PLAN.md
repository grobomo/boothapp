# Analysis Pipeline Error Handling

## Goal
Add robust error handling to the analysis pipeline: retry logic, stage timeouts, Bedrock error handling with fallback, and error.json written to S3 on failure.

## Success Criteria
1. `analysis/lib/retry.js` exists with exponential backoff utility (configurable retries, base delay)
2. `watcher.js` wraps pipeline trigger in try/catch with up to 2 retries, writes error.json to S3 on final failure
3. `pipeline-run.js` enforces 5-minute (300s) timeout per stage
4. `analyze.py` handles Bedrock errors gracefully with fallback message
5. All existing tests still pass
