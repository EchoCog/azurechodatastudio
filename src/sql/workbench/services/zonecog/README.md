# Zone-Cog Integration

This directory contains the Zone-Cog cognitive protocol integration for Azure Data Studio, transforming it into an experimental cognitive workbench.

## Overview

Zone-Cog implements a comprehensive thinking framework that enables natural, stream-of-consciousness cognitive processing for data analysis and management tasks. The integration provides:

- **Cognitive Protocol Service**: Full Zone-Cog thinking sequence (11 phases)
- **Hypergraph Store**: In-memory knowledge graph following the EchoCog HypergraphNode standard
- **Cognitive Membrane Architecture**: Cerebral / Somatic / Autonomic triad system
- **Adaptive Analysis**: Query complexity assessment and depth-appropriate thinking
- **Event-Driven State**: Reactive cognitive state management with change notifications
- **LLM Provider System**: Pluggable LLM backends with built-in rule-based fallback
- **Embodied Cognition**: Sensorimotor grounding loop (perceive → think → act → proprioception)
- **Cognitive Workspace**: Working memory, episodic memory, and task contexts
- **ECAN Attention Network**: Economic attention allocation with spreading activation and rent collection
- **Cognitive Loop**: Autonomous cognitive cycle orchestrator (perceive → attend → think → act → reflect)

## Architecture

### Cognitive Membrane Triads

The system implements the P-System Membrane Architecture:

| Triad | Role | Components |
|---|---|---|
| **Cerebral** | Core cognitive processing | `ZoneCogService`, `CognitiveLoopService`, thinking protocol |
| **Somatic** | Extension & UI interaction | Command Palette, bridge extension, LLM calls |
| **Autonomic** | Health monitoring & validation | `CognitiveMembraneService`, ECAN rent, error tracking |

### Services (12 total)

| Service | Interface | Implementation |
|---|---|---|
| Zone-Cog Core | `IZoneCogService` | `ZoneCogService` |
| Hypergraph Store | `IHypergraphStore` | `HypergraphStore` |
| Cognitive Membrane | `ICognitiveMembraneService` | `CognitiveMembraneService` |
| LLM Provider | `ILLMProviderService` | `LLMProviderService` |
| Embodied Cognition | `IEmbodiedCognitionService` | `EmbodiedCognitionService` |
| Cognitive Workspace | `ICognitiveWorkspaceService` | `CognitiveWorkspaceService` |
| ECAN Attention | `IECANAttentionService` | `ECANAttentionService` |
| Cognitive Loop | `ICognitiveLoopService` | `CognitiveLoopService` |
| AGI Studio | `IAgiStudioService` | `AgiStudioService` |
| Interaction Learning | `IUserInteractionLearningService` | `UserInteractionLearningService` |
| Cognitive Analytics | `ICognitiveAnalyticsService` | `CognitiveAnalyticsService` |
| AtomSpace Transport | `IAtomSpaceTransportService` | `AtomSpaceTransportService` |

### Cognitive Analytics & Telemetry (Phase 6.3)

The Cognitive Analytics service passively observes the cognitive subsystems
and aggregates the metrics needed to measure and optimize cognitive
performance:

- **Query latency histograms** — bucketed processing-time distribution from `IZoneCogService.onDidProcessQuery`
- **Thinking phase durations** — per-phase count / mean / max statistics
- **ECAN efficiency** — attentional focus ratio and rent collection, sampled per processed query
- **Working memory utilization** — fill ratio (mean / latest / peak) sampled per processed query
- **LLM token economics** — request, fallback, and streaming counts plus token totals via `ILLMProviderService.onDidCompleteRequest`
- **DTESN training convergence** — MSE history and convergence trend via `IDTESNService.onDidLearn`

Use the `zonecog.analyticsReport` Command Palette action to generate a
human-readable report; each report is persisted as an `AnalyticsReport`
hypergraph node for longitudinal analysis. `zonecog.analyticsReset` clears
all collected metrics.

