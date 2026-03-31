# Analysis Pipeline Error Handling - Summary

## What was done

1. **analysis/watcher.js** - Added retry (up to 2 times) around `processSession` using the new retry utility. On final failure, writes error.json both locally and to S3 via `writeErrorToS3()`.

2. **analysis/pipeline-run.js** (new) - Pipeline runner with `withTimeout()` that enforces a 5-minute wall-clock timeout per pipeline stage invocation.

3. **analysis/analyze.py** (new) - Python Bedrock transcript analyzer with retry logic for transient errors (throttling, timeouts, 429/503). Returns a fallback message dict if Claude fails after all retries.

4. **analysis/lib/retry.js** (new) - Reusable exponential backoff utility with configurable `shouldRetry` predicate, jitter, and `onRetry` callback.

## Verification
- All existing tests pass (correlator + errors)
- All new modules load without errors
- retry utility smoke-tested (retries transient failures, succeeds on recovery)
- analyze.py syntax validated
