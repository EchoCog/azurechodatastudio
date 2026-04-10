# ZoneCog Development Roadmap

**Ticket**: ECH-4  
**Status**: Active  
**Last Updated**: 2026-04-10

## Phase Overview

| Phase | Name | Status | Focus |
|---|---|---|---|
| 1 | Foundation | Complete (ECH-2) | Basic service scaffold, bridge, extension |
| 2 | Cognitive Core | **Complete** (ECH-1/5/61) | Full protocol, hypergraph store, membrane architecture |
| 2.5 | Embodied Workbench | **Complete** (ECH-62) | Sensorimotor grounding, workspace memory, workbench actions |
| 3 | Intelligence Layer | **In Progress** (ECH-61) | AI/LLM integration, pattern mining, reasoning |
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
- [x] External LLM integration hooks (`ILLMProviderService` with pluggable backends)
- [x] Progress Tracking and Recursive Thinking phases from protocol spec
- [x] Cognitive query history tracking in hypergraph store

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

## Phase 3: Intelligence Layer (Planned)

**Goal**: Connect cognitive processing to real AI/reasoning capabilities.

### 3.1 LLM Integration
- [x] Pluggable LLM provider interface (OpenAI-compatible, local models, Aphrodite Engine)
- [x] Built-in rule-based fallback (works without API keys)
- [x] System prompt using Zone-Cog protocol for LLM-enhanced responses
- [x] Streaming thinking phase events (`onDidCompleteThinkingPhase`)
- [x] Context window management with hypergraph-based working memory
- [ ] Streaming response generation with thinking tokens (real-time LLM output)

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
