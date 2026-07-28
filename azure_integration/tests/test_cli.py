"""Tests for the headless ZoneCog bridge CLI (azure_integration.cli).

Covers each subcommand end-to-end through `main()` (file input, stdin input,
and error paths) plus the underlying `cmd_*` handlers against a real
`BridgeApp` instance (no HTTP layer, no mocks).
"""
from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, Dict

import pytest

from azure_integration import cli
from azure_integration.data_studio_bridge import BridgeApp


SCHEMA_DOC: Dict[str, Any] = {
    "tables": [{"schema": "dbo", "table": "Users", "columns": [{"name": "Id"}, {"name": "Name"}]}],
    "foreign_keys": [],
}

TABLE_DOC: Dict[str, Any] = {
    "schema": "dbo",
    "table": "Users",
    "primary_key": "Id",
    "rows": [{"Id": 1, "Name": "Ada"}],
}

ATOMS_DOC: Dict[str, Any] = {
    "atoms": {
        "nodes": [{"type": "Node", "node_type": "TableNode", "name": "dbo.Users", "uuid": "abc"}],
        "links": [],
    }
}

REASON_DOC: Dict[str, Any] = {"atoms": ATOMS_DOC["atoms"], "mode": "default", "context": {}}


def _write(tmp_path: Path, name: str, doc: Dict[str, Any]) -> str:
    p = tmp_path / name
    p.write_text(json.dumps(doc), encoding="utf-8")
    return str(p)


class TestCommandHandlers:
    def test_health_reports_ok(self) -> None:
        app = BridgeApp()
        result = cli.cmd_health(app, argparse_namespace())
        assert result["status"] == "ok"
        assert "time" in result

    def test_status_starts_at_zero(self) -> None:
        app = BridgeApp()
        result = cli.cmd_status(app, argparse_namespace())
        assert result == {
            "status": "ok",
            "processed_batches": 0,
            "last_request_id": None,
            "protocol_version": "1.0",
            "backend": "local",
        }

    def test_ingest_schema_from_file(self, tmp_path: Path) -> None:
        app = BridgeApp()
        path = _write(tmp_path, "schema.json", SCHEMA_DOC)
        result = cli.cmd_ingest_schema(app, argparse_namespace(input=path))
        assert result["upsert"]["nodes"] == 3  # TableNode + 2 ColumnNodes
        assert app.processed_batches == 1

    def test_ingest_table_from_file(self, tmp_path: Path) -> None:
        app = BridgeApp()
        path = _write(tmp_path, "table.json", TABLE_DOC)
        result = cli.cmd_ingest_table(app, argparse_namespace(input=path))
        assert result["upsert"]["status"] == "ok"
        assert app.processed_batches == 1

    def test_ingest_atoms_from_file(self, tmp_path: Path) -> None:
        app = BridgeApp()
        path = _write(tmp_path, "atoms.json", ATOMS_DOC)
        result = cli.cmd_ingest_atoms(app, argparse_namespace(input=path))
        assert result["upsert"]["nodes"] == 1
        assert result["upsert"]["links"] == 0

    def test_reason_from_file(self, tmp_path: Path) -> None:
        app = BridgeApp()
        path = _write(tmp_path, "reason.json", REASON_DOC)
        result = cli.cmd_reason(app, argparse_namespace(input=path))
        assert result["cognitive"]["mode"] == "default"
        assert result["adapter"]["status"] == "ok"


class TestMainEndToEnd:
    def test_health_via_main(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = cli.main(["health"])
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["status"] == "ok"

    def test_ingest_schema_via_main_with_file(self, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
        path = _write(tmp_path, "schema.json", SCHEMA_DOC)
        rc = cli.main(["ingest-schema", path])
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["upsert"]["nodes"] == 3

    def test_ingest_atoms_via_main_with_stdin(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(ATOMS_DOC)))
        rc = cli.main(["ingest-atoms"])
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["upsert"]["nodes"] == 1

    def test_ingest_atoms_via_main_with_explicit_dash(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(ATOMS_DOC)))
        rc = cli.main(["ingest-atoms", "-"])
        assert rc == 0

    def test_status_reflects_prior_processed_batches_within_one_process(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Each `main()` call constructs a fresh BridgeApp, so status is
        # necessarily per-invocation for the CLI (unlike the long-lived HTTP
        # server); assert that invariant rather than cross-call state.
        rc = cli.main(["status"])
        assert rc == 0
        out = json.loads(capsys.readouterr().out)
        assert out["processed_batches"] == 0

    def test_missing_file_reports_error_and_nonzero_exit(self, capsys: pytest.CaptureFixture[str]) -> None:
        rc = cli.main(["ingest-schema", "/nonexistent/path/schema.json"])
        assert rc == 1
        captured = capsys.readouterr()
        assert captured.out == ""
        assert "error:" in captured.err

    def test_invalid_json_reports_error_and_nonzero_exit(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        path = tmp_path / "bad.json"
        path.write_text("{not valid json", encoding="utf-8")
        rc = cli.main(["ingest-schema", str(path)])
        assert rc == 1
        assert "error:" in capsys.readouterr().err

    def test_missing_required_field_reports_error_and_nonzero_exit(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # ingest-table requires "table" and "primary_key"; this doc has neither.
        path = _write(tmp_path, "incomplete_table.json", {"schema": "dbo", "rows": []})
        rc = cli.main(["ingest-table", path])
        assert rc == 1
        assert "error:" in capsys.readouterr().err

    def test_no_command_exits_nonzero(self) -> None:
        with pytest.raises(SystemExit):
            cli.main([])


class TestParser:
    def test_all_subcommands_registered(self) -> None:
        parser = cli.build_parser()
        subparsers_action = next(
            a for a in parser._subparsers._group_actions if hasattr(a, "choices")  # type: ignore[attr-defined]
        )
        assert set(subparsers_action.choices) == {  # type: ignore[attr-defined]
            "health",
            "status",
            "ingest-schema",
            "ingest-table",
            "ingest-atoms",
            "reason",
            "serve",
        }

    def test_input_defaults_to_none(self) -> None:
        parser = cli.build_parser()
        args = parser.parse_args(["ingest-atoms"])
        assert args.input is None


def argparse_namespace(**kwargs: Any) -> Any:
    from argparse import Namespace

    return Namespace(**kwargs)
