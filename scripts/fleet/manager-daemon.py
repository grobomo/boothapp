#!/usr/bin/env python3
"""
manager-daemon.py -- Hierarchical fleet manager for CCC (Cloud Claude Code).

Manages up to 5 child nodes (workers or sub-managers). Dispatches tasks via
HTTP POST (sub-managers) or SSH docker exec (workers). Monitors heartbeats,
reassigns on failure, escalates blockers via GitHub issues.

Env vars:
  ROLE          -- "manager" or "root-manager"
  MANAGER_NAME  -- human-readable name for this node
  MANAGER_TIER  -- integer tier level (0=root, 1=mid, 2=leaf)
  PARENT_URL    -- URL of parent manager (empty for root)
  MANAGER_PORT  -- listen port (default 8080)
  SSH_KEY_DIR   -- directory containing SSH keys for worker dispatch
"""

import json
import logging
import os
import subprocess
import threading
import time
import uuid
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import Request, urlopen
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROLE = os.getenv("ROLE", "manager")
MANAGER_NAME = os.getenv("MANAGER_NAME", "manager-0")
MANAGER_TIER = int(os.getenv("MANAGER_TIER", "0"))
PARENT_URL = os.getenv("PARENT_URL", "")
MANAGER_PORT = int(os.getenv("MANAGER_PORT", "8080"))
SSH_KEY_DIR = os.getenv("SSH_KEY_DIR", os.path.expanduser("~/.ssh"))

MAX_CHILDREN = 5
HEARTBEAT_TIMEOUT = 60  # seconds
DRAIN_INTERVAL = 5      # seconds

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("manager-daemon")

# ---------------------------------------------------------------------------
# State (protected by lock)
# ---------------------------------------------------------------------------

lock = threading.Lock()

children = {}       # name -> {name, ip, role, healthy, last_heartbeat, tasks_running, tasks_done}
task_queue = []     # [{id, spec, status, assigned_to, created, ...}]
task_archive = []   # completed / failed tasks

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def now():
    return time.time()


def post_json(url, payload, timeout=10):
    """Fire-and-forget JSON POST. Returns response body or None."""
    data = json.dumps(payload).encode()
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except (URLError, OSError, ValueError) as exc:
        log.warning("POST %s failed: %s", url, exc)
        return None


def create_github_issue(title, body):
    """Create a GitHub issue via gh CLI. Returns issue URL or None."""
    try:
        result = subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            log.info("Created GitHub issue: %s", url)
            return url
        log.warning("gh issue create failed: %s", result.stderr.strip())
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        log.warning("gh issue create error: %s", exc)
    return None


def least_busy_child():
    """Return the name of the healthy child with fewest running tasks, or None."""
    best, best_load = None, float("inf")
    for name, c in children.items():
        if c["healthy"] and c["tasks_running"] < best_load:
            best, best_load = name, c["tasks_running"]
    return best


