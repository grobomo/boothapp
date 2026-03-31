# Analysis Pipeline Error Handling - Summary

## Changes Made

1. **`analysis/lib/retry.js`** (NEW) - Shared exponential backoff retry utility with configurable maxRetries, baseDelayMs, and onRetry callback.

2. **`analysis/watcher.js`** - Pipeline trigger now retries up to 2 times with exponential backoff. On final failure, writes `error.json` to S3 (`sessions/<id>/output/error.json`) with error details and timestamp.

3. **`analysis/pipeline-run.js`** - Replaced inline retry with shared `retry.js`. Added `STAGE_TIMEOUT_MS = 300000` (5 min) applied to each stage's `execFileSync` call (analyze, render, email).

4. **`analysis/engines/analyzer.py`** - Added `_call_llm_with_retry()` that retries on transient Bedrock errors (ThrottlingException, ServiceUnavailableException, rate_limit_error, etc.) up to 3 times. Both LLM passes (factual + recommendations) use it. On unrecoverable failure, `analyze()` returns a fallback result with error message instead of crashing.

5. **`analysis/test/retry-test.js`** (NEW) - Tests for retry.js: immediate success, transient recovery, exhaustion, onRetry callback, exponential delay verification.

## Tests
- All existing tests pass (pipeline-error-test, watcher-health-test)
- New retry-test passes (5 tests, 13 assertions)
