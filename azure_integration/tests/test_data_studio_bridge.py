"""Tests for the Azure Data Studio ZoneCog bridge application.

Covers:
- Health endpoint
- Schema ingestion → AtomSpace upsert
- Table row ingestion → AtomSpace upsert
- Reasoning endpoint (4E cognitive pipeline)
- Status tracking across multiple requests
- BridgeApp business logic in isolation (no HTTP layer)
- AtomSpaceAdapter local graph and invalid configuration paths
- FourE processor
- Error handling
"""
from __future__ import annotations

import os
import types
from typing import Any, Dict

import pytest

from azure_integration.sql_to_atomspace import map_rows_to_atoms, map_schema_to_atoms
from azure_integration.data_studio_bridge import (
    AtomSpaceAdapter,
    BridgeApp,
    FourE,
    IngestAtomsRequest,
    IngestSchemaRequest,
    IngestTableRequest,
    ReasonRequest,
)


# ---------------------------------------------------------------------------
# BridgeApp unit tests (no HTTP)
# ---------------------------------------------------------------------------


class TestBridgeAppHealth:
    def test_health_returns_ok_status(self) -> None:
        bridge = BridgeApp()
        result = bridge.health()
        assert result["status"] == "ok"

    def test_health_includes_timestamp(self) -> None:
        bridge = BridgeApp()
        result = bridge.health()
        assert "time" in result
        assert result["time"].endswith("Z")

    def test_health_advertises_protocol_and_capabilities(self) -> None:
        bridge = BridgeApp()
        result = bridge.health()
        assert result["protocol_version"] == "1.0"
        assert result["backend"] == "local"
        assert "reason" in result["capabilities"]
        assert "list-atoms" in result["capabilities"]
        assert "persist" not in result["capabilities"]


class TestBridgeAppStatus:
    def test_initial_status(self) -> None:
        bridge = BridgeApp()
        result = bridge.status()
        assert result["status"] == "ok"
        assert result["processed_batches"] == 0
        assert result["last_request_id"] is None
        assert result["persisted"] is False

    def test_status_increments_after_ingest(self) -> None:
        bridge = BridgeApp()
        req = IngestSchemaRequest(
            tables=[{"table": "t1", "columns": [{"name": "id"}]}],
            foreign_keys=[],
        )
        bridge.ingest_schema(req)
        result = bridge.status()
        assert result["processed_batches"] == 1
        assert result["last_request_id"] is not None

    def test_status_request_id_changes_on_each_call(self) -> None:
        bridge = BridgeApp()
        req = IngestSchemaRequest(
            tables=[{"table": "t", "columns": []}],
            foreign_keys=[],
        )
        bridge.ingest_schema(req)
        id1 = bridge.status()["last_request_id"]
        bridge.ingest_schema(req)
        id2 = bridge.status()["last_request_id"]
        assert id1 != id2


class TestBridgeAppIngestSchema:
    def test_ingest_schema_returns_upsert_result(self) -> None:
        bridge = BridgeApp()
        req = IngestSchemaRequest(
            tables=[
                {
                    "schema": "dbo",
                    "table": "users",
                    "columns": [{"name": "id"}, {"name": "name"}],
                }
            ],
            foreign_keys=[],
        )
        result = bridge.ingest_schema(req)
        assert "upsert" in result
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] >= 3  # 1 table + 2 columns

    def test_ingest_schema_with_foreign_keys(self) -> None:
        bridge = BridgeApp()
        req = IngestSchemaRequest(
            tables=[
                {"schema": "dbo", "table": "orders", "columns": [{"name": "id"}, {"name": "user_id"}]},
                {"schema": "dbo", "table": "users", "columns": [{"name": "id"}]},
            ],
            foreign_keys=[
                {
                    "src_schema": "dbo",
                    "src_table": "orders",
                    "src_columns": ["user_id"],
                    "dst_schema": "dbo",
                    "dst_table": "users",
                    "dst_columns": ["id"],
                }
            ],
        )
        result = bridge.ingest_schema(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["links"] >= 1

    def test_ingest_schema_empty_tables(self) -> None:
        bridge = BridgeApp()
        req = IngestSchemaRequest(tables=[], foreign_keys=[])
        result = bridge.ingest_schema(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] == 0
        assert result["upsert"]["links"] == 0


class TestBridgeAppIngestAtoms:
    def test_ingest_atoms_returns_upsert_result(self) -> None:
        bridge = BridgeApp()
        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "total": 99.5}], primary_key="id")
        req = IngestAtomsRequest(atoms=batch)
        result = bridge.ingest_atoms(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] == len(batch["nodes"])
        assert result["upsert"]["links"] == len(batch["links"])

    def test_ingest_atoms_increments_processed_batches(self) -> None:
        bridge = BridgeApp()
        before = bridge.processed_batches
        req = IngestAtomsRequest(atoms={"nodes": [], "links": []})
        bridge.ingest_atoms(req)
        assert bridge.processed_batches == before + 1
        assert bridge.last_request_id is not None


