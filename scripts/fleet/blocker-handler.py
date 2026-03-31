#!/usr/bin/env python3
"""blocker-handler.py -- Manager-side blocker receiver and auto-resolver.

Runs an HTTP server that:
  1. Receives blocker reports from workers via POST /api/blocker
  2. Logs them to blockers/ directory
  3. Attempts auto-resolution (retry with different approach, reassign)
  4. Escalates unresolved blockers to parent manager
"""

import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
PORT = int(os.environ.get("BLOCKER_HANDLER_PORT", "5000"))
BLOCKERS_DIR = Path(os.environ.get("BLOCKERS_DIR", "blockers"))
PARENT_MANAGER_URL = os.environ.get("PARENT_MANAGER_URL", "")
MAX_AUTO_RETRIES = int(os.environ.get("MAX_AUTO_RETRIES", "2"))
LOG_FILE = os.environ.get("BLOCKER_LOG_FILE", "blockers/handler.log")
WORKER_POOL = os.environ.get("FLEET_WORKER_POOL", "").split(",")  # comma-separated worker IDs

logging.basicConfig(
    level=logging.INFO,
    format="[blocker-handler %(asctime)s] %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stderr),
    ],
)
log = logging.getLogger("blocker-handler")


# ---------------------------------------------------------------------------
# Blocker storage
# ---------------------------------------------------------------------------
def save_blocker(blocker: dict) -> Path:
    """Save blocker document to disk."""
    BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)
    task_id = blocker.get("task_id", "unknown")
    path = BLOCKERS_DIR / f"{task_id}.json"
    with open(path, "w") as f:
        json.dump(blocker, f, indent=2)
    return path


def load_blocker(task_id: str) -> dict | None:
    """Load a blocker by task ID."""
    path = BLOCKERS_DIR / f"{task_id}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def append_log(entry: dict):
    """Append structured log entry to handler log."""
    BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Auto-resolution strategies
# ---------------------------------------------------------------------------
def try_retry_different_approach(blocker: dict) -> bool:
    """Strategy 1: Suggest retry with a modified approach.

    Returns True if resolution was successful.
    In a real fleet, this would send a message back to the worker
    with a modified prompt/config. Here we mark it as 'retry-suggested'.
    """
    attempts = blocker.get("attempted_fixes", [])
    if len(attempts) >= MAX_AUTO_RETRIES:
        log.info("Task %s: max retries (%d) exhausted", blocker["task_id"], MAX_AUTO_RETRIES)
        return False

    log.info("Task %s: suggesting retry with different approach (attempt %d/%d)",
             blocker["task_id"], len(attempts) + 1, MAX_AUTO_RETRIES)

    blocker.setdefault("auto_resolution_attempts", []).append({
        "strategy": "retry_different_approach",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "suggestion": "Retry task with simplified constraints",
    })
    blocker["status"] = "retry-suggested"
    save_blocker(blocker)
    return True


def try_reassign(blocker: dict) -> bool:
    """Strategy 2: Reassign to a different worker.

    Returns True if a different worker is available.
    """
    current_worker = blocker.get("worker_id", "")
    available = [w for w in WORKER_POOL if w and w != current_worker]

    if not available:
        log.info("Task %s: no other workers available for reassignment", blocker["task_id"])
        return False

    new_worker = available[0]
    log.info("Task %s: reassigning from %s to %s",
             blocker["task_id"], current_worker, new_worker)

    blocker.setdefault("auto_resolution_attempts", []).append({
        "strategy": "reassign",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "from_worker": current_worker,
        "to_worker": new_worker,
    })
    blocker["status"] = "reassigned"
    blocker["assigned_to"] = new_worker
    save_blocker(blocker)
    return True


