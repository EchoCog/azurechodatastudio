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
from urllib.parse import parse_qs, urlparse

import pytest

from azure_integration.atomspace_transport import (
    AtomDeltaTracker,
    AtomSpaceTransportError,
    FederatedAtomSpaceClient,
    HttpAtomSpaceTransport,
)


class _StubAtomSpaceHandler(BaseHTTPRequestHandler):
    """Minimal stand-in for a real AtomSpace REST endpoint."""

    received: List[Tuple[str, Dict[str, Any]]] = []
    atoms_store: List[Dict[str, Any]] = []
    query_results: List[Dict[str, Any]] = []

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1.5/status":
            self._send_json(200, {"status": "ok"})
            return
        if parsed.path == "/api/v1.5/atoms":
            params = parse_qs(parsed.query)
            offset = int(params.get("cursor", ["0"])[0] or 0)
            store = type(self).atoms_store
            limit = int(params.get("limit", [str(len(store) or 1)])[0])
            page = store[offset:offset + limit]
            next_offset = offset + len(page)
            payload: Dict[str, Any] = {"atoms": page, "total": len(store)}
            if next_offset < len(store):
                payload["next_cursor"] = str(next_offset)
            self._send_json(200, payload)
            return
        if parsed.path == "/api/v1.5/empty":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parsed.path == "/api/v1.5/malformed":
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
            for atom in payload.get("atoms", []):
                type(self).atoms_store.append(atom)
            self._send_json(200, {"accepted": len(payload.get("atoms", []))})
        elif self.path == "/api/v1.5/reason":
            self._send_json(
                200,
                {
                    "insight": "stub-insight",
                    "mode": payload.get("mode"),
                    "native": payload.get("native", False),
                    "rules": payload.get("rules", []),
                },
            )
        elif self.path == "/api/v1.5/query":
            self._send_json(200, {"results": type(self).query_results, "kind": payload.get("kind")})
        elif self.path == "/api/v1.5/error":
            self._send_json(500, {"error": "boom"})
        else:
            self._send_json(404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        pass  # silence default request logging


@pytest.fixture()
def stub_server():
    _StubAtomSpaceHandler.received = []
    _StubAtomSpaceHandler.atoms_store = []
    _StubAtomSpaceHandler.query_results = []
    server = HTTPServer(("127.0.0.1", 0), _StubAtomSpaceHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        thread.join(timeout=2)


def _make_stub_server(atoms=None, query_results=None):
    """Create an independent stub server (own handler subclass and state)."""
    handler = type(
        "_IsolatedStubHandler",
        (_StubAtomSpaceHandler,),
        {
            "received": [],
            "atoms_store": list(atoms or []),
            "query_results": list(query_results or []),
        },
    )
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, handler


def _stop_stub_server(server: HTTPServer, thread: threading.Thread) -> None:
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


class TestAtomDeltaTracker:
    def test_first_delta_includes_everything(self) -> None:
        tracker = AtomDeltaTracker()
        batch = {
            "nodes": [{"type": "Node", "name": "a", "uuid": "n1"}],
            "links": [{"type": "Link", "out": ["n1"], "uuid": "l1"}],
        }
        delta = tracker.compute_delta(batch)
        assert len(delta["nodes"]) == 1
        assert len(delta["links"]) == 1

    def test_synced_atoms_are_excluded_until_changed(self) -> None:
        tracker = AtomDeltaTracker()
        batch = {
            "nodes": [{"type": "Node", "name": "a", "uuid": "n1"}],
            "links": [],
        }
        tracker.mark_synced(batch)
        assert tracker.compute_delta(batch) == {"nodes": [], "links": []}
        assert tracker.tracked_count == 1

        changed = {
            "nodes": [{"type": "Node", "name": "a-renamed", "uuid": "n1"}],
            "links": [],
        }
        delta = tracker.compute_delta(changed)
        assert [n["name"] for n in delta["nodes"]] == ["a-renamed"]

    def test_forget_and_reset(self) -> None:
        tracker = AtomDeltaTracker()
        batch = {"nodes": [{"type": "Node", "name": "a", "uuid": "n1"}], "links": []}
        tracker.mark_synced(batch)
        assert tracker.forget("n1") is True
        assert tracker.forget("n1") is False
        assert len(tracker.compute_delta(batch)["nodes"]) == 1
        tracker.mark_synced(batch)
        tracker.reset()
        assert tracker.tracked_count == 0

    def test_atoms_without_uuid_key_by_fingerprint(self) -> None:
        tracker = AtomDeltaTracker()
        batch = {"nodes": [{"type": "Node", "name": "anon"}], "links": []}
        tracker.mark_synced(batch)
        assert tracker.compute_delta(batch) == {"nodes": [], "links": []}
        changed = {"nodes": [{"type": "Node", "name": "anon-2"}], "links": []}
        assert len(tracker.compute_delta(changed)["nodes"]) == 1


class TestHttpAtomSpaceTransportFetch:
    def test_fetch_atoms_pages_with_cursor(self, stub_server) -> None:
        _StubAtomSpaceHandler.atoms_store = [
            {"type": "Node", "name": f"atom-{i}", "uuid": f"n{i}"} for i in range(5)
        ]
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))

        first = transport.fetch_atoms(limit=2)
        assert [a["uuid"] for a in first["atoms"]] == ["n0", "n1"]
        assert first["next_cursor"] == "2"

        second = transport.fetch_atoms(cursor=first["next_cursor"], limit=2)
        assert [a["uuid"] for a in second["atoms"]] == ["n2", "n3"]

        third = transport.fetch_atoms(cursor=second["next_cursor"], limit=2)
        assert [a["uuid"] for a in third["atoms"]] == ["n4"]
        assert third["next_cursor"] is None

    def test_fetch_all_atoms_walks_every_page(self, stub_server) -> None:
        _StubAtomSpaceHandler.atoms_store = [
            {"type": "Node", "name": f"atom-{i}", "uuid": f"n{i}"} for i in range(7)
        ]
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        atoms = transport.fetch_all_atoms(page_size=3)
        assert [a["uuid"] for a in atoms] == [f"n{i}" for i in range(7)]

    def test_fetch_all_atoms_raises_when_page_limit_exceeded(self, stub_server) -> None:
        _StubAtomSpaceHandler.atoms_store = [
            {"type": "Node", "name": f"atom-{i}", "uuid": f"n{i}"} for i in range(4)
        ]
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        with pytest.raises(AtomSpaceTransportError):
            transport.fetch_all_atoms(page_size=1, max_pages=2)


