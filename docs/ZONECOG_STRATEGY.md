# ZoneCog Implementation Strategy

**Ticket**: ECH-3  
**Status**: Active  
**Last Updated**: 2026-04-10

## Executive Summary

ZoneCog transforms the Azure Data Studio (ADS) fork into an embodied cognition workbench before ADS retirement (Feb 28, 2026). The strategy prioritizes a **layered, additive approach** that preserves full ADS backward compatibility while progressively introducing cognitive capabilities through the Zone-Cog protocol, hypergraph-based knowledge representation, and the Cognitive Membrane architecture.

## Strategic Principles

### 1. Minimal Fork Delta
- Keep ADS core modifications surgical and isolated
- Prefer extension/contribution patterns over core changes
- Abstract ADS-specific APIs behind interfaces for post-retirement portability

### 2. Cognitive Membrane Architecture
Map the system to the P-System Membrane Architecture used across EchoCog:

| Membrane Layer | Triad | Responsibility | Implementation |
|---|---|---|---|
| **Cognitive Membrane** | Cerebral | Core cognitive processing, thinking protocol, reasoning | `services/zonecog/` |
| **Extension Membrane** | Somatic | Plugin container, UI interactions, bridge communication | `contrib/zonecog/`, `extensions/zonecog-bridge/` |
| **Security Membrane** | Autonomic | Validation, state monitoring, error correction | Integrated validation layer |

### 3. Hypergraph-First Knowledge Representation
All cognitive state flows through a hypergraph store following the EchoCog standard `HypergraphNode` structure (`id`, `node_type`, `content`, `links`, `metadata`, `salience_score`). This enables:
- Unified representation of SQL schemas, cognitive states, and reasoning chains
- Compatibility with AtomSpace and other EchoCog subsystems
- Salience-based attention allocation (ECAN-compatible)

### 4. Protocol Fidelity
The Zone-Cog cognitive protocol from the specification must be implemented faithfully:
- Adaptive thinking framework with complexity-scaled depth
- Full cognitive sequence: Initial Engagement → Problem Space Exploration → Hypothesis Generation → Natural Discovery → Verification → Synthesis
- Authentic stream-of-consciousness internal monologue
- Recursive thinking at macro and micro levels

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   ZoneCog Workbench                   │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │         Cerebral Triad (Cognitive Core)          │ │
│  │  ZoneCogService ← IZoneCogService               │ │
│  │  HypergraphStore ← IHypergraphStore             │ │
│  │  CognitiveMembraneService                        │ │
│  │  ThinkingProtocol (full Zone-Cog sequence)       │ │
│  └─────────────────────────────────────────────────┘ │
│                         ↕                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │        Somatic Triad (Extension Layer)           │ │
│  │  Command Palette Actions                         │ │
│  │  ZoneCog Bridge Extension (VS Code compatible)   │ │
│  │  Python Sidecar Bridge (FastAPI)                 │ │
│  │  SQL→AtomSpace Mapping                           │ │
│  └─────────────────────────────────────────────────┘ │
│                         ↕                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │       Autonomic Triad (Validation Layer)         │ │
│  │  State Monitoring & Health Checks                │ │
│  │  Error Recognition & Correction                  │ │
│  │  Quality Metrics & Verification                  │ │
│  │  Cognitive Load Management                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │            Azure Data Studio Core                 │ │
│  │  (Unmodified except service registration)         │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Key Technical Decisions

### Service Architecture
- Follow ADS `IService`/`ServiceImpl` pattern with dependency injection
- Register services via `registerSingleton` in contribution files
- Use `Disposable` base class for proper lifecycle management
- Emit events via `Emitter<T>` for reactive state changes

### Python Bridge Communication
- Localhost HTTP bridge (default `127.0.0.1:7807`) decouples cognitive backend
- FastAPI sidecar with pluggable AtomSpace adapter
- Proper package structure with `__init__.py`
- Address all PR #7 Copilot review findings

### Data Flow
1. User query → ZoneCogService → Cognitive processing (full protocol)
2. Schema/table data → SQL→AtomSpace mapping → HypergraphStore
3. Hypergraph state → Reasoning engine → Response generation
4. Cognitive events → UI notifications → User feedback

### VS Code Portability
- All extension code uses standard VS Code APIs
- ADS-specific APIs wrapped behind abstraction interfaces
- Bridge pattern enables running cognitive services independently
- Extension manifest (`package.json`) compatible with VS Code marketplace

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| ADS retirement (Feb 2026) | VS Code-compatible extension surface; sidecar bridge runs independently |
| Fork drift from upstream | Minimal core changes; additive-only approach |
| Performance impact | Async processing; cognitive load monitoring; configurable depth |
| Complexity explosion | Phased delivery; clear membrane boundaries; comprehensive tests |
| AtomSpace unavailability | Mock adapter fallback; local hypergraph store as primary |

## Success Criteria

1. All ADS existing functionality preserved (zero breaking changes)
2. Full Zone-Cog cognitive protocol implemented and testable
3. Hypergraph store operational with standard HypergraphNode structure
4. Cognitive Membrane architecture cleanly separating concerns
5. Python bridge issues resolved and properly packaged
6. Comprehensive test coverage for all new services
7. Strategy and roadmap documents complete and actionable
