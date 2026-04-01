# Dispatcher Brain

## Goal

Build `scripts/fleet/dispatcher-brain.sh` and supporting modules that create a persistent, long-running dispatcher session. The dispatcher accepts tasks via HTTP POST, maintains context across tasks, runs periodic fleet maintenance, and supports agent-to-agent communication -- all without requiring a human operator.

## Success Criteria

1. `dispatcher-brain.sh` starts a persistent session with FIFO-based input
2. HTTP server (`dispatcher-server.js`) accepts POST /api/submit and pipes tasks into the session
3. Web dashboard at / with a /submit page that feeds into the live session
4. Session state persisted via TODO.md and state files in a context directory
5. Fleet-heal timer runs every 10 minutes (cron-style via setInterval)
6. A2A endpoint at POST /api/a2a for agent-to-agent communication
7. Health endpoint at GET /health returns session status, uptime, task counts
8. Task queue with status tracking (pending, running, completed, failed)
9. Idle between tasks (no CPU burn -- event-driven, not polling)
10. All existing tests continue to pass
11. New unit tests for dispatcher-server.js core logic

## Architecture

```
dispatcher-brain.sh          -- Entry point: creates FIFO, starts server + session loop
dispatcher-server.js         -- HTTP server: /api/submit, /api/a2a, /health, / dashboard
dispatcher-state.js          -- State management: task queue, context, persistence
dispatcher-brain.test.js     -- Unit tests for state + server logic
```

## Approach

- Node.js HTTP server (consistent with existing central-server.js pattern)
- Named pipe (FIFO) for feeding tasks into a shell session loop
- State persisted to JSON file on disk
- Dashboard is inline HTML (same pattern as central-server.js)
- No external dependencies (stdlib only)