class TestHttpAtomSpaceTransportSync:
    def test_sync_pushes_delta_and_pulls_remote_atoms(self, stub_server) -> None:
        _StubAtomSpaceHandler.atoms_store = [
            {"type": "Node", "name": "pre-existing", "uuid": "remote-1"},
        ]
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        batch = {
            "nodes": [{"type": "Node", "name": "local", "uuid": "local-1"}],
            "links": [],
        }

        result = transport.sync(batch)
        assert result["status"] == "ok"
        assert result["pushed"] == {"nodes": 1, "links": 0}
        # Pulled the pre-existing remote atom plus the atom just pushed.
        assert result["pulled"] == 2
        assert {a["uuid"] for a in result["atoms"]} == {"remote-1", "local-1"}

    def test_second_sync_sends_nothing_when_unchanged(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        batch = {
            "nodes": [{"type": "Node", "name": "local", "uuid": "local-1"}],
            "links": [],
        }
        transport.sync(batch, pull=False)
        upserts_before = [p for p, _ in _StubAtomSpaceHandler.received if p == "/api/v1.5/atoms"]

        second = transport.sync(batch, pull=False)
        assert second["pushed"] == {"nodes": 0, "links": 0}
        upserts_after = [p for p, _ in _StubAtomSpaceHandler.received if p == "/api/v1.5/atoms"]
        assert len(upserts_after) == len(upserts_before)

    def test_sync_resends_changed_atoms_only(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        batch = {
            "nodes": [
                {"type": "Node", "name": "stable", "uuid": "s1"},
                {"type": "Node", "name": "mutable", "uuid": "m1"},
            ],
            "links": [],
        }
        transport.sync(batch, pull=False)

        batch["nodes"][1] = {"type": "Node", "name": "mutable-changed", "uuid": "m1"}
        result = transport.sync(batch, pull=False)
        assert result["pushed"] == {"nodes": 1, "links": 0}
        _, payload = _StubAtomSpaceHandler.received[-1]
        assert [a["uuid"] for a in payload["atoms"]] == ["m1"]

    def test_failed_push_keeps_delta_for_retry(self) -> None:
        transport = HttpAtomSpaceTransport("http://127.0.0.1:1", timeout=1.0)
        batch = {
            "nodes": [{"type": "Node", "name": "local", "uuid": "local-1"}],
            "links": [],
        }
        with pytest.raises(AtomSpaceTransportError):
            transport.sync(batch, pull=False)
        # The delta tracker must not have marked the atom as synced.
        assert len(transport.delta_tracker.compute_delta(batch)["nodes"]) == 1


class TestHttpAtomSpaceTransportNativeReasoning:
    def test_reason_native_posts_rules_and_native_flag(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        result = transport.reason_native(["pln-deduction", "pln-abduction"], mode="pln")
        assert result["status"] == "ok"
        assert result["native"] is True
        assert result["mode"] == "pln"
        assert result["remote"]["native"] is True
        assert result["remote"]["rules"] == ["pln-deduction", "pln-abduction"]

        _, payload = _StubAtomSpaceHandler.received[-1]
        assert payload["native"] is True
        assert payload["rules"] == ["pln-deduction", "pln-abduction"]

    def test_reason_native_seeds_atoms_and_defaults_mode(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        batch = {
            "nodes": [{"type": "Node", "name": "seed", "uuid": "n1"}],
            "links": [],
        }
        result = transport.reason_native(["pln-deduction"], batch=batch)
        assert result["mode"] == "ure"
        _, payload = _StubAtomSpaceHandler.received[-1]
        assert len(payload["atoms"]) == 1

    def test_reason_native_requires_rules(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        with pytest.raises(ValueError):
            transport.reason_native([])


class TestHttpAtomSpaceTransportQuery:
    def test_query_posts_pattern_and_kind(self, stub_server) -> None:
        _StubAtomSpaceHandler.query_results = [{"type": "Node", "name": "hit", "uuid": "q1"}]
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        pattern = {"link_type": "MemberLink", "variables": ["$x"]}

        result = transport.query(pattern, kind="get")
        assert result["status"] == "ok"
        assert result["kind"] == "get"
        assert result["results"] == [{"type": "Node", "name": "hit", "uuid": "q1"}]

        path, payload = _StubAtomSpaceHandler.received[-1]
        assert path == "/api/v1.5/query"
        assert payload["pattern"] == pattern
        assert payload["kind"] == "get"

    def test_query_rejects_unknown_kind(self, stub_server) -> None:
        transport = HttpAtomSpaceTransport(_endpoint(stub_server))
        with pytest.raises(ValueError):
            transport.query({}, kind="mystery")


class TestFederatedAtomSpaceClient:
    def test_requires_at_least_one_endpoint(self) -> None:
        with pytest.raises(ValueError):
            FederatedAtomSpaceClient([])

    def test_query_merges_and_dedupes_across_endpoints(self) -> None:
        shared = {"type": "Node", "name": "shared", "uuid": "shared-1"}
        server_a, thread_a, _ = _make_stub_server(
            query_results=[shared, {"type": "Node", "name": "only-a", "uuid": "a-1"}]
        )
        server_b, thread_b, _ = _make_stub_server(
            query_results=[shared, {"type": "Node", "name": "only-b", "uuid": "b-1"}]
        )
        try:
            client = FederatedAtomSpaceClient([_endpoint(server_a), _endpoint(server_b)])
            result = client.query({"variables": ["$x"]}, kind="bind")
            assert result["status"] == "ok"
            assert {a["uuid"] for a in result["results"]} == {"shared-1", "a-1", "b-1"}
            assert result["sources"][_endpoint(server_a)] == 2
            assert result["sources"][_endpoint(server_b)] == 1
            assert result["errors"] == {}
        finally:
            _stop_stub_server(server_a, thread_a)
            _stop_stub_server(server_b, thread_b)

    def test_query_partial_when_one_endpoint_down(self) -> None:
        server_a, thread_a, _ = _make_stub_server(
            query_results=[{"type": "Node", "name": "only-a", "uuid": "a-1"}]
        )
        try:
            client = FederatedAtomSpaceClient(
                [_endpoint(server_a), "http://127.0.0.1:1"], timeout=1.0
            )
            result = client.query({"variables": ["$x"]})
            assert result["status"] == "partial"
            assert [a["uuid"] for a in result["results"]] == ["a-1"]
            assert "http://127.0.0.1:1" in result["errors"]
        finally:
            _stop_stub_server(server_a, thread_a)

    def test_query_error_when_all_endpoints_down(self) -> None:
        client = FederatedAtomSpaceClient(
            ["http://127.0.0.1:1", "http://127.0.0.1:2"], timeout=1.0
        )
        result = client.query({"variables": ["$x"]})
        assert result["status"] == "error"
        assert result["results"] == []
        assert len(result["errors"]) == 2

    def test_fetch_all_merges_remote_atom_sets(self) -> None:
        shared = {"type": "Node", "name": "shared", "uuid": "shared-1"}
        server_a, thread_a, _ = _make_stub_server(
            atoms=[shared, {"type": "Node", "name": "only-a", "uuid": "a-1"}]
        )
        server_b, thread_b, _ = _make_stub_server(
            atoms=[shared, {"type": "Node", "name": "only-b", "uuid": "b-1"}]
        )
        try:
            client = FederatedAtomSpaceClient([_endpoint(server_a), _endpoint(server_b)])
            result = client.fetch_all(page_size=1)
            assert result["status"] == "ok"
            assert {a["uuid"] for a in result["atoms"]} == {"shared-1", "a-1", "b-1"}
        finally:
            _stop_stub_server(server_a, thread_a)
            _stop_stub_server(server_b, thread_b)

    def test_upsert_all_reports_per_endpoint_outcomes(self) -> None:
        server_a, thread_a, handler_a = _make_stub_server()
        try:
            client = FederatedAtomSpaceClient(
                [_endpoint(server_a), "http://127.0.0.1:1"], timeout=1.0
            )
            batch = {
                "nodes": [{"type": "Node", "name": "n", "uuid": "n1"}],
                "links": [],
            }
            result = client.upsert_all(batch)
            assert result["status"] == "partial"
            assert result["outcomes"][_endpoint(server_a)]["remote"]["accepted"] == 1
            assert "http://127.0.0.1:1" in result["errors"]
            assert len(handler_a.atoms_store) == 1
        finally:
            _stop_stub_server(server_a, thread_a)

    def test_health_map_probes_every_endpoint(self) -> None:
        server_a, thread_a, _ = _make_stub_server()
        try:
            client = FederatedAtomSpaceClient(
                [_endpoint(server_a), "http://127.0.0.1:1"], timeout=1.0
            )
            health = client.health_map()
            assert health[_endpoint(server_a)] is True
            assert health["http://127.0.0.1:1"] is False
        finally:
            _stop_stub_server(server_a, thread_a)

    def test_accepts_preconstructed_transports(self) -> None:
        transport = HttpAtomSpaceTransport("http://127.0.0.1:1", timeout=1.0)
        client = FederatedAtomSpaceClient([transport])
        assert client.transports[0] is transport
