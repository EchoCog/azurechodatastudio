from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union


Atom = Dict[str, Any]
AtomBatch = Dict[str, List[Atom]]


def stable_id(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def table_node_id(schema: Optional[str], table: str) -> str:
    if schema:
        return f"{schema}.{table}"
    return table


def column_node_id(schema: Optional[str], table: str, column: str) -> str:
    return f"{table_node_id(schema, table)}.{column}"


def row_node_id(schema: Optional[str], table: str, pk_values: Union[str, Tuple[Any, ...], List[Any]]) -> str:
    if isinstance(pk_values, (list, tuple)):
        joined = "|".join(str(v) for v in pk_values)
    else:
        joined = str(pk_values)
    return f"{table_node_id(schema, table)}:{joined}"


def value_node_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, (int, float, bool)):
        return str(value)
    return str(value)


def make_node(node_type: str, name: str) -> Atom:
    return {"type": "Node", "node_type": node_type, "name": name, "uuid": stable_id(f"{node_type}:{name}")}


def make_link(link_type: str, out: List[str]) -> Atom:
    return {"type": "Link", "link_type": link_type, "out": out, "uuid": stable_id(f"{link_type}:{'|'.join(out)}")}


def map_schema_to_atoms(
    tables: Iterable[Dict[str, Any]],
    foreign_keys: Iterable[Dict[str, Any]],
) -> AtomBatch:
    nodes: List[Atom] = []
    links: List[Atom] = []

    for t in tables:
        schema = t.get("schema")
        table = t["table"]
        cols: List[Dict[str, Any]] = t.get("columns", [])
        tn = table_node_id(schema, table)
        nodes.append(make_node("TableNode", tn))
        for c in cols:
            cn = column_node_id(schema, table, c["name"])
            nodes.append(make_node("ColumnNode", cn))

    for fk in foreign_keys:
        src_schema = fk.get("src_schema")
        src_table = fk["src_table"]
        src_cols = fk["src_columns"]
        dst_schema = fk.get("dst_schema")
        dst_table = fk["dst_table"]
        dst_cols = fk["dst_columns"]
        src_tn = table_node_id(src_schema, src_table)
        dst_tn = table_node_id(dst_schema, dst_table)
        src_cols_ids = [column_node_id(src_schema, src_table, c) for c in src_cols]
        dst_cols_ids = [column_node_id(dst_schema, dst_table, c) for c in dst_cols]
        link_out = [make_node("TableNode", src_tn)["uuid"], make_node("TableNode", dst_tn)["uuid"]]
        link_out.extend(stable_id(x) for x in src_cols_ids)
        link_out.extend(stable_id(x) for x in dst_cols_ids)
        links.append(make_link("ForeignKeyLink", link_out))

    return {"nodes": dedupe(nodes), "links": dedupe(links)}


def map_rows_to_atoms(
    schema: Optional[str],
    table: str,
    rows: Iterable[Dict[str, Any]],
    primary_key: Union[str, List[str], Tuple[str, ...]],
) -> AtomBatch:
    nodes: List[Atom] = []
    links: List[Atom] = []
    tn = table_node_id(schema, table)
    t_uuid = make_node("TableNode", tn)["uuid"]

    if isinstance(primary_key, str):
        pk_cols = [primary_key]
    else:
        pk_cols = list(primary_key)

    for row in rows:
        pk_values = tuple(row[c] for c in pk_cols)
        rn = row_node_id(schema, table, pk_values)
        r_uuid = make_node("RowNode", rn)["uuid"]
        links.append(make_link("MemberLink", [r_uuid, t_uuid]))
        for col, val in row.items():
            cn = column_node_id(schema, table, col)
            c_uuid = make_node("ColumnNode", cn)["uuid"]
            vv = value_node_value(val)
            v_uuid = make_node("ValueNode", vv)["uuid"]
            links.append(make_link("EvaluationLink", [r_uuid, c_uuid, v_uuid]))

    return {"nodes": dedupe(nodes), "links": dedupe(links)}


def dedupe(atoms: List[Atom]) -> List[Atom]:
    seen = set()
    out: List[Atom] = []
    for a in atoms:
        k = a["uuid"]
        if k in seen:
            continue
        seen.add(k)
        out.append(a)
    return out


def to_json(batch: AtomBatch) -> str:
    return json.dumps(batch, separators=(",", ":"), sort_keys=True)


def merge_batches(batches: Iterable[AtomBatch]) -> AtomBatch:
    nodes: List[Atom] = []
    links: List[Atom] = []
    for b in batches:
        nodes.extend(b.get("nodes", []))
        links.extend(b.get("links", []))
    return {"nodes": dedupe(nodes), "links": dedupe(links)}
