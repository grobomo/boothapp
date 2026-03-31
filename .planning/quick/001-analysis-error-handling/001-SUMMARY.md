# Analysis Pipeline Error Handling - Summary

## What was done

1. **analysis/watcher.js** - Added retry (up to 2 times) around processSession using retryWithExponentialBackoff. On final failure, writes error.json to S3 via PutObjectCommand and locally via writeErrorJson.

2. **analysis/pipeline-run.js** (new) - Added withTimeout utility and runStageWithTimeout/runPipelineWithTimeout functions that enforce a 5-minute per-stage timeout (configurable via STAGE_TIMEOUT_MS env var). Rejects with StageTimeoutError.

3. **analysis/analyze.py** (new) - Python Bedrock analysis script with error handling for ThrottlingException, ModelTimeoutException, ValidationException, and generic failures. Returns a fallback message instead of crashing.

4. **analysis/lib/retry.js** (new) - Exponential backoff utility with configurable maxRetries, baseDelayMs, maxDelayMs, shouldRetry predicate, and onRetry callback.

5. **Tests** - Added retry.test.js (6 tests) and pipeline-run.test.js (5 tests). All 31 tests pass.