class TestBridgeAppIngestTable:
    def test_ingest_table_basic(self) -> None:
        bridge = BridgeApp()
        req = IngestTableRequest(
            schema="dbo",
            table="employees",
            primary_key="id",
            rows=[
                {"id": 1, "name": "Alice", "dept": "eng"},
                {"id": 2, "name": "Bob", "dept": "hr"},
            ],
        )
        result = bridge.ingest_table(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] >= 2  # at least 2 row nodes

    def test_ingest_table_composite_pk(self) -> None:
        bridge = BridgeApp()
        req = IngestTableRequest(
            schema="dbo",
            table="assignments",
            primary_key=["employee_id", "project_id"],
            rows=[
                {"employee_id": 1, "project_id": 10, "role": "lead"},
            ],
        )
        result = bridge.ingest_table(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] >= 1

    def test_ingest_table_empty_rows(self) -> None:
        bridge = BridgeApp()
        req = IngestTableRequest(
            schema=None,
            table="empty_table",
            primary_key="id",
            rows=[],
        )
        result = bridge.ingest_table(req)
        assert result["upsert"]["status"] == "ok"
        assert result["upsert"]["nodes"] == 0

    def test_ingest_table_increments_processed_batches(self) -> None:
        bridge = BridgeApp()
        before = bridge.processed_batches
        req = IngestTableRequest(
            schema="dbo", table="t", primary_key="id", rows=[{"id": 1}]
        )
        bridge.ingest_table(req)
        assert bridge.processed_batches == before + 1


class TestBridgeAppReason:
    def test_reason_returns_cognitive_and_adapter_results(self) -> None:
        bridge = BridgeApp()
        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "total": 99.5}], primary_key="id")
        req = ReasonRequest(atoms=batch)
        result = bridge.reason(req)
        assert "cognitive" in result
        assert "adapter" in result
        assert result["adapter"]["status"] == "ok"

    def test_reason_with_mode(self) -> None:
        bridge = BridgeApp()
        batch = map_schema_to_atoms(
            [{"table": "products", "columns": [{"name": "sku"}]}], []
        )
        req = ReasonRequest(atoms=batch, mode="inference")
        result = bridge.reason(req)
        assert result["cognitive"]["mode"] == "inference"

    def test_reason_with_context(self) -> None:
        bridge = BridgeApp()
        batch = map_rows_to_atoms(None, "items", [{"id": 5, "qty": 3}], primary_key="id")
        req = ReasonRequest(atoms=batch, context={"user": "alice", "session": "abc"})
        result = bridge.reason(req)
        assert result["cognitive"]["context"]["user"] == "alice"

    def test_reason_increments_processed_batches(self) -> None:
        bridge = BridgeApp()
        before = bridge.processed_batches
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")
        bridge.reason(ReasonRequest(atoms=batch))
        assert bridge.processed_batches == before + 1


class TestBridgeAppListAtoms:
    def test_list_atoms_reflects_ingested_data(self) -> None:
        bridge = BridgeApp()
        req = IngestTableRequest(schema="dbo", table="t", primary_key="id", rows=[{"id": 1}])
        bridge.ingest_table(req)
        result = bridge.list_atoms()
        assert result["status"] == "ok"
        assert len(result["nodes"]) >= 1


