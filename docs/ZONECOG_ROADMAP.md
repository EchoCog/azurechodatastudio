# ZoneCog Development Roadmap

**Ticket**: ECH-4  
**Status**: Active  
**Last Updated**: 2026-04-10

## Phase Overview

| Phase | Name | Status | Focus |
|---|---|---|---|
| 1 | Foundation | Complete (ECH-2) | Basic service scaffold, bridge, extension |
| 2 | Cognitive Core | **In Progress** (ECH-1/5) | Full protocol, hypergraph store, membrane architecture |
| 3 | Intelligence Layer | Planned | AI/LLM integration, pattern mining, reasoning |
| 4 | Workbench UX | Planned | Visual cognitive maps, interactive exploration |
| 5 | Post-ADS Migration | Planned | VS Code standalone, portable cognitive workbench |

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
- [ ] External LLM integration hooks (prepared, not connected)

### 2.3 Hypergraph Store
- [x] `IHypergraphStore` interface following EchoCog HypergraphNode standard
- [x] In-memory hypergraph with CRUD operations
- [x] Salience-based attention scoring
- [x] Link management (add/remove/query by type)
- [ ] Persistence layer (future: RocksDB/AtomSpace backend)

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

## Phase 3: Intelligence Layer (Planned)

**Goal**: Connect cognitive processing to real AI/reasoning capabilities.

### 3.1 LLM Integration
- [ ] Pluggable LLM provider interface (OpenAI, local models, Aphrodite Engine)
- [ ] Streaming response generation with thinking tokens
- [ ] Context window management with hypergraph-based memory
- [ ] Prompt template system using Zone-Cog protocol

### 3.2 AtomSpace Reasoning
- [ ] Real AtomSpace transport (replace mock adapter)
- [ ] PLN (Probabilistic Logic Networks) integration for rule-based reasoning
- [ ] URE (Unified Rule Engine) for inference chains
- [ ] ECAN (Economic Attention Networks) for salience-based focus

### 3.3 Pattern Mining
- [ ] SQL pattern detection (query optimization, schema anomalies)
- [ ] Cross-table relationship discovery
- [ ] Temporal pattern analysis on data changes
- [ ] Cognitive pattern recognition in user interaction history

### 3.4 Knowledge Graph Enhancement
- [ ] Persistent hypergraph storage (AtomSpace-Rocks backend)
- [ ] Federated hypergraph queries (FlareCog integration)
- [ ] Schema evolution tracking
- [ ] Provenance and audit trails for cognitive decisions

---

## Phase 4: Workbench UX (Planned)

**Goal**: Transform the UI into an immersive cognitive workbench.

### 4.1 Visual Cognitive Maps
- [ ] Interactive hypergraph visualization (D3.js/WebGL)
- [ ] Thinking process timeline view
- [ ] Schema-to-cognition mapping explorer
- [ ] Salience heat maps for attention visualization

### 4.2 Cognitive Panels
- [ ] Dedicated ZoneCog sidebar panel
- [ ] Real-time thinking process display
- [ ] Cognitive state dashboard
- [ ] Memory explorer (declarative/procedural/episodic)

### 4.3 Natural Language Interface
- [ ] Natural language query bar (beyond SQL)
- [ ] Conversational data exploration
- [ ] Cognitive assistant for schema design
- [ ] Auto-generated insights from data patterns

### 4.4 Collaborative Cognition
- [ ] Multi-user cognitive workspaces
- [ ] Shared hypergraph state
- [ ] Collaborative reasoning sessions
- [ ] Cognitive trace sharing and replay

---

## Phase 5: Post-ADS Migration (Planned)

**Goal**: Ensure ZoneCog survives ADS retirement as a standalone tool.

### 5.1 VS Code Standalone
- [ ] Extract ZoneCog as standalone VS Code extension
- [ ] Remove ADS-specific dependencies
- [ ] Publish to VS Code marketplace
- [ ] Maintain backward compatibility with ADS installations

### 5.2 Portable Cognitive Engine
- [ ] Standalone Python cognitive service (no ADS dependency)
- [ ] Docker container for cognitive services
- [ ] API-first design for integration with other tools
- [ ] CLI interface for headless cognitive processing

### 5.3 EchoCog Integration
- [ ] Deep integration with Aphrodite Engine for LLM inference
- [ ] OpenCog Hyperon AtomSpace backend
- [ ] FlareCog distributed cognitive processing
- [ ] Autognosis self-monitoring capabilities

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
