#!/usr/bin/env bash
# deploy-stack.sh -- Deploy a single CloudFormation stack for a fleet node
#
# Usage: deploy-stack.sh <stack-name> <tier> <instance-type>
#
# Outputs the stack name on success. Caller collects IP after stack completes.

set -euo pipefail

STACK_NAME="${1:?Usage: deploy-stack.sh <stack-name> <tier> <instance-type>}"
TIER="${2:?Missing tier (t1|t2|t3|worker)}"
INSTANCE_TYPE="${3:-t3.micro}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/fleet-node.cfn.yaml"
AWS_PROFILE="${AWS_PROFILE:-hackathon}"
AWS_REGION="${AWS_REGION:-us-east-1}"

if [[ ! -f "$TEMPLATE" ]]; then
    echo "ERROR: CloudFormation template not found: $TEMPLATE" >&2
    exit 1
fi

echo "[deploy-stack] Deploying ${STACK_NAME} (tier=${TIER}, type=${INSTANCE_TYPE})..."

aws cloudformation deploy \
    --template-file "$TEMPLATE" \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
        Tier="$TIER" \
        InstanceType="$INSTANCE_TYPE" \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    2>&1

echo "[deploy-stack] Stack ${STACK_NAME} deployment initiated."
echo "$STACK_NAME"
