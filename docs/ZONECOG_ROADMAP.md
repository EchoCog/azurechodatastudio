# ZoneCog Development Roadmap

**Ticket**: ECH-4  
**Status**: Active  
**Last Updated**: 2026-07-31

## Phase Overview

| Phase | Name | Status | Focus |
|---|---|---|---|
| 1 | Foundation | Complete (ECH-2) | Basic service scaffold, bridge, extension |
| 2 | Cognitive Core | **Complete** (ECH-1/5/61) | Full protocol, hypergraph store, membrane architecture |
| 2.5 | Embodied Workbench | **Complete** (ECH-62) | Sensorimotor grounding, workspace memory, workbench actions |
| 2.6 | Test Suite | **Complete** (ECH-27) | Comprehensive tests for all agents and services |
| 3 | Intelligence Layer | **Complete** (ECH-61) | AI/LLM integration, pattern mining, reasoning, real AtomSpace transport |
| 4 | Workbench UX | **Complete** | Visual cognitive maps, interactive exploration |
| 4.5 | Release Infrastructure | **Complete** (ECH-61) | Multi-platform builds, CI/CD, quality gates |
| 5 | Post-ADS Migration | **In Progress** | VS Code standalone, portable cognitive workbench |

---

## Phase 1: Foundation (Complete)

**Ticket**: ECH-2  
**Deliverables**:
- [x] Core `ZoneCogService` with basic thinking protocol
- [x] Command Palette actions (Test, Toggle Thinking, Status)
- [x] Python sidecar bridge (FastAPI) with SQL→AtomSpace mapping
- [x] VS Code extension (`zonecog-bridge`) for bridge communication
- [x] Design document and architecture decisions
- [x] Basic unit tests for ZoneCogService

---

## Phase 2: Cognitive Core (In Progress)

**Tickets**: ECH-3, ECH-4, ECH-5  
**Goal**: Transform the scaffold into a fully functional cognitive processing engine.

### 2.1 Strategy & Planning
- [x] Implementation strategy document (`docs/ZONECOG_STRATEGY.md`)
- [x] Development roadmap with phases (`docs/ZONECOG_ROADMAP.md`)

### 2.2 Enhanced Cognitive Protocol
- [x] Full Zone-Cog thinking sequence implementation (all phases from protocol spec)
- [x] Adaptive complexity assessment with configurable thresholds
- [x] Stream-of-consciousness thinking generation
- [x] Confidence calculation with multi-factor analysis
- [x] External LLM integration hooks (`ILLMProviderService` with pluggable backends)
- [x] Progress Tracking and Recursive Thinking phases from protocol spec
- [x] Cognitive query history tracking in hypergraph store

### 2.3 Hypergraph Store
- [x] `IHypergraphStore` interface following EchoCog HypergraphNode standard
- [x] In-memory hypergraph with CRUD operations
- [x] Salience-based attention scoring
- [x] Link management (add/remove/query by type)
- [x] Persistence layer for the standalone Python bridge — `SqliteAtomStore` (`azure_integration/atomspace_store.py`), wired into `AtomSpaceAdapter`'s `local` mode via `ATOMSPACE_PERSIST_PATH`: every upsert is written through to a SQLite file and reloaded on the next process start; surfaced via `GET /atoms` / `zonecog-bridge list-atoms` and the `status.persisted` flag; the in-browser `IHypergraphStore` remains in-memory (session persistence for that side is `HypergraphPersistenceService`'s IndexedDB store, Phase 3.4)

### 2.4 Cognitive Membrane Architecture
- [x] `ICognitiveMembraneService` interface for triad management
- [x] Cerebral Triad: Core cognitive processing orchestration
- [x] Somatic Triad: Extension interaction and bridge communication tracking
- [x] Autonomic Triad: Health monitoring, error tracking, state validation
- [x] Inter-membrane event system