def escalate_to_parent(blocker: dict) -> bool:
    """Escalate unresolved blocker to parent manager."""
    if not PARENT_MANAGER_URL:
        log.warning("Task %s: no PARENT_MANAGER_URL set -- cannot escalate", blocker["task_id"])
        blocker["status"] = "escalation-failed"
        blocker["escalation_error"] = "No parent manager configured"
        save_blocker(blocker)
        return False

    log.info("Task %s: escalating to parent manager %s", blocker["task_id"], PARENT_MANAGER_URL)

    blocker["status"] = "escalated"
    blocker["escalated_at"] = datetime.now(timezone.utc).isoformat()
    save_blocker(blocker)

    try:
        import urllib.request
        payload = json.dumps(blocker).encode()
        req = urllib.request.Request(
            f"{PARENT_MANAGER_URL}/api/blocker",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status in (200, 201, 202):
                log.info("Task %s: escalation accepted (HTTP %d)", blocker["task_id"], resp.status)
                return True
            else:
                log.warning("Task %s: escalation returned HTTP %d", blocker["task_id"], resp.status)
                return False
    except Exception as e:
        log.error("Task %s: escalation failed: %s", blocker["task_id"], e)
        blocker["escalation_error"] = str(e)
        save_blocker(blocker)
        return False


def resolve_blocker(blocker: dict) -> dict:
    """Run auto-resolution pipeline on a blocker.

    Tries strategies in order:
      1. Retry with different approach
      2. Reassign to another worker
      3. Escalate to parent manager
    """
    log.info("Attempting auto-resolution for task %s (severity=%s)",
             blocker["task_id"], blocker.get("severity", "unknown"))

    append_log({
        "event": "blocker_received",
        "task_id": blocker["task_id"],
        "worker_id": blocker.get("worker_id"),
        "severity": blocker.get("severity"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    # Strategy 1: retry
    if try_retry_different_approach(blocker):
        append_log({"event": "auto_resolved", "strategy": "retry",
                     "task_id": blocker["task_id"],
                     "timestamp": datetime.now(timezone.utc).isoformat()})
        return blocker

    # Strategy 2: reassign
    if try_reassign(blocker):
        append_log({"event": "auto_resolved", "strategy": "reassign",
                     "task_id": blocker["task_id"],
                     "timestamp": datetime.now(timezone.utc).isoformat()})
        return blocker

    # Strategy 3: escalate
    escalated = escalate_to_parent(blocker)
    append_log({
        "event": "escalated" if escalated else "escalation_failed",
        "task_id": blocker["task_id"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return blocker


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------
class BlockerHTTPHandler(BaseHTTPRequestHandler):
    """Simple HTTP handler for blocker API."""

    def log_message(self, format, *args):
        log.info(format, *args)

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/health":
            self._send_json(200, {"status": "ok", "service": "blocker-handler"})
        elif self.path == "/api/blockers":
            # List all blockers
            BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)
            blockers = []
            for f in sorted(BLOCKERS_DIR.glob("*.json")):
                if f.name == "handler.log":
                    continue
                try:
                    with open(f) as fh:
                        blockers.append(json.load(fh))
                except json.JSONDecodeError:
                    pass
            self._send_json(200, {"blockers": blockers, "count": len(blockers)})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/blocker":
            self._send_json(404, {"error": "not found"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._send_json(400, {"error": "empty body"})
            return

        try:
            body = self.rfile.read(content_length)
            blocker = json.loads(body)
        except (json.JSONDecodeError, ValueError) as e:
            self._send_json(400, {"error": f"invalid JSON: {e}"})
            return

        required = ["task_id", "description"]
        missing = [k for k in required if k not in blocker]
        if missing:
            self._send_json(400, {"error": f"missing fields: {missing}"})
            return

        # Save and process
        save_blocker(blocker)
        resolved = resolve_blocker(blocker)

        self._send_json(202, {
            "accepted": True,
            "task_id": resolved["task_id"],
            "status": resolved.get("status", "open"),
        })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    BLOCKERS_DIR.mkdir(parents=True, exist_ok=True)

    if "--resolve" in sys.argv:
        # CLI mode: resolve a specific blocker
        idx = sys.argv.index("--resolve") + 1
        if idx >= len(sys.argv):
            print("Usage: blocker-handler.py --resolve <task-id>", file=sys.stderr)
            sys.exit(1)
        task_id = sys.argv[idx]
        blocker = load_blocker(task_id)
        if not blocker:
            print(f"Blocker not found: {task_id}", file=sys.stderr)
            sys.exit(1)
        result = resolve_blocker(blocker)
        print(json.dumps(result, indent=2))
        return

    server = HTTPServer(("0.0.0.0", PORT), BlockerHTTPHandler)
    log.info("Blocker handler listening on port %d", PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
