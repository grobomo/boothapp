# Watcher Health Endpoint

## Goal
Add an HTTP health check endpoint to `analysis/watcher.js` that returns JSON status, enabling container orchestrators and monitoring tools to verify watcher liveness.

## Success Criteria
1. GET /health returns HTTP 200 with Content-Type: application/json
2. Response body includes: status ("ok"), uptime (seconds), pendingSessions (count), pollIntervalMs
3. Unknown paths return 404
4. Port is configurable via HEALTH_PORT env var (default 8080)
5. createHealthServer accepts a port parameter for testing
6. Health server is started/stopped with the watcher lifecycle
7. All existing tests continue to pass
8. Dedicated health endpoint test covers criteria 1-4