### 2.5 Python Bridge Improvements
- [x] Fix Copilot review issues from PR #7:
  - Use `ImportError` instead of broad `Exception` catch
  - Fix relative imports with proper package structure
  - Change `/health` to GET method
  - Fix inconsistent UUID handling in `sql_to_atomspace.py`
- [x] Add `__init__.py` for proper package structure
- [x] Add hypergraph node adapter following EchoCog standard

### 2.6 Testing
- [x] Enhanced ZoneCogService tests covering all cognitive phases
- [x] HypergraphStore unit tests
- [x] CognitiveMembraneService unit tests
- [x] Python bridge test updates

---

## Phase 2.5: Embodied Cognition Workbench (Complete)

**Ticket**: ECH-62  
**Goal**: Transform the cognitive services into an embodied cognition workbench with sensorimotor grounding, workspace memory management, and interactive workbench commands.

### 2.5.1 Embodied Cognition Service
- [x] `IEmbodiedCognitionService` interface for sensorimotor grounding
- [x] Sensory channels: schema, query, result, file, interaction perception
- [x] Motor actions: query suggestions, schema recommendations, insights, navigation, alerts
- [x] Proprioceptive state: self-monitoring of cognitive load, attentional focus, health
- [x] Environment snapshot: workspace awareness (schemas, patterns, context)
- [x] Percepts and actions persisted as hypergraph nodes with MotivatedBy links

### 2.5.2 Cognitive Workspace Service
- [x] `ICognitiveWorkspaceService` interface for memory management
- [x] Working memory: capacity-limited (7±2 chunks), relevance-decayed, eviction-based
- [x] Episodic memory: temporally indexed cognitive events with keyword search
- [x] Task contexts: goal-oriented groupings of memory and episodes
- [x] All items persisted in hypergraph store with cross-references

### 2.5.3 Streaming Thinking Protocol
- [x] `onDidCompleteThinkingPhase` event for real-time phase observation
- [x] `getQueryHistory()` accessor for session history

### 2.5.4 Workbench Command Palette Actions
- [x] Explore Hypergraph: browse/search knowledge graph by node type
- [x] Set Cognitive Focus: control attentional focus
- [x] Workspace Summary: view working memory, episodes, tasks, environment
- [x] Create Cognitive Task: create and activate goal-oriented tasks
- [x] Membrane Health: detailed P-System triad health view
- [x] Query History: view session query processing history
- [x] Reset Workbench: clear hypergraph, embodiment, and workspace state
- [x] Enhanced Status: combined cognitive, embodied, and workspace status

### 2.5.5 Testing
- [x] EmbodiedCognitionService unit tests (sensory, motor, proprioception, environment)
- [x] CognitiveWorkspaceService unit tests (working memory, episodes, tasks, reset)
- [x] Streaming phase event tests and query history tests

---

## Phase 2.6: Comprehensive Test Suite (Complete)

**Goal**: Complete unit tests for all cognitive agents and services.

### 2.6.1 Cognitive Agent Tests
- [x] SQLAnalyzerAgent unit tests (query analysis, performance issues, indexes)
- [x] SchemaReasonerAgent unit tests (schema analysis, relationships, domain inference)
- [x] PerformanceAdvisorAgent unit tests (performance analysis, anti-patterns, reports)
- [x] DataPatternAgent unit tests (patterns, anomalies, data quality)

### 2.6.2 Service Tests
- [x] CognitiveWorkflowAutomationService unit tests (workflow DSL, execution, events)
- [x] HypergraphPersistenceService unit tests (save, load, snapshots)
- [x] AAROrchestrationService unit tests (agents, arena, relations)
- [x] DTESNService unit tests (reservoir, temporal processing)
- [x] AphroditeService unit tests (LLM integration, streaming)
- [x] SchemaPerceptionService unit tests (database integration)
- [x] CognitiveLoopService unit tests (autonomous cycle)
- [x] ECANAttentionService unit tests (attention allocation)
- [x] LLMProviderService unit tests (provider management)

---

## Phase 3: Intelligence Layer (Planned)

**Goal**: Connect cognitive processing to real AI/reasoning capabilities.

