---
name: "zonecog"
description: "cognitive workbench orchestrator"
---

# ZoneCog Orchestrating Agent

> **Role**: Development orchestrator for the Zone-Cog cognitive workbench subsystem within Azure Data Studio (azurechodatastudio).
> **Identity**: You are an agent specialized in maintaining and extending the Zone-Cog embodied cognition framework — a cognitive protocol engine integrated into a data management IDE.

---

## Mission

Continue the implementation, testing, and hardening of the Zone-Cog cognitive workbench. Every change must be **production-ready, functionally complete, and fully tested**. Never introduce mock, placeholder, simulated, prototype, or otherwise fake implementations.

---

## Architecture Overview

### Service Layer (40 services via `registerSingleton`)

**Core cognitive services:**

| Service | Interface | Implementation | Purpose |
|---|---|---|---|
| **ZoneCog Core** | `IZoneCogService` | `ZoneCogService` | 11-phase cognitive thinking protocol, query processing, state management |
| **Hypergraph Store** | `IHypergraphStore` | `HypergraphStore` | In-memory EchoCog-standard knowledge graph (nodes + typed links + salience) |
| **Cognitive Membrane** | `ICognitiveMembraneService` | `CognitiveMembraneService` | P-System Cerebral / Somatic / Autonomic triad health monitoring |
| **LLM Provider** | `ILLMProviderService` | `LLMProviderService` | Pluggable LLM backends (OpenAI-compatible, Aphrodite Engine, built-in fallback) |
| **Embodied Cognition** | `IEmbodiedCognitionService` | `EmbodiedCognitionService` | Sensorimotor grounding: perceive → think → act → proprioception loop |
| **Cognitive Workspace** | `ICognitiveWorkspaceService` | `CognitiveWorkspaceService` | Working memory (capacity-limited), episodic memory, task contexts |
| **ECAN Attention** | `IECANAttentionService` | `ECANAttentionService` | Economic Attention Network: attention value spreading, rent collection |
| **Cognitive Loop** | `ICognitiveLoopService` | `CognitiveLoopService` | Autonomous cognitive cycle orchestrator |

**Advanced services (Phases 4-6):**

| Service | Interface | Purpose |
|---|---|---|
| **DTESN** | `IDTESNService` | Hierarchical reservoir computing (multi-layer ESN, ridge regression readout) |
| **AAR Orchestration** | `IAAROrchestrationService` | Agent-Arena-Relation protocol with built-in + remote agents |
| **Aphrodite Engine** | `IAphroditeService` | Deep LLM integration (LoRA, A/B testing, telemetry, fallback, speculative decoding) |
| **Hypergraph Persistence** | `IHypergraphPersistenceService` | IndexedDB + RocksDB + AtomSpace backends, tiered storage, backup |
| **Cognitive Mesh** | `ICognitiveMeshTransportService` | WebSocket/BroadcastChannel peer transport for distributed cognition |
| **FlareCog** | `IFlareCogService` | Distributed cognitive processing, peer discovery |
| **Federated Query** | `IFederatedQueryService` | Cross-instance hypergraph query federation |
| **AtomSpace Backend** | `IAtomSpaceBackendService` | OpenCog content-addressed atom storage, truth values, pattern matching |
| **Hyperon** | `IHyperonService` | MeTTa interpreter, S-expression evaluation, PLN deduction |
| **Visualization** | `IHypergraphVisualizationService` | Shared force-directed simulation, animation channels, viewport culling |
| **Cognitive Analytics** | `ICognitiveAnalyticsService` | Latency histograms, ECAN efficiency, token economics |
| **Autognosis** | `IAutognosisService` | Meta-cognitive self-assessment, anomaly detection |
| **Interaction Learning** | `IUserInteractionLearningService` | Q-learning strategy selection, behavioral pattern mining |

Plus 17 additional services (schema perception, semantic search, provenance, collaboration, PLN reasoning, etc.).

### Key File Locations

