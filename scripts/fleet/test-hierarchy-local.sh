#!/usr/bin/env bash
# Local hierarchy integration test.
# Spins up 15 manager-daemon.py processes (1 T1 + 2 T2 + 4 T3 + 8 workers)
# on localhost ports, wires them together, and verifies end-to-end task routing.
#
# No AWS required -- everything runs locally.
#
# Usage: bash scripts/fleet/test-hierarchy-local.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON="$SCRIPT_DIR/manager-daemon.py"

# Port assignments: T1=19001, T2=19011-19012, T3=19021-19024, W=19031-19038
BASE_T1=19001
BASE_T2=19011
BASE_T3=19021
BASE_W=19031

PIDS=()
PASS=0
FAIL=0
START_TIME=$(date +%s%N)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[$(date -u '+%H:%M:%S')] $*"; }

check() {
    local name="$1"; shift
    if "$@" >/dev/null 2>&1; then
        PASS=$((PASS + 1))
        log "[PASS] $name"
    else
        FAIL=$((FAIL + 1))
        log "[FAIL] $name"
    fi
}

cleanup() {
    log "--- Cleanup: killing ${#PIDS[@]} daemon processes ---"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    log "Cleanup complete."
}
trap cleanup EXIT

http_get() { curl -sf --max-time 3 "$1"; }

http_post() { curl -sf --max-time 5 -X POST -H "Content-Type: application/json" -d "$2" "$1"; }

wait_healthy() {
    local url="$1" name="$2" tries=0
    while ! curl -sf --max-time 1 "$url/health" >/dev/null 2>&1; do
        tries=$((tries + 1))
        if [ "$tries" -ge 40 ]; then
            log "FATAL: $name did not start within 4 seconds ($url)"
            return 1
        fi
        sleep 0.1
    done
}

start_daemon() {
    local name="$1" tier="$2" port="$3" parent_url="${4:-}"
    MANAGER_NAME="$name" MANAGER_TIER="$tier" MANAGER_PORT="$port" \
        PARENT_URL="$parent_url" ROLE="manager" \
        python3 "$DAEMON" >/dev/null 2>&1 &
    PIDS+=($!)
    wait_healthy "http://localhost:$port" "$name"
}

register() {
    local parent_url="$1" child_name="$2" child_port="$3" role="${4:-manager}"
    http_post "$parent_url/api/register" \
        "{\"name\":\"$child_name\",\"ip\":\"127.0.0.1\",\"port\":$child_port,\"role\":\"$role\"}" \
        >/dev/null 2>&1
}

elapsed_ms() {
    local now
    now=$(date +%s%N)
    echo $(( (now - START_TIME) / 1000000 ))
}

# ===================================================================
# PHASE 1: Start all 15 daemons
# ===================================================================

log "============================================"
log "Hierarchical Fleet Test (local)"
log "Topology: 1 T1 + 2 T2 + 4 T3 + 8 Workers"
log "============================================"
log ""

DEPLOY_START=$(date +%s%N)

log "--- Phase 1: Starting 15 daemon processes ---"

# T1 (1 node)
start_daemon "T1-001" "t1" $BASE_T1 ""
log "  T1-001 on :$BASE_T1"

# T2 (2 nodes, parent = T1)
for i in 1 2; do
    port=$((BASE_T2 + i - 1))
    start_daemon "T2-00$i" "t2" "$port" "http://localhost:$BASE_T1"
    log "  T2-00$i on :$port -> T1-001"
done

# T3 (4 nodes, parents = T2-001, T2-001, T2-002, T2-002)
T3_PARENTS=(19011 19011 19012 19012)
for i in 1 2 3 4; do
    port=$((BASE_T3 + i - 1))
    parent_port=${T3_PARENTS[$((i - 1))]}
    start_daemon "T3-00$i" "t3" "$port" "http://localhost:$parent_port"
    log "  T3-00$i on :$port -> T2 on :$parent_port"
done

# Workers (8 nodes, 2 per T3)
W_PARENTS=(19021 19021 19022 19022 19023 19023 19024 19024)
for i in 1 2 3 4 5 6 7 8; do
    port=$((BASE_W + i - 1))
    parent_port=${W_PARENTS[$((i - 1))]}
    start_daemon "W-00$i" "worker" "$port" "http://localhost:$parent_port"
    log "  W-00$i on :$port -> T3 on :$parent_port"
done

DEPLOY_END=$(date +%s%N)
DEPLOY_MS=$(( (DEPLOY_END - DEPLOY_START) / 1000000 ))
log "--- All 15 daemons started in ${DEPLOY_MS}ms ---"
log ""

# ===================================================================
# PHASE 2: Register children with parents
# ===================================================================

log "--- Phase 2: Registering hierarchy ---"

REGISTER_START=$(date +%s%N)

# Register T2s with T1
for i in 1 2; do
    port=$((BASE_T2 + i - 1))
    register "http://localhost:$BASE_T1" "T2-00$i" "$port" "manager"
    log "  T2-00$i registered with T1-001"
done