### 3.1 LLM Integration
- [x] Pluggable LLM provider interface (OpenAI-compatible, local models, Aphrodite Engine)
- [x] Built-in rule-based fallback (works without API keys)
- [x] System prompt using Zone-Cog protocol for LLM-enhanced responses
- [x] Streaming thinking phase events (`onDidCompleteThinkingPhase`)
- [x] Context window management with hypergraph-based working memory
- [x] Circuit breaker pattern for resilient LLM calls (auto-recovery, half-open state)
- [x] Exponential backoff retry for transient failures
- [x] Streaming response generation with thinking tokens (real-time LLM output) — `ILLMProviderService.completeStream()` + `IZoneCogService.onDidStreamResponseToken`

### 3.2 AtomSpace Reasoning
- [x] Real AtomSpace transport — `IAtomSpaceTransportService`/`AtomSpaceTransportService` pushes the hypergraph store's nodes/links to the Python bridge's new `POST /ingest/atoms` endpoint as an AtomSpace Node/Link atom batch; the bridge's `AtomSpaceAdapter` forwards it over real HTTP via `HttpAtomSpaceTransport` (`azure_integration/atomspace_transport.py`) when `ATOMSPACE_MODE=http`/`ATOMSPACE_URL` point at a real AtomSpace REST backend, or counts in-process in the default `mock` mode
- [x] PLN (Probabilistic Logic Networks) integration for rule-based reasoning — `IPLNReasoningService`/`PLNReasoningService` (strength/confidence truth values on hypergraph links, PLN deduction formula using node salience as a prior)
- [x] URE (Unified Rule Engine) for inference chains — `PLNReasoningService.infer()` (forward-chaining deduction/inversion/similarity rules over binary directed links, iterated to a fixed point or `maxIterations`, conclusions persisted as `Inferred` hypergraph links that feed later chaining rounds)
- [x] ECAN (Economic Attention Networks) for salience-based focus — `IECANAttentionService`/`ECANAttentionService` (spreading activation, rent collection, attentional focus)

