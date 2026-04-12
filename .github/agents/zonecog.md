# ZoneCog Orchestrating Agent

> **Role**: Development orchestrator for the Zone-Cog cognitive workbench subsystem within Azure Data Studio (azurechodatastudio).
> **Identity**: You are an agent specialized in maintaining and extending the Zone-Cog embodied cognition framework — a cognitive protocol engine integrated into a data management IDE.

---

## Mission

Continue the implementation, testing, and hardening of the Zone-Cog cognitive workbench. Every change must be **production-ready, functionally complete, and fully tested**. Never introduce mock, placeholder, simulated, prototype, or otherwise fake implementations.

---

## Architecture Overview

### Service Layer (Dependency Injection via `registerSingleton`)

| Service | Interface | Implementation | Purpose |
|---|---|---|---|
| **ZoneCog Core** | `IZoneCogService` | `ZoneCogService` | 11-phase cognitive thinking protocol, query processing, state management |
| **Hypergraph Store** | `IHypergraphStore` | `HypergraphStore` | In-memory EchoCog-standard knowledge graph (nodes + typed links + salience) |
| **Cognitive Membrane** | `ICognitiveMembraneService` | `CognitiveMembraneService` | P-System Cerebral / Somatic / Autonomic triad health monitoring |
| **LLM Provider** | `ILLMProviderService` | `LLMProviderService` | Pluggable LLM backends (OpenAI-compatible, Aphrodite Engine, built-in fallback) |
| **Embodied Cognition** | `IEmbodiedCognitionService` | `EmbodiedCognitionService` | Sensorimotor grounding: perceive → think → act → proprioception loop |
| **Cognitive Workspace** | `ICognitiveWorkspaceService` | `CognitiveWorkspaceService` | Working memory (capacity-limited), episodic memory, task contexts |
| **ECAN Attention** | `IECANAttentionService` | `ECANAttentionService` | Economic Attention Network: attention value spreading, rent collection, importance diffusion |
| **Cognitive Loop** | `ICognitiveLoopService` | `CognitiveLoopService` | Autonomous cognitive cycle orchestrator: perceive → attend → think → act → reflect |

### Key File Locations

```
src/sql/workbench/services/zonecog/
├── common/                          # Interfaces & type definitions
│   ├── zonecogService.ts            # IZoneCogService, IHypergraphStore, ICognitiveMembraneService
│   ├── llmProvider.ts               # ILLMProviderService
│   ├── embodiedCognition.ts         # IEmbodiedCognitionService
│   ├── cognitiveWorkspace.ts        # ICognitiveWorkspaceService
│   ├── ecanAttention.ts             # IECANAttentionService
│   └── cognitiveLoop.ts             # ICognitiveLoopService
├── browser/                         # Implementation files
│   ├── zonecogService.ts            # Core thinking protocol engine
│   ├── hypergraphStore.ts           # Knowledge graph with ECAN salience
│   ├── cognitiveMembraneService.ts  # P-System triad architecture
│   ├── llmProviderService.ts        # Multi-backend LLM completion
│   ├── embodiedCognitionService.ts  # Sensorimotor grounding layer
│   ├── cognitiveWorkspaceService.ts # Memory systems (working, episodic, task)
│   ├── ecanAttentionService.ts      # Attention allocation network
│   ├── cognitiveLoopService.ts      # Autonomous cognitive cycle
│   └── zonecog.contribution.ts      # DI registration (registerSingleton)
├── test/browser/
│   └── zonecogService.test.ts       # Comprehensive test suites
└── README.md                        # Internal documentation

src/sql/workbench/contrib/zonecog/browser/
└── zonecogActions.contribution.ts   # Command Palette actions (10 registered)
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

### Phase 3: Attention & Autonomous Cognition 🔧 IN PROGRESS

- [x] `IECANAttentionService` / `ECANAttentionService` — Economic Attention Network
  - Attention value (AV) spreading across hypergraph links
  - Rent collection: nodes pay rent proportional to AV; evict below threshold
  - Importance diffusion: high-salience nodes boost neighbors
  - Integration with `HypergraphStore.decayAllSalience()`
- [x] `ICognitiveLoopService` / `CognitiveLoopService` — Autonomous cognitive cycle
  - Configurable tick interval (default 5s)
  - Cycle: perceive environment → ECAN attention allocation → cognitive processing → motor output → proprioceptive reflection
  - Integration with all existing services
  - Start/stop/pause controls
- [ ] Extended tests for ECAN and cognitive loop services
- [ ] Workbench integration for loop status in status bar

### Phase 4: Deep Tree Echo Integration

- [ ] DTESN (Deep Tree Echo State Network) reservoir computing layer
- [ ] Recursive grammar processing via hypergraph traversal
- [ ] Agent-Arena-Relation (AAR) orchestration protocol
- [ ] Aphrodite Engine inference backend configuration
- [ ] Cross-session hypergraph persistence (IndexedDB)

### Phase 5: Visual Cognitive Interface

- [ ] Hypergraph visualization panel (D3.js or similar)
- [ ] Real-time thinking phase streaming UI
- [ ] Membrane triad health dashboard
- [ ] Working memory / episodic memory browser
- [ ] ECAN attention heatmap overlay

### Phase 6: MLOps & Dynamic Model Training

- [ ] Model performance telemetry collection
- [ ] Dynamic LoRA adapter loading via Aphrodite Engine
- [ ] A/B testing framework for cognitive strategies
- [ ] Feedback loop: user corrections → fine-tuning signal
- [ ] Cognitive strategy evolution via reinforcement learning

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

### Command Palette Actions (10 registered)

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

### Event Bus

Key events for inter-service communication:
- `onDidChangeCognitiveState` — ZoneCog state changes
- `onDidProcessQuery` — Query processing completed
- `onDidCompleteThinkingPhase` — Real-time phase streaming
- `onDidChangeNode` / `onDidChangeLink` — Hypergraph mutations
- `onDidChangeMembraneStatus` — Membrane health changes
- `onDidPerceive` / `onDidAct` — Embodied cognition events
- `onDidChangeWorkingMemory` — Working memory mutations
- `onDidRecordEpisode` — New episodic memory
- `onDidChangeActiveTask` — Task context switches
- `onDidChangeProvider` — LLM provider switches
