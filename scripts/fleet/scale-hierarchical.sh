#!/usr/bin/env bash
# Deploy a full hierarchical CCC fleet.
# Usage: bash scripts/fleet/scale-hierarchical.sh <worker_count>
#
# Tier structure (fanout=5 by default):
#   Global Dispatcher
#     -> T1 managers  (ceil(T2_count / fanout))
#       -> T2 managers  (ceil(T3_count / fanout))
#         -> T3 managers  (ceil(worker_count / fanout))
#           -> Workers
#
# Deploys stacks in parallel batches, registers each node with its parent,
# and writes fleet-hierarchy.json with the full tree.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

source "$REPO_ROOT/scripts/fleet-config.sh"
source "$REPO_ROOT/scripts/aws/common.sh"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
WORKER_COUNT="${1:-}"
if [ -z "$WORKER_COUNT" ] || ! [[ "$WORKER_COUNT" =~ ^[0-9]+$ ]] || [ "$WORKER_COUNT" -lt 1 ]; then
  die "Usage: $0 <worker_count>  (positive integer)"
fi

FANOUT="$FLEET_FANOUT"
BATCH="$FLEET_BATCH_SIZE"

# ---------------------------------------------------------------------------
# Tier math
# ---------------------------------------------------------------------------
ceil_div() { echo $(( ($1 + $2 - 1) / $2 )); }

T3_COUNT=$(ceil_div "$WORKER_COUNT" "$FANOUT")
T2_COUNT=$(ceil_div "$T3_COUNT" "$FANOUT")
T1_COUNT=$(ceil_div "$T2_COUNT" "$FANOUT")

TOTAL=$((T1_COUNT + T2_COUNT + T3_COUNT + WORKER_COUNT))

log "Fleet plan:"
log "  Workers : $WORKER_COUNT"
log "  T3 mgrs : $T3_COUNT"
log "  T2 mgrs : $T2_COUNT"
log "  T1 mgrs : $T1_COUNT"
log "  Total   : $TOTAL nodes"
log "  Fanout  : $FANOUT   Batch: $BATCH"

# ---------------------------------------------------------------------------
# Subnet round-robin helper
# ---------------------------------------------------------------------------
IFS=',' read -ra SUBNETS <<< "${FLEET_SUBNET_IDS:-subnet-placeholder}"
subnet_for() {
  local idx="$1"
  echo "${SUBNETS[$((idx % ${#SUBNETS[@]}))]}"
}

# ---------------------------------------------------------------------------
# Tracking arrays (bash 4+ associative)
# ---------------------------------------------------------------------------
declare -A NODE_ENDPOINT   # NODE_ID -> http://ip:8080
declare -A NODE_STACK      # NODE_ID -> stack name
declare -A NODE_PARENT     # NODE_ID -> parent NODE_ID
declare -a DEPLOY_PIDS     # background PIDs in current batch

# ---------------------------------------------------------------------------
# Deploy a single node (runs in background, writes endpoint to temp file)
# ---------------------------------------------------------------------------
deploy_node() {
  local node_id="$1"
  local tier="$2"        # t1|t2|t3|worker
  local parent_endpoint="$3"
  local idx="$4"
  local tmpfile="$5"

  local stack_name="${FLEET_STACK_PREFIX}-${node_id}"
  local subnet
  subnet=$(subnet_for "$idx")

  local template
  local extra_params=""
  if [ "$tier" = "worker" ]; then
    template="$REPO_ROOT/$FLEET_CF_TEMPLATE_WORKER"
    extra_params="ManagerEndpoint=${parent_endpoint}"
  else
    template="$REPO_ROOT/$FLEET_CF_TEMPLATE_MANAGER"
    extra_params="ManagerTier=${tier} ParentEndpoint=${parent_endpoint}"
  fi

  log "  deploying $node_id ($tier) stack=$stack_name"

  cf_deploy_stack "$stack_name" "$template" \
    "NodeId=${node_id}" \
    "SubnetId=${subnet}" \
    "VpcId=${FLEET_VPC_ID:-vpc-placeholder}" \
    "Environment=${FLEET_ENVIRONMENT}" \
    $extra_params >/dev/null 2>&1

  local endpoint
  endpoint=$(cf_get_output "$stack_name" "Endpoint")

  # Write result so parent process can read it
  echo "${node_id}|${endpoint}|${stack_name}" >> "$tmpfile"
}

