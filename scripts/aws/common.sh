#!/usr/bin/env bash
# Shared AWS helper functions for fleet scripts.
# Source this file; do not execute directly.

aws_cmd() {
  # Wrapper that injects profile + region automatically.
  aws --profile "$FLEET_AWS_PROFILE" --region "$FLEET_AWS_REGION" "$@"
}

cf_deploy_stack() {
  # Deploy a CloudFormation stack and wait for completion.
  # Usage: cf_deploy_stack STACK_NAME TEMPLATE_FILE PARAM1=VAL1 PARAM2=VAL2 ...
  local stack_name="$1"; shift
  local template="$1"; shift

  local params=()
  for kv in "$@"; do
    local key="${kv%%=*}"
    local val="${kv#*=}"
    params+=("ParameterKey=${key},ParameterValue=${val}")
  done

  local param_arg=""
  if [ ${#params[@]} -gt 0 ]; then
    param_arg="--parameters ${params[*]}"
  fi

  aws_cmd cloudformation deploy \
    --stack-name "$stack_name" \
    --template-file "$template" \
    --capabilities CAPABILITY_IAM \
    --tags "Project=${FLEET_PROJECT_TAG}" "Environment=${FLEET_ENVIRONMENT}" \
    --no-fail-on-empty-changeset \
    $param_arg 2>&1
}

cf_get_output() {
  # Retrieve a single output value from a deployed stack.
  # Usage: cf_get_output STACK_NAME OUTPUT_KEY
  local stack_name="$1"
  local output_key="$2"
  aws_cmd cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

cf_stack_exists() {
  # Return 0 if the stack exists and is not in a DELETE state.
  local stack_name="$1"
  local status
  status=$(aws_cmd cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].StackStatus" \
    --output text 2>/dev/null) || return 1
  [[ "$status" != DELETE_COMPLETE ]]
}

cf_delete_stack() {
  # Delete a CloudFormation stack.
  local stack_name="$1"
  aws_cmd cloudformation delete-stack --stack-name "$stack_name"
}

wait_for_url() {
  # Poll a URL until it returns HTTP 2xx (max 120s).
  local url="$1"
  local max_wait="${2:-120}"
  local elapsed=0
  while [ "$elapsed" -lt "$max_wait" ]; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  return 1
}

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

die() {
  log "FATAL: $*" >&2
  exit 1
}