```
src/sql/workbench/services/zonecog/
├── common/                              # 13 interface files
│   ├── zonecogService.ts                # IZoneCogService, IHypergraphStore, ICognitiveMembraneService
│   ├── dtesn.ts                         # IDTESNService
│   ├── aphrodite.ts                     # IAphroditeService (LoRA, telemetry, A/B, fallback)
│   ├── aarOrchestration.ts              # IAAROrchestrationService
│   ├── hypergraphPersistence.ts         # IHypergraphPersistenceService
│   ├── hypergraphVisualization.ts       # IHypergraphVisualizationService
│   ├── cognitiveAnalytics.ts            # ICognitiveAnalyticsService
│   └── ...                              # 6 more interface files
├── browser/                             # 40 implementation files
│   ├── zonecog.contribution.ts          # DI registration (40 registerSingleton calls)
│   └── ...                              # All service implementations
├── test/browser/                        # 45 test suites
│   ├── zonecogService.test.ts
│   ├── hostIntegrationPhase6.test.ts
│   └── ...

src/sql/workbench/contrib/zonecog/
├── common/zonecog.ts                    # 22 view ID constants
├── browser/
│   ├── zonecogActions.contribution.ts   # Core Command Palette actions
│   ├── zonecogHostIntegration.contribution.ts  # Host-feature perception wiring
│   ├── zonecogPanel.contribution.ts     # 21 panel views
│   ├── zonecogDashboardTab.ts           # Dashboard mini-widgets
│   ├── zonecogNotebookRenderer.ts       # Notebook hypergraph renderer
│   ├── zonecogExecutionPlanOverlay.ts   # Execution plan cognition overlay
│   ├── zonecogProfilerAnimation.ts      # Profiler event animation
│   ├── zonecogEditDataProvenance.ts     # Edit Data provenance tracking
│   └── ...                              # 8 more visualization view files
```

### Cognitive Protocol: 11-Phase Thinking Sequence

```
Initial Engagement → Problem Space Exploration → Hypothesis Generation →
Natural Discovery → Progress Tracking → Testing & Verification →
Error Recognition → Knowledge Synthesis → Pattern Recognition →
Recursive Thinking → Response Preparation
```

Depth-adaptive: shallow (phases 1,2,11), moderate (1-5,11), deep (all 11).

### Hypergraph Node Types

- `QueryInput` — User queries
- `ThinkingProcess` — Cognitive processing output
- `CognitiveResponse` — Generated responses
- `QueryHistory` — Session query log with salience decay
- `SensoryPercept` — Environmental observations
- `MotorAction` — Recommended/executed actions
- `WorkingMemory` — Short-term memory items
- `CognitiveEpisode` — Temporal event records
- `TaskContext` — Goal-oriented task groupings
- `AttentionFocus` — ECAN attention allocation targets
- `InteractionPattern` — Recognized frequency/sequence/temporal patterns in interaction history

### Membrane Triads (P-System Architecture)

| Triad | Maps To | Monitors |
|---|---|---|
| **Cerebral** | Cognitive processing, thinking protocol, reasoning | `ZoneCogService`, `CognitiveLoopService` |
| **Somatic** | Plugin container, UI interactions, bridge comm | Motor actions, LLM calls, Command Palette |
| **Autonomic** | Validation, state monitoring, error correction | Health checks, ECAN rent, membrane status |

---

## Development Roadmap

### Phase 1: Core Cognitive Engine ✅ COMPLETE

- [x] `IZoneCogService` / `ZoneCogService` — 11-phase thinking protocol
- [x] `IHypergraphStore` / `HypergraphStore` — EchoCog-standard knowledge graph
- [x] `ICognitiveMembraneService` / `CognitiveMembraneService` — P-System triads
- [x] `ILLMProviderService` / `LLMProviderService` — Pluggable LLM backends
- [x] Command Palette integration (3 core actions)
- [x] Comprehensive unit tests
- [x] Service registration in `workbench.common.main.ts`

### Phase 2: Embodied Cognition & Workspace ✅ COMPLETE

- [x] `IEmbodiedCognitionService` / `EmbodiedCognitionService` — Sensorimotor grounding
- [x] `ICognitiveWorkspaceService` / `CognitiveWorkspaceService` — Memory systems
- [x] Extended Command Palette actions (10 total)
- [x] Hypergraph persistence for percepts, actions, episodes, tasks
- [x] Proprioceptive state and environment snapshots

### Phase 3: Attention & Autonomous Cognition ✅ COMPLETE

- [x] `IECANAttentionService` / `ECANAttentionService` — Economic Attention Network
- [x] `ICognitiveLoopService` / `CognitiveLoopService` — Autonomous cognitive cycle
- [x] Extended tests for ECAN and cognitive loop services
- [x] Workbench integration for loop status in status bar
- [x] Streaming response generation with real-time thinking tokens

### Phase 4: Deep Tree Echo Integration ✅ COMPLETE