The Cognitive Loop additionally runs a **watchdog timer** (Phase 7.2): if an
iteration hangs for longer than three tick intervals, the watchdog recovers
the loop, records an autonomic membrane error, and increments the
`watchdogRecoveries` counter exposed via `CognitiveLoopState`.

### AGI Studio (Phase 7)

The AGI Studio provides **Agent-Zero-style hierarchical autonomous agents** for
the cognitive workbench. See [`common/agiStudio.ts`](common/agiStudio.ts) for
the full interface.

#### Architecture

```
User Goal
    │
    ▼
Root Orchestrator (depth 0)
    ├── task-assignment ──► SQL Analyzer Agent (depth 1)
    │                            └── invokes sql-analyze tool
    │                            └── result-report ──► Root
    ├── task-assignment ──► Schema Reasoner Agent (depth 1)
    │                            └── invokes schema-reason tool
    │                            └── result-report ──► Root
    └── ... (up to 4 subordinates, 8 total agents cap)
    │
    ▼
Synthesis → StudioRun.result
```

#### Key Types

| Type | Description |
|---|---|
| `StudioRun` | End-to-end run: goal → rootAgentId → status → result |
| `StudioAgent` | Agent node: id, role, depth, superiorId, subordinateIds, localMemory |
| `AgentMessage` | Inter-agent message: task-assignment / result-report / status-update |
| `AgentToolCall` | Tool invocation record: toolId, agentId, input, output, durationMs |
| `AgentTool` | Tool interface: id, name, description, invoke(input, agent) |

#### Registered Tools

| Tool ID | Wraps | Description |
|---|---|---|
| `sql-analyze` | `ISQLAnalyzerAgent` | Analyze SQL queries |
| `schema-reason` | `ISchemaReasonerAgent` | Analyze database schemas |
| `perf-advise` | `IPerformanceAdvisorAgent` | Identify performance issues |
| `data-pattern` | `IDataPatternAgent` | Detect data patterns |
| `llm-reason` | `ILLMProviderService` | LLM-based reasoning (with fallback) |
| `memory-save` | `ICognitiveWorkspaceService` | Save to agent-local + episodic memory |
| `memory-recall` | `ICognitiveWorkspaceService` | Recall from agent-local + episodic memory |

#### LLM Fallback Strategy

The goal decomposition calls `ILLMProviderService.complete()` and attempts to
parse the response as a JSON string array.  When the response is from the
built-in fallback provider (keyless), or parsing fails, the service falls back
to a deterministic keyword-based decomposition that always produces 2–4 valid
subtasks.  This ensures the run always completes meaningfully with or without
external API keys.

#### Command Palette Actions

| Command ID | Description |
|---|---|
| `zonecog.agiStudio.startRun` | Prompt for goal and start autonomous run |
| `zonecog.agiStudio.showStatus` | Show run status and agent-tree summary |
| `zonecog.agiStudio.stopRun` | Stop the currently active run |

### Real AtomSpace Transport (Phase 3.2)

`IAtomSpaceTransportService` / `AtomSpaceTransportService` closes the "real
AtomSpace transport" roadmap gap: it pushes the in-memory hypergraph store's
nodes and links to the ZoneCog Python bridge
(`azure_integration/data_studio_bridge.py`) as an AtomSpace-shaped Node/Link
atom batch over HTTP (`POST /ingest/atoms`).

The bridge's `AtomSpaceAdapter` decides what happens to that batch based on
`ATOMSPACE_MODE`:

- `mock` (default) — counts atoms in-process, no external dependency.
- `http` with `ATOMSPACE_URL` set — forwards the batch over real HTTP to an
  AtomSpace REST backend via `HttpAtomSpaceTransport`
  (`azure_integration/atomspace_transport.py`), which speaks the
  `POST /api/v1.5/atoms` / `POST /api/v1.5/reason` / `GET /api/v1.5/status`
  convention.

