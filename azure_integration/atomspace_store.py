"""Durable local AtomSpace storage for the ZoneCog Python bridge.

`AtomSpaceAdapter` in `data_studio_bridge.py` keeps its `local`-mode atom
graph in a plain Python dict, which is lost whenever the bridge process
restarts. This module adds an optional SQLite-backed store so a standalone
bridge instance (Phase 5.2's headless/Docker deployment) can retain its
ingested atoms across restarts without any extra runtime dependency — only
the standard library `sqlite3` module is used.

Enabled by setting the `ATOMSPACE_PERSIST_PATH` environment variable to a
file path; when unset, `AtomSpaceAdapter` keeps its current in-memory-only
behavior.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Dict, Iterable, Tuple

_SCHEMA = """
CREATE TABLE IF NOT EXISTS atomspace_nodes (
    uuid TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS atomspace_links (
    uuid TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
"""


class SqliteAtomStore:
    """Persists AtomSpace node/link atoms (as JSON blobs keyed by uuid) to a
    SQLite file, so a `local`-mode `AtomSpaceAdapter` can reload its graph
    after a process restart."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._conn = sqlite3.connect(self.path, isolation_level=None)
        self._conn.executescript(_SCHEMA)

    def load_all(self) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
        nodes = {
            row[0]: json.loads(row[1])
            for row in self._conn.execute("SELECT uuid, data FROM atomspace_nodes")
        }
        links = {
            row[0]: json.loads(row[1])
            for row in self._conn.execute("SELECT uuid, data FROM atomspace_links")
        }
        return nodes, links

    def upsert_nodes(self, atoms: Iterable[Dict[str, Any]]) -> None:
        self._upsert("atomspace_nodes", atoms)

    def upsert_links(self, atoms: Iterable[Dict[str, Any]]) -> None:
        self._upsert("atomspace_links", atoms)

    def _upsert(self, table: str, atoms: Iterable[Dict[str, Any]]) -> None:
        rows = [(atom["uuid"], json.dumps(atom)) for atom in atoms]
        if not rows:
            return
        self._conn.executemany(
            f"INSERT INTO {table} (uuid, data) VALUES (?, ?) "
            "ON CONFLICT(uuid) DO UPDATE SET data = excluded.data",
            rows,
        )

    def close(self) -> None:
        self._conn.close()
