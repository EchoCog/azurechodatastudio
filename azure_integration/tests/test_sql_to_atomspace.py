import json
from azure_integration.sql_to_atomspace import (
    map_schema_to_atoms,
    map_rows_to_atoms,
    merge_batches,
)

def test_map_schema_simple():
    tables = [
        {
            "schema": "dbo",
            "table": "users",
            "columns": [{"name": "id"}, {"name": "name"}, {"name": "email"}],
        }
    ]
    foreign_keys = []
    batch = map_schema_to_atoms(tables, foreign_keys)
    uuids = {a["uuid"] for a in batch["nodes"]}
    assert len(uuids) >= 4
    assert any(n for n in batch["nodes"] if n["node_type"] == "TableNode" and n["name"] == "dbo.users")
    assert any(n for n in batch["nodes"] if n["node_type"] == "ColumnNode" and n["name"] == "dbo.users.id")

def test_map_rows_with_composite_pk_and_values():
    rows = [
        {"id": 1, "dept": "eng", "name": "Alice", "active": True},
        {"id": 2, "dept": "eng", "name": "Bob", "active": False},
    ]
    batch = map_rows_to_atoms("dbo", "employees", rows, primary_key=["id", "dept"])
    member_links = [l for l in batch["links"] if l["link_type"] == "MemberLink"]
    assert len(member_links) == 2
    eval_links = [l for l in batch["links"] if l["link_type"] == "EvaluationLink"]
    assert len(eval_links) >= len(rows) * len(rows[0])

def test_merge_batches_dedup():
    b1 = map_rows_to_atoms("dbo", "t", [{"id": 1, "x": 10}], primary_key="id")
    b2 = map_rows_to_atoms("dbo", "t", [{"id": 1, "x": 10}], primary_key="id")
    merged = merge_batches([b1, b2])
    uuids = set()
    for a in merged["links"]:
        assert a["uuid"] not in uuids
        uuids.add(a["uuid"])
