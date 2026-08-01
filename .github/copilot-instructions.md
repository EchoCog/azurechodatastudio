# GitHub Copilot Instructions for ZoneCog Development

## Project Context

This is **azurechodatastudio** — a fork of Azure Data Studio transformed into the **Zone-Cog Cognitive Workbench**, an experimental embodied cognition platform for data analysis. The Zone-Cog subsystem implements a comprehensive cognitive protocol engine with hypergraph-based knowledge representation, membrane computing architecture, and sensorimotor grounding.

## ZoneCog Architecture

All ZoneCog code lives under `src/sql/workbench/services/zonecog/` and `src/sql/workbench/contrib/zonecog/`.

### Core Services (8 total)

1. **ZoneCogService** (`IZoneCogService`) — 11-phase adaptive thinking protocol
2. **HypergraphStore** (`IHypergraphStore`) — EchoCog-standard knowledge graph
3. **CognitiveMembraneService** (`ICognitiveMembraneService`) — P-System Cerebral/Somatic/Autonomic triads
4. **LLMProviderService** (`ILLMProviderService`) — Pluggable LLM backends
5. **EmbodiedCognitionService** (`IEmbodiedCognitionService`) — Sensorimotor grounding loop
6. **CognitiveWorkspaceService** (`ICognitiveWorkspaceService`) — Working memory, episodic memory, tasks
7. **ECANAttentionService** (`IECANAttentionService`) — Economic Attention Network
8. **CognitiveLoopService** (`ICognitiveLoopService`) — Autonomous cognitive cycle

### Service Registration

All services are registered in `src/sql/workbench/services/zonecog/browser/zonecog.contribution.ts` using `registerSingleton(IFoo, FooService, InstantiationType.Eager)`.

### Command Palette Actions (14 total)

Registered in `src/sql/workbench/contrib/zonecog/browser/zonecogActions.contribution.ts`. All use `Action2` + `registerAction2` pattern with `MenuId.CommandPalette`.

## Coding Conventions

### Service Pattern
```
Interface:      common/<name>.ts     — createDecorator + interface + types
Implementation: browser/<name>Service.ts — extends Disposable implements IFoo
Registration:   browser/zonecog.contribution.ts — registerSingleton
```

### Required Patterns
- Use `this._register(new Emitter<T>())` for events
- Use `@ILogService`, `@IHypergraphStore`, `@ICognitiveMembraneService` DI decorators
- Record membrane activity: `membraneService.recordActivity('cerebral'|'somatic'|'autonomic')`
- Persist important state as hypergraph nodes
- Follow `HypergraphNode` schema: `{ id, node_type, content, links, metadata, salience_score }`

### Testing
- Tests in `src/sql/workbench/services/zonecog/test/browser/zonecogService.test.ts`
- Use `TestInstantiationService` + `NullLogService`
- Create real instances of dependencies, not mocks

## Critical Rules

1. **NEVER** create mock/placeholder/simulated implementations — production-ready only
2. **NEVER** call external APIs directly — use `ILLMProviderService.complete()`
3. **ALWAYS** register new services in `zonecog.contribution.ts` with `InstantiationType.Eager`
4. **ALWAYS** record membrane activity for service operations
5. **ALWAYS** use the EchoCog `HypergraphNode` standard for knowledge representation
6. **ALWAYS** test new services with comprehensive unit tests

## Build & Test

```bash
# TypeScript compilation check
npx tsc --noEmit -p src/tsconfig.json

# Python bridge tests
python -m pytest azure_integration/tests/ -v --tb=short
```
