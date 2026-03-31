#!/usr/bin/env bash
# test-blocker-flow.sh -- Integration test for the blocker reporting system
#
# Tests:
#   1. Blocker document creation
#   2. Manager notification (spins up blocker-handler.py)
#   3. Auto-resolution (retry + reassign)
#   4. Escalation to parent manager
#   5. Blocker gate (3 consecutive failures)

set -uo pipefail
# Note: no -e, we handle errors ourselves

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BLOCKERS_DIR="${PROJECT_ROOT}/blockers"
BLOCKER_SYSTEM="${PROJECT_ROOT}/scripts/fleet/blocker-system.sh"
BLOCKER_HANDLER="${PROJECT_ROOT}/scripts/fleet/blocker-handler.py"
RECORD_FAILURE="${PROJECT_ROOT}/scripts/fleet/record-failure.sh"
BLOCKER_GATE="${PROJECT_ROOT}/.claude/hooks/run-modules/PreToolUse/blocker-gate.js"

PASS=0
FAIL=0
HANDLER_PID=""
PARENT_PID=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
cleanup() {
    [[ -n "$HANDLER_PID" ]] && kill "$HANDLER_PID" 2>/dev/null || true
    [[ -n "$PARENT_PID" ]] && kill "$PARENT_PID" 2>/dev/null || true
    rm -rf "${BLOCKERS_DIR}/test-"* 2>/dev/null || true
    rm -f "${BLOCKERS_DIR}/handler.log" "${BLOCKERS_DIR}/parent-received.json" 2>/dev/null || true
    rm -f /tmp/blocker-test-*.json 2>/dev/null || true
}
trap cleanup EXIT

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  [PASS] $label"
        ((PASS++)) || true
    else
        echo "  [FAIL] $label: expected='$expected' actual='$actual'"
        ((FAIL++)) || true
    fi
}

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if echo "$haystack" | grep -qE "$needle"; then
        echo "  [PASS] $label"
        ((PASS++)) || true
    else
        echo "  [FAIL] $label: '$needle' not found in output"
        ((FAIL++)) || true
    fi
}

assert_file_exists() {
    local label="$1" filepath="$2"
    if [[ -f "$filepath" ]]; then
        echo "  [PASS] $label"
        ((PASS++)) || true
    else
        echo "  [FAIL] $label: file not found: $filepath"
        ((FAIL++)) || true
    fi
}

json_field() {
    python3 -c "import json; d=json.load(open('$1')); print(d.get('$2',''))" 2>/dev/null || echo ""
}

wait_for_port() {
    local port="$1" max_wait="${2:-5}"
    local i=0
    while ! curl -s "http://localhost:${port}/api/health" >/dev/null 2>&1; do
        sleep 0.5
        ((i++)) || true
        if [[ $i -ge $((max_wait * 2)) ]]; then
            echo "  [FAIL] Port $port not ready after ${max_wait}s"
            return 1
        fi
    done
    return 0
}

# ---------------------------------------------------------------------------
echo "=== Blocker System Integration Tests ==="
echo ""

# ---------------------------------------------------------------------------
# Test 1: Blocker document creation (dry-run, no GitHub/manager needed)
# ---------------------------------------------------------------------------
echo "--- Test 1: Blocker document creation ---"

FLEET_WORKER_ID="test-worker-01" \
    bash "$BLOCKER_SYSTEM" \
    "test-task-001" \
    "Build step failed: cannot find module foo" \
    --stack-trace "Error: Cannot find module foo at require" \
    --attempts '[{"fix":"installed foo","result":"still fails"}]' \
    --severity "high" \
    --dry-run >/dev/null 2>&1

assert_file_exists "Blocker JSON created" "${BLOCKERS_DIR}/test-task-001.json"
assert_eq "task_id correct" "test-task-001" "$(json_field "${BLOCKERS_DIR}/test-task-001.json" task_id)"
assert_eq "severity correct" "high" "$(json_field "${BLOCKERS_DIR}/test-task-001.json" severity)"
assert_eq "status is open" "open" "$(json_field "${BLOCKERS_DIR}/test-task-001.json" status)"
assert_eq "worker_id correct" "test-worker-01" "$(json_field "${BLOCKERS_DIR}/test-task-001.json" worker_id)"

echo ""

# ---------------------------------------------------------------------------
# Test 2: Manager receives and processes blocker
# ---------------------------------------------------------------------------
echo "--- Test 2: Manager handler receives blocker ---"

