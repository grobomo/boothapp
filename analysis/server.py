"""Minimal HTTP server for the booth visitor analysis app."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/health":
            body = json.dumps({
                "status": "ok",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body.encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # silence logs during tests


def create_server(port: int = 8000) -> HTTPServer:
    return HTTPServer(("", port), RequestHandler)


if __name__ == "__main__":
    server = create_server()
    print("Serving on port 8000")
    server.serve_forever()
