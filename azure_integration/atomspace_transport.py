"""Real AtomSpace HTTP transport for the ZoneCog Python bridge.

`AtomSpaceAdapter` in `data_studio_bridge.py` maintains an in-process graph
when no remote AtomSpace backend is configured. This module implements the
remote side: a thin HTTP client that speaks the
OpenCog REST API atom-batch convention (POST a list of Node/Link atom dicts,
as already produced by `sql_to_atomspace.py`) against a running AtomSpace
REST endpoint reachable at `ATOMSPACE_URL`.

Phase B.4 additions:
  * bidirectional sync (`fetch_atoms` / `fetch_all_atoms` / `sync`),
  * incremental delta updates (`AtomDeltaTracker` - only new or changed
    atoms are re-sent),
  * AtomSpace-native reasoning via REST (`reason_native` - URE/PLN rule
    execution on the remote AtomSpace itself),
  * distributed query federation across multiple remote AtomSpaces
    (`FederatedAtomSpaceClient`).

Only the standard library is used (`urllib`) so this has no additional
runtime dependency beyond what `sql_to_atomspace.py` already requires.
"""
from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union

from azure_integration.sql_to_atomspace import AtomBatch


class AtomSpaceTransportError(RuntimeError):
    """Raised when a request to the real AtomSpace transport fails."""


