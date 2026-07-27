"""Headless CLI for the ZoneCog Python cognitive bridge (Phase 5.2).

Drives `BridgeApp` directly — the same request models and business logic
the FastAPI HTTP layer in `data_studio_bridge.py` uses — so schema/table/atom
ingestion and reasoning can run from JSON files or stdin in scripts and CI
without starting the HTTP server or depending on Azure Data Studio.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, TextIO

from azure_integration.data_studio_bridge import (
    BridgeApp,
    IngestAtomsRequest,
    IngestSchemaRequest,
    IngestTableRequest,
    ReasonRequest,
)

_INPUT_ERRORS = (OSError, ValueError, KeyError, TypeError, RuntimeError)


def _read_json(source: Optional[str]) -> Dict[str, Any]:
    if source is None or source == "-":
        return json.load(sys.stdin)
    with open(source, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(data: Any, stream: TextIO) -> None:
    json.dump(data, stream, indent=2, sort_keys=True)
    stream.write("\n")


def cmd_health(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    return app.health()


def cmd_status(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    return app.status()


def cmd_ingest_schema(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    payload = _read_json(args.input)
    return app.ingest_schema(IngestSchemaRequest(**payload))


def cmd_ingest_table(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    payload = _read_json(args.input)
    return app.ingest_table(IngestTableRequest(**payload))


def cmd_ingest_atoms(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    payload = _read_json(args.input)
    return app.ingest_atoms(IngestAtomsRequest(**payload))


def cmd_reason(app: BridgeApp, args: argparse.Namespace) -> Dict[str, Any]:
    payload = _read_json(args.input)
    return app.reason(ReasonRequest(**payload))


def _add_input_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "input",
        nargs="?",
        default=None,
        help="path to a JSON document, or '-'/omitted to read from stdin",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="zonecog-bridge",
        description=(
            "Headless CLI for the ZoneCog cognitive bridge: schema/table/atom "
            "ingestion and reasoning against the AtomSpace adapter, without "
            "requiring a running HTTP server or Azure Data Studio."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_health = sub.add_parser("health", help="report bridge liveness")
    p_health.set_defaults(func=cmd_health)

    p_status = sub.add_parser("status", help="report processed batch count and last request id")
    p_status.set_defaults(func=cmd_status)

    p_schema = sub.add_parser(
        "ingest-schema", help="ingest a {tables, foreign_keys} JSON document"
    )
    _add_input_arg(p_schema)
    p_schema.set_defaults(func=cmd_ingest_schema)

    p_table = sub.add_parser(
        "ingest-table", help="ingest a {schema, table, primary_key, rows} JSON document"
    )
    _add_input_arg(p_table)
    p_table.set_defaults(func=cmd_ingest_table)

    p_atoms = sub.add_parser(
        "ingest-atoms", help="ingest a raw {atoms: {nodes, links}} JSON document"
    )
    _add_input_arg(p_atoms)
    p_atoms.set_defaults(func=cmd_ingest_atoms)

    p_reason = sub.add_parser(
        "reason",
        help="run the 4E cognitive pipeline and AtomSpace reasoning over a {atoms, mode, context} JSON document",
    )
    _add_input_arg(p_reason)
    p_reason.set_defaults(func=cmd_reason)

    p_serve = sub.add_parser(
        "serve", help="start the FastAPI HTTP bridge server (reads HOST/PORT env vars)"
    )
    p_serve.set_defaults(func=None)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    # Resolve sys.stdout/sys.stderr at call time (not as default-argument
    # values) so test harnesses that monkeypatch/capture them still work.
    stdout = sys.stdout
    stderr = sys.stderr
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "serve":
        from azure_integration.data_studio_bridge import main as serve_main

        serve_main()
        return 0

    app = BridgeApp()
    try:
        result = args.func(app, args)
    except _INPUT_ERRORS as exc:
        print(f"error: {exc}", file=stderr)
        return 1

    _write_json(result, stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
