"""Real AtomSpace HTTP transport for the ZoneCog Python bridge.

`AtomSpaceAdapter` in `data_studio_bridge.py` falls back to counting atoms
in-process ("mock" mode) when no real AtomSpace backend is configured. This
module implements the "real" side: a thin HTTP client that speaks the
OpenCog REST API atom-batch convention (POST a list of Node/Link atom dicts,
as already produced by `sql_to_atomspace.py`) against a running AtomSpace
REST endpoint reachable at `ATOMSPACE_URL`.

Only the standard library is used (`urllib`) so this has no additional
runtime dependency beyond what `sql_to_atomspace.py` already requires.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

from azure_integration.sql_to_atomspace import AtomBatch


class AtomSpaceTransportError(RuntimeError):
    """Raised when a request to the real AtomSpace transport fails."""


class HttpAtomSpaceTransport:
    """HTTP client for a real AtomSpace REST backend.

    Endpoints (relative to `endpoint`):
      POST /api/v1.5/atoms  - upsert a batch of {"atoms": [Node|Link, ...]}
      POST /api/v1.5/reason - run reasoning over a batch, optional "mode"
      GET  /api/v1.5/status - liveness/status probe
    """

    def __init__(self, endpoint: str, timeout: float = 5.0) -> None:
        if not endpoint:
            raise ValueError("HttpAtomSpaceTransport requires a non-empty endpoint")
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout

    def upsert(self, batch: AtomBatch) -> Dict[str, Any]:
        atoms = list(batch.get("nodes", [])) + list(batch.get("links", []))
        remote = self._post("/api/v1.5/atoms", {"atoms": atoms})
        return {
            "status": "ok",
            "nodes": len(batch.get("nodes", [])),
            "links": len(batch.get("links", [])),
            "remote": remote,
        }

    def reason(self, batch: AtomBatch, mode: Optional[str]) -> Dict[str, Any]:
        atoms = list(batch.get("nodes", [])) + list(batch.get("links", []))
        remote = self._post("/api/v1.5/reason", {"atoms": atoms, "mode": mode or "default"})
        return {"status": "ok", "mode": mode or "default", "remote": remote}

    def health(self) -> bool:
        try:
            self._get("/api/v1.5/status")
            return True
        except AtomSpaceTransportError:
            return False

    def _post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._request(path, payload, method="POST")

    def _get(self, path: str) -> Dict[str, Any]:
        return self._request(path, None, method="GET")

    def _request(self, path: str, payload: Optional[Dict[str, Any]], method: str) -> Dict[str, Any]:
        url = f"{self.endpoint}{path}"
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            raise AtomSpaceTransportError(
                f"AtomSpace transport request to {url} failed with HTTP {exc.code}: {exc.reason}"
            ) from exc
        except urllib.error.URLError as exc:
            raise AtomSpaceTransportError(f"AtomSpace transport request to {url} failed: {exc.reason}") from exc

        if not body:
            return {}
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise AtomSpaceTransportError(f"AtomSpace transport returned invalid JSON from {url}: {exc}") from exc
