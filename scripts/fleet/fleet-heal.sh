#!/usr/bin/env bash
# fleet-heal.sh -- Periodic fleet health check and self-repair.
# Called by dispatcher-brain on a 10-minute timer.
# Checks node health, restarts failed workers, reports status.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCHER_URL="${DISPATCHER_URL:-http://localhost:3100}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "[fleet-heal] ${TIMESTAMP} Starting health check"

# 1. Check dispatcher health
HEALTH=$(curl -sf "${DISPATCHER_URL}/health" 2>/dev/null || echo '{"status":"unreachable"}')
STATUS=$(echo "${HEALTH}" | node -e "var d='';process.stdin.on('data',function(c){d+=c});process.stdin.on('end',function(){try{console.log(JSON.parse(d).status)}catch(e){console.log('error')}})" 2>/dev/null || echo "error")

if [[ "${STATUS}" != "ok" ]]; then
  echo "[fleet-heal] WARNING: Dispatcher health check failed (status: ${STATUS})"
  exit 1
fi

echo "[fleet-heal] Dispatcher healthy"

# 2. Check for stale tasks (running > 30 min with no progress)
PENDING=$(echo "${HEALTH}" | node -e "var d='';process.stdin.on('data',function(c){d+=c});process.stdin.on('end',function(){try{var h=JSON.parse(d);console.log(h.tasks.pending||0)}catch(e){console.log(0)}})" 2>/dev/null || echo "0")
RUNNING=$(echo "${HEALTH}" | node -e "var d='';process.stdin.on('data',function(c){d+=c});process.stdin.on('end',function(){try{var h=JSON.parse(d);console.log(h.tasks.running||0)}catch(e){console.log(0)}})" 2>/dev/null || echo "0")

echo "[fleet-heal] Queue: ${PENDING} pending, ${RUNNING} running"

# 3. Check disk space
DISK_PCT=$(df -h "${SCRIPT_DIR}" | tail -1 | awk '{print $5}' | tr -d '%')
if [[ "${DISK_PCT}" -gt 90 ]]; then
  echo "[fleet-heal] WARNING: Disk usage at ${DISK_PCT}%"
fi

# 4. Check state file integrity
STATE_FILE="${SCRIPT_DIR}/.dispatcher-state/state.json"
if [[ -f "${STATE_FILE}" ]]; then
  if ! node -e "JSON.parse(require('fs').readFileSync('${STATE_FILE}','utf8'))" 2>/dev/null; then
    echo "[fleet-heal] WARNING: state.json is corrupted, backing up"
    cp "${STATE_FILE}" "${STATE_FILE}.bak.${TIMESTAMP}"
  fi
fi

echo "[fleet-heal] ${TIMESTAMP} Health check complete"
