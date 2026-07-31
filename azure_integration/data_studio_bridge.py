from __future__ import annotations

import os
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel, Field
    import uvicorn
except ImportError:  # pragma: no cover
    FastAPI = None  # type: ignore
    HTTPException = Exception  # type: ignore
    BaseModel = object  # type: ignore
    Field = None  # type: ignore
    uvicorn = None  # type: ignore

from azure_integration.atomspace_store import SqliteAtomStore
from azure_integration.atomspace_transport import AtomSpaceTransportError, HttpAtomSpaceTransport
from azure_integration.sql_to_atomspace import AtomBatch, map_rows_to_atoms, map_schema_to_atoms, merge_batches

PROTOCOL_VERSION = "1.0"


class HealthResponse(BaseModel):  # type: ignore
    status: str
    time: str
    protocol_version: str
    backend: str
    capabilities: List[str]


class IngestSchemaRequest(BaseModel):  # type: ignore
    tables: List[Dict[str, Any]]
    foreign_keys: List[Dict[str, Any]] = []


class IngestAtomsRequest(BaseModel):  # type: ignore
    atoms: AtomBatch


class IngestTableRequest(BaseModel):  # type: ignore
    # Named `db_schema` to avoid shadowing Pydantic's reserved `schema`
    # attribute; the JSON/HTTP interface still uses the key "schema" via alias.
    db_schema: Optional[str] = Field(None, alias="schema")
    table: str
    primary_key: Any
    rows: List[Dict[str, Any]]

    model_config = {"populate_by_name": True}  # type: ignore[assignment]


class ReasonRequest(BaseModel):  # type: ignore
    atoms: AtomBatch
    mode: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class StatusResponse(BaseModel):  # type: ignore
    status: str
    processed_batches: int
    last_request_id: Optional[str]
    protocol_version: str
    backend: str
    persisted: bool


