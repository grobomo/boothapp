# Summary: manager-daemon tests

Added 21 integration tests for the fleet manager daemon. Tests spin up a real
HTTP server on a random port and exercise every endpoint including error paths.

Key coverage:
- All 7 endpoints: health, register, submit, task-complete, blocker, heartbeat, children/status
- Max children (5) enforcement returns 409
- Re-registration updates existing child
- Heartbeat timeout marks child unhealthy and reassigns running tasks
- least_busy_child selects correctly, skips unhealthy, returns None when empty
- Blocker requeues task and decrements child task count
- 404 on unknown GET/POST routes
