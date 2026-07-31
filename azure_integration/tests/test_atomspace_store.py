"""Tests for the SQLite-backed AtomSpace persistence store."""
from __future__ import annotations

import os

from azure_integration.atomspace_store import SqliteAtomStore


class TestSqliteAtomStore:
    def test_new_store_loads_empty(self, tmp_path: "os.PathLike[str]") -> None:
        store = SqliteAtomStore(str(tmp_path / "atoms.db"))
        nodes, links = store.load_all()
        assert nodes == {}
        assert links == {}
        store.close()

    def test_upsert_and_reload_nodes(self, tmp_path: "os.PathLike[str]") -> None:
        path = str(tmp_path / "atoms.db")
        store = SqliteAtomStore(path)
        store.upsert_nodes([{"uuid": "n1", "node_type": "TableNode", "content": "users"}])
        store.close()

        reopened = SqliteAtomStore(path)
        nodes, links = reopened.load_all()
        assert nodes == {"n1": {"uuid": "n1", "node_type": "TableNode", "content": "users"}}
        assert links == {}
        reopened.close()

    def test_upsert_and_reload_links(self, tmp_path: "os.PathLike[str]") -> None:
        path = str(tmp_path / "atoms.db")
        store = SqliteAtomStore(path)
        store.upsert_links([{"uuid": "l1", "link_type": "ForeignKeyLink", "out": ["n1", "n2"]}])
        store.close()

        reopened = SqliteAtomStore(path)
        _, links = reopened.load_all()
        assert links == {"l1": {"uuid": "l1", "link_type": "ForeignKeyLink", "out": ["n1", "n2"]}}
        reopened.close()

    def test_upsert_overwrites_existing_uuid(self, tmp_path: "os.PathLike[str]") -> None:
        path = str(tmp_path / "atoms.db")
        store = SqliteAtomStore(path)
        store.upsert_nodes([{"uuid": "n1", "content": "v1"}])
        store.upsert_nodes([{"uuid": "n1", "content": "v2"}])
        nodes, _ = store.load_all()
        assert nodes["n1"]["content"] == "v2"
        store.close()

    def test_upsert_empty_iterable_is_a_noop(self, tmp_path: "os.PathLike[str]") -> None:
        path = str(tmp_path / "atoms.db")
        store = SqliteAtomStore(path)
        store.upsert_nodes([])
        store.upsert_links([])
        nodes, links = store.load_all()
        assert nodes == {}
        assert links == {}
        store.close()

    def test_persists_across_multiple_sessions(self, tmp_path: "os.PathLike[str]") -> None:
        path = str(tmp_path / "atoms.db")

        store1 = SqliteAtomStore(path)
        store1.upsert_nodes([{"uuid": "n1", "content": "a"}])
        store1.close()

        store2 = SqliteAtomStore(path)
        store2.upsert_nodes([{"uuid": "n2", "content": "b"}])
        store2.close()

        store3 = SqliteAtomStore(path)
        nodes, _ = store3.load_all()
        assert set(nodes) == {"n1", "n2"}
        store3.close()
