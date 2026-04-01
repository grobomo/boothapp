#!/usr/bin/env bash
# dispatcher-brain.sh -- Start the persistent dispatcher brain.
#
# Creates a FIFO, launches the HTTP server, and runs a session loop
# that reads tasks from the FIFO and processes them. Sits idle between
# tasks (blocked on FIFO read -- zero CPU burn).
#
# Usage:
#   ./dispatcher-brain.sh              # foreground
#   ./dispatcher-brain.sh --daemon     # background with log file
#
# Environment:
#   DISPATCHER_PORT    HTTP port (default: 3100)
#   HEAL_INTERVAL_MS   Fleet-heal interval in ms (default: 600000 = 10min)
#   HEAL_SCRIPT        Path to fleet-heal.sh (default: auto-detected)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${SCRIPT_DIR}/.dispatcher-state"
FIFO_PATH="${STATE_DIR}/brain.fifo"
LOG_FILE="${STATE_DIR}/dispatcher.log"
PID_FILE="${STATE_DIR}/dispatcher.pid"
CONTEXT_FILE="${STATE_DIR}/context.md"

export DISPATCHER_FIFO="${FIFO_PATH}"
export HEAL_SCRIPT="${HEAL_SCRIPT:-${SCRIPT_DIR}/fleet-heal.sh}"

# -- Setup ------------------------------------------------------------------

mkdir -p "${STATE_DIR}"

# Create FIFO if it doesn't exist
if [[ ! -p "${FIFO_PATH}" ]]; then
  mkfifo "${FIFO_PATH}"
  echo "[brain] Created FIFO at ${FIFO_PATH}"
fi

# Write initial context file
cat > "${CONTEXT_FILE}" << 'CONTEXT'
# Dispatcher Brain Context

## Role
Persistent dispatcher that receives tasks, decomposes them, dispatches to workers,
and maintains fleet health. Operates autonomously without human intervention.

## Capabilities
- Task decomposition and dispatch
- Fleet scaling decisions
- GitHub issue monitoring and PR merges
- E2E test orchestration
- Agent-to-agent communication
- Periodic fleet healing (every 10 min)

## State
Task queue and history persisted in .dispatcher-state/state.json
Human-readable TODO at .dispatcher-state/TODO.md
CONTEXT

# -- Cleanup on exit -------------------------------------------------------

cleanup() {
  echo "[brain] Shutting down..."
  if [[ -f "${PID_FILE}" ]]; then
    local server_pid
    server_pid=$(cat "${PID_FILE}")
    kill "${server_pid}" 2>/dev/null || true
    rm -f "${PID_FILE}"
  fi
  echo "[brain] Stopped at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
trap cleanup EXIT

# -- Start HTTP server ------------------------------------------------------

start_server() {
  node "${SCRIPT_DIR}/dispatcher-server.js" &
  local server_pid=$!
  echo "${server_pid}" > "${PID_FILE}"
  echo "[brain] HTTP server started (PID ${server_pid})"
}

# -- Session loop -----------------------------------------------------------
# Reads from the FIFO. Blocks when no input (zero CPU). When a line arrives,
# it processes the task. This is the "persistent session" -- it never exits
# unless killed.

session_loop() {
  echo "[brain] Session loop started. Waiting for tasks on FIFO..."
  echo "[brain] Dashboard: http://localhost:${DISPATCHER_PORT:-3100}"

  while true; do
    # Open FIFO for reading. This blocks until a writer connects.
    # We use a redirect trick: open FIFO and also keep a write fd open
    # so the read doesn't get EOF when the writer closes.
    if read -r line < "${FIFO_PATH}"; then
      if [[ -z "${line}" ]]; then
        continue
      fi

      local timestamp
      timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      echo "[brain] [${timestamp}] Received: ${line}"

      # Parse the JSON message
      local msg_type
      msg_type=$(echo "${line}" | node -e "
        var d = '';
        process.stdin.on('data', function(c) { d += c; });
        process.stdin.on('end', function() {
          try { console.log(JSON.parse(d).type || 'unknown'); }
          catch(e) { console.log('raw'); }
        });
      " 2>/dev/null || echo "raw")

      local task_id
      task_id=$(echo "${line}" | node -e "
        var d = '';
        process.stdin.on('data', function(c) { d += c; });
        process.stdin.on('end', function() {
          try { console.log(JSON.parse(d).id || ''); }
          catch(e) { console.log(''); }
        });
      " 2>/dev/null || echo "")

      local task_text
      task_text=$(echo "${line}" | node -e "
        var d = '';
        process.stdin.on('data', function(c) { d += c; });
        process.stdin.on('end', function() {
          try { console.log(JSON.parse(d).text || d); }
          catch(e) { console.log(d); }
        });
      " 2>/dev/null || echo "${line}")

      echo "[brain] Processing ${msg_type} task: ${task_id}"
      echo "[brain]   Text: ${task_text:0:120}"

      # Mark task as running via the API
      if [[ -n "${task_id}" ]]; then
        curl -s -X POST "http://localhost:${DISPATCHER_PORT:-3100}/api/complete" \
          -H "Content-Type: application/json" \
          -d "{\"id\":\"${task_id}\",\"status\":\"running\"}" > /dev/null 2>&1 || true

        # Start the task via API (sets status to running in state)
        node -e "
          var s = require('${SCRIPT_DIR}/dispatcher-state');
          var st = new s.State('${STATE_DIR}');
          st.load();
          st.startTask('${task_id}');
        " 2>/dev/null || true
      fi

      # -- Task processing --
      # In production, this is where claude processes the task.
      # For now, we log it and mark complete.
      echo "[brain] Task ${task_id} dispatched for processing"

      # Mark task complete
      if [[ -n "${task_id}" ]]; then
        node -e "
          var s = require('${SCRIPT_DIR}/dispatcher-state');
          var st = new s.State('${STATE_DIR}');
          st.load();
          st.completeTask('${task_id}', 'processed by dispatcher brain');
        " 2>/dev/null || true
        echo "[brain] Task ${task_id} completed"
      fi
    fi
  done
}

# -- Main -------------------------------------------------------------------

echo "============================================="
echo "  Dispatcher Brain"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================="
echo ""

if [[ "${1:-}" == "--daemon" ]]; then
  echo "[brain] Starting in daemon mode. Log: ${LOG_FILE}"
  start_server
  session_loop >> "${LOG_FILE}" 2>&1 &
  echo $! >> "${PID_FILE}"
  echo "[brain] Daemon started. PIDs in ${PID_FILE}"
  echo "[brain] Dashboard: http://localhost:${DISPATCHER_PORT:-3100}"
  echo "[brain] Logs: tail -f ${LOG_FILE}"
else
  start_server
  session_loop
fi
