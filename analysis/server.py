"""HTTP server with health monitoring for the booth visitor analysis app."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

import boto3
from botocore.exceptions import BotoCoreError, ClientError

VERSION = "1.0.0"
S3_BUCKET = os.environ.get("BOOTHAPP_S3_BUCKET", "boothapp-sessions")
WATCHER_PID_FILE = os.environ.get("BOOTHAPP_WATCHER_PID", "/tmp/boothapp-watcher.pid")

_start_time = time.monotonic()

# In-memory session counters (updated by the watcher/pipeline)
_sessions = {"total": 0, "active": 0, "completed": 0}
_last_errors: list[dict] = []
MAX_ERRORS = 20


def record_error(message: str) -> None:
    """Append an error entry (kept in memory, capped at MAX_ERRORS)."""
    _last_errors.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "message": message,
    })
    if len(_last_errors) > MAX_ERRORS:
        _last_errors.pop(0)


def update_sessions(*, total: int | None = None, active: int | None = None,
                    completed: int | None = None) -> None:
    if total is not None:
        _sessions["total"] = total
    if active is not None:
        _sessions["active"] = active
    if completed is not None:
        _sessions["completed"] = completed


def _check_watcher() -> str:
    """Return 'running' if the watcher PID file exists, else 'stopped'."""
    pid_file = os.environ.get("BOOTHAPP_WATCHER_PID", WATCHER_PID_FILE)
    return "running" if os.path.exists(pid_file) else "stopped"


def _check_s3(s3_client=None) -> str:
    """List 1 object in the S3 bucket. Returns 'connected' or 'error'."""
    try:
        client = s3_client or boto3.client("s3")
        client.list_objects_v2(Bucket=S3_BUCKET, MaxKeys=1)
        return "connected"
    except (BotoCoreError, ClientError, Exception):
        return "error"


def build_health_response(s3_client=None) -> dict:
    uptime = time.monotonic() - _start_time
    return {
        "status": "ok",
        "uptime_seconds": round(uptime, 1),
        "services": {
            "watcher": _check_watcher(),
            "presenter": "running",
            "s3": _check_s3(s3_client),
        },
        "sessions": dict(_sessions),
        "version": VERSION,
    }


class RequestHandler(BaseHTTPRequestHandler):
    s3_client = None

    def do_GET(self):
        if self.path == "/api/health":
            self._json_response(200, build_health_response(self.s3_client))
        elif self.path == "/api/errors":
            self._json_response(200, {"errors": list(_last_errors)})
        else:
            self.send_response(404)
            self.end_headers()

    def _json_response(self, code: int, data: dict) -> None:
        body = json.dumps(data)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, format, *args):
        pass  # silence logs during tests


def create_server(port: int = 8000, s3_client=None) -> HTTPServer:
    if s3_client is not None:
        RequestHandler.s3_client = s3_client
    return HTTPServer(("", port), RequestHandler)


if __name__ == "__main__":
    server = create_server()
    print(f"BoothApp health server v{VERSION} on port 8000")
    server.serve_forever()
