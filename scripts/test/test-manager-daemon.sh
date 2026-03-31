#!/usr/bin/env bash
#
# Integration test for the fleet manager daemon.
# Starts the daemon locally, registers 2 mock children,
# submits a task, and verifies assignment.
#

set -euo pipefail

PORT=18080
BASE="http://localhost:${PORT}"
DAEMON_PID=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON="$SCRIPT_DIR/../fleet/manager-daemon.py"

# -----------------------------------------------
# Helpers
# -----------------------------------------------

fail() { echo "FAIL: $1" >&2; cleanup; exit 1; }
pass() { echo "PASS: $1"; }

cleanup() {
    if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
        kill "$DAEMON_PID" 2>/dev/null || true
        wait "$DAEMON_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

http_get() {
    curl -sf --max-time 5 "$1"
}

http_post() {
    curl -sf --max-time 5 -X POST -H "Content-Type: application/json" -d "$2" "$1"
}

wait_for_server() {
    local tries=0
    while ! curl -sf --max-time 1 "$BASE/health" >/dev/null 2>&1; do
        tries=$((tries + 1))
        if [ "$tries" -ge 20 ]; then
            fail "daemon did not start within 10 seconds"
        fi
        sleep 0.5
    done
}

# -----------------------------------------------
# Start daemon
# -----------------------------------------------

echo "--- Starting manager daemon on port $PORT ---"
DRY_RUN=1 MANAGER_PORT=$PORT MANAGER_NAME=test-manager MANAGER_TIER=t1 \
    python3 "$DAEMON" &
DAEMON_PID=$!
wait_for_server
pass "daemon started (pid=$DAEMON_PID)"

# -----------------------------------------------
# Test: health endpoint
# -----------------------------------------------

health=$(http_get "$BASE/health")
echo "$health" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['status'] == 'ok', f'bad status: {d[\"status\"]}'
assert d['children_count'] == 0, f'expected 0 children, got {d[\"children_count\"]}'
assert d['name'] == 'test-manager', f'bad name: {d[\"name\"]}'
" || fail "health check"
pass "health endpoint returns correct data"

# -----------------------------------------------
# Test: register 2 children
# -----------------------------------------------

resp=$(http_post "$BASE/api/register" '{"name":"worker-1","ip":"10.0.0.1","role":"worker"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['registered'] == 'worker-1'
" || fail "register worker-1"
pass "registered worker-1"

resp=$(http_post "$BASE/api/register" '{"name":"worker-2","ip":"10.0.0.2","role":"worker"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['registered'] == 'worker-2'
" || fail "register worker-2"
pass "registered worker-2"

# verify children count
health=$(http_get "$BASE/health")
echo "$health" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['children_count'] == 2, f'expected 2, got {d[\"children_count\"]}'
assert d['idle'] == 2, f'expected 2 idle, got {d[\"idle\"]}'
" || fail "children count after register"
pass "children count = 2, both idle"

# -----------------------------------------------
# Test: list children
# -----------------------------------------------

children=$(http_get "$BASE/api/children")
echo "$children" | python3 -c "
import sys, json; d = json.load(sys.stdin)
names = {c['name'] for c in d['children']}
assert names == {'worker-1', 'worker-2'}, f'unexpected children: {names}'
" || fail "list children"
pass "GET /api/children lists both workers"

# -----------------------------------------------
# Test: max children enforcement
# -----------------------------------------------

for i in 3 4 5; do
    http_post "$BASE/api/register" "{\"name\":\"worker-$i\",\"ip\":\"10.0.0.$i\",\"role\":\"worker\"}" >/dev/null
done

resp=$(http_post "$BASE/api/register" '{"name":"worker-6","ip":"10.0.0.6","role":"worker"}' 2>&1 || true)
# curl returns non-zero on 409, check via verbose request
status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
    -H "Content-Type: application/json" \
    -d '{"name":"worker-6","ip":"10.0.0.6","role":"worker"}' \
    "$BASE/api/register")
[ "$status" = "409" ] || fail "expected 409 for 6th child, got $status"
pass "max 5 children enforced (409 on 6th)"

# -----------------------------------------------
# Test: submit task -> assigned to idle child
# -----------------------------------------------

resp=$(http_post "$BASE/api/submit" '{"prompt":"analyze session data"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['task_id'] == 'task-0001', f'unexpected task_id: {d[\"task_id\"]}'
assert d['assigned_to'] is not None, 'task not assigned to any child'
assert d['status'] == 'assigned', f'expected assigned, got {d[\"status\"]}'
" || fail "submit task"
pass "task submitted and assigned to a child"

# verify busy count
health=$(http_get "$BASE/health")
echo "$health" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['busy'] >= 1, f'expected at least 1 busy, got {d[\"busy\"]}'
" || fail "busy count after submit"
pass "at least 1 child busy after task submit"

# -----------------------------------------------
# Test: task-complete
# -----------------------------------------------

assigned=$(echo "$resp" | python3 -c "import sys, json; print(json.load(sys.stdin)['assigned_to'])")
resp=$(http_post "$BASE/api/task-complete" \
    "{\"task_id\":\"task-0001\",\"child_name\":\"$assigned\",\"output\":\"done\"}")
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['status'] == 'completed'
" || fail "task-complete"
pass "task-complete accepted"

# verify child is idle again
health=$(http_get "$BASE/health")
echo "$health" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['busy'] == 0, f'expected 0 busy after complete, got {d[\"busy\"]}'
" || fail "child not idle after complete"
pass "child idle after task-complete"

# -----------------------------------------------
# Test: status endpoint
# -----------------------------------------------

status=$(http_get "$BASE/api/status")
echo "$status" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['manager'] == 'test-manager'
assert d['tier'] == 't1'
assert len(d['children']) == 5
assert len(d['recent_completed']) >= 1
" || fail "status endpoint"
pass "GET /api/status returns full tree"

# -----------------------------------------------
# Test: blocker (without gh CLI -- just verify HTTP 200)
# -----------------------------------------------

resp=$(http_post "$BASE/api/blocker" \
    '{"task_id":"task-0001","child_name":"worker-1","description":"test blocker"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['status'] == 'blocked'
" || fail "blocker endpoint"
pass "blocker endpoint accepted"

# -----------------------------------------------
# Test: heartbeat
# -----------------------------------------------

resp=$(http_post "$BASE/api/heartbeat" '{"name":"worker-1"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['status'] == 'ok'
" || fail "heartbeat"
pass "heartbeat accepted"

# -----------------------------------------------
# Test: dry-run auto-completion (dispatch simulates success)
# -----------------------------------------------

resp=$(http_post "$BASE/api/submit" '{"prompt":"dry run test"}')
task_id=$(echo "$resp" | python3 -c "import sys, json; print(json.load(sys.stdin)['task_id'])")
# DRY_RUN=1 dispatch completes after ~100ms, wait a bit
sleep 1
status=$(http_get "$BASE/api/status")
echo "$status" | python3 -c "
import sys, json; d = json.load(sys.stdin)
completed_ids = [t['id'] for t in d['recent_completed']]
assert '$task_id' in completed_ids, f'task $task_id not in completed: {completed_ids}'
" || fail "dry-run auto-completion"
pass "dry-run dispatch auto-completes task"

# -----------------------------------------------
# Test: drain loop picks up queued task when child becomes available
# -----------------------------------------------

# Fill all children with busy status by submitting 5 tasks rapidly
for i in $(seq 1 5); do
    http_post "$BASE/api/submit" "{\"prompt\":\"drain-test-$i\"}" >/dev/null
done
sleep 1  # let dry-run complete them all

# submit one more -- should get picked up immediately since dry-run freed children
resp=$(http_post "$BASE/api/submit" '{"prompt":"drain-final"}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['assigned_to'] is not None, 'drain-final should be assigned (children freed by dry-run)'
" || fail "drain loop assignment"
pass "drain loop assigns tasks when children free up"

# -----------------------------------------------
# Test: register a manager child (role=manager)
# -----------------------------------------------

# First deregister one worker by re-registering with same name as manager
resp=$(http_post "$BASE/api/register" '{"name":"worker-1","ip":"10.0.0.1","role":"manager","port":9090}')
echo "$resp" | python3 -c "
import sys, json; d = json.load(sys.stdin)
assert d['role'] == 'manager'
" || fail "register manager child"
pass "re-registered worker-1 as manager role"

# -----------------------------------------------
# Summary
# -----------------------------------------------

echo ""
echo "=== All tests passed ==="
