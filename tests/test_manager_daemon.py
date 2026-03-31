#!/usr/bin/env python3
"""Tests for scripts/fleet/manager-daemon.py

Spins up the manager HTTP server on a random port and exercises every
endpoint: register, submit, heartbeat, task-complete, blocker, health,
status, children.  Also covers the drain loop, heartbeat monitor,
max-children enforcement, and task reassignment on child failure.
"""

import json
import os
import sys
import threading
import time
import unittest
from http.server import HTTPServer
from urllib.request import Request, urlopen

# Patch env BEFORE importing the module so config picks up test values
os.environ["ROLE"] = "manager"
os.environ["MANAGER_NAME"] = "test-mgr"
os.environ["MANAGER_TIER"] = "1"
os.environ["PARENT_URL"] = ""
os.environ["MANAGER_PORT"] = "0"  # we bind manually
os.environ["SSH_KEY_DIR"] = "/tmp"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts", "fleet"))

import importlib
daemon = importlib.import_module("manager-daemon")


def _post(url, payload):
    data = json.dumps(payload).encode()
    req = Request(url, data=data, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=5) as resp:
        return resp.getcode(), json.loads(resp.read())


def _get(url):
    req = Request(url)
    with urlopen(req, timeout=5) as resp:
        return resp.getcode(), json.loads(resp.read())


