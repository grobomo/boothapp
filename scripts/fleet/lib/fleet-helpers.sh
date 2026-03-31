#!/usr/bin/env bash
# fleet-helpers.sh -- Shared utility functions for fleet scripts

# Ceiling division: ceil(a/b)
ceil_div() {
    local num=$1
    local den=$2
    echo $(( (num + den - 1) / den ))
}

# Calculate tier counts from worker count
# Sets: T3_COUNT, T2_COUNT, T1_COUNT
calc_tiers() {
    local workers=$1
    T3_COUNT=$(ceil_div "$workers" 5)
    T2_COUNT=$(ceil_div "$T3_COUNT" 5)
    T1_COUNT=$(ceil_div "$T2_COUNT" 5)
}

# Wait for a CloudFormation stack to reach CREATE_COMPLETE or UPDATE_COMPLETE
wait_for_stack() {
    local stack_name=$1
    local profile="${AWS_PROFILE:-hackathon}"
    local region="${AWS_REGION:-us-east-1}"
    local max_wait=600
    local interval=10
    local elapsed=0

    while (( elapsed < max_wait )); do
        local status
        status=$(aws cloudformation describe-stacks \
            --stack-name "$stack_name" \
            --query 'Stacks[0].StackStatus' \
            --output text \
            --profile "$profile" \
            --region "$region" 2>/dev/null || echo "UNKNOWN")

        case "$status" in
            CREATE_COMPLETE|UPDATE_COMPLETE)
                return 0
                ;;
            *ROLLBACK*|*FAILED*|DELETE_COMPLETE)
                echo "ERROR: Stack $stack_name reached terminal state: $status" >&2
                return 1
                ;;
        esac

        sleep "$interval"
        (( elapsed += interval ))
    done

    echo "ERROR: Stack $stack_name timed out after ${max_wait}s" >&2
    return 1
}

# Get the public IP of a stack's instance (from CF outputs)
get_stack_ip() {
    local stack_name=$1
    local profile="${AWS_PROFILE:-hackathon}"
    local region="${AWS_REGION:-us-east-1}"

    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --query 'Stacks[0].Outputs[?OutputKey==`PublicIp`].OutputValue' \
        --output text \
        --profile "$profile" \
        --region "$region" 2>/dev/null
}

# Register a child node with its parent via POST /api/register
register_child() {
    local parent_ip=$1
    local child_ip=$2
    local child_tier=$3
    local child_name=$4
    local port="${API_PORT:-8080}"
    local max_retries=3
    local retry=0

    while (( retry < max_retries )); do
        local http_code
        http_code=$(curl -s -o /dev/null -w '%{http_code}' \
            -X POST "http://${parent_ip}:${port}/api/register" \
            -H 'Content-Type: application/json' \
            -d "{\"ip\":\"${child_ip}\",\"tier\":\"${child_tier}\",\"name\":\"${child_name}\"}" \
            --connect-timeout 10 \
            --max-time 30)

        if [[ "$http_code" =~ ^2 ]]; then
            return 0
        fi

        (( retry++ ))
        echo "WARN: register_child ${child_name} -> ${parent_ip} returned HTTP ${http_code}, retry ${retry}/${max_retries}" >&2
        sleep 2
    done

    echo "ERROR: Failed to register ${child_name} with parent ${parent_ip}" >&2
    return 1
}

# Deploy a batch of stacks in parallel (max BATCH_SIZE concurrent)
# Usage: deploy_batch <tier> <instance_type> <name1> <name2> ...
# Populates DEPLOYED_STACKS array with successfully deployed stack names
deploy_batch() {
    local tier=$1
    local instance_type=$2
    shift 2
    local names=("$@")
    local batch_size="${BATCH_SIZE:-20}"

    DEPLOYED_STACKS=()
    local pids=()
    local stack_names=()
    local batch_count=0

    for name in "${names[@]}"; do
        bash "$(dirname "${BASH_SOURCE[0]}")/../deploy-stack.sh" "$name" "$tier" "$instance_type" &
        pids+=($!)
        stack_names+=("$name")
        (( batch_count++ ))

        if (( batch_count >= batch_size )); then
            # Wait for this batch to finish
            for i in "${!pids[@]}"; do
                if wait "${pids[$i]}" 2>/dev/null; then
                    DEPLOYED_STACKS+=("${stack_names[$i]}")
                else
                    echo "WARN: Stack ${stack_names[$i]} deploy process failed" >&2
                fi
            done
            pids=()
            stack_names=()
            batch_count=0
        fi
    done

    # Wait for remaining
    for i in "${!pids[@]}"; do
        if wait "${pids[$i]}" 2>/dev/null; then
            DEPLOYED_STACKS+=("${stack_names[$i]}")
        else
            echo "WARN: Stack ${stack_names[$i]} deploy process failed" >&2
        fi
    done
}

# Wait for all stacks in a list and collect their IPs
# Usage: wait_and_collect_ips <stack1> <stack2> ...
# Populates STACK_IPS associative array: STACK_IPS[stack_name]=ip
wait_and_collect_ips() {
    local stacks=("$@")

    declare -gA STACK_IPS

    for stack in "${stacks[@]}"; do
        if wait_for_stack "$stack"; then
            local ip
            ip=$(get_stack_ip "$stack")
            if [[ -n "$ip" && "$ip" != "None" ]]; then
                STACK_IPS["$stack"]="$ip"
                echo "[fleet] ${stack} -> ${ip}"
            else
                echo "WARN: No IP found for stack ${stack}" >&2
            fi
        fi
    done
}

# Assign children to parents round-robin (up to 5 children per parent)
# Usage: assign_children <parent_array_name> <child_array_name>
# Outputs lines: parent_stack child_stack
assign_round_robin() {
    local -n parents=$1
    local -n children=$2
    local parent_count=${#parents[@]}
    local idx=0

    for child in "${children[@]}"; do
        local parent_idx=$(( idx % parent_count ))
        echo "${parents[$parent_idx]} ${child}"
        (( idx++ ))
    done
}