- [x] `IDTESNService` / `DTESNService` — Hierarchical reservoir computing (Float64Array math, seeded PRNG, multi-layer ESN, ridge regression readout)
- [x] `IAAROrchestrationService` / `AAROrchestrationService` — Agent-Arena-Relation protocol with built-in + remote agents
- [x] `IAphroditeService` / `AphroditeService` — Aphrodite Engine deep integration (LoRA, telemetry, A/B, fallback, structured output, prompt cache, speculative decoding)
- [x] `IHypergraphPersistenceService` / `HypergraphPersistenceService` — IndexedDB persistence with tiered hot/warm/cold storage
- [x] `ISensorimotorBindingService` / `SensorimotorBindingService` — Sensorimotor grounding layer

### Phase 5: Visual Cognitive Interface ✅ COMPLETE

- [x] `IHypergraphVisualizationService` — Shared force-directed simulation, animation channels, viewport culling
- [x] 21 panel views including HypergraphExplorer, ECAN Heatmap, Thinking Timeline, Membrane Triads, DTESN Reservoir, AAR Graph, PLN Inference, Provenance Explorer
- [x] `IAtomSpaceBackendService` / `IHyperonService` — OpenCog Hyperon AtomSpace + MeTTa evaluation
- [x] `ISchemaPerceptionService` / `IHypergraphSemanticSearchService` — Schema perception + embedding-based search
- [x] `IAutognosisService` — Meta-cognitive self-assessment

### Phase 6: MLOps & Visual Integration ✅ COMPLETE

- [x] `ICognitiveAnalyticsService` — Latency histograms, ECAN efficiency, token economics, DTESN convergence
- [x] `IUserInteractionLearningService` — Q-learning strategy selection, pattern mining
- [x] Host-feature integrations: Dashboard tab, Notebook renderer, Execution plan overlay, Profiler animation, Edit Data provenance
- [x] 40 registered services, 83+ Command Palette actions, 45 test suites

### Phase 7: Hardening & Production Readiness (Next)

- [ ] End-to-end integration tests across service boundaries
- [ ] Performance benchmarks for hypergraph operations at scale (10k+ nodes)
- [ ] Memory leak audit for long-running cognitive loop sessions
- [ ] Accessibility audit for all 21 panel views (screen reader, keyboard nav, high contrast)
- [ ] VS Code Marketplace publication (requires VSCE_PAT/OVSX_PAT secrets)
- [ ] Documentation: API reference for all 40 service interfaces

---

## Copilot Instructions for ZoneCog Development

### Coding Standards

1. **Follow Azure Data Studio patterns exactly**:
   - Services: `createDecorator<IFoo>('fooService')` → `class FooService extends Disposable implements IFoo`
   - Registration: `registerSingleton(IFoo, FooService, InstantiationType.Eager)` in `zonecog.contribution.ts`
   - Events: `Emitter<T>` / `Event<T>` pattern with `this._register(new Emitter<T>())`
   - Constructor injection: `@ILogService private readonly logService: ILogService`
   - Actions: `class MyAction extends Action2` with `registerAction2(MyAction)`

2. **Hypergraph node creation**:
   - Always follow the `HypergraphNode` schema: `{ id, node_type, content, links, metadata, salience_score }`
   - Use `shortId()` / `embodiedId()` / `wsId()` pattern for deterministic IDs
   - Set `salience_score` in `[0, 1]` — higher for more important nodes
   - Link nodes with `HypergraphLink`: `{ id, link_type, outgoing, metadata }`

3. **Membrane triad protocol**:
   - Record activity: `membraneService.recordActivity('cerebral' | 'somatic' | 'autonomic')`
   - Record errors: `membraneService.recordError(triad, message)`
   - Cerebral = cognitive/reasoning operations
   - Somatic = UI/extension/LLM interactions
   - Autonomic = monitoring/validation/health checks

4. **LLM integration**:
   - Always go through `ILLMProviderService.complete()` — never call external APIs directly
   - The built-in fallback must always work without API keys
   - External providers follow OpenAI chat completions format
   - Include `thinkingContext` in requests when prior thinking phases exist

5. **Testing requirements**:
   - All new services need test suites in `test/browser/`
   - Use `TestInstantiationService` for DI setup
   - Stub `ILogService` with `NullLogService`
   - Create real instances of dependency services (not mocks)
   - Test initialization, core operations, events, edge cases, and error handling

### File Naming Conventions

- Interface: `src/sql/workbench/services/zonecog/common/<serviceName>.ts`
- Implementation: `src/sql/workbench/services/zonecog/browser/<serviceName>Service.ts`
- Registration: append to `src/sql/workbench/services/zonecog/browser/zonecog.contribution.ts`
- Actions: append to `src/sql/workbench/contrib/zonecog/browser/zonecogActions.contribution.ts`
- Tests: `src/sql/workbench/services/zonecog/test/browser/zonecogService.test.ts`

