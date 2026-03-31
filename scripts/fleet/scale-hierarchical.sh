#!/usr/bin/env bash
# scale-hierarchical.sh -- Deploy a full hierarchical fleet
#
# Usage: scale-hierarchical.sh <worker_count> [--instance-type TYPE] [--prefix PREFIX]
#
# Tier calculation:
#   T3 managers = ceil(workers / 5)
#   T2 managers = ceil(T3 / 5)
#   T1 managers = ceil(T2 / 5)
#
# Deploy order: T1 -> T2 (register with T1) -> T3 (register with T2) -> Workers (register with T3)
# Batches of 20 parallel deploys per tier.
# Generates fleet-hierarchy.json with the full tree mapping.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/fleet-helpers.sh"

# -- Defaults --
INSTANCE_TYPE="t3.micro"
PREFIX="booth"
BATCH_SIZE="${BATCH_SIZE:-20}"
API_PORT="${API_PORT:-8080}"
OUTPUT_FILE="fleet-hierarchy.json"

# -- Parse args --
WORKER_COUNT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
        --prefix)        PREFIX="$2"; shift 2 ;;
        --output)        OUTPUT_FILE="$2"; shift 2 ;;
        --port)          API_PORT="$2"; shift 2 ;;
        --batch-size)    BATCH_SIZE="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: scale-hierarchical.sh <worker_count> [options]"
            echo ""
            echo "Options:"
            echo "  --instance-type TYPE   EC2 instance type (default: t3.micro)"
            echo "  --prefix PREFIX        Stack name prefix (default: booth)"
            echo "  --output FILE          Output hierarchy file (default: fleet-hierarchy.json)"
            echo "  --port PORT            API port for registration (default: 8080)"
            echo "  --batch-size N         Max parallel deploys per batch (default: 20)"
            exit 0
            ;;
        *)
            if [[ -z "$WORKER_COUNT" ]]; then
                WORKER_COUNT="$1"
            else
                echo "ERROR: Unexpected argument: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$WORKER_COUNT" ]] || ! [[ "$WORKER_COUNT" =~ ^[0-9]+$ ]] || (( WORKER_COUNT < 1 )); then
    echo "ERROR: worker_count must be a positive integer" >&2
    echo "Usage: scale-hierarchical.sh <worker_count>" >&2
    exit 1
fi

export BATCH_SIZE API_PORT

# -- Calculate tiers --
calc_tiers "$WORKER_COUNT"

echo "============================================"
echo "  Hierarchical Fleet Deployment"
echo "============================================"
echo "  Workers:      ${WORKER_COUNT}"
echo "  T3 managers:  ${T3_COUNT}"
echo "  T2 managers:  ${T2_COUNT}"
echo "  T1 managers:  ${T1_COUNT}"
echo "  Total nodes:  $(( T1_COUNT + T2_COUNT + T3_COUNT + WORKER_COUNT ))"
echo "  Instance type: ${INSTANCE_TYPE}"
echo "  Batch size:   ${BATCH_SIZE}"
echo "============================================"
echo ""

# -- Generate stack names for each tier --
T1_NAMES=()
for i in $(seq 1 "$T1_COUNT"); do
    T1_NAMES+=("${PREFIX}-t1-$(printf '%03d' "$i")")
done

T2_NAMES=()
for i in $(seq 1 "$T2_COUNT"); do
    T2_NAMES+=("${PREFIX}-t2-$(printf '%03d' "$i")")
done

T3_NAMES=()
for i in $(seq 1 "$T3_COUNT"); do
    T3_NAMES+=("${PREFIX}-t3-$(printf '%03d' "$i")")
done

WORKER_NAMES=()
for i in $(seq 1 "$WORKER_COUNT"); do
    WORKER_NAMES+=("${PREFIX}-worker-$(printf '%03d' "$i")")
done

# -- Hierarchy tracking --
declare -A STACK_IPS
declare -A CHILDREN_MAP   # parent -> space-separated list of children
declare -A NODE_TIER      # node_name -> tier

# -- TIER 1: Deploy T1 managers --
echo "[TIER 1] Deploying ${T1_COUNT} T1 manager(s)..."
deploy_batch "t1" "$INSTANCE_TYPE" "${T1_NAMES[@]}"
T1_DEPLOYED=("${DEPLOYED_STACKS[@]}")

echo "[TIER 1] Waiting for T1 stacks to complete..."
wait_and_collect_ips "${T1_DEPLOYED[@]}"
for name in "${T1_DEPLOYED[@]}"; do
    NODE_TIER["$name"]="t1"
done
echo "[TIER 1] Complete. ${#T1_DEPLOYED[@]} T1 managers deployed."
echo ""

# -- TIER 2: Deploy T2 managers and register with T1 --
echo "[TIER 2] Deploying ${T2_COUNT} T2 manager(s)..."
deploy_batch "t2" "$INSTANCE_TYPE" "${T2_NAMES[@]}"
T2_DEPLOYED=("${DEPLOYED_STACKS[@]}")

echo "[TIER 2] Waiting for T2 stacks to complete..."
wait_and_collect_ips "${T2_DEPLOYED[@]}"
for name in "${T2_DEPLOYED[@]}"; do
    NODE_TIER["$name"]="t2"
done

