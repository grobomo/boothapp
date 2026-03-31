# Health Monitoring Endpoint + Status Page

## Goal
Add comprehensive health monitoring: GET /api/health with service checks (watcher PID, S3 connectivity, presenter status, session stats) and a presenter/status.html dashboard with auto-refresh, color indicators, and error log display.

## Success Criteria
1. GET /api/health returns JSON with: status, uptime_seconds, services (watcher/presenter/s3), sessions (total/active/completed), version
2. S3 check actually lists 1 object (or returns "error" on failure)
3. Watcher check verifies PID file exists
4. presenter/status.html renders dashboard with auto-refresh (5s), green/red indicators, uptime counter, last errors
5. All existing tests pass + new tests for the health endpoint
