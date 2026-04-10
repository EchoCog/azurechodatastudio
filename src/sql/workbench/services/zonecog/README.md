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
- **Cognitive Query History**: Hypergraph-persisted query tracking with salience decay

## Architecture

### Cognitive Membrane Triads

The system implements the P-System Membrane Architecture:

| Triad | Role | Components |
|---|---|---|
| **Cerebral** | Core cognitive processing | `ZoneCogService`, thinking protocol |
| **Somatic** | Extension & UI interaction | Command Palette, bridge extension |
| **Autonomic** | Health monitoring & validation | `CognitiveMembraneService`, error tracking |

### Services

| Service | Interface | Implementation |
|---|---|---|
| Zone-Cog Core | `IZoneCogService` | `ZoneCogService` |
| Hypergraph Store | `IHypergraphStore` | `HypergraphStore` |
| Cognitive Membrane | `ICognitiveMembraneService` | `CognitiveMembraneService` |
| LLM Provider | `ILLMProviderService` | `LLMProviderService` |

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

- `Zone-Cog: Test Cognitive Processing` — Interactive query processing with full protocol
- `Zone-Cog: Toggle Thinking Mode` — Enable/disable comprehensive thinking
- `Zone-Cog: Show Status` — Display cognitive state, membrane health, hypergraph stats

## File Structure

```
services/zonecog/
├── common/
│   ├── zonecogService.ts          # Interfaces: IZoneCogService, IHypergraphStore,
│   │                              #   ICognitiveMembraneService, types
│   └── llmProvider.ts             # ILLMProviderService interface and types
├── browser/
│   ├── zonecogService.ts          # ZoneCogService implementation
│   ├── hypergraphStore.ts         # HypergraphStore implementation
│   ├── cognitiveMembraneService.ts # CognitiveMembraneService implementation
│   ├── llmProviderService.ts      # LLMProviderService implementation
│   └── zonecog.contribution.ts    # DI service registration
├── test/
│   └── browser/
│       └── zonecogService.test.ts # Tests for all four services
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
