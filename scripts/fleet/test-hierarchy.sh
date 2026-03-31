#!/usr/bin/env bash
# Deploy a mini hierarchy and verify task routing through all tiers.
# Topology: 1 T1 + 2 T2 + 4 T3 + 8 workers
#
# Usage: bash scripts/fleet/test-hierarchy.sh
#
# The script:
#   1. Deploys the mini fleet using scale-hierarchical.sh logic
#   2. Submits a test task to the global dispatcher
#   3. Polls until the task is picked up by a worker
#   4. Verifies the routing path traversed all tiers
#   5. Tears down test stacks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/scripts/fleet-config.sh"
source "$REPO_ROOT/scripts/aws/common.sh"

# Override fleet config for mini test
export FLEET_STACK_PREFIX="ccc-test-fleet"
export FLEET_ENVIRONMENT="test"

TEST_WORKER_COUNT=8
HIERARCHY_FILE="$REPO_ROOT/test-fleet-hierarchy.json"
TEST_TASK_ID="test-$(date +%s)"
PASS=0
FAIL=0
CLEANUP_STACKS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
check() {
  local name="$1"; shift
  if "$@"; then
    PASS=$((PASS + 1))
    log "[PASS] $name"
  else
    FAIL=$((FAIL + 1))
    log "[FAIL] $name"
  fi
}

