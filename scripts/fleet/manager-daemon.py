#!/usr/bin/env python3
"""
CCC Fleet Manager Daemon

Hierarchical manager that coordinates up to 5 child nodes (workers or sub-managers).
Runs as an HTTP server on configurable port (default 8080).

Environment variables:
  ROLE            - "manager" (default)
  MANAGER_NAME    - Human-readable name (default: hostname)
  MANAGER_TIER    - t1/t2/t3 hierarchy level (default: t1)
  PARENT_URL      - URL of parent manager (optional, for escalation)
  MANAGER_PORT    - Port to listen on (default: 8080)
  SSH_KEY_DIR     - Directory containing SSH keys for worker dispatch (default: ~/.ssh)
  DRY_RUN         - "1" to simulate dispatch (no real SSH/HTTP), useful for testing
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timezone

MAX_CHILDREN = 5
HEARTBEAT_TIMEOUT = 60
DRAIN_INTERVAL = 5

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

lock = threading.Lock()

children = {}       # name -> {name, ip, port, role, status, last_heartbeat, current_task}
task_queue = []     # [{id, prompt, submitted_at, assigned_to, status}]
completed_tasks = []  # last 50 completed

task_counter = 0


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def next_task_id():
    global task_counter
    task_counter += 1
    return f"task-{task_counter:04d}"


# ---------------------------------------------------------------------------
# Child management
# ---------------------------------------------------------------------------

def find_idle_child():
    """Return the name of an idle child, preferring workers over managers."""
    idle = [(n, c) for n, c in children.items()
            if c["status"] == "idle" and c["healthy"]]
    if not idle:
        return None
    # prefer workers
    workers = [x for x in idle if x[1]["role"] == "worker"]
    if workers:
        return workers[0][0]
    return idle[0][0]


def dispatch_to_child(child_name, task):
    """Send task to child. For managers: HTTP forward. For workers: SSH docker exec."""
    child = children[child_name]
    child["status"] = "busy"
    child["current_task"] = task["id"]
    task["assigned_to"] = child_name
    task["status"] = "assigned"
    task["assigned_at"] = now_iso()

    if child["role"] == "manager":
        threading.Thread(target=_forward_to_manager, args=(child, task),
                         daemon=True).start()
    else:
        threading.Thread(target=_dispatch_to_worker, args=(child, task),
                         daemon=True).start()


def _forward_to_manager(child, task):
    """Forward task to a sub-manager via HTTP POST."""
    if os.environ.get("DRY_RUN") == "1":
        time.sleep(0.1)
        _complete_task(task["id"], child["name"], "[dry-run] forwarded to sub-manager")
        return

    url = f"http://{child['ip']}:{child.get('port', 8080)}/api/submit"
    payload = json.dumps({"prompt": task["prompt"], "parent_task_id": task["id"]}).encode()
    req = urllib.request.Request(url, data=payload,
                                headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as e:
        _handle_child_failure(child["name"], task, str(e))


def _dispatch_to_worker(child, task):
    """Dispatch task to a worker via SSH docker exec."""
    if os.environ.get("DRY_RUN") == "1":
        time.sleep(0.1)
        _complete_task(task["id"], child["name"], "[dry-run] worker executed task")
        return

    ssh_key_dir = os.environ.get("SSH_KEY_DIR", os.path.expanduser("~/.ssh"))
    key_path = os.path.join(ssh_key_dir, "id_rsa")
    ip = child["ip"]
    prompt = task["prompt"].replace("'", "'\\''")

    cmd = [
        "ssh", "-i", key_path,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        f"ubuntu@{ip}",
        f"docker exec claude-worker claude -p '{prompt}'"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0:
            _complete_task(task["id"], child["name"], result.stdout[:2000])
        else:
            _handle_child_failure(child["name"], task,
                                  f"exit {result.returncode}: {result.stderr[:500]}")
    except subprocess.TimeoutExpired:
        _handle_child_failure(child["name"], task, "SSH timeout after 300s")
    except Exception as e:
        _handle_child_failure(child["name"], task, str(e))


def _self_execute(task):
    """Leaf node: no children, execute task locally and report completion."""
    name = os.environ.get("MANAGER_NAME", socket.gethostname())
    time.sleep(0.05)  # simulate minimal work
    output = f"[leaf:{name}] executed: {task['prompt'][:100]}"
    parent_task_id = task.get("parent_task_id")
    with lock:
        task["status"] = "completed"
        task["completed_at"] = now_iso()
        task["output"] = output
        task["assigned_to"] = f"self:{name}"
        completed_tasks.append(task)
        if len(completed_tasks) > 50:
            completed_tasks.pop(0)

    # Escalate to parent
    parent_url = os.environ.get("PARENT_URL")
    if parent_url and parent_task_id:
        threading.Thread(target=_escalate_complete,
                         args=(parent_url, parent_task_id, output),
                         daemon=True).start()


def _complete_task(task_id, child_name, output=""):
    """Mark task complete, free the child, and escalate to parent if needed."""
    parent_task_id = None
    with lock:
        for t in task_queue:
            if t["id"] == task_id:
                t["status"] = "completed"
                t["completed_at"] = now_iso()
                t["output"] = output
                parent_task_id = t.get("parent_task_id")
                completed_tasks.append(t)
                if len(completed_tasks) > 50:
                    completed_tasks.pop(0)
                break
        if child_name in children:
            children[child_name]["status"] = "idle"
            children[child_name]["current_task"] = None

    # Escalate completion to parent manager
    parent_url = os.environ.get("PARENT_URL")
    if parent_url and parent_task_id:
        threading.Thread(target=_escalate_complete,
                         args=(parent_url, parent_task_id, output),
                         daemon=True).start()


def _escalate_complete(parent_url, parent_task_id, output):
    """Notify parent manager that a task completed."""
    try:
        payload = json.dumps({
            "task_id": parent_task_id,
            "child_name": os.environ.get("MANAGER_NAME", socket.gethostname()),
            "output": output,
        }).encode()
        req = urllib.request.Request(
            f"{parent_url}/api/task-complete",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def _handle_child_failure(child_name, task, error):
    """Mark child unhealthy, reassign task to a sibling."""
    with lock:
        if child_name in children:
            children[child_name]["status"] = "idle"
            children[child_name]["healthy"] = False
            children[child_name]["current_task"] = None

        task["status"] = "queued"
        task["assigned_to"] = None
        task["error"] = error

        # try reassigning to a sibling
        sibling = find_idle_child()
        if sibling:
            dispatch_to_child(sibling, task)


def _create_github_issue(title, body):
    """Create a GitHub issue for a blocker."""
    try:
        result = subprocess.run(
            ["gh", "issue", "create", "--title", title, "--body", body],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Background threads
# ---------------------------------------------------------------------------

def drain_loop():
    """Every DRAIN_INTERVAL seconds, assign queued tasks to idle children."""
    while True:
        time.sleep(DRAIN_INTERVAL)
        with lock:
            queued = [t for t in task_queue if t["status"] == "queued"]
            for task in queued:
                idle = find_idle_child()
                if idle:
                    dispatch_to_child(idle, task)
                else:
                    break


def heartbeat_monitor():
    """Mark children unhealthy if no heartbeat for HEARTBEAT_TIMEOUT seconds."""
    while True:
        time.sleep(10)
        now = time.time()
        with lock:
            for child in children.values():
                elapsed = now - child["last_heartbeat"]
                if elapsed > HEARTBEAT_TIMEOUT:
                    if child["healthy"]:
                        child["healthy"] = False
                        # if child had a task, requeue it
                        if child["current_task"]:
                            for t in task_queue:
                                if t["id"] == child["current_task"]:
                                    t["status"] = "queued"
                                    t["assigned_to"] = None
                                    break
                            child["current_task"] = None
                            child["status"] = "idle"


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class ManagerHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # quieter logging
        sys.stderr.write(f"[{now_iso()}] {fmt % args}\n")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _respond(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # --- routes ---

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

    def _handle_health(self):
        with lock:
            idle = sum(1 for c in children.values() if c["status"] == "idle" and c["healthy"])
            busy = sum(1 for c in children.values() if c["status"] == "busy")
            unhealthy = sum(1 for c in children.values() if not c["healthy"])
            queued = sum(1 for t in task_queue if t["status"] == "queued")

        self._respond(200, {
            "status": "ok",
            "name": os.environ.get("MANAGER_NAME", socket.gethostname()),
            "role": os.environ.get("ROLE", "manager"),
            "tier": os.environ.get("MANAGER_TIER", "t1"),
            "children_count": len(children),
            "idle": idle,
            "busy": busy,
            "unhealthy": unhealthy,
            "queued_tasks": queued,
            "uptime_seconds": int(time.time() - start_time),
        })

    def _handle_status(self):
        with lock:
            child_list = []
            for c in children.values():
                child_list.append({
                    "name": c["name"],
                    "ip": c["ip"],
                    "role": c["role"],
                    "status": c["status"],
                    "healthy": c["healthy"],
                    "current_task": c["current_task"],
                })
            recent = list(completed_tasks[-10:])
            queued = [t for t in task_queue if t["status"] in ("queued", "assigned")]

        self._respond(200, {
            "manager": os.environ.get("MANAGER_NAME", socket.gethostname()),
            "tier": os.environ.get("MANAGER_TIER", "t1"),
            "children": child_list,
            "queued_tasks": queued,
            "recent_completed": recent,
        })

    def _handle_children(self):
        with lock:
            child_list = []
            for c in children.values():
                child_list.append({
                    "name": c["name"],
                    "ip": c["ip"],
                    "port": c.get("port", 8080),
                    "role": c["role"],
                    "status": c["status"],
                    "healthy": c["healthy"],
                    "current_task": c["current_task"],
                })
        self._respond(200, {"children": child_list})

    def _handle_register(self):
        data = self._read_body()
        name = data.get("name")
        ip = data.get("ip")
        role = data.get("role", "worker")

        if not name or not ip:
            self._respond(400, {"error": "name and ip are required"})
            return

        if role not in ("worker", "manager"):
            self._respond(400, {"error": "role must be 'worker' or 'manager'"})
            return

        with lock:
            if name not in children and len(children) >= MAX_CHILDREN:
                self._respond(409, {"error": f"max {MAX_CHILDREN} children reached"})
                return

            children[name] = {
                "name": name,
                "ip": ip,
                "port": data.get("port", 8080),
                "role": role,
                "status": "idle",
                "healthy": True,
                "last_heartbeat": time.time(),
                "current_task": None,
            }

        self._respond(200, {"registered": name, "role": role})

    def _handle_submit(self):
        data = self._read_body()
        prompt = data.get("prompt")
        if not prompt:
            self._respond(400, {"error": "prompt is required"})
            return

        with lock:
            task = {
                "id": next_task_id(),
                "prompt": prompt,
                "parent_task_id": data.get("parent_task_id"),
                "submitted_at": now_iso(),
                "status": "queued",
                "assigned_to": None,
                "assigned_at": None,
                "completed_at": None,
                "output": None,
                "error": None,
            }
            task_queue.append(task)

            idle = find_idle_child()
            if idle:
                dispatch_to_child(idle, task)
            elif not children:
                # Leaf node: no children registered, self-execute
                task["status"] = "self-executing"
                threading.Thread(target=_self_execute, args=(task,),
                                 daemon=True).start()

        self._respond(202, {"task_id": task["id"], "status": task["status"],
                            "assigned_to": task["assigned_to"]})

    def _handle_task_complete(self):
        data = self._read_body()
        task_id = data.get("task_id")
        child_name = data.get("child_name")
        output = data.get("output", "")

        if not task_id or not child_name:
            self._respond(400, {"error": "task_id and child_name are required"})
            return

        _complete_task(task_id, child_name, output)
        # Note: _complete_task handles parent escalation automatically

        self._respond(200, {"status": "completed", "task_id": task_id})

    def _handle_blocker(self):
        data = self._read_body()
        task_id = data.get("task_id")
        child_name = data.get("child_name")
        description = data.get("description", "No description")

        if not task_id or not child_name:
            self._respond(400, {"error": "task_id and child_name are required"})
            return

        # mark task as blocked
        with lock:
            for t in task_queue:
                if t["id"] == task_id:
                    t["status"] = "blocked"
                    t["error"] = description
                    break
            if child_name in children:
                children[child_name]["status"] = "idle"
                children[child_name]["current_task"] = None

        # create github issue
        manager_name = os.environ.get("MANAGER_NAME", socket.gethostname())
        title = f"[{manager_name}] Blocker: {task_id}"
        body = (
            f"**Task:** {task_id}\n"
            f"**Reported by:** {child_name}\n"
            f"**Manager:** {manager_name} (tier {os.environ.get('MANAGER_TIER', 't1')})\n\n"
            f"**Description:**\n{description}"
        )
        issue_url = _create_github_issue(title, body)

        # escalate to parent
        parent_url = os.environ.get("PARENT_URL")
        if parent_url:
            try:
                payload = json.dumps({
                    "task_id": task_id,
                    "child_name": manager_name,
                    "description": f"Escalated from {child_name}: {description}",
                }).encode()
                req = urllib.request.Request(
                    f"{parent_url}/api/blocker",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass

        self._respond(200, {
            "status": "blocked",
            "task_id": task_id,
            "issue_url": issue_url,
        })

    def _handle_heartbeat(self):
        data = self._read_body()
        name = data.get("name")
        if not name:
            self._respond(400, {"error": "name is required"})
            return
        with lock:
            if name in children:
                children[name]["last_heartbeat"] = time.time()
                children[name]["healthy"] = True
                self._respond(200, {"status": "ok"})
            else:
                self._respond(404, {"error": "child not registered"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

start_time = time.time()


def main():
    port = int(os.environ.get("MANAGER_PORT", 8080))
    name = os.environ.get("MANAGER_NAME", socket.gethostname())
    tier = os.environ.get("MANAGER_TIER", "t1")
    role = os.environ.get("ROLE", "manager")

    print(f"[fleet-manager] {name} (tier={tier}, role={role}) starting on :{port}")

    # start background threads
    threading.Thread(target=drain_loop, daemon=True).start()
    threading.Thread(target=heartbeat_monitor, daemon=True).start()

    server = HTTPServer(("0.0.0.0", port), ManagerHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n[fleet-manager] {name} shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