# ---------------------------------------------------------------------------
# AtomSpaceAdapter unit tests
# ---------------------------------------------------------------------------


class TestAtomSpaceAdapterLocal:
    def setup_method(self) -> None:
        os.environ.pop("ATOMSPACE_URL", None)
        os.environ["ATOMSPACE_MODE"] = "local"

    def test_upsert_counts_nodes_and_links(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1, "x": 10}], primary_key="id")
        result = adapter.upsert(batch)
        assert result["status"] == "ok"
        assert result["backend"] == "local"
        assert result["nodes"] == len(batch["nodes"])
        assert result["links"] == len(batch["links"])
        assert result["total_nodes"] == len(batch["nodes"])

    def test_upsert_empty_batch(self) -> None:
        adapter = AtomSpaceAdapter()
        result = adapter.upsert({"nodes": [], "links": []})
        assert result["status"] == "ok"
        assert result["nodes"] == 0
        assert result["links"] == 0

    def test_reason_returns_structural_insights(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_schema_to_atoms([{"table": "t", "columns": []}], [])
        result = adapter.reason(batch, mode="default")
        assert result["status"] == "ok"
        assert result["node_types"] == {"TableNode": 1}
        assert result["atoms"] == {"nodes": 1, "links": 0}
        assert result["insights"]

    def test_reason_without_mode(self) -> None:
        adapter = AtomSpaceAdapter()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = adapter.reason(batch, mode=None)
        assert result["mode"] == "default"


class TestAtomSpaceAdapterPersistence:
    def setup_method(self) -> None:
        os.environ.pop("ATOMSPACE_URL", None)
        os.environ["ATOMSPACE_MODE"] = "local"

    def teardown_method(self) -> None:
        os.environ.pop("ATOMSPACE_PERSIST_PATH", None)

    def test_upsert_without_persist_path_stays_in_memory_only(self) -> None:
        os.environ.pop("ATOMSPACE_PERSIST_PATH", None)
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")
        result = adapter.upsert(batch)
        assert result["persisted"] is False

    def test_upsert_persists_to_sqlite_file(self, tmp_path: Any) -> None:
        db_path = str(tmp_path / "atoms.db")
        os.environ["ATOMSPACE_PERSIST_PATH"] = db_path
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1, "name": "x"}], primary_key="id")
        result = adapter.upsert(batch)
        assert result["persisted"] is True

        # A fresh adapter pointed at the same file reloads the persisted graph.
        reloaded = AtomSpaceAdapter()
        assert reloaded._nodes == adapter._nodes
        assert reloaded._links == adapter._links
        assert len(reloaded._nodes) == len(batch["nodes"])

    def test_reload_survives_process_restart_simulation(self, tmp_path: Any) -> None:
        db_path = str(tmp_path / "atoms.db")
        os.environ["ATOMSPACE_PERSIST_PATH"] = db_path

        first = AtomSpaceAdapter()
        batch1 = map_rows_to_atoms("dbo", "orders", [{"id": 1}], primary_key="id")
        first.upsert(batch1)
        del first  # simulate process exit

        second = AtomSpaceAdapter()
        batch2 = map_rows_to_atoms("dbo", "orders", [{"id": 2}], primary_key="id")
        second.upsert(batch2)

        third = AtomSpaceAdapter()
        assert len(third._nodes) == len(batch1["nodes"]) + len(batch2["nodes"])

    def test_upsert_from_worker_thread_does_not_raise(self, tmp_path: Any) -> None:
        # Regression test: FastAPI's sync route handlers run each request in
        # a worker threadpool, distinct from the thread that constructed the
        # adapter/store. sqlite3's default check_same_thread=True would raise
        # ProgrammingError here.
        import concurrent.futures

        db_path = str(tmp_path / "atoms.db")
        os.environ["ATOMSPACE_PERSIST_PATH"] = db_path
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(adapter.upsert, batch).result()

        assert result["persisted"] is True
        assert len(adapter._nodes) == len(batch["nodes"])

    def test_concurrent_upserts_from_multiple_threads_all_persist(self, tmp_path: Any) -> None:
        import concurrent.futures

        db_path = str(tmp_path / "atoms.db")
        os.environ["ATOMSPACE_PERSIST_PATH"] = db_path
        adapter = AtomSpaceAdapter()
        batches = [
            map_rows_to_atoms("dbo", "t", [{"id": i}], primary_key="id") for i in range(8)
        ]

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(adapter.upsert, batches))

        assert all(r["status"] == "ok" for r in results)
        reloaded = AtomSpaceAdapter()
        assert len(reloaded._nodes) == sum(len(b["nodes"]) for b in batches)

    def test_http_mode_with_persist_path_set_reports_not_persisted(self, tmp_path: Any) -> None:
        # ATOMSPACE_PERSIST_PATH only takes effect in `local` mode; in `http`
        # mode no SqliteAtomStore is ever created, so `persisted` must be
        # False even though the env var happens to be set.
        os.environ["ATOMSPACE_MODE"] = "http"
        os.environ["ATOMSPACE_URL"] = "http://127.0.0.1:1"
        os.environ["ATOMSPACE_PERSIST_PATH"] = str(tmp_path / "atoms.db")
        try:
            adapter = AtomSpaceAdapter()
            assert adapter.persisted is False
        finally:
            os.environ.pop("ATOMSPACE_URL", None)
            os.environ["ATOMSPACE_MODE"] = "local"


