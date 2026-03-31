#!/usr/bin/env bash
# test-hierarchy.sh -- Deploy a mini hierarchy and verify end-to-end task routing
#
# Deploys: 1 T1 + 2 T2 + 4 T3 + 8 workers = 15 nodes
# Then submits a task at T1 and verifies it completes on a worker.
#
# Usage: test-hierarchy.sh [--skip-deploy] [--cleanup]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/fleet-helpers.sh"

PREFIX="booth-test"
API_PORT="${API_PORT:-8080}"
HIERARCHY_FILE="fleet-hierarchy-test.json"
SKIP_DEPLOY=false
CLEANUP=false
TASK_TIMEOUT=120  # seconds to wait for task completion
WORKER_COUNT=8    # 8 workers -> T3=2, T2=1, T1=1 = 12 nodes total

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-deploy) SKIP_DEPLOY=true; shift ;;
        --cleanup)     CLEANUP=true; shift ;;
        --port)        API_PORT="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: test-hierarchy.sh [--skip-deploy] [--cleanup] [--port PORT]"
            echo ""
            echo "  --skip-deploy  Use existing fleet-hierarchy-test.json instead of deploying"
            echo "  --cleanup      Delete all test stacks after the test"
            echo "  --port PORT    API port (default: 8080)"
            exit 0
            ;;
        *) echo "ERROR: Unknown argument: $1" >&2; exit 1 ;;
    esac
done

export API_PORT

# -- Colors for output --
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }
info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

TESTS_PASSED=0
TESTS_FAILED=0

assert_eq() {
    local desc=$1 expected=$2 actual=$3
    if [[ "$expected" == "$actual" ]]; then
        pass "$desc"
        (( TESTS_PASSED++ ))
    else
        fail "$desc (expected: ${expected}, got: ${actual})"
        (( TESTS_FAILED++ ))
    fi
}

assert_not_empty() {
    local desc=$1 value=$2
    if [[ -n "$value" ]]; then
        pass "$desc"
        (( TESTS_PASSED++ ))
    else
        fail "$desc (value was empty)"
        (( TESTS_FAILED++ ))
    fi
}

# Pre-calculate expected tiers using the same formula as scale-hierarchical
calc_tiers "$WORKER_COUNT"
EXPECTED_T1=$T1_COUNT
EXPECTED_T2=$T2_COUNT
EXPECTED_T3=$T3_COUNT
EXPECTED_TOTAL=$(( EXPECTED_T1 + EXPECTED_T2 + EXPECTED_T3 + WORKER_COUNT ))

echo "============================================"
echo "  Hierarchical Fleet Integration Test"
echo "============================================"
echo "  Workers:  ${WORKER_COUNT}"
echo "  Expected: ${EXPECTED_T1} T1 + ${EXPECTED_T2} T2 + ${EXPECTED_T3} T3 + ${WORKER_COUNT} workers = ${EXPECTED_TOTAL} nodes"
echo "============================================"
echo ""

# ===== PHASE 1: Deploy mini hierarchy =====
if [[ "$SKIP_DEPLOY" == "false" ]]; then
    info "Phase 1: Deploying mini hierarchy (${WORKER_COUNT} workers)..."
    bash "${SCRIPT_DIR}/scale-hierarchical.sh" "$WORKER_COUNT" \
        --prefix "$PREFIX" \
        --output "$HIERARCHY_FILE" \
        --port "$API_PORT"
    echo ""
else
    info "Phase 1: Skipping deploy, using existing ${HIERARCHY_FILE}"
fi

# ===== PHASE 2: Validate hierarchy file =====
info "Phase 2: Validating hierarchy file..."

if [[ ! -f "$HIERARCHY_FILE" ]]; then
    fail "Hierarchy file ${HIERARCHY_FILE} not found"
    exit 1
fi

# Parse hierarchy with node (available since we have package.json)
VALIDATION=$(node -e "
const h = require('./${HIERARCHY_FILE}');
const nodes = Object.keys(h.nodes);
const t1 = nodes.filter(n => h.nodes[n].tier === 't1');
const t2 = nodes.filter(n => h.nodes[n].tier === 't2');
const t3 = nodes.filter(n => h.nodes[n].tier === 't3');
const workers = nodes.filter(n => h.nodes[n].tier === 'worker');

console.log(JSON.stringify({
    total: nodes.length,
    t1: t1.length,
    t2: t2.length,
    t3: t3.length,
    workers: workers.length,
    t1_ip: t1.length > 0 ? h.nodes[t1[0]].ip : '',
    all_have_ips: nodes.every(n => h.nodes[n].ip && h.nodes[n].ip !== 'unknown'),
    t1_has_children: t1.length > 0 ? h.nodes[t1[0]].children.length > 0 : false,
    t2_have_children: t2.every(n => h.nodes[n].children.length > 0),
    t3_have_children: t3.every(n => h.nodes[n].children.length > 0),
    workers_are_leaves: workers.every(n => h.nodes[n].children.length === 0)
}));
")

TOTAL=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).total))")
T1_N=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t1))")
T2_N=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t2))")
T3_N=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t3))")
WORKERS_N=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).workers))")
T1_IP=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t1_ip))")
ALL_IPS=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).all_have_ips))")
T1_CHILDREN=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t1_has_children))")
T2_CHILDREN=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t2_have_children))")
T3_CHILDREN=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).t3_have_children))")
WORKERS_LEAVES=$(echo "$VALIDATION" | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).workers_are_leaves))")

