"""Tests for the /api/health endpoint."""

import json
import threading
import urllib.request

import pytest

from analysis.server import create_server


@pytest.fixture()
def server():
    srv = create_server(port=0)  # OS picks a free port
    t = threading.Thread(target=srv.serve_forever)
    t.daemon = True
    t.start()
    yield srv
    srv.shutdown()


def _get(server, path):
    host, port = server.server_address
    url = f"http://127.0.0.1:{port}{path}"
    return urllib.request.urlopen(url)


def test_health_returns_200(server):
    resp = _get(server, "/api/health")
    assert resp.status == 200


def test_health_returns_json(server):
    resp = _get(server, "/api/health")
    data = json.loads(resp.read())
    assert data["status"] == "ok"
    assert "timestamp" in data


def test_unknown_route_returns_404(server):
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        _get(server, "/nonexistent")
    assert exc_info.value.code == 404