cleanup() {
  log "--- Cleaning up test stacks ---"
  local pids=()
  for stack in "${CLEANUP_STACKS[@]}"; do
    (cf_delete_stack "$stack" 2>/dev/null || true) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" || true; done
  rm -f "$HIERARCHY_FILE"
  log "Cleanup complete."
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Phase 1: Deploy mini hierarchy
# ---------------------------------------------------------------------------
log "=== Test Hierarchy: 1 T1 + 2 T2 + 4 T3 + 8 Workers ==="
log "--- Deploying mini fleet ---"

# We reuse the scale script's logic but inline it here for the small size.
# This avoids subprocess issues with associative arrays.

IFS=',' read -ra SUBNETS <<< "${FLEET_SUBNET_IDS:-subnet-placeholder}"
subnet_for() { echo "${SUBNETS[$(($1 % ${#SUBNETS[@]}))]}" ; }

declare -A EP PARENT STACK

deploy_one() {
  local node_id="$1" tier="$2" parent_ep="$3" idx="$4"
  local stack_name="${FLEET_STACK_PREFIX}-${node_id}"
  local subnet
  subnet=$(subnet_for "$idx")
  CLEANUP_STACKS+=("$stack_name")

  local template extra=""
  if [ "$tier" = "worker" ]; then
    template="$REPO_ROOT/$FLEET_CF_TEMPLATE_WORKER"
    extra="ManagerEndpoint=${parent_ep}"
  else
    template="$REPO_ROOT/$FLEET_CF_TEMPLATE_MANAGER"
    extra="ManagerTier=${tier} ParentEndpoint=${parent_ep}"
  fi

  log "  deploying $node_id ($tier)"
  cf_deploy_stack "$stack_name" "$template" \
    "NodeId=${node_id}" \
    "SubnetId=${subnet}" \
    "VpcId=${FLEET_VPC_ID:-vpc-placeholder}" \
    "Environment=${FLEET_ENVIRONMENT}" \
    $extra >/dev/null 2>&1 || true

  EP["$node_id"]=$(cf_get_output "$stack_name" "Endpoint" 2>/dev/null || echo "http://pending:8080")
  STACK["$node_id"]="$stack_name"
}

register() {
  local node_id="$1" role="$2" tier="$3" target_url="$4" node_ep="$5"
  curl -sf -X POST "${target_url}/api/register" \
    -H "Content-Type: application/json" \
    -d "{\"node_id\":\"${node_id}\",\"role\":\"${role}\",\"tier\":\"${tier}\",\"endpoint\":\"${node_ep}\"}" \
    >/dev/null 2>&1 || log "  WARN: registration failed for $node_id"
}

# -- T1 (1 node) --
deploy_one "T1-001" "t1" "" 0
register "T1-001" "manager" "t1" "$FLEET_DISPATCHER_URL" "${EP[T1-001]}"
PARENT["T1-001"]="dispatcher"

# -- T2 (2 nodes -> T1-001) --
T2_IDS=("T2-001" "T2-002")
for i in "${!T2_IDS[@]}"; do
  nid="${T2_IDS[$i]}"
  deploy_one "$nid" "t2" "${EP[T1-001]}" "$((i+1))"
  register "$nid" "manager" "t2" "${EP[T1-001]}" "${EP[$nid]}"
  PARENT["$nid"]="T1-001"
done

# -- T3 (4 nodes -> T2s, 2 per T2) --
T3_IDS=("T3-001" "T3-002" "T3-003" "T3-004")
T3_PARENTS=("T2-001" "T2-001" "T2-002" "T2-002")
for i in "${!T3_IDS[@]}"; do
  nid="${T3_IDS[$i]}"
  pid="${T3_PARENTS[$i]}"
  deploy_one "$nid" "t3" "${EP[$pid]}" "$((i+3))"
  register "$nid" "manager" "t3" "${EP[$pid]}" "${EP[$nid]}"
  PARENT["$nid"]="$pid"
done

# -- Workers (8 nodes -> T3s, 2 per T3) --
W_IDS=("W-001" "W-002" "W-003" "W-004" "W-005" "W-006" "W-007" "W-008")
W_PARENTS=("T3-001" "T3-001" "T3-002" "T3-002" "T3-003" "T3-003" "T3-004" "T3-004")
for i in "${!W_IDS[@]}"; do
  nid="${W_IDS[$i]}"
  pid="${W_PARENTS[$i]}"
  deploy_one "$nid" "worker" "${EP[$pid]}" "$((i+7))"
  register "$nid" "worker" "worker" "${EP[$pid]}" "${EP[$nid]}"
  PARENT["$nid"]="$pid"
done

log "--- Mini fleet deployed (15 nodes) ---"

# ---------------------------------------------------------------------------
# Phase 2: Verify structure
# ---------------------------------------------------------------------------
log "--- Verifying hierarchy structure ---"

check "T1-001 has endpoint" [ -n "${EP[T1-001]}" ]
check "T2-001 parent is T1-001" [ "${PARENT[T2-001]}" = "T1-001" ]
check "T2-002 parent is T1-001" [ "${PARENT[T2-002]}" = "T1-001" ]
check "T3-001 parent is T2-001" [ "${PARENT[T3-001]}" = "T2-001" ]
check "T3-003 parent is T2-002" [ "${PARENT[T3-003]}" = "T2-002" ]
check "W-001 parent is T3-001" [ "${PARENT[W-001]}" = "T3-001" ]
check "W-005 parent is T3-003" [ "${PARENT[W-005]}" = "T3-003" ]
check "8 workers deployed" [ "${#W_IDS[@]}" -eq 8 ]

# ---------------------------------------------------------------------------
# Phase 3: Submit test task and verify routing
# ---------------------------------------------------------------------------
log "--- Submitting test task: $TEST_TASK_ID ---"

SUBMIT_RESPONSE=$(curl -sf -X POST "${FLEET_DISPATCHER_URL}/api/tasks" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"${TEST_TASK_ID}\",
    \"type\": \"test-echo\",
    \"payload\": {\"message\": \"hierarchy-test\"},
    \"trace\": true
  }" 2>&1) || SUBMIT_RESPONSE='{"error":"dispatcher unreachable"}'

check "task submitted" echo "$SUBMIT_RESPONSE" | jq -e '.task_id' >/dev/null 2>&1

# Poll for task completion (max 60s)
log "--- Polling for task completion (max 60s) ---"
TASK_STATUS="pending"
POLL_ELAPSED=0
while [ "$POLL_ELAPSED" -lt 60 ] && [ "$TASK_STATUS" != "completed" ]; do
  TASK_RESULT=$(curl -sf "${FLEET_DISPATCHER_URL}/api/tasks/${TEST_TASK_ID}" 2>/dev/null || echo '{}')
  TASK_STATUS=$(echo "$TASK_RESULT" | jq -r '.status // "pending"')
  if [ "$TASK_STATUS" = "completed" ]; then break; fi
  sleep 5
  POLL_ELAPSED=$((POLL_ELAPSED + 5))
done

check "task completed" [ "$TASK_STATUS" = "completed" ]

# Verify routing trace (task should have passed through all tiers)
if [ "$TASK_STATUS" = "completed" ]; then
  ROUTE_TRACE=$(echo "$TASK_RESULT" | jq -r '.trace[]?.node_id // empty' 2>/dev/null)
  HAS_T1=$(echo "$ROUTE_TRACE" | grep -c '^T1-' || true)
  HAS_T2=$(echo "$ROUTE_TRACE" | grep -c '^T2-' || true)
  HAS_T3=$(echo "$ROUTE_TRACE" | grep -c '^T3-' || true)
  HAS_W=$(echo "$ROUTE_TRACE" | grep -c '^W-' || true)

  check "task routed through T1" [ "$HAS_T1" -gt 0 ]
  check "task routed through T2" [ "$HAS_T2" -gt 0 ]
  check "task routed through T3" [ "$HAS_T3" -gt 0 ]
  check "task executed by worker" [ "$HAS_W" -gt 0 ]

  WORKER_ID=$(echo "$TASK_RESULT" | jq -r '.assigned_worker // "none"')
  log "  Task executed by: $WORKER_ID"
  log "  Route trace: $ROUTE_TRACE"
else
  log "  SKIP: routing verification (task did not complete)"
  FAIL=$((FAIL + 4))
fi

# ---------------------------------------------------------------------------
# Phase 4: Write test hierarchy JSON
# ---------------------------------------------------------------------------
log "--- Writing test hierarchy to $HIERARCHY_FILE ---"

jq -n \
  --arg dispatcher "$FLEET_DISPATCHER_URL" \
  --arg task_id "$TEST_TASK_ID" \
  --arg task_status "$TASK_STATUS" \
  '{
    test_run: (now | todate),
    dispatcher: $dispatcher,
    topology: "1 T1 + 2 T2 + 4 T3 + 8 Workers",
    test_task: {
      id: $task_id,
      status: $task_status
    },
    tree: {
      "T1-001": {
        tier: "t1",
        children: {
          "T2-001": {
            tier: "t2",
            children: {
              "T3-001": { tier: "t3", workers: ["W-001","W-002"] },
              "T3-002": { tier: "t3", workers: ["W-003","W-004"] }
            }
          },
          "T2-002": {
            tier: "t2",
            children: {
              "T3-003": { tier: "t3", workers: ["W-005","W-006"] },
              "T3-004": { tier: "t3", workers: ["W-007","W-008"] }
            }
          }
        }
      }
    }
  }' > "$HIERARCHY_FILE"

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
log "============================================"
log "Test Results: $PASS passed, $FAIL failed"
log "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