assert_eq "Total nodes = ${EXPECTED_TOTAL}" "$EXPECTED_TOTAL" "$TOTAL"
assert_eq "T1 count = ${EXPECTED_T1}" "$EXPECTED_T1" "$T1_N"
assert_eq "T2 count = ${EXPECTED_T2}" "$EXPECTED_T2" "$T2_N"
assert_eq "T3 count = ${EXPECTED_T3}" "$EXPECTED_T3" "$T3_N"
assert_eq "Worker count = ${WORKER_COUNT}" "$WORKER_COUNT" "$WORKERS_N"
assert_eq "All nodes have IPs" "true" "$ALL_IPS"
assert_eq "T1 has children" "true" "$T1_CHILDREN"
assert_eq "T2 managers have children" "true" "$T2_CHILDREN"
assert_eq "T3 managers have children" "true" "$T3_CHILDREN"
assert_eq "Workers are leaf nodes" "true" "$WORKERS_LEAVES"
echo ""

# ===== PHASE 3: Submit task and verify routing =====
info "Phase 3: Submitting task to T1 and verifying end-to-end routing..."

assert_not_empty "T1 IP is available" "$T1_IP"

if [[ -n "$T1_IP" ]]; then
    # Submit a test task to T1
    TASK_ID="test-$(date +%s)"
    SUBMIT_RESPONSE=$(curl -s -w '\n%{http_code}' \
        -X POST "http://${T1_IP}:${API_PORT}/api/task" \
        -H 'Content-Type: application/json' \
        -d "{\"task_id\":\"${TASK_ID}\",\"type\":\"analyze\",\"payload\":{\"test\":true}}" \
        --connect-timeout 10 \
        --max-time 30 2>/dev/null || echo -e "\n000")

    HTTP_BODY=$(echo "$SUBMIT_RESPONSE" | head -n -1)
    HTTP_CODE=$(echo "$SUBMIT_RESPONSE" | tail -n 1)

    assert_eq "Task submission returns 2xx" "true" "$([[ "$HTTP_CODE" =~ ^2 ]] && echo true || echo false)"

    if [[ "$HTTP_CODE" =~ ^2 ]]; then
        info "Task ${TASK_ID} submitted. Polling for completion..."

        ELAPSED=0
        TASK_STATUS="pending"
        WORKER_NAME=""

        while (( ELAPSED < TASK_TIMEOUT )); do
            STATUS_RESPONSE=$(curl -s \
                "http://${T1_IP}:${API_PORT}/api/task/${TASK_ID}" \
                --connect-timeout 10 \
                --max-time 30 2>/dev/null || echo '{}')

            TASK_STATUS=$(echo "$STATUS_RESPONSE" | node -e "
                try {
                    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
                    process.stdout.write(d.status || 'unknown');
                } catch(e) { process.stdout.write('unknown'); }
            " 2>/dev/null || echo "unknown")

            WORKER_NAME=$(echo "$STATUS_RESPONSE" | node -e "
                try {
                    const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
                    process.stdout.write(d.worker || d.executed_by || '');
                } catch(e) { process.stdout.write(''); }
            " 2>/dev/null || echo "")

            if [[ "$TASK_STATUS" == "complete" || "$TASK_STATUS" == "completed" ]]; then
                break
            fi

            sleep 5
            (( ELAPSED += 5 ))
        done

        assert_eq "Task reached complete status" "true" \
            "$([[ "$TASK_STATUS" == "complete" || "$TASK_STATUS" == "completed" ]] && echo true || echo false)"
        assert_not_empty "Task was executed by a worker" "$WORKER_NAME"

        if [[ -n "$WORKER_NAME" ]]; then
            info "Task ${TASK_ID} completed by worker: ${WORKER_NAME}"
        fi
    else
        fail "Could not submit task (HTTP ${HTTP_CODE})"
        (( TESTS_FAILED++ ))
    fi
fi

echo ""

# ===== PHASE 4: Cleanup (optional) =====
if [[ "$CLEANUP" == "true" ]]; then
    info "Phase 4: Cleaning up test stacks..."

    ALL_STACKS=$(node -e "
        const h = require('./${HIERARCHY_FILE}');
        console.log(Object.keys(h.nodes).join(' '));
    " 2>/dev/null || echo "")

    for stack in $ALL_STACKS; do
        info "Deleting stack: ${stack}"
        aws cloudformation delete-stack \
            --stack-name "$stack" \
            --profile "${AWS_PROFILE:-hackathon}" \
            --region "${AWS_REGION:-us-east-1}" 2>/dev/null || true
    done
    info "Cleanup initiated. Stacks will be deleted asynchronously."
    rm -f "$HIERARCHY_FILE"
    echo ""
fi

# ===== Results =====
echo "============================================"
echo "  Test Results"
echo "============================================"
echo -e "  ${GREEN}Passed: ${TESTS_PASSED}${NC}"
echo -e "  ${RED}Failed: ${TESTS_FAILED}${NC}"
echo "============================================"

if (( TESTS_FAILED > 0 )); then
    exit 1
fi