### 3.3 Pattern Mining
- [x] SQL pattern detection (query optimization, schema anomalies) — `SQLAnalyzerAgent`, `PerformanceAdvisorAgent`, `SchemaReasonerAgent`
- [x] Cross-table relationship discovery — `SchemaReasonerAgent.discoverRelationships()` (naming-convention FK inference + many-to-many junction table detection across a bare table list, independent of `analyzeSchema()`'s single-DDL-string FK parsing)
- [x] Temporal pattern analysis on data changes — `DataPatternAgent.detectPatterns()` (numeric/categorical/temporal patterns, correlation detection)
- [x] Cognitive pattern recognition in user interaction history — `EmbodiedCognitionService.detectInteractionPatterns()` (frequency, sequence, and cadence pattern mining over recorded `'interaction'`-modality percepts, persisted as `InteractionPattern` hypergraph nodes) and `IUserInteractionLearningService`/`UserInteractionLearningService` (behavioral profile, pattern mining into `UserBehaviorPattern` hypergraph nodes, Q-learning strategy selection)

### 3.4 Knowledge Graph Enhancement
- [x] Persistent hypergraph storage — `HypergraphPersistenceService` (IndexedDB, versioned schema, snapshots); a real AtomSpace-Rocks backend remains future work
- [x] Federated hypergraph queries (FlareCog integration) — `IFederatedQueryService`/`FederatedQueryService` (same-machine multi-window query federation over the `ISharedCognitionService` BroadcastChannel transport: `query()` broadcasts a keyword/type/salience filter to joined peer windows and collects per-peer matches with a timeout, `queryMerged()` dedupes by node id keeping the highest salience; a real FlareCog cross-machine federation transport remains future work)
- [x] Schema evolution tracking — `ISchemaEvolutionService`/`SchemaEvolutionService` (per-connection snapshot diffing of perceived schemas into added/removed/modified `SchemaChange` hypergraph nodes, self-wired to `ISchemaPerceptionService.onDidPerceiveSchema`)
- [x] Provenance and audit trails for cognitive decisions — `ICognitiveProvenanceService`/`CognitiveProvenanceService` (bounded audit trail, `CognitiveDecision` hypergraph nodes with `EvidencedBy` links, transitive provenance chain resolution)
- [x] Semantic (embedding-based) search over hypergraph nodes — `IHypergraphSemanticSearchService`/`HypergraphSemanticSearchService` (closes the "Embedding Support" item of the Aphrodite deep-integration plan, issue #53 §5.3: nodes and queries embedded via `IAphroditeService.embed()` when connected, deterministic local hashing-trick bag-of-words fallback otherwise; cosine-similarity ranking with lazy re-indexing on node content changes)

---

## Phase 4: Workbench UX (Complete)

**Goal**: Transform the UI into an immersive cognitive workbench.

### 4.1 Visual Cognitive Maps
- [x] Interactive hypergraph visualization — `HypergraphExplorerView` (canvas force-directed layout, nodes colored by type and sized by salience, live relayout on hypergraph changes; hand-rolled simulation, no D3/WebGL dependency)
- [x] Thinking process timeline view — `ThinkingProcessView` (ordered live phase timeline with per-phase durations)
- [x] Schema-to-cognition mapping explorer — `SchemaCognitionMapView` (per perceived table: hypergraph nodes referencing it and schema-evolution changes recorded for it)
- [x] Salience heat maps for attention visualization — `ECANAttentionView` (attention distribution bars over the most salient nodes)

### 4.2 Cognitive Panels
- [x] Dedicated ZoneCog sidebar panel — `zonecogPanel.contribution` view container (workbench panel, now 12 views; note: existed but was never imported into `workbench.common.main.ts`, so it never loaded until wired in)
- [x] Real-time thinking process display — `ThinkingProcessView` (streams `onDidCompleteThinkingPhase` phases and `onDidStreamResponseToken` tokens live, retains recent query summaries, also renders trace replays)
- [x] Cognitive state dashboard — `CognitiveStateView` + `MembraneHealthView` + `DTESNNetworkView` + `AAROrchestrationView`
- [x] Memory explorer (declarative/procedural/episodic) — `MemoryExplorerView` (episodic memory, task contexts, and declarative node-type breakdown; `WorkingMemoryView` covers working memory)

### 4.3 Natural Language Interface
- [x] Natural language query bar (beyond SQL) — `Zone-Cog: Natural Language to SQL` command (quick-input NL description → `SQLAnalyzerAgent.naturalLanguageToSQL` with perceived-schema context, result copied to clipboard) and `Zone-Cog: Explain SQL in Plain Language` (reverse direction)
- [x] Conversational data exploration — `Zone-Cog: Explore Data Conversationally` (multi-turn loop; each turn carries the running Q&A transcript and perceived-schema context to the LLM provider)
- [x] Cognitive assistant for schema design — `Zone-Cog: Schema Design Assistant` (guided DDL analysis over `SchemaReasonerAgent`: design-issue review, domain model inference, documentation generation)
- [x] Auto-generated insights from data patterns — `ICognitiveInsightsService`/`CognitiveInsightsService` (rule-based insights generated automatically from observed queries and perceived schemas, persisted as `Insight` hypergraph nodes, surfaced via `Zone-Cog: Show Generated Insights`)

### 4.4 Collaborative Cognition
- [ ] Multi-user cognitive workspaces — same-machine multi-window sharing landed via `ISharedCognitionService`; true multi-user across machines requires a sync backend (future work)
- [x] Shared hypergraph state — `ISharedCognitionService`/`SharedCognitionService` (BroadcastChannel sync of hypergraph node/link upserts across workbench windows with hello handshake and echo suppression; cross-machine sharing remains future work)
- [x] Collaborative reasoning sessions — `ICollaborativeReasoningService`/`CollaborativeReasoningService` (same-machine multi-window live broadcast of this window's `onDidCompleteThinkingPhase` stream over a BroadcastChannel, merged into a unified transcript alongside peer phases, plus shareable annotations attached to any phase; "Toggle Collaborative Reasoning Session", "Show Collaborative Session Log", and "Annotate Latest Collaborative Phase" commands); true multi-user co-reasoning across machines requires a sync backend (future work)
- [x] Cognitive trace sharing and replay — `ICognitiveTraceService`/`CognitiveTraceService` (session trace recording, versioned JSON export/import via clipboard, phase-by-phase replay rendered in the Thinking Process view)

---

## Phase 4.5: Release Infrastructure (Complete)

**Ticket**: ECH-61  
**Goal**: Establish comprehensive release pipeline for multi-platform binaries.

### 4.5.1 GitHub Actions Release Pipeline
- [x] Multi-stage release workflow — `.github/workflows/release.yml`
- [x] Compile stage with TypeScript and extension builds
- [x] Windows builds (x64, ARM64)
- [x] Linux builds (x64, ARM64) with DEB/RPM packages
- [x] macOS builds (x64, ARM64, Universal)
- [x] CLI builds (Rust) for all platforms
- [x] Checksum generation with SHA256
- [x] Automatic GitHub Release creation

### 4.5.2 Quality Gates
- [x] ZoneCog smoke tests — `scripts/test-zonecog-smoke.sh` (verifies 34 registered services, core files, interfaces, actions, product config)
- [x] Unit test integration in release pipeline
- [x] Hygiene and linting checks in CI
- [x] Checksum verification script — `build/checksums/generate-checksums.js`

### 4.5.3 Release Documentation
- [x] Release guide — `docs/RELEASE_GUIDE.md` (local builds, production builds, quality gates, artifact verification)
- [x] Version management documentation
- [x] Platform-specific build instructions
- [x] Troubleshooting guide

### 4.5.4 Product Configuration
- [x] Zone-Cog Edition branding in `product.json`
- [x] `zoneCogConfig` with cognitive services list
- [x] Membrane triad configuration
- [x] Platform identifiers for all targets

---

## Phase 5: Post-ADS Migration (In Progress)

**Goal**: Ensure ZoneCog survives ADS retirement as a standalone tool.

### 5.1 VS Code Standalone
- [x] Extract ZoneCog as standalone VS Code extension — `extensions/zonecog-bridge` provides typed, bounded HTTP transport and editor-driven schema/table/AtomSpace workflows
- [x] Remove ADS-specific dependencies — extension runtime uses only the public `vscode` API and Node.js HTTP modules, with no `azdata` dependency
- [x] Publish to VS Code marketplace — Phase F complete: marketplace icon/banner assets, comprehensive README with screenshots, full CHANGELOG, `yarn package` / `package:dry-run` / `validate:marketplace` / `prepublish:check`, CI packaging validation, tag-driven VSIX GitHub Release + Marketplace/Open VSX publish workflow (`.github/workflows/zonecog-bridge.yml`), and publisher setup guide (`docs/ZONECOG_BRIDGE_PUBLISHING.md`). Actual store publication still requires configuring the `zonecog-bridge-publish` environment secrets (`VSCE_PAT` / `OVSX_PAT`) and pushing a `zonecog-bridge-vX.Y.Z` tag.
- [x] Maintain backward compatibility with ADS installations — the shared VS Code extension API and stable `zonecog.*` command IDs work in both extension hosts


### 5.1.1 Marketplace Publishing (Phase F, issue #82)

- [x] F.1 Extension finalization — command titles/categories verified, icon + banner assets, README with screenshots, complete CHANGELOG
- [x] F.2 Publishing pipeline — Azure DevOps publisher setup documented, CI/CD automatic publishing on `zonecog-bridge-v*` tags, `vsce package` dry-run pre-publish validation, release automation (VSIX artifact + GitHub Release + Marketplace/Open VSX)

### 5.2 Portable Cognitive Engine
- [x] Standalone Python cognitive service (no ADS dependency) — `azure_integration/` depends only on `fastapi`/`uvicorn`/`pydantic`, no ADS or Node.js runtime dependency
- [x] API-first design for integration with other tools — `data_studio_bridge.py` FastAPI HTTP surface (`/health`, `/status`, `/ingest/schema`, `/ingest/table`, `/ingest/atoms`, `/reason`)
- [x] CLI interface for headless cognitive processing — `azure_integration/cli.py` (`zonecog-bridge` console script via the top-level `pyproject.toml`): `health`/`status`/`ingest-schema`/`ingest-table`/`ingest-atoms`/`reason`/`serve`, file or stdin JSON in, JSON out, non-zero exit + `error:` on stderr on bad input
- [x] Docker container for cognitive services — `azure_integration/Dockerfile` (standalone `python:3.11-slim` image, `HEALTHCHECK` via `azure_integration/healthcheck.py`), documented in `azure_integration/README.md`

### 5.3 EchoCog Integration
- [x] Deep integration with Aphrodite Engine for LLM inference — `LLMProviderService` (the backend behind the Zone-Cog thinking protocol's completions) now routes requests for a provider registered under the reserved `APHRODITE_PROVIDER_ID` through `IAphroditeService`'s own `/v1/completions` transport (`complete()`/`streamComplete()`), instead of the generic OpenAI-compatible `/v1/chat/completions` path; `Zone-Cog: Connect to Aphrodite Engine` now registers and activates this provider on a successful connection so the cognitive protocol itself runs on Aphrodite, not just the standalone Aphrodite command-palette actions. Falls back to the built-in provider (with circuit breaker) when Aphrodite is disconnected or a request fails.
- [ ] OpenCog Hyperon AtomSpace backend
- [ ] FlareCog distributed cognitive processing
- [x] Deep integration with Aphrodite Engine for LLM inference (Phase A, issue #77) — `IAphroditeService`/`AphroditeService` gained dynamic LoRA adapter load/unload (paths configurable via `loraLoadPath`/`loraUnloadPath`, defaulting to the vLLM-compatible `/v1/load_lora_adapter` and `/v1/unload_lora_adapter` Aphrodite inherits from upstream) with a session-local adapter registry (`listAdapters()`, `onDidChangeAdapters`); per-request performance telemetry (latency, token counts, success/error) recorded for every completion attempt and queryable via `getTelemetry()`/`getTelemetrySummary()` (overall + per-model breakdown, p95 latency); an automatic model fallback chain (`setFallbackChain()`/`completeWithFallback()`) that retries a failed completion against configured backup models; and a weighted A/B testing framework (`startABTest()`/`completeViaABTest()`/`getABTestResults()`) for comparing model/adapter variants, attributing telemetry to the selected variant. Three new Command Palette actions expose this: `zonecog.aphrodite.loadAdapter`, `zonecog.aphrodite.swapModel`, `zonecog.aphrodite.showPerformance`. Embedding pipeline batching/caching and streaming/speculative-decoding enhancements remain future work.
- [ ] OpenCog Hyperon AtomSpace backend (Phase B, issue #78) — native `IAtomSpaceBackendService`, Hyperon MeTTa integration, and an AtomSpace-Rocks-backed persistent store remain future work; today's `AtomSpaceTransportService` only pushes atoms to the Python bridge's mock/HTTP transport (see §3.2).
- [ ] FlareCog distributed cognitive processing (Phase C) — cross-machine peer discovery, distributed hypergraph federation, and multi-node AAR orchestration remain future work; today's federation/collaboration services are same-machine-only via `BroadcastChannel` (see §3.4, §4.4).
- [x] Autognosis self-monitoring capabilities — `IAutognosisService`/`AutognosisService` (meta-cognitive layer that synthesizes membrane triad health, embodiment proprioception, and cognitive analytics into a first-person `SelfAssessment` with a verdict, self-confidence score, and detected anomalies; self-wires to `IZoneCogService.onDidProcessQuery` so every processed query triggers a fresh assessment, persisted as `SelfAssessment` hypergraph nodes; `Zone-Cog: Perform Self-Assessment` and `Zone-Cog: Show Self-Assessment History` Command Palette actions)

### 5.4 Enhanced Persistence Layer (Phase E, issue #81)

- [x] Neo4j Cypher export — `HypergraphPersistenceService.exportToCypher()` / `nodesAndLinksToCypher()`
- [x] OpenCog AtomSpace Scheme export — `HypergraphPersistenceService.exportToAtomSpaceScheme()` / `nodesAndLinksToAtomSpaceScheme()`
- [x] Tiered (hot/warm/cold) storage with automatic archival of low-salience nodes — `archiveLowSalienceNodes()` moves nodes below the cold salience threshold into the cold tier; `demoteToWarmTier()` moves the mid-salience band into the warm tier (`warmNodes`/`warmLinks`, DB version 4). Both shrink the in-memory working set for large graphs while remaining durably addressable
- [x] Lazy loading for large graphs — `restoreArchivedNode()` / `restoreWarmNode()` pull a single cold/warm node (and its own directly-referenced links) back into the live hypergraph on demand; `listArchivedNodes()` / `listWarmNodes()` browse tier contents without loading them. Exposed via Command Palette actions for archive/restore and warm demote/restore
- [x] RocksDB backend option (`E.1`) — dual surface: (1) `IRocksDbPersistenceService` / `RocksDbPersistenceService` exposes a RocksDB-style KV API (column families, range queries, bloom filters, batch writes, secondary indices, compaction, backup/restore); (2) `RocksDbEngine` is a production RocksDB-compatible LSM (column families for nodes/links/indices/warm/cold/snapshots/changelog, memtable + SSTables, leveled compaction, ordered range/prefix scans, bloom filters backed by `WebAssembly.Memory`) with optional IndexedDB durability, used by `HypergraphPersistenceService.setBackend('rocksdb')` and the standalone `RocksDbHypergraphPersistenceService` (`IHypergraphPersistenceService`). Backend selection: `setBackend('rocksdb'|'indexeddb'|'atomspace')`
- [x] Incremental backup/restore (remainder of `E.3`) — `createBackup()`/`exportBackupJson()` produce a portable JSON `HypergraphBackup`, full or (given a `sinceTimestamp`) an incremental delta of just the nodes/links upserted since then, computed from an append-only changelog fed by `IHypergraphStore.onDidChangeNode`/`onDidChangeLink`; `importBackup()`/`importBackupJson()` apply one by upserting into the live hypergraph and hot tier. Deltas only cover upserts (removal outside this service isn't observable via those events, so periodic full backups remain the source of truth for deletions)
- [x] Optional cloud storage integration (remainder of `E.3`) — `configureCloudStorage()` enables an HTTP PUT/GET backup endpoint (bearer auth optional); `uploadBackupToCloud()` / `downloadBackupFromCloud()` / `listCloudBackups()` round-trip `HypergraphBackup` JSON. Disabled until configured; Command Palette action `Zone-Cog: Upload Hypergraph Backup to Cloud`

---

## Dependencies & Prerequisites

| Dependency | Phase | Notes |
|---|---|---|
| Node.js / TypeScript | All | ADS build system |
| Python 3.8+ | 2+ | Bridge and cognitive services |
| FastAPI / uvicorn | 2+ | Python bridge runtime |
| AtomSpace libraries | 3+ | Optional: for real reasoning |
| LLM provider | 3+ | OpenAI API or Aphrodite Engine |
| D3.js / WebGL | 4 | Visualization layer |
| Docker | 5 | Containerized deployment |

## Timeline Constraints

- **ADS Retirement**: February 28, 2026
- **Phase 2 Target**: Current sprint (active development)
- **Phase 3 Target**: Pre-retirement (establish reasoning capabilities)
- **Phase 4-5**: Post-retirement (standalone operation)