BLOCKER_HANDLER_PORT=15987 \
    BLOCKERS_DIR="${BLOCKERS_DIR}" \
    FLEET_WORKER_POOL="worker-a,worker-b,worker-c" \
    BLOCKER_LOG_FILE="${BLOCKERS_DIR}/handler.log" \
    MAX_AUTO_RETRIES=1 \
    python3 "$BLOCKER_HANDLER" &
HANDLER_PID=$!

if wait_for_port 15987; then
    HTTP_CODE=$(curl -s -o /tmp/blocker-test-response.json -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{
            "task_id": "test-task-002",
            "description": "API rate limit exceeded",
            "worker_id": "worker-a",
            "severity": "medium",
            "status": "open",
            "attempted_fixes": [{"fix":"waited 60s","result":"still rate limited"}],
            "stack_trace": "HTTPError 429: Too Many Requests"
        }' \
        "http://localhost:15987/api/blocker" 2>/dev/null)

    assert_eq "Handler returns 202" "202" "$HTTP_CODE"
    assert_file_exists "Blocker saved by handler" "${BLOCKERS_DIR}/test-task-002.json"

    HANDLER_STATUS="$(json_field "${BLOCKERS_DIR}/test-task-002.json" status)"
    assert_contains "Auto-resolution attempted" "retry-suggested|reassigned|escalated" "$HANDLER_STATUS"

    echo ""

    # -----------------------------------------------------------------------
    # Test 3: GET /api/blockers lists all blockers
    # -----------------------------------------------------------------------
    echo "--- Test 3: List blockers endpoint ---"
    LIST_RESPONSE=$(curl -s "http://localhost:15987/api/blockers" 2>/dev/null)
    assert_contains "Blockers list has entries" "test-task-002" "$LIST_RESPONSE"

    echo ""

    # -----------------------------------------------------------------------
    # Test 4: Escalation (no parent configured = escalation-failed)
    # -----------------------------------------------------------------------
    echo "--- Test 4: Escalation when auto-resolution exhausted ---"

    # Use a worker_id that IS in the pool so retry fails (max exceeded)
    # and reassign also fails (all pool members = this worker)
    # We need to restart handler with a single-worker pool
    kill "$HANDLER_PID" 2>/dev/null || true
    sleep 0.5

    BLOCKER_HANDLER_PORT=15987 \
        BLOCKERS_DIR="${BLOCKERS_DIR}" \
        FLEET_WORKER_POOL="solo-worker" \
        BLOCKER_LOG_FILE="${BLOCKERS_DIR}/handler.log" \
        MAX_AUTO_RETRIES=0 \
        python3 "$BLOCKER_HANDLER" &
    HANDLER_PID=$!
    wait_for_port 15987

    curl -s -o /tmp/blocker-test-escalation.json -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{
            "task_id": "test-task-003",
            "description": "Persistent compilation error",
            "worker_id": "solo-worker",
            "severity": "critical",
            "status": "open",
            "attempted_fixes": [
                {"fix":"clean build","result":"same error"},
                {"fix":"downgrade deps","result":"same error"},
                {"fix":"rebuild","result":"same error"}
            ]
        }' \
        "http://localhost:15987/api/blocker" >/dev/null 2>&1

    sleep 0.5
    ESCL_STATUS="$(json_field "${BLOCKERS_DIR}/test-task-003.json" status)"
    assert_eq "Escalation status" "escalation-failed" "$ESCL_STATUS"

    assert_file_exists "Handler log exists" "${BLOCKERS_DIR}/handler.log"
    LOG_LINES=$(wc -l < "${BLOCKERS_DIR}/handler.log" 2>/dev/null || echo 0)
    if [[ "$LOG_LINES" -ge 2 ]]; then
        echo "  [PASS] Handler log has $LOG_LINES entries"
        ((PASS++)) || true
    else
        echo "  [FAIL] Handler log has $LOG_LINES entries (expected >= 2)"
        ((FAIL++)) || true
    fi
else
    echo "  [FAIL] Handler did not start -- skipping tests 2-4"
    ((FAIL += 4)) || true
fi

kill "$HANDLER_PID" 2>/dev/null || true
HANDLER_PID=""

echo ""

# ---------------------------------------------------------------------------
# Test 5: Escalation to parent manager (simulated)
# ---------------------------------------------------------------------------
echo "--- Test 5: Escalation to parent manager ---"

python3 -c "
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os

class MockParent(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        data = json.loads(body)
        with open('${BLOCKERS_DIR}/parent-received.json', 'w') as f:
            json.dump(data, f, indent=2)
        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'accepted': True}).encode())
    def log_message(self, *a): pass

HTTPServer(('0.0.0.0', 15988), MockParent).serve_forever()
" &
PARENT_PID=$!
sleep 1

