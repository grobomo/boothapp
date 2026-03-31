# Plan: manager-daemon tests

## Goal
Add integration tests for scripts/fleet/manager-daemon.py covering all endpoints,
edge cases, max-children enforcement, heartbeat timeout, and task reassignment.

## Success Criteria
- [x] All 7 HTTP endpoints tested (health, register, submit, task-complete, blocker, heartbeat, children, status)
- [x] Max 5 children enforcement tested
- [x] Heartbeat timeout marks child unhealthy
- [x] Task reassignment on child failure tested
- [x] least_busy_child logic tested (healthy/unhealthy/empty)
- [x] 404 handling for unknown routes
- [x] All tests pass (21/21)