class AtomSpaceAdapter:
    def __init__(self) -> None:
        self.mode = os.environ.get("ATOMSPACE_MODE", "local")
        self.endpoint = os.environ.get("ATOMSPACE_URL")
        self.persist_path = os.environ.get("ATOMSPACE_PERSIST_PATH")
        self._transport: Optional[HttpAtomSpaceTransport] = None
        self._store: Optional[SqliteAtomStore] = None
        self._nodes: Dict[str, Dict[str, Any]] = {}
        self._links: Dict[str, Dict[str, Any]] = {}
        if self.mode == "http" and not self.endpoint:
            raise RuntimeError("ATOMSPACE_URL is required when ATOMSPACE_MODE=http")
        if self.mode == "http":
            assert self.endpoint is not None
            self._transport = HttpAtomSpaceTransport(self.endpoint)
        elif self.mode != "local":
            raise ValueError(f"Unsupported ATOMSPACE_MODE: {self.mode}")
        if self.mode == "local" and self.persist_path:
            self._store = SqliteAtomStore(self.persist_path)
            self._nodes, self._links = self._store.load_all()

    def upsert(self, batch: AtomBatch) -> Dict[str, Any]:
        if self.mode == "local":
            nodes = batch.get("nodes", [])
            links = batch.get("links", [])
            self._store_atoms(self._nodes, nodes, "node")
            self._store_atoms(self._links, links, "link")
            if self._store is not None:
                self._store.upsert_nodes(nodes)
                self._store.upsert_links(links)
            return {
                "status": "ok",
                "backend": "local",
                "persisted": self._store is not None,
                "nodes": len(nodes),
                "links": len(links),
                "total_nodes": len(self._nodes),
                "total_links": len(self._links),
            }
        if self.mode == "http":
            assert self._transport is not None
            try:
                return self._transport.upsert(batch)
            except AtomSpaceTransportError as exc:
                raise RuntimeError(str(exc)) from exc
        raise RuntimeError(f"Unsupported AtomSpace backend: {self.mode}")

    def reason(self, batch: AtomBatch, mode: Optional[str]) -> Dict[str, Any]:
        if self.mode == "local":
            self.upsert(batch)
            nodes = list(self._nodes.values())
            links = list(self._links.values())
            node_types = Counter(str(node.get("node_type", "Unknown")) for node in nodes)
            link_types = Counter(str(link.get("link_type", "Unknown")) for link in links)
            known_nodes = set(self._nodes)
            referenced_nodes = {
                str(node_id)
                for link in links
                for node_id in link.get("out", [])
            }
            dangling = sorted(referenced_nodes - known_nodes)
            isolated = sorted(known_nodes - referenced_nodes)
            insights = self._derive_insights(node_types, link_types, isolated, dangling)
            return {
                "status": "ok",
                "backend": "local",
                "mode": mode or "default",
                "atoms": {"nodes": len(nodes), "links": len(links)},
                "node_types": dict(sorted(node_types.items())),
                "link_types": dict(sorted(link_types.items())),
                "isolated_nodes": isolated,
                "dangling_references": dangling,
                "insights": insights,
            }
        if self.mode == "http" and self.endpoint:
            assert self._transport is not None
            try:
                return self._transport.reason(batch, mode)
            except AtomSpaceTransportError as exc:
                raise RuntimeError(str(exc)) from exc
        raise RuntimeError(f"Unsupported AtomSpace backend: {self.mode}")

    def list_atoms(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "backend": self.mode,
            "persisted": self._store is not None,
            "nodes": list(self._nodes.values()),
            "links": list(self._links.values()),
        }

    @staticmethod
    def _store_atoms(target: Dict[str, Dict[str, Any]], atoms: List[Dict[str, Any]], kind: str) -> None:
        for atom in atoms:
            atom_id = atom.get("uuid")
            if not isinstance(atom_id, str) or not atom_id:
                raise ValueError(f"Every {kind} atom must contain a non-empty uuid")
            target[atom_id] = dict(atom)

    @staticmethod
    def _derive_insights(
        node_types: Counter[str],
        link_types: Counter[str],
        isolated: List[str],
        dangling: List[str],
    ) -> List[str]:
        total_nodes = sum(node_types.values())
        total_links = sum(link_types.values())
        if total_nodes == 0 and total_links == 0:
            return ["The cognitive graph is empty; ingest schema or table atoms before analysis."]

        insights = [
            f"The graph contains {total_nodes} nodes and {total_links} links across "
            f"{len(node_types)} node types and {len(link_types)} relation types."
        ]
        foreign_keys = link_types.get("ForeignKeyLink", 0)
        if foreign_keys:
            insights.append(f"Detected {foreign_keys} schema relationship{'s' if foreign_keys != 1 else ''}.")
        if dangling:
            insights.append(f"Detected {len(dangling)} references to atoms not present in the local graph.")
        if isolated:
            insights.append(f"Detected {len(isolated)} nodes with no recorded relationships.")
        if not dangling and total_links:
            insights.append("All relation endpoints resolve to atoms in the local graph.")
        return insights


