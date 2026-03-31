#!/usr/bin/env bash
# Shared constants for CCC fleet management scripts.
# Source this file; do not execute directly.

# -- AWS --
export FLEET_AWS_PROFILE="${FLEET_AWS_PROFILE:-hackathon}"
export FLEET_AWS_REGION="${FLEET_AWS_REGION:-us-east-1}"

# -- Networking --
export FLEET_VPC_ID="${FLEET_VPC_ID:-}"          # set in env or discovered at deploy time
export FLEET_SUBNET_IDS="${FLEET_SUBNET_IDS:-}"  # comma-separated

# -- CloudFormation --
export FLEET_CF_TEMPLATE_MANAGER="cloudformation/hackathon26-manager.yaml"
export FLEET_CF_TEMPLATE_WORKER="cloudformation/hackathon26-worker.yaml"
export FLEET_STACK_PREFIX="ccc-fleet"

# -- Dispatcher --
export FLEET_DISPATCHER_URL="${FLEET_DISPATCHER_URL:-http://localhost:8080}"

# -- Tier fan-out (how many children per parent) --
export FLEET_FANOUT="${FLEET_FANOUT:-5}"

# -- Parallelism --
export FLEET_BATCH_SIZE="${FLEET_BATCH_SIZE:-20}"

# -- Tags --
export FLEET_PROJECT_TAG="boothapp"
export FLEET_ENVIRONMENT="${FLEET_ENVIRONMENT:-dev}"
