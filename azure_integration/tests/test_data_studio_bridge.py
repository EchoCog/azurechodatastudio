"""Tests for the Azure Data Studio ZoneCog bridge application.

Covers:
- Health endpoint
- Schema ingestion → AtomSpace upsert
- Table row ingestion → AtomSpace upsert
- Reasoning endpoint (4E cognitive pipeline)
- Status tracking across multiple requests
- BridgeApp business logic in isolation (no HTTP layer)
- AtomSpaceAdapter mock / NotImplementedError paths
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


class TestBridgeAppStatus:
    def test_initial_status(self) -> None:
        bridge = BridgeApp()
        result = bridge.status()
        assert result["status"] == "ok"
        assert result["processed_batches"] == 0
        assert result["last_request_id"] is None

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


# ---------------------------------------------------------------------------
# AtomSpaceAdapter unit tests
# ---------------------------------------------------------------------------


class TestAtomSpaceAdapterMock:
    def setup_method(self) -> None:
        os.environ.pop("ATOMSPACE_URL", None)
        os.environ["ATOMSPACE_MODE"] = "mock"

    def test_upsert_counts_nodes_and_links(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1, "x": 10}], primary_key="id")
        result = adapter.upsert(batch)
        assert result["status"] == "ok"
        assert result["nodes"] == len(batch["nodes"])
        assert result["links"] == len(batch["links"])

    def test_upsert_empty_batch(self) -> None:
        adapter = AtomSpaceAdapter()
        result = adapter.upsert({"nodes": [], "links": []})
        assert result["status"] == "ok"
        assert result["nodes"] == 0
        assert result["links"] == 0

    def test_reason_returns_insight(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_schema_to_atoms([{"table": "t", "columns": []}], [])
        result = adapter.reason(batch, mode="default")
        assert result["status"] == "ok"
        assert "insight" in result

    def test_reason_without_mode(self) -> None:
        adapter = AtomSpaceAdapter()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        result = adapter.reason(batch, mode=None)
        assert result["mode"] == "default"


class TestAtomSpaceAdapterNotImplemented:
    def setup_method(self) -> None:
        os.environ["ATOMSPACE_MODE"] = "real"
        os.environ["ATOMSPACE_URL"] = "http://localhost:17001"

    def teardown_method(self) -> None:
        os.environ.pop("ATOMSPACE_MODE", None)
        os.environ.pop("ATOMSPACE_URL", None)

    def test_upsert_raises_not_implemented(self) -> None:
        adapter = AtomSpaceAdapter()
        batch = map_rows_to_atoms("dbo", "t", [{"id": 1}], primary_key="id")
        with pytest.raises(NotImplementedError):
            adapter.upsert(batch)

    def test_reason_raises_not_implemented(self) -> None:
        adapter = AtomSpaceAdapter()
        batch: Dict[str, Any] = {"nodes": [], "links": []}
        with pytest.raises(NotImplementedError):
            adapter.reason(batch, mode=None)


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