class FourE:
    def __init__(self) -> None:
        self.default_mode = os.environ.get("FOURE_MODE", "default")

    def process(self, batch: AtomBatch, mode: Optional[str], context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        m = mode or self.default_mode
        nodes = batch.get("nodes", [])
        links = batch.get("links", [])
        size = len(nodes) + len(links)
        relation_density = len(links) / max(1, len(nodes))
        node_types = sorted({str(node.get("node_type", "Unknown")) for node in nodes})
        link_types = sorted({str(link.get("link_type", "Unknown")) for link in links})
        cognitive_context = context or {}
        return {
            "mode": m,
            "summary": f"processed {size} atoms with relation density {relation_density:.3f}",
            "context": cognitive_context,
            "four_e": {
                "embodied": {"node_count": len(nodes), "link_count": len(links)},
                "embedded": {"node_types": node_types, "link_types": link_types},
                "enacted": {"available_relations": link_types},
                "extended": {"context_keys": sorted(cognitive_context)},
            },
        }


class BridgeApp:
    def __init__(self) -> None:
        self.adapter = AtomSpaceAdapter()
        self.foure = FourE()
        self.processed_batches = 0
        self.last_request_id: Optional[str] = None

    def health(self) -> Dict[str, Any]:
        capabilities = ["ingest-schema", "ingest-table", "ingest-atoms", "reason", "list-atoms"]
        if self.adapter.persist_path:
            capabilities.append("persist")
        return {
            "status": "ok",
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "protocol_version": PROTOCOL_VERSION,
            "backend": self.adapter.mode,
            "capabilities": capabilities,
        }

    def ingest_schema(self, req: IngestSchemaRequest) -> Dict[str, Any]:
        batch = map_schema_to_atoms(req.tables, req.foreign_keys)
        res = self.adapter.upsert(batch)
        self.processed_batches += 1
        self.last_request_id = str(uuid.uuid4())
        return {"upsert": res}

    def ingest_atoms(self, req: IngestAtomsRequest) -> Dict[str, Any]:
        res = self.adapter.upsert(req.atoms)
        self.processed_batches += 1
        self.last_request_id = str(uuid.uuid4())
        return {"upsert": res}

    def ingest_table(self, req: IngestTableRequest) -> Dict[str, Any]:
        batch = map_rows_to_atoms(req.db_schema, req.table, req.rows, req.primary_key)
        res = self.adapter.upsert(batch)
        self.processed_batches += 1
        self.last_request_id = str(uuid.uuid4())
        return {"upsert": res}

    def reason(self, req: ReasonRequest) -> Dict[str, Any]:
        merged = merge_batches([req.atoms])
        cog = self.foure.process(merged, req.mode, req.context)
        res = self.adapter.reason(merged, req.mode)
        self.processed_batches += 1
        self.last_request_id = str(uuid.uuid4())
        return {"cognitive": cog, "adapter": res}

    def list_atoms(self) -> Dict[str, Any]:
        return self.adapter.list_atoms()

    def status(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "processed_batches": self.processed_batches,
            "last_request_id": self.last_request_id,
            "protocol_version": PROTOCOL_VERSION,
            "backend": self.adapter.mode,
            "persisted": self.adapter.persist_path is not None,
        }


app_impl = BridgeApp()

if FastAPI:
    app = FastAPI()

    @app.get("/health", response_model=HealthResponse)  # type: ignore
    def get_health() -> Dict[str, Any]:
        return app_impl.health()

    @app.post("/ingest/schema")
    def post_ingest_schema(req: IngestSchemaRequest) -> Dict[str, Any]:
        return app_impl.ingest_schema(req)

    @app.post("/ingest/table")
    def post_ingest_table(req: IngestTableRequest) -> Dict[str, Any]:
        return app_impl.ingest_table(req)

    @app.post("/ingest/atoms")
    def post_ingest_atoms(req: IngestAtomsRequest) -> Dict[str, Any]:
        return app_impl.ingest_atoms(req)

    @app.post("/reason")
    def post_reason(req: ReasonRequest) -> Dict[str, Any]:
        return app_impl.reason(req)

    @app.get("/atoms")
    def get_atoms() -> Dict[str, Any]:
        return app_impl.list_atoms()

    @app.get("/status", response_model=StatusResponse)  # type: ignore
    def get_status() -> Dict[str, Any]:
        return app_impl.status()

    def main() -> None:
        port = int(os.environ.get("PORT", "7807"))
        host = os.environ.get("HOST", "127.0.0.1")
        if uvicorn is None:
            raise RuntimeError("uvicorn not available")
        uvicorn.run(app, host=host, port=port)

else:
    app = None

    def main() -> None:
        raise RuntimeError("FastAPI is not installed")


if __name__ == "__main__":
    main()
