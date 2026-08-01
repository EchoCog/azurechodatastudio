"""Tests for the real HTTP AtomSpace transport.

Spins up a tiny stdlib HTTP server to stand in for a real AtomSpace REST
backend, so these tests exercise an actual request/response round trip
rather than mocking the transport itself.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Tuple

import pytest

from azure_integration.atomspace_transport import AtomSpaceTransportError, HttpAtomSpaceTransport


class _StubAtomSpaceHandler(BaseHTTPRequestHandler):
    """Minimal stand-in for a real AtomSpace REST endpoint."""

    received: List[Tuple[str, Dict[str, Any]]] = []

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        if self.path == "/api/v1.5/status":
            self._send_json(200, {"status": "ok"})
            return
        if self.path == "/api/v1.5/empty":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/api/v1.5/malformed":
            body = b"not-json{"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 (http.server API)
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        payload = json.loads(raw) if raw else {}
        type(self).received.append((self.path, payload))

        if self.path == "/api/v1.5/atoms":
            self._send_json(200, {"accepted": len(payload.get("atoms", []))})
        elif self.path == "/api/v1.5/reason":
            self._send_json(200, {"insight": "stub-insight", "mode": payload.get("mode")})
        elif self.path == "/api/v1.5/error":
            self._send_json(500, {"error": "boom"})
        else:
            self._send_json(404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass  # silence default request logging


@pytest.fixture()
def stub_server():
    _StubAtomSpaceHandler.received = []
    server = HTTPServer(("127.0.0.1", 0), _StubAtomSpaceHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=2)


def _endpoint(server: HTTPServer) -> str:
    host, port = server.server_address[:2]
    return f"http://{host}:{port}"


class TestHttpAtomSpaceTransportUpsert:
    def test_upsert_posts_nodes_and_links_as_atoms(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        batch = {
            "nodes": [{"type": "Node", "node_type": "TableNode", "name": "orders", "uuid": "n1"}],
            "links": [{"type": "Link", "link_type": "MemberLink", "out": ["n1"], "uuid": "l1"}],
        }

        result = transport.upsert(batch)

        assert result["status"] == "ok"
        assert result["nodes"] == 1
        assert result["links"] == 1
        assert result["remote"]["accepted"] == 2

        path, payload = _StubAtomSpaceHandler.received[-1]
        assert path == "/api/v1.5/atoms"
        assert len(payload["atoms"]) == 2

    def test_upsert_with_empty_batch(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        result = transport.upsert({"nodes": [], "links": []})
        assert result["nodes"] == 0
        assert result["links"] == 0
        assert result["remote"]["accepted"] == 0


class TestHttpAtomSpaceTransportReason:
    def test_reason_forwards_mode(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        result = transport.reason({"nodes": [], "links": []}, mode="inference")
        assert result["status"] == "ok"
        assert result["mode"] == "inference"
        assert result["remote"]["insight"] == "stub-insight"

    def test_reason_defaults_mode(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        result = transport.reason({"nodes": [], "links": []}, mode=None)
        assert result["mode"] == "default"


class TestHttpAtomSpaceTransportHealth:
    def test_health_true_when_reachable(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        assert transport.health() is True

    def test_health_false_when_unreachable(self) -> None:
        transport = HttpAtomSpaceTransport("http://127.0.0.1:1")
        assert transport.health() is False


class TestHttpAtomSpaceTransportErrors:
    def test_connection_failure_raises_transport_error(self) -> None:
        transport = HttpAtomSpaceTransport("http://127.0.0.1:1", timeout=1.0)
        with pytest.raises(AtomSpaceTransportError):
            transport.upsert({"nodes": [], "links": []})

    def test_http_error_status_raises_transport_error(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        with pytest.raises(AtomSpaceTransportError):
            transport._post("/api/v1.5/error", {})

    def test_empty_response_body_decodes_to_empty_dict(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        result = transport._get("/api/v1.5/empty")
        assert result == {}

    def test_malformed_json_response_raises_transport_error(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        with pytest.raises(AtomSpaceTransportError):
            transport._get("/api/v1.5/malformed")

    def test_rejects_empty_endpoint(self) -> None:
        with pytest.raises(ValueError):
            HttpAtomSpaceTransport("")
