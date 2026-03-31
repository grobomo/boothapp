#!/usr/bin/env bash
# ============================================================================
# BoothApp -- Start All Services
# Idempotent -- kills existing instances before restarting.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export AWS_PROFILE="${AWS_PROFILE:-hackathon}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export BOOTH_S3_BUCKET="${BOOTH_S3_BUCKET:-boothapp-sessions-752266476357}"

LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
stop_existing() {
  local name="$1"
  local pidfile="$LOG_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local old_pid
    old_pid="$(cat "$pidfile")"
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "  Stopping existing $name (pid $old_pid)..."
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pidfile"
  fi
}

start_bg() {
  local name="$1"
  local cmd="$2"
  local workdir="${3:-$PROJECT_ROOT}"
  local logfile="$LOG_DIR/$name.log"
  local pidfile="$LOG_DIR/$name.pid"

  stop_existing "$name"

  echo "  Starting $name..."
  (cd "$workdir" && nohup bash -c "$cmd" >> "$logfile" 2>&1 & echo $! > "$pidfile")
  local pid
  pid="$(cat "$pidfile")"

  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "  [OK] $name running (pid $pid, log: logs/$name.log)"
  else
    echo "  [FAIL] $name exited immediately -- check logs/$name.log"
  fi
}

# ---------------------------------------------------------------------------
# Start services
# ---------------------------------------------------------------------------
echo ""
echo "== Starting BoothApp Services =="
echo ""
echo "  S3 bucket : $BOOTH_S3_BUCKET"
echo "  AWS profile: $AWS_PROFILE"
echo "  Region     : $AWS_REGION"
echo ""

# Watcher (analysis pipeline) -- only if watcher.js exists
WATCHER="$PROJECT_ROOT/analysis/watcher.js"
if [ -f "$WATCHER" ]; then
  start_bg "watcher" "node $WATCHER"
else
  echo "  [SKIP] Watcher not found at analysis/watcher.js"
fi

# Notification server -- only if a server entry point exists
NOTIFY_SERVER="$PROJECT_ROOT/infra/notifications/server.js"
if [ -f "$NOTIFY_SERVER" ]; then
  start_bg "notify-server" "node $NOTIFY_SERVER" "$PROJECT_ROOT/infra/notifications"
else
  echo "  [SKIP] Notification server not found at infra/notifications/server.js"
fi

# Presenter dev server -- serve static HTML if python3/npx available
PRESENTER_DIR="$PROJECT_ROOT/presenter"
if [ -d "$PRESENTER_DIR" ] && [ -f "$PRESENTER_DIR/demo.html" ]; then
  if command -v python3 &>/dev/null; then
    start_bg "presenter" "python3 -m http.server 8080" "$PRESENTER_DIR"
  elif command -v npx &>/dev/null; then
    start_bg "presenter" "npx -y serve -l 8080" "$PRESENTER_DIR"
  else
    echo "  [SKIP] No static server available for presenter (install python3 or npx)"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "== Running Services =="
echo ""
for pidfile in "$LOG_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  name="$(basename "$pidfile" .pid)"
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "  $name  pid=$pid  log=logs/$name.log"
  else
    echo "  $name  STOPPED (check logs/$name.log)"
  fi
done

echo ""
echo "Stop all: kill \$(cat logs/*.pid 2>/dev/null) 2>/dev/null"
echo ""