# Register T3s with T2s
T3_PARENT_PORTS=(19011 19011 19012 19012)
for i in 1 2 3 4; do
    port=$((BASE_T3 + i - 1))
    parent_port=${T3_PARENT_PORTS[$((i - 1))]}
    register "http://localhost:$parent_port" "T3-00$i" "$port" "manager"
    log "  T3-00$i registered with T2 on :$parent_port"
done

# Register workers with T3s
W_PARENT_PORTS=(19021 19021 19022 19022 19023 19023 19024 19024)
for i in 1 2 3 4 5 6 7 8; do
    port=$((BASE_W + i - 1))
    parent_port=${W_PARENT_PORTS[$((i - 1))]}
    register "http://localhost:$parent_port" "W-00$i" "$port" "manager"
    log "  W-00$i registered with T3 on :$parent_port"
done

REGISTER_END=$(date +%s%N)
REGISTER_MS=$(( (REGISTER_END - REGISTER_START) / 1000000 ))
log "--- Registration complete in ${REGISTER_MS}ms ---"
log ""

# ===================================================================
# PHASE 3: Verify hierarchy structure
# ===================================================================

log "--- Phase 3: Verifying hierarchy structure ---"

# T1 should have 2 children
T1_CHILDREN=$(http_get "http://localhost:$BASE_T1/api/children" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['children']))")
check "T1-001 has 2 children" [ "$T1_CHILDREN" = "2" ]

# T2-001 should have 2 children (T3-001, T3-002)
T2_1_CHILDREN=$(http_get "http://localhost:$BASE_T2/api/children" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['children']))")
check "T2-001 has 2 children" [ "$T2_1_CHILDREN" = "2" ]

# T2-002 should have 2 children (T3-003, T3-004)
T2_2_CHILDREN=$(http_get "http://localhost:$((BASE_T2+1))/api/children" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['children']))")
check "T2-002 has 2 children" [ "$T2_2_CHILDREN" = "2" ]

# T3-001 should have 2 children (W-001, W-002)
T3_1_CHILDREN=$(http_get "http://localhost:$BASE_T3/api/children" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['children']))")
check "T3-001 has 2 children" [ "$T3_1_CHILDREN" = "2" ]

# Workers should have 0 children
W1_CHILDREN=$(http_get "http://localhost:$BASE_W/api/children" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['children']))")
check "W-001 has 0 children (leaf)" [ "$W1_CHILDREN" = "0" ]