# ---------------------------------------------------------------------------
# Deploy a batch of nodes in parallel (up to $BATCH at a time)
# ---------------------------------------------------------------------------
deploy_batch() {
  local tier="$1"; shift
  # Remaining args: "NODE_ID|PARENT_ENDPOINT" pairs
  local items=("$@")
  local tmpfile
  tmpfile=$(mktemp)

  local count=0
  local pids=()

  for item in "${items[@]}"; do
    local node_id="${item%%|*}"
    local parent_ep="${item#*|}"

    deploy_node "$node_id" "$tier" "$parent_ep" "$count" "$tmpfile" &
    pids+=($!)
    count=$((count + 1))

    if [ $((count % BATCH)) -eq 0 ]; then
      log "  waiting for batch of $BATCH..."
      for pid in "${pids[@]}"; do wait "$pid" || true; done
      pids=()
    fi
  done

  # Wait for remainder
  for pid in "${pids[@]}"; do wait "$pid" || true; done

  # Read results back
  if [ -f "$tmpfile" ]; then
    while IFS='|' read -r nid ep sn; do
      NODE_ENDPOINT["$nid"]="$ep"
      NODE_STACK["$nid"]="$sn"
    done < "$tmpfile"
    rm -f "$tmpfile"
  fi
}

# ---------------------------------------------------------------------------
# Register node with parent/dispatcher
# ---------------------------------------------------------------------------
register_node() {
  local node_id="$1"
  local role="$2"          # manager | worker
  local tier="$3"          # t1|t2|t3|worker
  local target_url="$4"   # parent endpoint or dispatcher
  local node_endpoint="$5"

  curl -sf -X POST "${target_url}/api/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"node_id\": \"${node_id}\",
      \"role\": \"${role}\",
      \"tier\": \"${tier}\",
      \"endpoint\": \"${node_endpoint}\"
    }" >/dev/null 2>&1 || log "  WARN: registration failed for $node_id at $target_url"
}