```typescript
atomSpaceTransportService.configure({ baseUrl: 'http://127.0.0.1:7807' });
const result = await atomSpaceTransportService.syncHypergraph(
  hypergraphStore.getAllNodes(),
  hypergraphStore.getAllNodes().flatMap(n => hypergraphStore.getLinksForNode(n.id)),
);
console.log(result.success, result.nodeCount, result.linkCount);
```

Every sync attempt (success or failure) is recorded as an
`AtomSpaceSyncRecord` hypergraph node and reported via `onDidSync`; bridge
reachability changes fire `onDidChangeConnectionStatus`.

#### Command Palette Actions

| Command ID | Description |
|---|---|
| `zonecog.atomSpaceTransport.configure` | Set the ZoneCog bridge base URL |
| `zonecog.atomSpaceTransport.syncNow` | Push the current hypergraph to the bridge |
| `zonecog.atomSpaceTransport.showStatus` | Show bridge reachability and last sync outcome |

### Thinking Protocol Phases

The full Zone-Cog cognitive sequence (depth-adaptive):

1. **Initial Engagement** — Rephrase query, map knowns/unknowns (always)
2. **Problem Space Exploration** — Break down components, identify requirements (always)
3. **Hypothesis Generation** — Multiple interpretations, avoid premature commitment (moderate+)
4. **Natural Discovery** — Organic insight development, pattern connections (moderate+)
5. **Progress Tracking** — Track established conclusions and open questions (moderate+)
6. **Testing & Verification** — Question assumptions, check consistency (deep)
7. **Error Recognition** — Acknowledge and correct reasoning flaws (deep)
8. **Knowledge Synthesis** — Connect information, build coherent picture (deep)
9. **Pattern Recognition** — Analyze patterns using hypergraph context (deep)
10. **Recursive Thinking** — Apply analysis at macro and micro scales (deep)
11. **Response Preparation** — Final response formulation (always)

## Hypergraph Store

Follows the EchoCog standard `HypergraphNode` structure:

```typescript
interface HypergraphNode {
  id: string;           // Unique stable identifier
  node_type: string;    // e.g. "TableNode", "ThinkingProcess", "QueryInput"
  content: string;      // Primary content payload
  links: string[];      // Link IDs this node participates in
  metadata: Record<string, unknown>;
  salience_score: number; // [0, 1] for ECAN-style attention
}
```

Cognitive processing creates and links nodes automatically:
- `QueryInput` → `ThinkingProcess` → `CognitiveResponse`
- `QueryHistory` nodes track past queries with salience decay
- Links typed as `ProducedBy` connect the processing chain

## ECAN Attention Network

The Economic Attention Network provides principled resource allocation:

- **Attention Values**: Each node has STI (Short-Term Importance) in [-1, 1] and LTI (Long-Term Importance) in [0, 1]
- **Spreading Activation**: STI diffuses along hypergraph links from high-attention nodes to neighbors
- **Rent Collection**: A flat rent is charged each cycle, creating economic pressure against low-value nodes
- **Attentional Focus**: Nodes with STI above the focus boundary receive priority processing

```typescript
// Stimulate a node to draw attention
ecanService.stimulate('important-node', 0.5);

// Run a spreading activation cycle
const result = ecanService.spreadActivation();
console.log('Boosted:', result.boosted.length, 'Evicted:', result.evicted.length);

// Get nodes in attentional focus
const focusNodes = ecanService.getAttentionalFocus();
```

## Cognitive Loop

The autonomous cognitive cycle runs continuously:

```
perceive → attend → think → act → reflect → (repeat)
```

- **Perceive**: Scan environment via embodied cognition layer
- **Attend**: Run ECAN spreading activation
- **Think**: Process focused items, update working memory
- **Act**: Produce motor actions (insights, suggestions)
- **Reflect**: Decay transient state, record episodes