def _canonical_fingerprint(atom: Dict[str, Any]) -> str:
    """Stable sha1 fingerprint of an atom's canonical JSON representation."""
    canonical = json.dumps(atom, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha1(canonical.encode("utf-8")).hexdigest()


def _atom_key(atom: Dict[str, Any], fingerprint: str) -> str:
    """Identity key for delta tracking / deduplication: uuid when present."""
    uuid = atom.get("uuid")
    return str(uuid) if uuid else f"fp:{fingerprint}"


class AtomDeltaTracker:
    """Tracks atom fingerprints so syncs only transmit new or changed atoms.

    Atoms are keyed by their `uuid` (stable ids from `sql_to_atomspace`).
    An atom is part of the delta when its key is unknown or its canonical
    fingerprint differs from the last synced state. Atoms without a uuid
    are keyed by fingerprint, so they are re-sent only when their content
    changes.
    """

    def __init__(self) -> None:
        self._fingerprints: Dict[str, str] = {}

    def compute_delta(self, batch: AtomBatch) -> AtomBatch:
        """Return the sub-batch of atoms that are new or changed since the
        last `mark_synced`. Does not mutate tracker state."""
        delta: AtomBatch = {"nodes": [], "links": []}
        for kind in ("nodes", "links"):
            for atom in batch.get(kind, []):
                fingerprint = _canonical_fingerprint(atom)
                if self._fingerprints.get(_atom_key(atom, fingerprint)) != fingerprint:
                    delta[kind].append(atom)
        return delta

    def mark_synced(self, batch: AtomBatch) -> None:
        """Record the given atoms as synced at their current content."""
        for kind in ("nodes", "links"):
            for atom in batch.get(kind, []):
                fingerprint = _canonical_fingerprint(atom)
                self._fingerprints[_atom_key(atom, fingerprint)] = fingerprint

    def forget(self, key: str) -> bool:
        """Drop one tracked atom (it will be re-sent on the next sync)."""
        return self._fingerprints.pop(str(key), None) is not None

    def reset(self) -> None:
        self._fingerprints.clear()

    @property
    def tracked_count(self) -> int:
        return len(self._fingerprints)


class HttpAtomSpaceTransport:
    """HTTP client for a real AtomSpace REST backend.

    Endpoints (relative to `endpoint`):
      POST /api/v1.5/atoms  - upsert a batch of {"atoms": [Node|Link, ...]}
      GET  /api/v1.5/atoms  - paged atom retrieval (?cursor=&limit=)
      POST /api/v1.5/query  - pattern-match query (BindLink/GetLink style)
      POST /api/v1.5/reason - run reasoning over a batch, optional "mode";
                              with "native": true the remote AtomSpace runs
                              its own URE/PLN rules server-side
      GET  /api/v1.5/status - liveness/status probe
    """

    def __init__(self, endpoint: str, timeout: float = 5.0) -> None:
        if not endpoint:
            raise ValueError("HttpAtomSpaceTransport requires a non-empty endpoint")
        self.endpoint = endpoint.rstrip("/")
        self.timeout = timeout
        self.delta_tracker = AtomDeltaTracker()

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

    def reason_native(
        self,
        rules: Sequence[str],
        batch: Optional[AtomBatch] = None,
        mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run AtomSpace-native reasoning on the remote backend.

        Unlike `reason` (which ships atoms for the bridge to reason about),
        this asks the remote AtomSpace to execute its own rule engine
        (URE/PLN) server-side over the named `rules`, optionally seeding it
        with a batch of atoms first.
        """
        if not rules:
            raise ValueError("reason_native requires at least one rule name")
        atoms: List[Dict[str, Any]] = []
        if batch:
            atoms = list(batch.get("nodes", [])) + list(batch.get("links", []))
        payload = {
            "native": True,
            "rules": list(rules),
            "mode": mode or "ure",
            "atoms": atoms,
        }
        remote = self._post("/api/v1.5/reason", payload)
        return {"status": "ok", "mode": payload["mode"], "native": True, "remote": remote}

    def query(self, pattern: Dict[str, Any], kind: str = "bind") -> Dict[str, Any]:
        """Run a pattern-match query (BindLink/GetLink style) remotely.

        `pattern` is a JSON-serializable pattern description; `kind` selects
        GetLink semantics ("get" - bindings only) or BindLink semantics
        ("bind" - instantiate results server-side).
        """
        if kind not in ("bind", "get"):
            raise ValueError(f"query kind must be 'bind' or 'get', got {kind!r}")
        remote = self._post("/api/v1.5/query", {"pattern": pattern, "kind": kind})
        results = remote.get("results") or []
        return {"status": "ok", "kind": kind, "results": list(results), "remote": remote}

    def fetch_atoms(self, cursor: Optional[str] = None, limit: Optional[int] = None) -> Dict[str, Any]:
        """Fetch one page of atoms from the remote AtomSpace.

        Returns {"atoms": [...], "next_cursor": str | None, "remote": raw}.
        Accepts both native pagination responses ({"atoms", "next_cursor"})
        and bridge-shaped snapshots ({"nodes", "links"}).
        """
        params: Dict[str, str] = {}
        if cursor:
            params["cursor"] = str(cursor)
        if limit is not None:
            params["limit"] = str(int(limit))
        path = "/api/v1.5/atoms"
        if params:
            path = f"{path}?{urllib.parse.urlencode(params)}"
        remote = self._get(path)
        if "atoms" in remote:
            atoms = list(remote.get("atoms") or [])
        else:
            atoms = list(remote.get("nodes") or []) + list(remote.get("links") or [])
        next_cursor = remote.get("next_cursor")
        return {"atoms": atoms, "next_cursor": next_cursor, "remote": remote}

    def fetch_all_atoms(
        self,
        page_size: Optional[int] = None,
        max_pages: int = 1000,
    ) -> List[Dict[str, Any]]:
        """Fetch every atom from the remote AtomSpace, walking pagination."""
        atoms: List[Dict[str, Any]] = []
        cursor: Optional[str] = None
        for _ in range(max_pages):
            page = self.fetch_atoms(cursor=cursor, limit=page_size)
            atoms.extend(page["atoms"])
            cursor = page["next_cursor"]
            if not cursor:
                return atoms
        raise AtomSpaceTransportError(
            f"fetch_all_atoms exceeded {max_pages} pages from {self.endpoint} - aborting"
        )

    def sync(
        self,
        batch: AtomBatch,
        pull: bool = True,
        page_size: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Bidirectional incremental sync with the remote AtomSpace.

        Pushes only the delta (atoms new or changed since the last sync,
        per `AtomDeltaTracker`), then optionally pulls the remote atom set.
        Returns push/pull counts and the pulled atoms.
        """
        delta = self.delta_tracker.compute_delta(batch)
        pushed_nodes = len(delta["nodes"])
        pushed_links = len(delta["links"])
        if pushed_nodes or pushed_links:
            self.upsert(delta)
        # Only mark atoms synced after a successful push (upsert raises on failure).
        self.delta_tracker.mark_synced(delta)
        pulled_atoms: List[Dict[str, Any]] = []
        if pull:
            pulled_atoms = self.fetch_all_atoms(page_size=page_size)
        return {
            "status": "ok",
            "pushed": {"nodes": pushed_nodes, "links": pushed_links},
            "pulled": len(pulled_atoms),
            "atoms": pulled_atoms,
        }

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


class FederatedAtomSpaceClient:
    """Federates queries and syncs across multiple remote AtomSpaces.

    Fan-out reads (`query`, `fetch_all`) deduplicate atoms by uuid while
    recording per-endpoint provenance and errors; fan-out writes
    (`upsert_all`) report per-endpoint outcomes. A partial failure never
    hides results from healthy endpoints.
    """

    def __init__(
        self,
        endpoints: Iterable[Union[str, HttpAtomSpaceTransport]],
        timeout: float = 5.0,
    ) -> None:
        transports: List[HttpAtomSpaceTransport] = []
        for entry in endpoints:
            if isinstance(entry, HttpAtomSpaceTransport):
                transports.append(entry)
            else:
                transports.append(HttpAtomSpaceTransport(str(entry), timeout=timeout))
        if not transports:
            raise ValueError("FederatedAtomSpaceClient requires at least one endpoint")
        self.transports = transports

    def health_map(self) -> Dict[str, bool]:
        """Probe every federated endpoint; never raises."""
        return {transport.endpoint: transport.health() for transport in self.transports}

    def query(self, pattern: Dict[str, Any], kind: str = "bind") -> Dict[str, Any]:
        """Fan a pattern-match query out to every endpoint and merge results.

        Results are deduplicated by uuid (canonical fingerprint when absent);
        `sources` records how many unique results each endpoint contributed
        and `errors` records unreachable/failed endpoints.
        """
        results: List[Dict[str, Any]] = []
        sources: Dict[str, int] = {}
        errors: Dict[str, str] = {}
        seen: set = set()
        if kind not in ("bind", "get"):
            raise ValueError(f"query kind must be 'bind' or 'get', got {kind!r}")
        for transport in self.transports:
            try:
                response = transport.query(pattern, kind=kind)
            except AtomSpaceTransportError as exc:
                errors[transport.endpoint] = str(exc)
                continue
            contributed = 0
            for item in response["results"]:
                key = self._dedupe_key(item)
                if key in seen:
                    continue
                seen.add(key)
                results.append(item)
                contributed += 1
            sources[transport.endpoint] = contributed
        return {
            "status": self._federated_status(len(sources)),
            "kind": kind,
            "results": results,
            "sources": sources,
            "errors": errors,
        }

    def fetch_all(self, page_size: Optional[int] = None) -> Dict[str, Any]:
        """Fetch and merge the atom sets of every federated AtomSpace."""
        atoms: List[Dict[str, Any]] = []
        sources: Dict[str, int] = {}
        errors: Dict[str, str] = {}
        seen: set = set()
        for transport in self.transports:
            try:
                fetched = transport.fetch_all_atoms(page_size=page_size)
            except AtomSpaceTransportError as exc:
                errors[transport.endpoint] = str(exc)
                continue
            contributed = 0
            for atom in fetched:
                key = self._dedupe_key(atom)
                if key in seen:
                    continue
                seen.add(key)
                atoms.append(atom)
                contributed += 1
            sources[transport.endpoint] = contributed
        return {
            "status": self._federated_status(len(sources)),
            "atoms": atoms,
            "sources": sources,
            "errors": errors,
        }

    def upsert_all(self, batch: AtomBatch) -> Dict[str, Any]:
        """Push a batch to every federated AtomSpace, reporting per-endpoint outcomes."""
        outcomes: Dict[str, Dict[str, Any]] = {}
        errors: Dict[str, str] = {}
        for transport in self.transports:
            try:
                outcomes[transport.endpoint] = transport.upsert(batch)
            except AtomSpaceTransportError as exc:
                errors[transport.endpoint] = str(exc)
        return {
            "status": self._federated_status(len(outcomes)),
            "outcomes": outcomes,
            "errors": errors,
        }

    def _federated_status(self, successes: int) -> str:
        if successes == len(self.transports):
            return "ok"
        return "partial" if successes > 0 else "error"

    @staticmethod
    def _dedupe_key(item: Any) -> str:
        if isinstance(item, dict):
            fingerprint = _canonical_fingerprint(item)
            return _atom_key(item, fingerprint)
        return json.dumps(item, sort_keys=True, default=str)