class TestAtomSpaceAdapterListAtoms:
    def setup_method(self) -> None:
        os.environ.pop("ATOMSPACE_URL", None)
        os.environ.pop("ATOMSPACE_PERSIST_PATH", None)
        os.environ["ATOMSPACE_MODE"] = "local"

    def test_list_atoms_reflects_upserts(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")
        adapter.upsert(batch)
        listed = adapter.list_atoms()
        assert listed["status"] == "ok"
        assert listed["backend"] == "local"
        assert listed["persisted"] is False
        assert len(listed["nodes"]) == len(batch["nodes"])
        assert len(listed["links"]) == len(batch["links"])

    def test_list_atoms_empty_by_default(self) -> None:
        adapter = AtomSpaceAdapter()
        listed = adapter.list_atoms()
        assert listed["nodes"] == []
        assert listed["links"] == []


class TestAtomSpaceAdapterInvalidConfiguration:
    def setup_method(self) -> None:
        os.environ["ATOMSPACE_MODE"] = "real"
        os.environ["ATOMSPACE_URL"] = "http://localhost:17001"

    def teardown_method(self) -> None:
        os.environ.pop("ATOMSPACE_MODE", None)
        os.environ.pop("ATOMSPACE_URL", None)

    def test_constructor_rejects_unknown_backend(self) -> None:
        with pytest.raises(ValueError, match="Unsupported ATOMSPACE_MODE"):
            AtomSpaceAdapter()


class TestAtomSpaceAdapterHttpMode:
    """Verifies AtomSpaceAdapter dispatches to the real HTTP transport when
    ATOMSPACE_MODE=http, using a local stub server rather than a mock."""

    def setup_method(self) -> None:
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length else b"{}"
                payload = json.loads(raw) if raw else {}
                body = json.dumps({"accepted": len(payload.get("atoms", []))}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
                pass

        self._server = HTTPServer(("127.0.0.1", 0), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        host, port = self._server.server_address[:2]
        os.environ["ATOMSPACE_MODE"] = "http"
        os.environ["ATOMSPACE_URL"] = f"http://{host}:{port}"

    def teardown_method(self) -> None:
        self._server.shutdown()
        self._thread.join(timeout=2)
        os.environ.pop("ATOMSPACE_MODE", None)
        os.environ.pop("ATOMSPACE_URL", None)

    def test_upsert_dispatches_to_real_transport(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1, "x": 10}], primary_key="id")
        result = adapter.upsert(batch)
        assert result["status"] == "ok"
        assert result["nodes"] == len(batch["nodes"])
        assert result["links"] == len(batch["links"])
        assert result["remote"]["accepted"] == len(batch["nodes"]) + len(batch["links"])

    def test_upsert_wraps_unreachable_transport_error(self) -> None:
        self._server.shutdown()
        os.environ["ATOMSPACE_URL"] = "http://127.0.0.1:1"
        adapter = AtomSpaceAdapter()
        with pytest.raises(RuntimeError):
            adapter.upsert({"nodes": [], "links": []})


# ---------------------------------------------------------------------------
# FourE processor unit tests
# ---------------------------------------------------------------------------


class TestFourEProcessor:
    def setup_method(self) -> None:
        os.environ.pop("FOURE_MODE", None)

    def test_process_returns_summary(self) -> None:
        foure = FourE()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")
        result = foure.process(batch, mode=None, context=None)
        assert "summary" in result
        assert "processed" in result["summary"]

    def test_process_uses_provided_mode(self) -> None:
        foure = FourE()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = foure.process(batch, mode="embodied", context=None)
        assert result["mode"] == "embodied"

    def test_process_falls_back_to_default_mode(self) -> None:
        foure = FourE()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = foure.process(batch, mode=None, context=None)
        assert result["mode"] == "default"

    def test_process_uses_env_default_mode(self) -> None:
        os.environ["FOURE_MODE"] = "extended"
        foure = FourE()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = foure.process(batch, mode=None, context=None)
        assert result["mode"] == "extended"
        del os.environ["FOURE_MODE"]

    def test_process_returns_context(self) -> None:
        foure = FourE()
        ctx = {"tenant": "zone-cog", "session": "xyz"}
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = foure.process(batch, mode=None, context=ctx)
        assert result["context"]["tenant"] == "zone-cog"
        assert result["four_e"]["extended"]["context_keys"] == ["session", "tenant"]

    def test_process_empty_context_defaults_to_empty_dict(self) -> None:
        foure = FourE()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = foure.process(batch, mode=None, context=None)
        assert result["context"] == {}

    def test_process_counts_atoms_in_summary(self) -> None:
        foure = FourE()
        batch = map_rows_to_atoms(
            "dbo", "items",
            [{"id": 1, "qty": 2}, {"id": 2, "qty": 3}],
            primary_key="id",
        )
        result = foure.process(batch, mode=None, context=None)
        total_atoms = len(batch["nodes"]) + len(batch["links"])
        assert str(total_atoms) in result["summary"]
        assert result["four_e"]["embodied"]["node_count"] == len(batch["nodes"])


# ---------------------------------------------------------------------------
# HTTP endpoint tests (using FastAPI TestClient)
# ---------------------------------------------------------------------------


try:
    from fastapi.testclient import TestClient
    from azure_integration.data_studio_bridge import app as fastapi_app

    _has_fastapi = fastapi_app is not None
except Exception:
    _has_fastapi = False


@pytest.mark.skipif(not _has_fastapi, reason="FastAPI not available")
class TestFastAPIEndpoints:
    def setup_method(self) -> None:
        from azure_integration.data_studio_bridge import app as _app, app_impl
        self.client = TestClient(_app)  # type: ignore[arg-type]
        # Reset state between tests
        app_impl.processed_batches = 0
        app_impl.last_request_id = None

    def test_health_endpoint(self) -> None:
        response = self.client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "time" in data

    def test_status_endpoint_initial(self) -> None:
        response = self.client.get("/status")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["processed_batches"] == 0
        assert data["persisted"] is False

    def test_ingest_schema_endpoint(self) -> None:
        payload = {
            "tables": [
                {
                    "schema": "dbo",
                    "table": "customers",
                    "columns": [{"name": "id"}, {"name": "email"}],
                }
            ],
            "foreign_keys": [],
        }
        response = self.client.post("/ingest/schema", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["upsert"]["status"] == "ok"

    def test_ingest_schema_increments_status(self) -> None:
        payload = {"tables": [{"table": "t", "columns": []}], "foreign_keys": []}
        self.client.post("/ingest/schema", json=payload)
        status = self.client.get("/status").json()
        assert status["processed_batches"] == 1
        assert status["last_request_id"] is not None

    def test_ingest_table_endpoint(self) -> None:
        payload = {
            "schema": "dbo",
            "table": "orders",
            "primary_key": "order_id",
            "rows": [
                {"order_id": 100, "amount": 49.99, "status": "pending"},
                {"order_id": 101, "amount": 129.0, "status": "shipped"},
            ],
        }
        response = self.client.post("/ingest/table", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["upsert"]["status"] == "ok"
        assert data["upsert"]["nodes"] >= 2

    def test_ingest_atoms_endpoint(self) -> None:
        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "amount": 10}], primary_key="id")
        response = self.client.post("/ingest/atoms", json={"atoms": batch})
        assert response.status_code == 200
        data = response.json()
        assert data["upsert"]["status"] == "ok"
        assert data["upsert"]["nodes"] == len(batch["nodes"])
        assert data["upsert"]["links"] == len(batch["links"])

    def test_atoms_endpoint_reflects_ingested_data(self) -> None:
        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "amount": 10}], primary_key="id")
        self.client.post("/ingest/atoms", json={"atoms": batch})
        response = self.client.get("/atoms")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        returned_uuids = {node["uuid"] for node in data["nodes"]}
        assert {node["uuid"] for node in batch["nodes"]} <= returned_uuids
        assert len(data["nodes"]) >= len(batch["nodes"])
        assert len(data["links"]) >= len(batch["links"])

    def test_reason_endpoint(self) -> None:
        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "qty": 5}], primary_key="id")
        payload = {"atoms": batch, "mode": "default"}
        response = self.client.post("/reason", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "cognitive" in data
        assert "adapter" in data

    def test_reason_endpoint_without_mode(self) -> None:
        batch = map_rows_to_atoms("dbo", "products", [{"id": 99}], primary_key="id")
        payload = {"atoms": batch}
        response = self.client.post("/reason", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["cognitive"]["mode"] == "default"

    def test_status_reflects_multiple_operations(self) -> None:
        schema_payload = {"tables": [{"table": "a", "columns": []}], "foreign_keys": []}
        table_payload = {"schema": None, "table": "b", "primary_key": "id", "rows": [{"id": 1}]}

        self.client.post("/ingest/schema", json=schema_payload)
        self.client.post("/ingest/table", json=table_payload)

        status = self.client.get("/status").json()
        assert status["processed_batches"] == 2


@pytest.mark.skipif(not _has_fastapi, reason="FastAPI not available")
class TestFastAPIEndpointsWithPersistence:
    """Regression coverage for the exact scenario Cursor Bugbot flagged: FastAPI's
    sync route handlers execute each request in a worker threadpool, distinct
    from the thread that constructs `app_impl`/`AtomSpaceAdapter`/`SqliteAtomStore`
    at import time. Real HTTP requests (not direct in-process calls) must
    round-trip through persistence without raising."""

    def setup_method(self) -> None:
        import azure_integration.data_studio_bridge as bridge_module

        self.bridge_module = bridge_module
        self._original_app_impl = bridge_module.app_impl

    def teardown_method(self) -> None:
        self.bridge_module.app_impl = self._original_app_impl
        os.environ.pop("ATOMSPACE_PERSIST_PATH", None)

    def test_ingest_and_list_atoms_over_http_with_persistence_enabled(self, tmp_path: Any) -> None:
        os.environ["ATOMSPACE_PERSIST_PATH"] = str(tmp_path / "atoms.db")
        self.bridge_module.app_impl = self.bridge_module.BridgeApp()
        client = TestClient(self.bridge_module.app)  # type: ignore[arg-type]

        batch = map_rows_to_atoms("dbo", "orders", [{"id": 1, "amount": 10}], primary_key="id")
        ingest_response = client.post("/ingest/atoms", json={"atoms": batch})
        assert ingest_response.status_code == 200
        assert ingest_response.json()["upsert"]["persisted"] is True

        atoms_response = client.get("/atoms")
        assert atoms_response.status_code == 200
        assert atoms_response.json()["persisted"] is True

        status_response = client.get("/status")
        assert status_response.json()["persisted"] is True

        health_response = client.get("/health")
        assert "persist" in health_response.json()["capabilities"]
