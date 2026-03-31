# Analysis Pipeline Error Handling & Resilience

## Goal

Add production-grade error handling and resilience to the analysis pipeline:
retry logic, dead-letter handling, metrics endpoint, graceful shutdown, and
session timeout.

## Success Criteria

1. `analysis/watcher.js` has retry logic (3 attempts, exponential backoff) for S3 operations
2. Sessions failing 3 times get `sessions/<id>/output/error.json` with failure details
3. GET /api/watcher-stats returns metrics: sessions processed, avg processing time, error count
4. SIGTERM triggers graceful shutdown (finish current session, stop polling)
5. `analysis/pipeline-run.js` enforces 10-minute max timeout per session
6. All new code has tests