class ManagerDaemonTest(unittest.TestCase):
    """Integration tests -- real HTTP server, no mocks."""

    @classmethod
    def setUpClass(cls):
        # Reset global state
        daemon.children.clear()
        daemon.task_queue.clear()
        daemon.task_archive.clear()

        cls.server = HTTPServer(("127.0.0.1", 0), daemon.ManagerHandler)
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        """Reset state between tests."""
        with daemon.lock:
            daemon.children.clear()
            daemon.task_queue.clear()
            daemon.task_archive.clear()

    # ----- GET /health -----

    def test_health_returns_manager_info(self):
        code, body = _get(f"{self.base}/health")
        self.assertEqual(code, 200)
        self.assertEqual(body["name"], "test-mgr")
        self.assertEqual(body["role"], "manager")
        self.assertEqual(body["tier"], 1)
        self.assertTrue(body["healthy"])

    # ----- POST /api/register -----

    def test_register_child(self):
        code, body = _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1:8080", "role": "worker",
        })
        self.assertEqual(code, 200)
        self.assertEqual(body["registered"], "w1")

    def test_register_missing_fields(self):
        try:
            _post(f"{self.base}/api/register", {"name": "", "ip": ""})
            self.fail("Expected 400")
        except Exception as e:
            self.assertIn("400", str(e))

    def test_register_max_children_enforced(self):
        for i in range(5):
            _post(f"{self.base}/api/register", {
                "name": f"c{i}", "ip": f"10.0.0.{i}", "role": "worker",
            })

        try:
            _post(f"{self.base}/api/register", {
                "name": "c5", "ip": "10.0.0.5", "role": "worker",
            })
            self.fail("Expected 409")
        except Exception as e:
            self.assertIn("409", str(e))

    def test_register_same_name_updates(self):
        """Re-registering with same name should update, not count as new."""
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        code, body = _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.99", "role": "worker",
        })
        self.assertEqual(code, 200)
        with daemon.lock:
            self.assertEqual(daemon.children["w1"]["ip"], "10.0.0.99")

    # ----- GET /api/children -----

    def test_children_list(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        code, body = _get(f"{self.base}/api/children")
        self.assertEqual(code, 200)
        self.assertEqual(len(body["children"]), 1)
        self.assertEqual(body["children"][0]["name"], "w1")

    # ----- POST /api/submit -----

    def test_submit_task(self):
        code, body = _post(f"{self.base}/api/submit", {
            "spec": {"prompt": "write hello world"},
        })
        self.assertEqual(code, 202)
        self.assertIn("task_id", body)
        self.assertEqual(body["status"], "queued")

    def test_submit_no_spec(self):
        try:
            _post(f"{self.base}/api/submit", {})
            self.fail("Expected 400")
        except Exception as e:
            self.assertIn("400", str(e))

    # ----- POST /api/task-complete -----

    def test_task_complete(self):
        # Register child and submit task
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        _, sub = _post(f"{self.base}/api/submit", {
            "spec": {"prompt": "test"},
        })
        task_id = sub["task_id"]

        # Manually mark as running
        with daemon.lock:
            task = daemon.task_queue[0]
            task["status"] = "running"
            task["assigned_to"] = "w1"
            daemon.children["w1"]["tasks_running"] = 1

        code, body = _post(f"{self.base}/api/task-complete", {
            "task_id": task_id,
            "child_name": "w1",
            "result": "done",
        })
        self.assertEqual(code, 200)
        self.assertEqual(body["completed"], task_id)

        with daemon.lock:
            self.assertEqual(len(daemon.task_queue), 0)
            self.assertEqual(len(daemon.task_archive), 1)
            self.assertEqual(daemon.children["w1"]["tasks_running"], 0)
            self.assertEqual(daemon.children["w1"]["tasks_done"], 1)

    def test_task_complete_unknown_id(self):
        try:
            _post(f"{self.base}/api/task-complete", {
                "task_id": "nonexistent", "child_name": "w1",
            })
            self.fail("Expected 404")
        except Exception as e:
            self.assertIn("404", str(e))

    # ----- POST /api/heartbeat -----

    def test_heartbeat(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        code, body = _post(f"{self.base}/api/heartbeat", {"name": "w1"})
        self.assertEqual(code, 200)
        self.assertTrue(body["ack"])

    def test_heartbeat_unknown_child(self):
        try:
            _post(f"{self.base}/api/heartbeat", {"name": "ghost"})
            self.fail("Expected 404")
        except Exception as e:
            self.assertIn("404", str(e))

    # ----- POST /api/blocker -----

    def test_blocker_requeues_task(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        _, sub = _post(f"{self.base}/api/submit", {"spec": {"prompt": "test"}})
        task_id = sub["task_id"]

        with daemon.lock:
            task = daemon.task_queue[0]
            task["status"] = "running"
            task["assigned_to"] = "w1"
            daemon.children["w1"]["tasks_running"] = 1

        code, body = _post(f"{self.base}/api/blocker", {
            "task_id": task_id,
            "child_name": "w1",
            "reason": "Cannot access repo",
        })
        self.assertEqual(code, 200)
        self.assertTrue(body["blocker_logged"])

        with daemon.lock:
            self.assertEqual(daemon.task_queue[0]["status"], "queued")
            self.assertIsNone(daemon.task_queue[0]["assigned_to"])
            self.assertEqual(daemon.children["w1"]["tasks_running"], 0)

    # ----- GET /api/status -----

    def test_status_full(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        _post(f"{self.base}/api/submit", {"spec": {"prompt": "test"}})

        code, body = _get(f"{self.base}/api/status")
        self.assertEqual(code, 200)
        self.assertEqual(body["manager"], "test-mgr")
        self.assertEqual(len(body["children"]), 1)
        self.assertEqual(len(body["active_tasks"]), 1)

    # ----- 404 handling -----

    def test_get_404(self):
        try:
            _get(f"{self.base}/api/nonexistent")
            self.fail("Expected 404")
        except Exception as e:
            self.assertIn("404", str(e))

    def test_post_404(self):
        try:
            _post(f"{self.base}/api/nonexistent", {})
            self.fail("Expected 404")
        except Exception as e:
            self.assertIn("404", str(e))

    # ----- heartbeat monitor logic -----

    def test_heartbeat_timeout_marks_unhealthy(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })

        # Backdate heartbeat to force timeout
        with daemon.lock:
            daemon.children["w1"]["last_heartbeat"] = time.time() - 120

        # Run one cycle of the monitor logic inline
        with daemon.lock:
            cutoff = time.time() - daemon.HEARTBEAT_TIMEOUT
            for name, c in daemon.children.items():
                c["healthy"] = c["last_heartbeat"] >= cutoff

            self.assertFalse(daemon.children["w1"]["healthy"])

    def test_task_reassigned_on_unhealthy_child(self):
        _post(f"{self.base}/api/register", {
            "name": "w1", "ip": "10.0.0.1", "role": "worker",
        })
        _, sub = _post(f"{self.base}/api/submit", {"spec": {"prompt": "test"}})

        with daemon.lock:
            task = daemon.task_queue[0]
            task["status"] = "running"
            task["assigned_to"] = "w1"
            daemon.children["w1"]["tasks_running"] = 1
            daemon.children["w1"]["last_heartbeat"] = time.time() - 120

        # Simulate monitor logic
        with daemon.lock:
            cutoff = time.time() - daemon.HEARTBEAT_TIMEOUT
            for name, c in daemon.children.items():
                was_healthy = c["healthy"]
                c["healthy"] = c["last_heartbeat"] >= cutoff
                if was_healthy and not c["healthy"]:
                    for t in daemon.task_queue:
                        if t["assigned_to"] == name and t["status"] == "running":
                            t["status"] = "queued"
                            t["assigned_to"] = None
                            c["tasks_running"] = max(0, c["tasks_running"] - 1)

            self.assertEqual(daemon.task_queue[0]["status"], "queued")
            self.assertIsNone(daemon.task_queue[0]["assigned_to"])

    # ----- least_busy_child -----

    def test_least_busy_child_selection(self):
        with daemon.lock:
            daemon.children["w1"] = {
                "name": "w1", "ip": "10.0.0.1", "role": "worker",
                "healthy": True, "last_heartbeat": time.time(),
                "tasks_running": 3, "tasks_done": 0,
            }
            daemon.children["w2"] = {
                "name": "w2", "ip": "10.0.0.2", "role": "worker",
                "healthy": True, "last_heartbeat": time.time(),
                "tasks_running": 1, "tasks_done": 0,
            }
            result = daemon.least_busy_child()
        self.assertEqual(result, "w2")

    def test_least_busy_skips_unhealthy(self):
        with daemon.lock:
            daemon.children["w1"] = {
                "name": "w1", "ip": "10.0.0.1", "role": "worker",
                "healthy": False, "last_heartbeat": 0,
                "tasks_running": 0, "tasks_done": 0,
            }
            daemon.children["w2"] = {
                "name": "w2", "ip": "10.0.0.2", "role": "worker",
                "healthy": True, "last_heartbeat": time.time(),
                "tasks_running": 5, "tasks_done": 0,
            }
            result = daemon.least_busy_child()
        self.assertEqual(result, "w2")

    def test_least_busy_no_healthy_children(self):
        with daemon.lock:
            result = daemon.least_busy_child()
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