# Health checks
for port in $BASE_T1 $BASE_T2 $((BASE_T2+1)) $BASE_T3 $((BASE_T3+1)) $((BASE_T3+2)) $((BASE_T3+3)); do
    name=$(http_get "http://localhost:$port/health" | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
    check "$name is healthy" [ -n "$name" ]
done

log ""

# ===================================================================
# PHASE 4: Submit task and verify end-to-end routing
# ===================================================================

log "--- Phase 4: Task routing test ---"

TASK_START=$(date +%s%N)

# Submit to T1
SUBMIT_RESP=$(http_post "http://localhost:$BASE_T1/api/submit" \
    '{"prompt":"hierarchy-test: analyze booth session data"}')
TASK_ID=$(echo "$SUBMIT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
log "  Submitted task: $TASK_ID"

SUBMIT_STATUS=$(echo "$SUBMIT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
check "task accepted by T1" [ -n "$SUBMIT_STATUS" ]

# Poll T1 for task completion (max 10s)
log "  Polling for completion (max 10s)..."
POLL_ELAPSED=0
TASK_STATUS="pending"
while [ "$POLL_ELAPSED" -lt 10 ]; do
    STATUS_RESP=$(http_get "http://localhost:$BASE_T1/api/status" 2>/dev/null || echo '{}')
    TASK_STATUS=$(echo "$STATUS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in d.get('recent_completed', []):
    if t['id'] == '$TASK_ID':
        print('completed')
        sys.exit(0)
for t in d.get('queued_tasks', []):
    if t['id'] == '$TASK_ID':
        print(t['status'])
        sys.exit(0)
print('pending')
" 2>/dev/null || echo "pending")
    if [ "$TASK_STATUS" = "completed" ]; then break; fi
    sleep 0.5
    POLL_ELAPSED=$((POLL_ELAPSED + 1))
done

TASK_END=$(date +%s%N)
TASK_MS=$(( (TASK_END - TASK_START) / 1000000 ))

check "task completed end-to-end" [ "$TASK_STATUS" = "completed" ]
log "  Task routing time: ${TASK_MS}ms"

# Verify the task reached a worker by checking worker status
WORKER_EXECUTED=""
for i in 1 2 3 4 5 6 7 8; do
    port=$((BASE_W + i - 1))
    W_STATUS=$(http_get "http://localhost:$port/api/status" 2>/dev/null || echo '{}')
    COMPLETED=$(echo "$W_STATUS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for t in d.get('recent_completed', []):
    if 'hierarchy-test' in t.get('prompt', ''):
        print(d['manager'])
        sys.exit(0)
print('')
" 2>/dev/null || echo "")
    if [ -n "$COMPLETED" ]; then
        WORKER_EXECUTED="$COMPLETED"
        break
    fi
done

check "task executed by a worker" [ -n "$WORKER_EXECUTED" ]
if [ -n "$WORKER_EXECUTED" ]; then
    log "  Executed by: $WORKER_EXECUTED"
fi

log ""

# ===================================================================
# PHASE 5: Multi-task burst test
# ===================================================================

log "--- Phase 5: Burst test (8 tasks) ---"

BURST_START=$(date +%s%N)
BURST_IDS=()
for i in $(seq 1 8); do
    RESP=$(http_post "http://localhost:$BASE_T1/api/submit" \
        "{\"prompt\":\"burst-task-$i\"}" 2>/dev/null || echo '{}')
    TID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task_id',''))" 2>/dev/null || echo "")
    BURST_IDS+=("$TID")
done
log "  Submitted 8 tasks"

# Wait for all to complete (max 15s)
sleep 3
BURST_COMPLETED=0
T1_STATUS=$(http_get "http://localhost:$BASE_T1/api/status" 2>/dev/null || echo '{}')
BURST_COMPLETED=$(echo "$T1_STATUS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ids = set(t['id'] for t in d.get('recent_completed', []))
count = sum(1 for tid in ['${BURST_IDS[0]}','${BURST_IDS[1]}','${BURST_IDS[2]}','${BURST_IDS[3]}','${BURST_IDS[4]}','${BURST_IDS[5]}','${BURST_IDS[6]}','${BURST_IDS[7]}'] if tid in ids)
print(count)
" 2>/dev/null || echo "0")

BURST_END=$(date +%s%N)
BURST_MS=$(( (BURST_END - BURST_START) / 1000000 ))

check "all 8 burst tasks completed" [ "$BURST_COMPLETED" -ge 8 ]
log "  Burst completed: $BURST_COMPLETED/8 in ${BURST_MS}ms"

log ""

# ===================================================================
# PHASE 6: Print tree structure
# ===================================================================

log "--- Hierarchy Tree ---"
log ""
log "Global Dispatcher"
log "|"

# Collect tree data
print_tree() {
    local t1_health t2_health t3_health w_health

    t1_health=$(http_get "http://localhost:$BASE_T1/health" 2>/dev/null)
    T1_IDLE=$(echo "$t1_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['idle'])" 2>/dev/null)
    T1_BUSY=$(echo "$t1_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['busy'])" 2>/dev/null)
    log "+-- T1-001 [:$BASE_T1] (children: idle=$T1_IDLE busy=$T1_BUSY)"

    for t2i in 1 2; do
        t2_port=$((BASE_T2 + t2i - 1))
        t2_health=$(http_get "http://localhost:$t2_port/health" 2>/dev/null)
        T2_IDLE=$(echo "$t2_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['idle'])" 2>/dev/null)
        T2_BUSY=$(echo "$t2_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['busy'])" 2>/dev/null)
        local t2_prefix="|   "
        [ "$t2i" -eq 2 ] && t2_prefix="    "
        log "|   +-- T2-00$t2i [:$t2_port] (children: idle=$T2_IDLE busy=$T2_BUSY)"

        for t3i in 1 2; do
            local t3_idx=$(( (t2i - 1) * 2 + t3i ))
            t3_port=$((BASE_T3 + t3_idx - 1))
            t3_health=$(http_get "http://localhost:$t3_port/health" 2>/dev/null)
            T3_IDLE=$(echo "$t3_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['idle'])" 2>/dev/null)
            T3_BUSY=$(echo "$t3_health" | python3 -c "import sys,json; print(json.load(sys.stdin)['busy'])" 2>/dev/null)
            log "$t2_prefix   +-- T3-00$t3_idx [:$t3_port] (children: idle=$T3_IDLE busy=$T3_BUSY)"

            for wi in 1 2; do
                local w_idx=$(( (t3_idx - 1) * 2 + wi ))
                w_port=$((BASE_W + w_idx - 1))
                w_health=$(http_get "http://localhost:$w_port/health" 2>/dev/null)
                W_COMPLETED=$(http_get "http://localhost:$w_port/api/status" 2>/dev/null | \
                    python3 -c "import sys,json; print(len(json.load(sys.stdin).get('recent_completed',[])))" 2>/dev/null || echo "0")
                local w_prefix="$t2_prefix   |   "
                [ "$t3i" -eq 2 ] && [ "$t2i" -eq 2 ] && w_prefix="$t2_prefix       "
                log "$t2_prefix   |   +-- W-00$w_idx [:$w_port] (completed: $W_COMPLETED tasks)"
            done
        done
    done
}

print_tree

log ""

# ===================================================================
# Results
# ===================================================================

TOTAL_END=$(date +%s%N)
TOTAL_MS=$(( (TOTAL_END - START_TIME) / 1000000 ))

log "============================================"
log "Test Results: $PASS passed, $FAIL failed"
log "============================================"
log "Timing:"
log "  Deploy (15 daemons): ${DEPLOY_MS}ms"
log "  Registration:        ${REGISTER_MS}ms"
log "  Single task routing: ${TASK_MS}ms"
log "  Burst (8 tasks):     ${BURST_MS}ms"
log "  Total test time:     ${TOTAL_MS}ms"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
