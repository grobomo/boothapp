#!/usr/bin/env bash
# fleet-tune.sh -- Read dispatcher health, calculate optimal node counts,
#                  and output scaling recommendations.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/tune-config.json"

# ---------- helpers ----------
die()  { echo "ERROR: $*" >&2; exit 1; }
json() { node -e "console.log(JSON.parse(require('fs').readFileSync('$1','utf8'))$2)"; }

# ---------- load config ----------
[ -f "$CONFIG_FILE" ] || die "Config not found: $CONFIG_FILE"

DISPATCHER_URL=$(json "$CONFIG_FILE" ".dispatcher_url")
WORKERS_PER_TASK=$(json "$CONFIG_FILE" ".ratios.workers_per_pending_task")
MIN_WORKERS=$(json "$CONFIG_FILE" ".ratios.min_workers")
WORKERS_PER_MON=$(json "$CONFIG_FILE" ".ratios.workers_per_monitor")
MIN_MONITORS=$(json "$CONFIG_FILE" ".ratios.min_monitors")
DESIRED_DISPATCHERS=$(json "$CONFIG_FILE" ".ratios.dispatchers")
DRIFT_PCT=$(json "$CONFIG_FILE" ".thresholds.drift_percent")
CRITICAL_PCT=$(json "$CONFIG_FILE" ".thresholds.critical_percent")

# ---------- fetch dispatcher health ----------
HEALTH_URL="${DISPATCHER_URL}/health"
echo "Fetching fleet state from ${HEALTH_URL} ..."

HEALTH=$(curl -sf --max-time 5 "$HEALTH_URL" 2>/dev/null) \
  || die "Cannot reach dispatcher at ${HEALTH_URL}"

# Parse actual counts from health response
ACTUAL_WORKERS=$(echo "$HEALTH" | node -e "
  var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.nodes && d.nodes.workers || d.workers || 0);
")
ACTUAL_MONITORS=$(echo "$HEALTH" | node -e "
  var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.nodes && d.nodes.monitors || d.monitors || 0);
")
ACTUAL_DISPATCHERS=$(echo "$HEALTH" | node -e "
  var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.nodes && d.nodes.dispatchers || d.dispatchers || 1);
")
PENDING_TASKS=$(echo "$HEALTH" | node -e "
  var d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.pending_tasks || d.queue && d.queue.pending || 0);
")

# ---------- calculate desired counts ----------
DESIRED_WORKERS=$(node -e "console.log(Math.max(${PENDING_TASKS} * ${WORKERS_PER_TASK}, ${MIN_WORKERS}))")
DESIRED_MONITORS=$(node -e "console.log(Math.max(Math.ceil(${DESIRED_WORKERS} / ${WORKERS_PER_MON}), ${MIN_MONITORS}))")

# ---------- compare and recommend ----------
recommend() {
  local role="$1" actual="$2" desired="$3"
  local diff=$((desired - actual))
  local abs_diff=${diff#-}

  if [ "$actual" -eq 0 ]; then
    local pct=100
  else
    pct=$(node -e "console.log(Math.round(Math.abs(${diff}) / ${actual} * 100))")
  fi

  local color="green"
  local status="MATCHED"
  if [ "$abs_diff" -gt 0 ]; then
    if [ "$pct" -ge "$CRITICAL_PCT" ]; then
      color="red"
      status="CRITICAL"
    elif [ "$pct" -ge "$DRIFT_PCT" ]; then
      color="yellow"
      status="DRIFT"
    else
      color="green"
      status="MINOR"
    fi
  fi

  local action="none"
  if [ "$diff" -gt 0 ]; then
    action="add ${diff} ${role}(s)"
  elif [ "$diff" -lt 0 ]; then
    action="remove ${abs_diff} ${role}(s)"
  fi

  printf "  %-14s actual=%-4s desired=%-4s drift=%-4s status=%-10s action=%s\n" \
    "$role" "$actual" "$desired" "${diff}" "[${status}]" "$action"
}

echo ""
echo "=== Fleet Tuning Report ==="
echo "  pending_tasks: ${PENDING_TASKS}"
echo ""
recommend "workers"     "$ACTUAL_WORKERS"     "$DESIRED_WORKERS"
recommend "monitors"    "$ACTUAL_MONITORS"     "$DESIRED_MONITORS"
recommend "dispatchers" "$ACTUAL_DISPATCHERS"  "$DESIRED_DISPATCHERS"
echo ""

# ---------- JSON output for programmatic use ----------
if [ "${1:-}" = "--json" ]; then
  node -e "
    console.log(JSON.stringify({
      pending_tasks: ${PENDING_TASKS},
      actual:  { workers: ${ACTUAL_WORKERS}, monitors: ${ACTUAL_MONITORS}, dispatchers: ${ACTUAL_DISPATCHERS} },
      desired: { workers: ${DESIRED_WORKERS}, monitors: ${DESIRED_MONITORS}, dispatchers: ${DESIRED_DISPATCHERS} },
      delta:   { workers: ${DESIRED_WORKERS}-${ACTUAL_WORKERS}, monitors: ${DESIRED_MONITORS}-${ACTUAL_MONITORS}, dispatchers: ${DESIRED_DISPATCHERS}-${ACTUAL_DISPATCHERS} }
    }, null, 2));
  "
fi
