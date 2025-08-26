# ECH-2: Azure Data Studio ↔ ZoneCog/AtomSpace “Embodied Cognition Workbench” Integration Design

Author: Devin AI (@devin) for d@rzo.io (@drzo)
Repo: EchoCog/azurechodatastudio
Ticket: ECH-2

1) Fork vs. Plugin (given ADS retirement)
- Context
  - Azure Data Studio (ADS) will be retired Feb 28, 2026. See README banner in this fork.
  - ADS is largely VS Code-based. Extensions are broadly VS Code-compatible but use azdata/mssql APIs.
- Decision
  - Plugin-first extension surface inside the existing Zone-Cog fork, keeping fork deltas minimal. Implement contributions/commands using the standard extension/service patterns already present in this fork.
  - Sidecar bridge for AtomSpace connectivity implemented as a separate local HTTP service to avoid coupling to ADS core.
  - Maintain VS Code compatibility where possible to ease post-ADS migration.
- Rationale
  - Minimizes long-lived maintenance of the fork and keeps features portable to VS Code-based targets.
  - Decouples cognitive back end from the ADS runtime—replaceable and testable independently.
- Risks and mitigations
  - ADS deprecation: Keep the extension surface pure VS Code API where feasible. Abstract ADS-specific APIs.
  - Fork drift: Avoid modifying core except for minimal service hooks; prefer extension contributions and configuration.

2) AtomSpace ↔ SQL Mapping Strategy
- Objectives
  - Represent relational structure and instances as a hypergraph suitable for AtomSpace reasoning.
  - Enable deterministic, idempotent updates to support synchronization.
- Canonical mapping
  - Nodes
    - TableNode: unique id “schema.table”
    - RowNode: unique id “schema.table:pkValue” (composite keys join values by “|”)
    - ColumnNode: unique id “schema.table.column”
    - ValueNode: serialized literal value, optionally typed
  - Links
    - MemberLink: (RowNode r) → (TableNode t)
    - EvaluationLink: predicate “hasColumnValue” over (RowNode r, ColumnNode c, ValueNode v)
    - ReferenceLink: (RowNode child) → (RowNode parent) for foreign keys
- Practical encoding
  - Bridge emits a JSON hypergraph (atoms) that can be sent to AtomSpace via an adapter.
  - Batch-friendly format with stable IDs to allow upsert semantics.

3) Depth of Cognitive Integration in ADS
- Phase 1 (this ticket)
  - Data ingestion: schema/table ingestion commands.
  - Basic reasoning hook: pass selected context or atom batches to the 4E pipeline entry point for a response.
  - Status/health checks surfaced via commands.
- Phase 2 (future)
  - Pattern mining, rule evaluation (URE/PLN) against ingested atoms.
  - Visual cognitive maps and interactive exploration inside ADS.
  - Collaborative cognitive spaces and advanced LLM integrations.
- Boundaries
  - Keep heavy cognition out of the ADS process; run in the bridge/remote services.

4) Data Synchronization Model
- Strategy
  - Pull-based snapshot ingestion with optional incremental updates.
  - Use rowversion/updated_at if available; otherwise keyset pagination for large tables.
  - Idempotent upserts keyed by stable RowNode IDs.
- Process
  - Schema ingest: enumerate tables/columns/constraints and emit TableNode/ColumnNode and FK ReferenceLinks.
  - Table ingest: page through rows, produce MemberLinks and EvaluationLinks; optionally only changed rows since a watermark.
- Consistency and failure
  - Batches, retries with exponential backoff in the adapter to AtomSpace.
  - Partial failures return a structured report with retry hints.

5) Extension Architecture
- Components
  - ADS Zone-Cog Service client (TypeScript): talks to local sidecar over HTTP (default http://127.0.0.1:7807).
  - Python sidecar bridge:
    - Endpoint: /health, /ingest/schema, /ingest/table, /reason, /status
    - Uses a pluggable AtomSpace adapter (REST, CogServer, mock).
    - Uses a pluggable DB adapter (ODBC, SQL Server, Postgres, etc.) for schema/row retrieval.
  - Configuration:
    - ADS settings or environment vars for bridge base URL, auth token, batch sizes.
- UI
  - Command Palette entries:
    - Zone-Cog: Ingest Current Database Schema
    - Zone-Cog: Ingest Active Table
    - Zone-Cog: Run Cognitive Analysis on Selection
  - Status view optional in future; Phase 1 uses notifications/output channel.

6) Performance Considerations and Limits
- Ingestion performance
  - Batch size defaults (e.g., 500–1000 rows) with pagination.
  - Stream-like processing in the bridge; avoid loading entire tables in memory.
  - Metadata caching; limit maximum value sizes and number of columns processed per row.
- Bridge/IPC
  - Localhost HTTP is simple and robust; enable cancellation via request timeouts.
  - Optional token header to avoid accidental cross-app calls.
- AtomSpace
  - Batch upserts with backpressure; adapter controls throughput.
  - Optionally buffer atoms and flush periodically; configurable limits.
- UI responsiveness
  - Run long operations asynchronously with progress notifications; cancelable commands.
  - Avoid blocking main thread; use promises and background tasks.

Implementation Plan Summary
- In this repo (EchoCog/azurechodatastudio)
  - Add azure-integration/data_studio_bridge.py: FastAPI app exposing REST endpoints, AtomSpace adapter abstraction, 4E hook.
  - Add azure-integration/sql_to_atomspace.py: SQL metadata and row mapping to canonical atom JSON.
  - Add TypeScript client scaffold under existing Zone-Cog service folder later to invoke the bridge (kept minimal for Phase 1).
  - Document usage in this design doc.
- In echo.dash config repo
  - Extend team_config.yaml with an azure_integration section pointing to the bridge and listing capabilities.
- Defaults
  - Bridge: 127.0.0.1:7807, JSON hypergraph payloads, mock AtomSpace adapter if a real one isn’t configured.
  - Security: disabled by default for local development; enable token if running beyond localhost.

Testing and Verification
- Bridge self-test: start server; /health returns 200; ingest endpoints accept payloads and produce mapping counts.
- Mapping unit checks: deterministic IDs for nodes/links; composite keys stable ordering.
- ADS smoke:
  - Commands visible in Command Palette.
  - Ingest Active Table posts to /ingest/table with the active connection and database/table.
  - Output channel/notifications show results and errors.
- Performance smoke:
  - Ingest a 10k row table using page_size 500; memory and latency within acceptable ranges.

Risks and Open Items
- Exact AtomSpace transport: if REST is unavailable, implement CogServer client; the adapter makes this swappable.
- DB drivers in the bridge: keep pluggable; default to limited set to avoid dependency bloat.
- ADS CI/build: ensure no build break; TS code changes kept behind feature flags and not imported until ready.

Appendix
- Files added
  - azure-integration/data_studio_bridge.py
  - azure-integration/sql_to_atomspace.py
- Referenced docs
  - README deprecation note
  - src/sql/workbench/services/zonecog/README.md
  - ZONECOG.md, ZONECOG_IMPLEMENTATION.md