```typescript
// Start the autonomous cognitive loop
cognitiveLoopService.start();

// Or run a single iteration manually
const iteration = await cognitiveLoopService.runOnce();
console.log('Phases:', iteration.phases.map(p => p.name).join(' → '));
```

## Interaction Pattern Recognition

`EmbodiedCognitionService.detectInteractionPatterns()` mines the recorded
`'interaction'`-modality percepts for recurring usage patterns, persisting
each as an `InteractionPattern` hypergraph node:

- **Frequency** — a specific interaction recurs at least `minOccurrences` times
- **Sequence** — a pair of interactions consistently follows one another (a habitual bigram)
- **Temporal** — inter-arrival gaps between interactions form a regular cadence (low coefficient of variation)

```typescript
embodiedService.perceive('interaction', 'open-query-editor', '');
// ... more interaction percepts ...

const patterns = embodiedService.detectInteractionPatterns(3);
for (const p of patterns) {
  console.log(`[${p.kind}] ${p.description} (confidence: ${p.confidence.toFixed(2)})`);
}

// React to newly recognized patterns
embodiedService.onDidDetectInteractionPattern(pattern => {
  console.log('New pattern:', pattern.description);
});
```

## LLM Provider System

The `ILLMProviderService` supports pluggable LLM backends:

- **Built-in fallback**: Rule-based response generation (no API keys required)
- **OpenAI-compatible**: Any API following the OpenAI chat completions format
- **Aphrodite Engine**: Local inference via Aphrodite's OpenAI-compatible API
- **Custom providers**: Register at runtime via `registerProvider()`

```typescript
// Register an external LLM provider
llmProviderService.registerProvider({
  id: 'my-llm',
  displayName: 'My LLM',
  baseUrl: 'http://localhost:8080',
  model: 'my-model',
  maxContextLength: 4096,
  apiKey: 'optional-key',
});
llmProviderService.setActiveProvider('my-llm');
```

### Streaming Responses

`completeStream()` delivers the response incrementally, one chunk at a time,
instead of waiting for the full completion. The built-in fallback streams
word-by-word; external OpenAI-compatible providers stream via `stream: true`
and incremental SSE frames. Both paths share the same circuit-breaker fallback
behavior as `complete()`.

```typescript
const response = await llmProviderService.completeStream(
  { systemPrompt: '...', userMessage: 'Explain this query plan' },
  token => process.stdout.write(token),
);
console.log('\nFinal:', response.content);
```

`ZoneCogService` streams the response phase of query processing through
`onDidStreamResponseToken`, so the workbench can render the final answer live
as it arrives from the active LLM provider (thinking phases stream separately
via `onDidCompleteThinkingPhase`).

## Commands

Available through Command Palette (`Ctrl+Shift+P`):

### Core Cognitive Commands
- `Zone-Cog: Test Cognitive Processing` — Interactive query processing with full protocol
- `Zone-Cog: Toggle Thinking Mode` — Enable/disable comprehensive thinking
- `Zone-Cog: Show Status` — Display cognitive state, membrane health, hypergraph stats
- `Zone-Cog: Explore Hypergraph Knowledge Store` — Browse hypergraph by node type
- `Zone-Cog: Set Cognitive Focus` — Set attentional focus for embodied cognition
- `Zone-Cog: Show Cognitive Workspace Summary` — Working memory, episodes, tasks
- `Zone-Cog: Create Cognitive Task` — Create and activate a task context
- `Zone-Cog: Show Membrane Triad Health` — Cerebral/Somatic/Autonomic status
- `Zone-Cog: Reset Cognitive Workbench` — Clear all state
- `Zone-Cog: Show Query History` — Recent query processing history
- `Zone-Cog: Show ECAN Attention Snapshot` — Attention network diagnostics
- `Zone-Cog: Run ECAN Spreading Activation` — Manual spreading activation trigger
- `Zone-Cog: Toggle Cognitive Loop` — Start/stop the autonomous cognitive cycle
- `Zone-Cog: Show Cognitive Loop Status` — Loop iterations and performance
- `Zone-Cog: Detect Interaction Patterns` — Mine recorded interactions for frequency, sequence, and cadence patterns

