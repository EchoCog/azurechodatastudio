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

### Services (8 total)

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

### Phase 6 - Cognitive Workflow Automation
- `Zone-Cog: List Cognitive Workflows` — View all registered workflows
- `Zone-Cog: Execute Cognitive Workflow` — Run a workflow manually
- `Zone-Cog: Show Workflow Execution History` — View recent executions
- `Zone-Cog: Toggle Workflow Enabled` — Enable/disable a workflow

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
```

## Related Documentation

- [Implementation Strategy](../../../docs/ZONECOG_STRATEGY.md)
- [Development Roadmap](../../../docs/ZONECOG_ROADMAP.md)
- [Zone-Cog Protocol Specification](../../../ZONECOG.md)
- [Implementation Summary](../../../ZONECOG_IMPLEMENTATION.md)
