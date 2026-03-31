# Manager Daemon Plan

## Goal
Create `scripts/fleet/manager-daemon.py`: a Python HTTP server that acts as a hierarchical manager for up to 5 child nodes (workers or sub-managers), with task queuing, heartbeat monitoring, blocker escalation, and two dispatch modes (HTTP for sub-managers, SSH for workers).

## Success Criteria
1. HTTP server starts on configurable port (MANAGER_PORT env, default 8080)
2. POST /api/register -- child registers with name, ip, role; max 5 enforced
3. POST /api/submit -- receive task, assign to least-busy child
4. POST /api/task-complete -- child reports task completion
5. POST /api/blocker -- child reports blocker; creates GitHub issue and escalates to parent
6. GET /health -- own health + children summary
7. GET /api/status -- full status of all children and tasks
8. GET /api/children -- list registered children
9. Task queue with 5s drain loop
10. Heartbeat monitoring: mark child unhealthy if no heartbeat in 60s
11. Task reassignment on child failure
12. Dispatch: HTTP POST for role=manager, SSH docker exec for role=worker
13. Env vars: ROLE, MANAGER_NAME, MANAGER_TIER, PARENT_URL, MANAGER_PORT, SSH_KEY_DIR