### Phase 4 - DTESN, AAR, Persistence
- `Zone-Cog: Run DTESN Forward Pass` — Test the Deep Tree Echo State Network
- `Zone-Cog: Show DTESN Network Status` — View neural network diagnostics
- `Zone-Cog: AAR: Orchestrate Cognitive Task` — Route tasks through the agent network
- `Zone-Cog: Show AAR Arena Status` — View agents and orchestration stats
- `Zone-Cog: Save Hypergraph to IndexedDB` — Persist knowledge graph
- `Zone-Cog: Load Hypergraph from IndexedDB` — Restore knowledge graph
- `Zone-Cog: Show Hypergraph Persistence Stats` — View storage statistics

### Phase 5 - Schema Perception, Aphrodite Engine
- `Zone-Cog: Perceive Database Schema` — Discover schema elements as sensory inputs
- `Zone-Cog: Show Schema Perception Stats` — View query statistics and patterns
- `Zone-Cog: Register Schema in Hypergraph` — Create knowledge nodes from schema
- `Zone-Cog: Connect to Aphrodite Engine` — Connect to local LLM inference
- `Zone-Cog: Show Aphrodite Engine Status` — View model and performance stats
- `Zone-Cog: Run Aphrodite Completion` — Test LLM inference
- `Zone-Cog: Index Hypergraph for Semantic Search` — Embed hypergraph nodes for similarity search (`IAphroditeService.embed()` when connected, local hashing-trick fallback otherwise)
- `Zone-Cog: Semantic Search Hypergraph` — Rank hypergraph nodes by cosine similarity to a natural-language query

### Phase 6 - Cognitive Workflow Automation
- `Zone-Cog: List Cognitive Workflows` — View all registered workflows
- `Zone-Cog: Execute Cognitive Workflow` — Run a workflow manually
- `Zone-Cog: Show Workflow Execution History` — View recent executions
- `Zone-Cog: Toggle Workflow Enabled` — Enable/disable a workflow