def dispatch_to_child(child_name, task):
    """Dispatch a task to a child. Returns True on success."""
    child = children.get(child_name)
    if not child:
        return False

    if child["role"] == "manager":
        # Forward via HTTP POST to sub-manager
        url = f"http://{child['ip']}/api/submit"
        resp = post_json(url, {"spec": task["spec"], "parent_task_id": task["id"]})
        return resp is not None

    # role == "worker": dispatch via SSH docker exec
    ip = child["ip"].split(":")[0]  # strip port if present
    key_path = os.path.join(SSH_KEY_DIR, "id_rsa")
    spec_json = json.dumps(task["spec"])
    cmd = [
        "ssh", "-i", key_path,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        f"root@{ip}",
        "docker", "exec", "claude-worker",
        "claude", "--task", spec_json,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0:
            return True
        log.warning("SSH dispatch to %s failed: %s", child_name, result.stderr.strip())
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        log.warning("SSH dispatch to %s error: %s", child_name, exc)
    return False


# ---------------------------------------------------------------------------
# Background threads
# ---------------------------------------------------------------------------

def drain_loop():
    """Every DRAIN_INTERVAL seconds, try to assign queued tasks."""
    while True:
        time.sleep(DRAIN_INTERVAL)
        with lock:
            pending = [t for t in task_queue if t["status"] == "queued"]
            for task in pending:
                target = least_busy_child()
                if target is None:
                    break  # no healthy children
                task["status"] = "dispatching"
                task["assigned_to"] = target
                children[target]["tasks_running"] += 1

        # Dispatch outside the lock to avoid blocking
        with lock:
            dispatching = [t for t in task_queue if t["status"] == "dispatching"]

        for task in dispatching:
            ok = dispatch_to_child(task["assigned_to"], task)
            with lock:
                if ok:
                    task["status"] = "running"
                    log.info("Task %s dispatched to %s", task["id"], task["assigned_to"])
                else:
                    # Dispatch failed -- requeue
                    children[task["assigned_to"]]["tasks_running"] = max(
                        0, children[task["assigned_to"]]["tasks_running"] - 1
                    )
                    task["status"] = "queued"
                    task["assigned_to"] = None
                    log.warning("Task %s dispatch failed, requeued", task["id"])


def heartbeat_monitor():
    """Check children heartbeats, mark unhealthy, reassign tasks."""
    while True:
        time.sleep(DRAIN_INTERVAL)
        with lock:
            cutoff = now() - HEARTBEAT_TIMEOUT
            for name, c in children.items():
                was_healthy = c["healthy"]
                c["healthy"] = c["last_heartbeat"] >= cutoff
                if was_healthy and not c["healthy"]:
                    log.warning("Child %s marked unhealthy (no heartbeat)", name)
                    # Reassign its running tasks
                    for task in task_queue:
                        if task["assigned_to"] == name and task["status"] == "running":
                            task["status"] = "queued"
                            task["assigned_to"] = None
                            c["tasks_running"] = max(0, c["tasks_running"] - 1)
                            log.info("Task %s reassigned (child %s unhealthy)", task["id"], name)


# ---------------------------------------------------------------------------
# HTTP Handler
# ---------------------------------------------------------------------------

class ManagerHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        log.info(fmt, *args)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _respond(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- routing --

    def do_GET(self):
        if self.path == "/health":
            self._handle_health()
        elif self.path == "/api/status":
            self._handle_status()
        elif self.path == "/api/children":
            self._handle_children()
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/api/submit":
            self._handle_submit()
        elif self.path == "/api/register":
            self._handle_register()
        elif self.path == "/api/task-complete":
            self._handle_task_complete()
        elif self.path == "/api/blocker":
            self._handle_blocker()
        elif self.path == "/api/heartbeat":
            self._handle_heartbeat()
        else:
            self._respond(404, {"error": "not found"})

    # -- GET handlers --

    def _handle_health(self):
        with lock:
            healthy_count = sum(1 for c in children.values() if c["healthy"])
            total = len(children)
            pending = sum(1 for t in task_queue if t["status"] == "queued")
            running = sum(1 for t in task_queue if t["status"] == "running")
        self._respond(200, {
            "name": MANAGER_NAME,
            "role": ROLE,
            "tier": MANAGER_TIER,
            "healthy": True,
            "children_healthy": healthy_count,
            "children_total": total,
            "tasks_pending": pending,
            "tasks_running": running,
            "tasks_completed": len(task_archive),
        })

    def _handle_status(self):
        with lock:
            child_list = list(children.values())
            tasks = [
                {k: v for k, v in t.items()}
                for t in task_queue
            ]
            archived = list(task_archive[-50:])  # last 50
        self._respond(200, {
            "manager": MANAGER_NAME,
            "tier": MANAGER_TIER,
            "children": child_list,
            "active_tasks": tasks,
            "recent_completed": archived,
        })

    def _handle_children(self):
        with lock:
            child_list = [
                {
                    "name": c["name"],
                    "ip": c["ip"],
                    "role": c["role"],
                    "healthy": c["healthy"],
                    "tasks_running": c["tasks_running"],
                    "tasks_done": c["tasks_done"],
                }
                for c in children.values()
            ]
        self._respond(200, {"children": child_list})

    # -- POST handlers --

    def _handle_register(self):
        body = self._read_body()
        name = body.get("name", "").strip()
        ip = body.get("ip", "").strip()
        role = body.get("role", "worker").strip()

        if not name or not ip:
            self._respond(400, {"error": "name and ip required"})
            return

        with lock:
            if name not in children and len(children) >= MAX_CHILDREN:
                self._respond(409, {"error": f"max {MAX_CHILDREN} children reached"})
                return

            children[name] = {
                "name": name,
                "ip": ip,
                "role": role,
                "healthy": True,
                "last_heartbeat": now(),
                "tasks_running": 0,
                "tasks_done": 0,
            }

        log.info("Registered child: %s (%s) role=%s", name, ip, role)
        self._respond(200, {"registered": name})

    def _handle_submit(self):
        body = self._read_body()
        spec = body.get("spec")
        if not spec:
            self._respond(400, {"error": "spec required"})
            return

        task_id = str(uuid.uuid4())[:8]
        task = {
            "id": task_id,
            "spec": spec,
            "status": "queued",
            "assigned_to": None,
            "created": now(),
            "parent_task_id": body.get("parent_task_id"),
        }

        with lock:
            task_queue.append(task)

        log.info("Task %s queued", task_id)
        self._respond(202, {"task_id": task_id, "status": "queued"})

    def _handle_task_complete(self):
        body = self._read_body()
        task_id = body.get("task_id", "").strip()
        child_name = body.get("child_name", "").strip()

        with lock:
            task = next((t for t in task_queue if t["id"] == task_id), None)
            if not task:
                self._respond(404, {"error": "task not found"})
                return

            task["status"] = "completed"
            task["result"] = body.get("result")
            task_queue.remove(task)
            task_archive.append(task)

            if child_name in children:
                children[child_name]["tasks_running"] = max(
                    0, children[child_name]["tasks_running"] - 1
                )
                children[child_name]["tasks_done"] += 1

        log.info("Task %s completed by %s", task_id, child_name)

        # Notify parent if we have one
        if PARENT_URL:
            parent_task_id = task.get("parent_task_id")
            if parent_task_id:
                post_json(f"{PARENT_URL}/api/task-complete", {
                    "task_id": parent_task_id,
                    "child_name": MANAGER_NAME,
                    "result": body.get("result"),
                })

        self._respond(200, {"completed": task_id})

    def _handle_blocker(self):
        body = self._read_body()
        task_id = body.get("task_id", "")
        child_name = body.get("child_name", "")
        reason = body.get("reason", "Unknown blocker")

        # Create GitHub issue
        title = f"[Fleet Blocker] {child_name}: {reason[:80]}"
        issue_body = (
            f"**Manager:** {MANAGER_NAME} (tier {MANAGER_TIER})\n"
            f"**Child:** {child_name}\n"
            f"**Task:** {task_id}\n\n"
            f"## Blocker\n{reason}\n"
        )
        issue_url = create_github_issue(title, issue_body)

        # Escalate to parent
        if PARENT_URL:
            post_json(f"{PARENT_URL}/api/blocker", {
                "task_id": task_id,
                "child_name": f"{MANAGER_NAME}/{child_name}",
                "reason": reason,
                "issue_url": issue_url,
            })

        # Mark task as blocked, requeue for another child
        with lock:
            task = next((t for t in task_queue if t["id"] == task_id), None)
            if task and task["status"] == "running":
                old_child = task["assigned_to"]
                task["status"] = "queued"
                task["assigned_to"] = None
                if old_child in children:
                    children[old_child]["tasks_running"] = max(
                        0, children[old_child]["tasks_running"] - 1
                    )

        log.info("Blocker from %s on task %s: %s", child_name, task_id, reason)
        self._respond(200, {"blocker_logged": True, "issue_url": issue_url})

    def _handle_heartbeat(self):
        body = self._read_body()
        name = body.get("name", "").strip()
        with lock:
            if name in children:
                children[name]["last_heartbeat"] = now()
                children[name]["healthy"] = True
                self._respond(200, {"ack": True})
            else:
                self._respond(404, {"error": "unknown child"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log.info(
        "Starting %s (name=%s, tier=%d, port=%d, parent=%s)",
        ROLE, MANAGER_NAME, MANAGER_TIER, MANAGER_PORT, PARENT_URL or "(none)",
    )

    # Start background threads
    threading.Thread(target=drain_loop, daemon=True, name="drain").start()
    threading.Thread(target=heartbeat_monitor, daemon=True, name="heartbeat").start()

    server = HTTPServer(("0.0.0.0", MANAGER_PORT), ManagerHandler)
    log.info("Listening on 0.0.0.0:%d", MANAGER_PORT)

    # Register with parent if configured
    if PARENT_URL:
        resp = post_json(f"{PARENT_URL}/api/register", {
            "name": MANAGER_NAME,
            "ip": f"host.docker.internal:{MANAGER_PORT}",
            "role": "manager",
        })
        if resp:
            log.info("Registered with parent: %s", PARENT_URL)
        else:
            log.warning("Failed to register with parent (will retry on next heartbeat)")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
