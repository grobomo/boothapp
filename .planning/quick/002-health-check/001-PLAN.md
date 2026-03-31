# Health Check Endpoint

## Goal
Add GET /api/health endpoint to the boothapp server that returns JSON with status and timestamp.

## Success Criteria
1. GET /api/health returns HTTP 200
2. Response is JSON with `status: "ok"` and `timestamp` (ISO 8601)
3. Existing tests still pass
4. New endpoint has a test
