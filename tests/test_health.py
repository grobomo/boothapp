"""Tests for the /api/health and /api/errors endpoints."""

import json
import os
import tempfile
import threading
import urllib.request
import urllib.error
from unittest.mock import MagicMock

import pytest

from analysis.server import (
    create_server, build_health_response, record_error,
    update_sessions, _sessions, _last_errors, _check_watcher,
)


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset global state between tests."""
    _sessions.update({"total": 0, "active": 0, "completed": 0})
    _last_errors.clear()
    yield


@pytest.fixture()
def mock_s3():
    client = MagicMock()
    client.list_objects_v2.return_value = {"Contents": []}
    return client


@pytest.fixture()
def server(mock_s3):
    srv = create_server(port=0, s3_client=mock_s3)
    t = threading.Thread(target=srv.serve_forever)
    t.daemon = True
    t.start()
    yield srv
    srv.shutdown()


def _get(server, path):
    host, port = server.server_address
    url = f"http://127.0.0.1:{port}{path}"
    return urllib.request.urlopen(url)


# -- /api/health --

def test_health_returns_200(server):
    resp = _get(server, "/api/health")
    assert resp.status == 200


def test_health_json_structure(server):
    resp = _get(server, "/api/health")
    data = json.loads(resp.read())
    assert data["status"] == "ok"
    assert isinstance(data["uptime_seconds"], (int, float))
    assert data["version"] == "1.0.0"
    assert "watcher" in data["services"]
    assert "presenter" in data["services"]
    assert "s3" in data["services"]
    assert data["sessions"] == {"total": 0, "active": 0, "completed": 0}


def test_health_s3_connected(server, mock_s3):
    resp = _get(server, "/api/health")
    data = json.loads(resp.read())
    assert data["services"]["s3"] == "connected"
    mock_s3.list_objects_v2.assert_called()


def test_health_s3_error():
    bad_s3 = MagicMock()
    bad_s3.list_objects_v2.side_effect = Exception("no bucket")
    data = build_health_response(s3_client=bad_s3)
    assert data["services"]["s3"] == "error"


def test_health_watcher_running():
    with tempfile.NamedTemporaryFile(suffix=".pid", delete=False) as f:
        pid_path = f.name
    try:
        os.environ["BOOTHAPP_WATCHER_PID"] = pid_path
        # Re-import to pick up env change -- just call directly
        assert _check_watcher() == "running"
    finally:
        os.unlink(pid_path)
        os.environ.pop("BOOTHAPP_WATCHER_PID", None)


def test_health_watcher_stopped():
    os.environ["BOOTHAPP_WATCHER_PID"] = "/tmp/nonexistent-pid-file-test"
    try:
        assert _check_watcher() == "stopped"
    finally:
        os.environ.pop("BOOTHAPP_WATCHER_PID", None)


def test_health_presenter_always_running(server):
    resp = _get(server, "/api/health")
    data = json.loads(resp.read())
    assert data["services"]["presenter"] == "running"


def test_session_counters(server):
    update_sessions(total=5, active=2, completed=3)
    resp = _get(server, "/api/health")
    data = json.loads(resp.read())
    assert data["sessions"] == {"total": 5, "active": 2, "completed": 3}


# -- /api/errors --

def test_errors_empty(server):
    resp = _get(server, "/api/errors")
    data = json.loads(resp.read())
    assert data["errors"] == []


def test_errors_returns_entries(server):
    record_error("S3 timeout")
    record_error("Watcher crash")
    resp = _get(server, "/api/errors")
    data = json.loads(resp.read())
    assert len(data["errors"]) == 2
    assert data["errors"][0]["message"] == "S3 timeout"


# -- 404 fallback --

def test_unknown_route_returns_404(server):
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _get(server, "/nonexistent")
    assert exc_info.value.code == 404