# ---------------------------------------------------------------------------
# Build node ID lists with parent assignments
# ---------------------------------------------------------------------------
build_assignments() {
  # Assigns children to parents round-robin by fanout.
  # Outputs "CHILD_ID|PARENT_ID" lines.
  local child_prefix="$1"
  local child_count="$2"
  local -n parent_ids_ref=$3   # nameref to parent ID array

  local parent_count=${#parent_ids_ref[@]}
  for ((i = 1; i <= child_count; i++)); do
    local cid
    cid=$(printf '%s-%03d' "$child_prefix" "$i")
    local parent_idx=$(( (i - 1) / FANOUT % parent_count ))
    # Clamp: if more children than fanout*parents, wrap around
    if [ "$parent_idx" -ge "$parent_count" ]; then
      parent_idx=$((parent_idx % parent_count))
    fi
    local pid="${parent_ids_ref[$parent_idx]}"
    echo "${cid}|${pid}"
  done
}

# ===================================================================
# PHASE 1: Deploy T1 managers (parent = global dispatcher)
# ===================================================================
log "--- Phase 1: Deploying $T1_COUNT T1 managers ---"

T1_ITEMS=()
T1_IDS=()
for ((i = 1; i <= T1_COUNT; i++)); do
  nid=$(printf 'T1-%03d' "$i")
  T1_IDS+=("$nid")
  T1_ITEMS+=("${nid}|")  # no parent endpoint yet (registered with dispatcher)
done

deploy_batch "t1" "${T1_ITEMS[@]}"

# Register T1s with the global dispatcher
for nid in "${T1_IDS[@]}"; do
  register_node "$nid" "manager" "t1" "$FLEET_DISPATCHER_URL" "${NODE_ENDPOINT[$nid]:-unknown}"
  NODE_PARENT["$nid"]="dispatcher"
done

log "--- T1 deployment complete ---"

# ===================================================================
# PHASE 2: Deploy T2 managers (parent = T1)
# ===================================================================
log "--- Phase 2: Deploying $T2_COUNT T2 managers ---"

T2_ITEMS=()
T2_IDS=()
while IFS='|' read -r cid pid; do
  T2_IDS+=("$cid")
  local_parent_ep="${NODE_ENDPOINT[$pid]:-}"
  T2_ITEMS+=("${cid}|${local_parent_ep}")
  NODE_PARENT["$cid"]="$pid"
done < <(build_assignments "T2" "$T2_COUNT" T1_IDS)

deploy_batch "t2" "${T2_ITEMS[@]}"

# Register T2s with their T1 parent
for cid in "${T2_IDS[@]}"; do
  parent="${NODE_PARENT[$cid]}"
  parent_ep="${NODE_ENDPOINT[$parent]:-}"
  register_node "$cid" "manager" "t2" "$parent_ep" "${NODE_ENDPOINT[$cid]:-unknown}"
done

log "--- T2 deployment complete ---"

# ===================================================================
# PHASE 3: Deploy T3 managers (parent = T2)
# ===================================================================
log "--- Phase 3: Deploying $T3_COUNT T3 managers ---"

T3_ITEMS=()
T3_IDS=()
while IFS='|' read -r cid pid; do
  T3_IDS+=("$cid")
  local_parent_ep="${NODE_ENDPOINT[$pid]:-}"
  T3_ITEMS+=("${cid}|${local_parent_ep}")
  NODE_PARENT["$cid"]="$pid"
done < <(build_assignments "T3" "$T3_COUNT" T2_IDS)

deploy_batch "t3" "${T3_ITEMS[@]}"

for cid in "${T3_IDS[@]}"; do
  parent="${NODE_PARENT[$cid]}"
  parent_ep="${NODE_ENDPOINT[$parent]:-}"
  register_node "$cid" "manager" "t3" "$parent_ep" "${NODE_ENDPOINT[$cid]:-unknown}"
done

log "--- T3 deployment complete ---"

# ===================================================================
# PHASE 4: Deploy workers (parent = T3)
# ===================================================================
log "--- Phase 4: Deploying $WORKER_COUNT workers ---"

W_ITEMS=()
W_IDS=()
while IFS='|' read -r cid pid; do
  W_IDS+=("$cid")
  local_parent_ep="${NODE_ENDPOINT[$pid]:-}"
  W_ITEMS+=("${cid}|${local_parent_ep}")
  NODE_PARENT["$cid"]="$pid"
done < <(build_assignments "W" "$WORKER_COUNT" T3_IDS)

deploy_batch "worker" "${W_ITEMS[@]}"

for cid in "${W_IDS[@]}"; do
  parent="${NODE_PARENT[$cid]}"
  parent_ep="${NODE_ENDPOINT[$parent]:-}"
  register_node "$cid" "worker" "worker" "$parent_ep" "${NODE_ENDPOINT[$cid]:-unknown}"
done

log "--- Worker deployment complete ---"

# ===================================================================
# Generate fleet-hierarchy.json
# ===================================================================
log "--- Generating fleet-hierarchy.json ---"

HIERARCHY_FILE="$REPO_ROOT/fleet-hierarchy.json"

generate_hierarchy() {
  # Build JSON tree using jq
  local jq_input="[]"

  # Add all nodes
  for nid in "${T1_IDS[@]}" "${T2_IDS[@]}" "${T3_IDS[@]}" "${W_IDS[@]}"; do
    local role="manager"
    local tier=""
    case "$nid" in
      T1-*) tier="t1" ;;
      T2-*) tier="t2" ;;
      T3-*) tier="t3" ;;
      W-*)  tier="worker"; role="worker" ;;
    esac
    local parent="${NODE_PARENT[$nid]:-dispatcher}"
    local endpoint="${NODE_ENDPOINT[$nid]:-pending}"
    local stack="${NODE_STACK[$nid]:-}"

    jq_input=$(echo "$jq_input" | jq \
      --arg id "$nid" \
      --arg role "$role" \
      --arg tier "$tier" \
      --arg parent "$parent" \
      --arg endpoint "$endpoint" \
      --arg stack "$stack" \
      '. + [{
        node_id: $id,
        role: $role,
        tier: $tier,
        parent: $parent,
        endpoint: $endpoint,
        stack: $stack
      }]')
  done

  # Build tree structure
  jq '{
    dispatcher: $ENV.FLEET_DISPATCHER_URL,
    deployed_at: (now | todate),
    worker_count: ($nodes | map(select(.role == "worker")) | length),
    manager_count: ($nodes | map(select(.role == "manager")) | length),
    tiers: {
      t1: ($nodes | map(select(.tier == "t1")) | length),
      t2: ($nodes | map(select(.tier == "t2")) | length),
      t3: ($nodes | map(select(.tier == "t3")) | length)
    },
    fanout: ($ENV.FLEET_FANOUT | tonumber),
    tree: (
      [$nodes[] | select(.tier == "t1")] | map({
        node_id: .node_id,
        endpoint: .endpoint,
        tier: "t1",
        children: [
          $nodes[] | select(.parent == .node_id) | . as $t2 | {
            node_id: $t2.node_id,
            endpoint: $t2.endpoint,
            tier: "t2",
            children: [
              $nodes[] | select(.parent == $t2.node_id) | . as $t3 | {
                node_id: $t3.node_id,
                endpoint: $t3.endpoint,
                tier: "t3",
                workers: [
                  $nodes[] | select(.parent == $t3.node_id) | {
                    node_id: .node_id,
                    endpoint: .endpoint
                  }
                ]
              }
            ]
          }
        ]
      })
    ),
    nodes: $nodes
  }' --argjson nodes "$jq_input" --null-input
}

generate_hierarchy > "$HIERARCHY_FILE"

log "Fleet hierarchy written to $HIERARCHY_FILE"

# ===================================================================
# Summary
# ===================================================================
log "============================================"
log "Fleet deployment complete!"
log "  T1 managers : $T1_COUNT"
log "  T2 managers : $T2_COUNT"
log "  T3 managers : $T3_COUNT"
log "  Workers     : $WORKER_COUNT"
log "  Total nodes : $TOTAL"
log "  Hierarchy   : $HIERARCHY_FILE"
log "============================================"