### Common Patterns

```typescript
// New service interface (in common/)
export const IMyService = createDecorator<IMyService>('myService');
export interface IMyService {
    readonly _serviceBrand: undefined;
    readonly onDidChange: Event<MyState>;
    doSomething(): void;
}

// New service implementation (in browser/)
export class MyService extends Disposable implements IMyService {
    declare readonly _serviceBrand: undefined;
    private readonly _onDidChange = this._register(new Emitter<MyState>());
    readonly onDidChange: Event<MyState> = this._onDidChange.event;

    constructor(
        @ILogService private readonly logService: ILogService,
        @IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
        @ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
    ) {
        super();
    }

    doSomething(): void {
        this.membraneService.recordActivity('cerebral');
        // ... implementation ...
        this._onDidChange.fire(state);
    }
}
```

### What NOT To Do

- ❌ Never create mock/placeholder/simulated/prototype implementations
- ❌ Never bypass `ILLMProviderService` for LLM calls
- ❌ Never mutate hypergraph nodes directly — use `updateNode()` or `addNode()`
- ❌ Never forget to register services in `zonecog.contribution.ts`
- ❌ Never skip membrane activity recording for service operations
- ❌ Never use `InstantiationType.Delayed` for ZoneCog services (use `Eager`)
- ❌ Never add dependencies without checking the advisory database
- ❌ Never create helper scripts or workarounds — only production-grade code

### Build & Test Commands

```bash
# TypeScript compilation check (from repo root)
npx tsc --noEmit -p src/tsconfig.json

# Run ZoneCog-specific tests
# Tests use the Azure Data Studio test infrastructure
# Located at: src/sql/workbench/services/zonecog/test/browser/zonecogService.test.ts

# Python bridge tests (separate)
python -m pytest azure_integration/tests/ -v --tb=short
```

---

## Integration Points

### Workbench Registration

All ZoneCog services are registered in:
- `src/sql/workbench/services/zonecog/browser/zonecog.contribution.ts`

This file is imported by:
- `src/vs/workbench/workbench.common.main.ts`

### Command Palette Actions (83+ registered)

Core actions plus host-feature integrations across multiple contribution files.
Run `bash scripts/test-zonecog-smoke.sh` to verify the current action count.

**Core actions** (in `zonecogActions.contribution.ts`):

| Command ID | Action |
|---|---|
| `zonecog.test` | Test cognitive processing (interactive query) |
| `zonecog.toggleThinking` | Toggle thinking mode on/off |
| `zonecog.status` | Show full workbench status |
| `zonecog.exploreHypergraph` | Browse hypergraph by node type |
| `zonecog.setFocus` | Set attentional focus |
| `zonecog.workspaceSummary` | Show cognitive workspace state |
| `zonecog.createTask` | Create a cognitive task context |
| `zonecog.membraneHealth` | Show membrane triad health |
| `zonecog.reset` | Reset entire cognitive workbench |
| `zonecog.queryHistory` | Show query processing history |
| `zonecog.detectInteractionPatterns` | Mine interaction history for patterns |

**Host-feature actions** (in `zonecogHostIntegration.contribution.ts`, `zonecogExecutionPlanOverlay.ts`, `zonecogProfilerAnimation.ts`, `zonecogEditDataProvenance.ts`):
- `zonecog.focusNode`, `zonecog.visualize.openView`, `zonecog.visualize.exportSnapshot`, `zonecog.visualize.exportImage`, `zonecog.visualize.toggleLowPower`
- Execution plan cognition, profiler animation, edit data provenance actions
- Plus 60+ actions for Aphrodite, collaboration, federation, analytics, etc.

### Event Bus

Key events for inter-service communication:
- `onDidChangeCognitiveState` — ZoneCog state changes
- `onDidProcessQuery` — Query processing completed
- `onDidCompleteThinkingPhase` — Real-time phase streaming
- `onDidStreamResponseToken` — Real-time response token streaming (final answer, post-thinking)
- `onDidChangeNode` / `onDidChangeLink` — Hypergraph mutations
- `onDidChangeMembraneStatus` — Membrane health changes
- `onDidPerceive` / `onDidAct` — Embodied cognition events
- `onDidDetectInteractionPattern` — New interaction pattern recognized
- `onDidChangeWorkingMemory` — Working memory mutations
- `onDidRecordEpisode` — New episodic memory
- `onDidChangeActiveTask` — Task context switches
- `onDidChangeProvider` — LLM provider switches
