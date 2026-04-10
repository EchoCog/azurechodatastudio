# Zone-Cog Integration

This directory contains the Zone-Cog cognitive protocol integration for Azure Data Studio, transforming it into an experimental cognitive workbench.

## Overview

Zone-Cog implements a comprehensive thinking framework that enables natural, stream-of-consciousness cognitive processing for data analysis and management tasks. The integration provides:

- **Cognitive Protocol Service**: Full Zone-Cog thinking sequence (9 phases)
- **Hypergraph Store**: In-memory knowledge graph following the EchoCog HypergraphNode standard
- **Cognitive Membrane Architecture**: Cerebral / Somatic / Autonomic triad system
- **Adaptive Analysis**: Query complexity assessment and depth-appropriate thinking
- **Event-Driven State**: Reactive cognitive state management with change notifications

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

### Thinking Protocol Phases

The full Zone-Cog cognitive sequence (depth-adaptive):

1. **Initial Engagement** — Rephrase query, map knowns/unknowns (always)
2. **Problem Space Exploration** — Break down components, identify requirements (always)
3. **Hypothesis Generation** — Multiple interpretations, avoid premature commitment (moderate+)
4. **Natural Discovery** — Organic insight development, pattern connections (moderate+)
5. **Testing & Verification** — Question assumptions, check consistency (deep)
6. **Error Recognition** — Acknowledge and correct reasoning flaws (deep)
7. **Knowledge Synthesis** — Connect information, build coherent picture (deep)
8. **Pattern Recognition** — Analyze patterns using hypergraph context (deep)
9. **Response Preparation** — Final response formulation (always)

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
- Links typed as `ProducedBy` connect the processing chain

## Commands

Available through Command Palette (`Ctrl+Shift+P`):

- `Zone-Cog: Test Cognitive Processing` — Interactive query processing with full protocol
- `Zone-Cog: Toggle Thinking Mode` — Enable/disable comprehensive thinking
- `Zone-Cog: Show Status` — Display cognitive state, membrane health, hypergraph stats

## File Structure

```
services/zonecog/
├── common/
│   └── zonecogService.ts          # Interfaces: IZoneCogService, IHypergraphStore,
│                                  #   ICognitiveMembraneService, types
├── browser/
│   ├── zonecogService.ts          # ZoneCogService implementation
│   ├── hypergraphStore.ts         # HypergraphStore implementation
│   ├── cognitiveMembraneService.ts # CognitiveMembraneService implementation
│   └── zonecog.contribution.ts    # DI service registration
├── test/
│   └── browser/
│       └── zonecogService.test.ts # Tests for all three services
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
```

## Related Documentation

- [Implementation Strategy](../../../docs/ZONECOG_STRATEGY.md)
- [Development Roadmap](../../../docs/ZONECOG_ROADMAP.md)
- [Zone-Cog Protocol Specification](../../../ZONECOG.md)
- [Implementation Summary](../../../ZONECOG_IMPLEMENTATION.md)