echo "[TIER 2] Registering T2 managers with T1 parents..."
while IFS=' ' read -r parent child; do
    parent_ip="${STACK_IPS[$parent]}"
    child_ip="${STACK_IPS[$child]}"
    if [[ -n "$parent_ip" && -n "$child_ip" ]]; then
        register_child "$parent_ip" "$child_ip" "t2" "$child" && \
            CHILDREN_MAP["$parent"]+="$child " || true
    fi
done < <(assign_round_robin T1_DEPLOYED T2_DEPLOYED)
echo "[TIER 2] Complete. ${#T2_DEPLOYED[@]} T2 managers deployed."
echo ""

# -- TIER 3: Deploy T3 managers and register with T2 --
echo "[TIER 3] Deploying ${T3_COUNT} T3 manager(s)..."
deploy_batch "t3" "$INSTANCE_TYPE" "${T3_NAMES[@]}"
T3_DEPLOYED=("${DEPLOYED_STACKS[@]}")

echo "[TIER 3] Waiting for T3 stacks to complete..."
wait_and_collect_ips "${T3_DEPLOYED[@]}"
for name in "${T3_DEPLOYED[@]}"; do
    NODE_TIER["$name"]="t3"
done

echo "[TIER 3] Registering T3 managers with T2 parents..."
while IFS=' ' read -r parent child; do
    parent_ip="${STACK_IPS[$parent]}"
    child_ip="${STACK_IPS[$child]}"
    if [[ -n "$parent_ip" && -n "$child_ip" ]]; then
        register_child "$parent_ip" "$child_ip" "t3" "$child" && \
            CHILDREN_MAP["$parent"]+="$child " || true
    fi
done < <(assign_round_robin T2_DEPLOYED T3_DEPLOYED)
echo "[TIER 3] Complete. ${#T3_DEPLOYED[@]} T3 managers deployed."
echo ""

# -- WORKERS: Deploy workers and register with T3 --
echo "[WORKERS] Deploying ${WORKER_COUNT} worker(s)..."
deploy_batch "worker" "$INSTANCE_TYPE" "${WORKER_NAMES[@]}"
WORKERS_DEPLOYED=("${DEPLOYED_STACKS[@]}")

echo "[WORKERS] Waiting for worker stacks to complete..."
wait_and_collect_ips "${WORKERS_DEPLOYED[@]}"
for name in "${WORKERS_DEPLOYED[@]}"; do
    NODE_TIER["$name"]="worker"
done

echo "[WORKERS] Registering workers with T3 parents..."
while IFS=' ' read -r parent child; do
    parent_ip="${STACK_IPS[$parent]}"
    child_ip="${STACK_IPS[$child]}"
    if [[ -n "$parent_ip" && -n "$child_ip" ]]; then
        register_child "$parent_ip" "$child_ip" "worker" "$child" && \
            CHILDREN_MAP["$parent"]+="$child " || true
    fi
done < <(assign_round_robin T3_DEPLOYED WORKERS_DEPLOYED)
echo "[WORKERS] Complete. ${#WORKERS_DEPLOYED[@]} workers deployed."
echo ""

# -- Generate fleet-hierarchy.json --
echo "[OUTPUT] Generating ${OUTPUT_FILE}..."

# Build JSON using a heredoc + bash substitution
{
    echo '{'
    echo '  "generated_at": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",'
    echo '  "worker_count": '"${WORKER_COUNT}"','
    echo '  "tiers": {'
    echo '    "t1": '"${T1_COUNT}"','
    echo '    "t2": '"${T2_COUNT}"','
    echo '    "t3": '"${T3_COUNT}"','
    echo '    "workers": '"${WORKER_COUNT}"
    echo '  },'
    echo '  "nodes": {'

    local_first=true
    # Collect all node names
    ALL_NODES=()
    ALL_NODES+=("${T1_DEPLOYED[@]}")
    ALL_NODES+=("${T2_DEPLOYED[@]}")
    ALL_NODES+=("${T3_DEPLOYED[@]}")
    ALL_NODES+=("${WORKERS_DEPLOYED[@]}")

    for node in "${ALL_NODES[@]}"; do
        if [[ "$local_first" == "true" ]]; then
            local_first=false
        else
            echo ','
        fi
        ip="${STACK_IPS[$node]:-unknown}"
        tier="${NODE_TIER[$node]:-unknown}"
        children_str="${CHILDREN_MAP[$node]:-}"

        # Build children JSON array
        children_json="[]"
        if [[ -n "$children_str" ]]; then
            children_json="["
            child_first=true
            for child in $children_str; do
                child_ip="${STACK_IPS[$child]:-unknown}"
                if [[ "$child_first" == "true" ]]; then
                    child_first=false
                else
                    children_json+=","
                fi
                children_json+="\"${child}\""
            done
            children_json+="]"
        fi

        printf '    "%s": {"ip": "%s", "tier": "%s", "children": %s}' \
            "$node" "$ip" "$tier" "$children_json"
    done

    echo ''
    echo '  }'
    echo '}'
} > "$OUTPUT_FILE"

echo ""
echo "============================================"
echo "  Fleet deployment complete!"
echo "============================================"
echo "  Hierarchy file: ${OUTPUT_FILE}"
echo "  Total deployed: $(( ${#T1_DEPLOYED[@]} + ${#T2_DEPLOYED[@]} + ${#T3_DEPLOYED[@]} + ${#WORKERS_DEPLOYED[@]} ))"
echo "============================================"
