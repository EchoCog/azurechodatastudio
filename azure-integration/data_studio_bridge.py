from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List, Optional

try:
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import uvicorn
except Exception:  # pragma: no cover
    FastAPI = None  # type: ignore
    HTTPException = Exception  # type: ignore
    BaseModel = object  # type: ignore
    uvicorn = None  # type: ignore

from datetime import datetime

from .sql_to_atomspace import AtomBatch, map_rows_to_atoms, map_schema_to_atoms, merge_batches


class HealthResponse(BaseModel):  # type: ignore
    status: str
    time: str


class IngestSchemaRequest(BaseModel):  # type: ignore
    tables: List[Dict[str, Any]]
    foreign_keys: List[Dict[str, Any]] = []


class IngestTableRequest(BaseModel):  # type: ignore
    schema: Optional[str] = None
    table: str
    primary_key: Any
    rows: List[Dict[str, Any]]


class ReasonRequest(BaseModel):  # type: ignore
    atoms: AtomBatch
    mode: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class StatusResponse(BaseModel):  # type: ignore
    status: str
    processed_batches: int
    last_request_id: Optional[str]


class AtomSpaceAdapter:
    def __init__(self) -> None:
        self.mode = os.environ.get("ATOMSPACE_MODE", "mock")
        self.endpoint = os.environ.get("ATOMSPACE_URL")

    def upsert(self, batch: AtomBatch) -> Dict[str, Any]:
        if self.mode == "mock" or not self.endpoint:
            nodes = len(batch.get("nodes", []))
            links = len(batch.get("links", []))
            return {"status": "ok", "nodes": nodes, "links": links}
        raise NotImplementedError("Real AtomSpace transport not configured")

    def reason(self, batch: AtomBatch, mode: Optional[str]) -> Dict[str, Any]:
        if self.mode == "mock":
            return {"status": "ok", "mode": mode or "default", "insight": "noop", "atoms": len(batch.get("links", []))}
        raise NotImplementedError("Real AtomSpace reasoning not configured")


class FourE:
    def __init__(self) -> None:
        self.default_mode = os.environ.get("FOURE_MODE", "default")

    def process(self, batch: AtomBatch, mode: Optional[str], context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        m = mode or self.default_mode
        size = len(batch.get("nodes", [])) + len(batch.get("links", []))
        return {"mode": m, "summary": f"processed {size} atoms", "context": context or {}}


class BridgeApp:
    def __init__(self) -> None:
        self.adapter = AtomSpaceAdapter()
        self.foure = FourE()
        self.processed_batches = 0
        self.last_request_id: Optional[str] = None

    def health(self) -> Dict[str, Any]:
        return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}

    def ingest_schema(self, req: IngestSchemaRequest) -> Dict[str, Any]:
        batch = map_schema_to_atoms(req.tables, req.foreign_keys)
        res = self.adapter.upsert(batch)
        self.processed_batches += 1
        self.last_request_id = str(uuid.uuid4())
        return {"upsert": res}

    def ingest_table(self, req: IngestTableRequest) -> Dict[str, Any]:
        batch = map_rows_to_atoms(req.schema, req.table, req.rows, req.primary_key)
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

    def status(self) -> Dict[str, Any]:
        return {
            "status": "ok",
            "processed_batches": self.processed_batches,
            "last_request_id": self.last_request_id,
        }


app_impl = BridgeApp()

if FastAPI:
    app = FastAPI()

    @app.post("/health", response_model=HealthResponse)  # type: ignore
    def post_health() -> Dict[str, Any]:
        return app_impl.health()

    @app.post("/ingest/schema")
    def post_ingest_schema(req: IngestSchemaRequest) -> Dict[str, Any]:
        return app_impl.ingest_schema(req)

    @app.post("/ingest/table")
    def post_ingest_table(req: IngestTableRequest) -> Dict[str, Any]:
        return app_impl.ingest_table(req)

    @app.post("/reason")
    def post_reason(req: ReasonRequest) -> Dict[str, Any]:
        return app_impl.reason(req)

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
