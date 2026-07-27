# ZoneCog Python Bridge — Standalone Cognitive Service

The `azure_integration` package is the Python side of the ZoneCog cognitive
protocol: it maps SQL schemas/rows into AtomSpace-style Node/Link atoms and
runs the 4E cognitive pipeline (`data_studio_bridge.py`, `sql_to_atomspace.py`,
`atomspace_transport.py`). It has no Azure Data Studio or Node.js dependency —
only `fastapi`, `uvicorn`, and `pydantic` — so it runs standalone (Phase 5.2 of
`docs/ZONECOG_ROADMAP.md`).

## Running as an HTTP service

```bash
pip install -r azure_integration/requirements.txt
python -m azure_integration.cli serve   # or: python -m azure_integration.data_studio_bridge
```

Reads `HOST` (default `0.0.0.0` in Docker, `127.0.0.1` otherwise), `PORT`
(default `7807`), `ATOMSPACE_MODE` (`mock` or `http`), and `ATOMSPACE_URL`
from the environment. Endpoints: `GET /health`, `GET /status`,
`POST /ingest/schema`, `POST /ingest/table`, `POST /ingest/atoms`,
`POST /reason`.

## Headless CLI

For scripts and CI that want to drive ingestion/reasoning without standing up
the HTTP server:

```bash
python -m azure_integration.cli health
python -m azure_integration.cli ingest-schema schema.json
python -m azure_integration.cli ingest-table table.json
python -m azure_integration.cli ingest-atoms atoms.json
python -m azure_integration.cli reason reason.json
python -m azure_integration.cli status
```

Each subcommand (other than `health`/`status`/`serve`) reads one JSON document
— from the given file path, or from stdin when omitted or passed `-` — shaped
like the matching HTTP request body, and prints the JSON result to stdout.
Non-zero exit and an `error: ...` line on stderr on bad input (missing file,
invalid JSON, failed validation). Each invocation constructs its own
`BridgeApp`, so `status`/`ingest-*` counters are per-process, not shared
across separate CLI calls the way they are across requests to a single running
`serve` instance.

If installed as a package (`pip install .` from the repo root, using the
top-level `pyproject.toml`), the same CLI is also available as the
`zonecog-bridge` console script.

## Docker

```bash
docker build -f azure_integration/Dockerfile -t zonecog-bridge .
docker run -p 7807:7807 zonecog-bridge
```

The image installs only `azure_integration/requirements.txt` and copies the
`azure_integration` package — no ADS build toolchain — and defaults to
`serve`. Override the command to run a one-off CLI invocation instead, e.g.
`docker run --rm -v "$PWD:/data" zonecog-bridge ingest-schema /data/schema.json`.

## Tests

```bash
python -m pytest azure_integration/tests/ -v --tb=short
```