BLOCKER_HANDLER_PORT=15989 \
    BLOCKERS_DIR="${BLOCKERS_DIR}" \
    PARENT_MANAGER_URL="http://localhost:15988" \
    BLOCKER_LOG_FILE="${BLOCKERS_DIR}/handler.log" \
    MAX_AUTO_RETRIES=0 \
    FLEET_WORKER_POOL="" \
    python3 "$BLOCKER_HANDLER" &
HANDLER_PID=$!

if wait_for_port 15989; then
    curl -s -o /dev/null \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{
            "task_id": "test-task-004",
            "description": "Escalation test",
            "worker_id": "worker-x",
            "severity": "critical",
            "status": "open"
        }' \
        "http://localhost:15989/api/blocker" 2>/dev/null

    sleep 1

    assert_file_exists "Parent received escalation" "${BLOCKERS_DIR}/parent-received.json"
    PARENT_TASK="$(json_field "${BLOCKERS_DIR}/parent-received.json" task_id)"
    assert_eq "Parent got correct task_id" "test-task-004" "$PARENT_TASK"
    ESCL4_STATUS="$(json_field "${BLOCKERS_DIR}/test-task-004.json" status)"
    assert_eq "Blocker marked as escalated" "escalated" "$ESCL4_STATUS"
else
    echo "  [FAIL] Escalation handler did not start"
    ((FAIL += 3)) || true
fi

kill "$HANDLER_PID" 2>/dev/null || true
kill "$PARENT_PID" 2>/dev/null || true
HANDLER_PID=""
PARENT_PID=""

echo ""

# ---------------------------------------------------------------------------
# Test 6: Blocker gate (3 consecutive failures)
# ---------------------------------------------------------------------------
echo "--- Test 6: Blocker gate (PreToolUse hook) ---"

# Record 3 failures
bash "$RECORD_FAILURE" "test-task-005" "Bash" "command not found" >/dev/null 2>&1
bash "$RECORD_FAILURE" "test-task-005" "Bash" "command not found" >/dev/null 2>&1
bash "$RECORD_FAILURE" "test-task-005" "Bash" "still broken" >/dev/null 2>&1

FAIL_COUNT="$(json_field "${BLOCKERS_DIR}/test-task-005-failures.json" count)"
assert_eq "3 failures recorded" "3" "$FAIL_COUNT"

# Run blocker-gate -- should exit 2 (block) since 3 failures and no blocker
GATE_OUTPUT=$(export FLEET_TASK_ID="test-task-005" PROJECT_ROOT="$PROJECT_ROOT"; \
    echo '{"tool_name":"Bash","tool_input":{"command":"echo test"}}' | \
    node "$BLOCKER_GATE" 2>/dev/null) || true

assert_contains "Gate blocks after 3 failures" "BLOCKED" "$GATE_OUTPUT"

# Now create a blocker for this task
FLEET_WORKER_ID="test-worker" bash "$BLOCKER_SYSTEM" \
    "test-task-005" "Repeated command failures" \
    --dry-run >/dev/null 2>&1

# Run gate again -- should allow since blocker exists
GATE_OUTPUT2=$(export FLEET_TASK_ID="test-task-005" PROJECT_ROOT="$PROJECT_ROOT"; \
    echo '{"tool_name":"Bash","tool_input":{"command":"echo test"}}' | \
    node "$BLOCKER_GATE" 2>/dev/null) || true
# If it allowed, exit code was 0 and output doesn't say BLOCKED
if echo "$GATE_OUTPUT2" | grep -q "BLOCKED"; then
    echo "  [FAIL] Gate still blocks after blocker created"
    ((FAIL++)) || true
else
    echo "  [PASS] Gate allows after blocker created"
    ((PASS++)) || true
fi

echo ""

# ---------------------------------------------------------------------------
# Test 7: Gate allows non-gated tools
# ---------------------------------------------------------------------------
echo "--- Test 7: Gate allows non-gated tools ---"

GATE_OUTPUT3=$(export FLEET_TASK_ID="test-task-005" PROJECT_ROOT="$PROJECT_ROOT"; \
    echo '{"tool_name":"Read","tool_input":{"file":"test.txt"}}' | \
    node "$BLOCKER_GATE" 2>/dev/null) || true

if echo "$GATE_OUTPUT3" | grep -q "BLOCKED"; then
    echo "  [FAIL] Gate incorrectly blocks Read tool"
    ((FAIL++)) || true
else
    echo "  [PASS] Gate allows Read tool"
    ((PASS++)) || true
fi

echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "==========================================="
echo "  Results: ${PASS} passed, ${FAIL} failed"
echo "==========================================="

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