### Phase 3.4 / 4.4 - Shared and Federated Cognition
- `Zone-Cog: Toggle Shared Cognition Session` — Sync hypergraph node/link upserts with other workbench windows on this machine
- `Zone-Cog: Toggle Federated Query Session` — Join same-machine query federation so hypergraph queries also search other windows
- `Zone-Cog: Run Federated Hypergraph Query` — Search this window (and any joined peer windows) by keyword/type/salience
- `Zone-Cog: Toggle Collaborative Reasoning Session` — Stream this window's thinking phases live to other workbench windows on this machine and merge peer phases into a unified transcript
- `Zone-Cog: Show Collaborative Session Log` — View the merged transcript of own and peer thinking phases and annotations
- `Zone-Cog: Annotate Latest Collaborative Phase` — Attach a shared remark to the most recent phase in the transcript (own or a peer's)

## Panel Views

The Zone-Cog panel (View > Zone-Cog) includes seven dashboard views:

1. **Cognitive State** — Overall system status, thinking mode, node count
2. **Membrane Health** — Cerebral/Somatic/Autonomic triad health
3. **ECAN Attention** — Attention values and spreading activation
4. **Working Memory** — Current working memory items
5. **DTESN Network** — Neural network layers and spectral radii
6. **AAR Orchestration** — Agent network and task orchestration
7. **Workflows** — Registered workflows and execution history

## File Structure

```
services/zonecog/
├── common/
│   ├── zonecogService.ts          # Interfaces: IZoneCogService, IHypergraphStore,
│   │                              #   ICognitiveMembraneService, types
│   ├── llmProvider.ts             # ILLMProviderService interface and types
│   ├── embodiedCognition.ts       # IEmbodiedCognitionService interface and types
│   ├── cognitiveWorkspace.ts      # ICognitiveWorkspaceService interface and types
│   ├── ecanAttention.ts           # IECANAttentionService interface and types
│   ├── cognitiveLoop.ts           # ICognitiveLoopService interface and types
│   ├── dtesn.ts                   # IDTESNService interface and types
│   ├── aarOrchestration.ts        # IAAROrchestrationService interface and types
│   ├── hypergraphPersistence.ts   # IHypergraphPersistenceService interface
│   ├── schemaPerception.ts        # ISchemaPerceptionService interface
│   ├── aphrodite.ts               # IAphroditeService interface (LLM engine)
│   ├── cognitiveAgents.ts         # Cognitive agent interfaces
│   └── cognitiveWorkflowAutomation.ts # Workflow DSL and automation
├── browser/
│   ├── zonecogService.ts          # ZoneCogService implementation
│   ├── hypergraphStore.ts         # HypergraphStore implementation
│   ├── cognitiveMembraneService.ts # CognitiveMembraneService implementation
│   ├── llmProviderService.ts      # LLMProviderService implementation
│   ├── embodiedCognitionService.ts # EmbodiedCognitionService implementation
│   ├── cognitiveWorkspaceService.ts # CognitiveWorkspaceService implementation
│   ├── ecanAttentionService.ts    # ECANAttentionService implementation
│   ├── cognitiveLoopService.ts    # CognitiveLoopService implementation
│   ├── dtesnService.ts            # DTESNService (neural reservoir)
│   ├── aarOrchestrationService.ts # AAROrchestrationService (agents)
│   ├── hypergraphPersistenceService.ts # IndexedDB persistence
│   ├── schemaPerceptionService.ts # Schema perception
│   ├── aphroditeService.ts        # Aphrodite LLM engine
│   ├── sqlAnalyzerAgent.ts        # SQL analysis agent
│   ├── schemaReasonerAgent.ts     # Schema reasoning agent
│   ├── performanceAdvisorAgent.ts # Performance advisor agent
│   ├── dataPatternAgent.ts        # Data pattern agent
│   ├── cognitiveWorkflowAutomationService.ts # Workflow engine
│   └── zonecog.contribution.ts    # DI service registration
├── test/
│   └── browser/
│       └── *.test.ts              # Tests for all services
└── README.md                      # This file
```

## Development

### Adding New Node Types

Add nodes to the hypergraph store from anywhere with access to `IHypergraphStore`:

```typescript
store.addNode({
  id: 'unique-id',
  node_type: 'MyCustomNode',
  content: 'payload',
  links: [],
  metadata: { custom: 'data' },
  salience_score: 0.5,
});
```

### Listening to Events

```typescript
// React to cognitive state changes
zoneCogService.onDidChangeCognitiveState(state => {
  console.log('Load:', state.cognitiveLoad, 'Healthy:', state.membraneHealthy);
});

// React to completed queries
zoneCogService.onDidProcessQuery(response => {
  console.log('Phases:', response.phases.map(p => p.name).join(' → '));
});

// React to LLM provider changes
llmProviderService.onDidChangeProvider(config => {
  console.log('Now using:', config.displayName);
});

// React to streaming response tokens as they arrive
zoneCogService.onDidStreamResponseToken(({ query, token }) => {
  process.stdout.write(token);
});
```

## Related Documentation

- [Implementation Strategy](../../../docs/ZONECOG_STRATEGY.md)
- [Development Roadmap](../../../docs/ZONECOG_ROADMAP.md)
- [Zone-Cog Protocol Specification](../../../ZONECOG.md)
- [Implementation Summary](../../../ZONECOG_IMPLEMENTATION.md)
