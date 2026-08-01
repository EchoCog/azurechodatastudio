# Goal: ZoneCog AGI Studio — Agent-Zero-style autonomous agent orchestration

## User Request

"implement zonecog agi studio" with context `/agent-zero [ "zonecog" ]` — build an
Agent-Zero-inspired AGI Studio for the ZoneCog cognitive workbench.

## Refined Goal

Implement an **AGI Studio** subsystem for the ZoneCog cognitive workbench: a new
`IAgiStudioService` that provides Agent-Zero-style hierarchical autonomous agents.
An Agent-Zero model means: a root studio agent receives a goal from the user; any
agent can **spawn subordinate agents** to delegate decomposed subtasks (forming a
superior/subordinate tree); agents communicate via **direct inter-agent messages**
(superior→subordinate task assignment, subordinate→superior result reporting);
agents solve tasks using **tools** — the existing specialized cognitive agents
(SQL Analyzer, Schema Reasoner, Performance Advisor, Data Pattern), LLM completion
via `ILLMProviderService`, and memory recall/save; each agent keeps **agent-local
memory** in addition to the shared cognitive workspace; and every run persists its
state to the hypergraph. The Studio is surfaced in the workbench via a new
"AGI Studio" view in the existing Zone-Cog panel plus Command Palette actions to
launch a goal, inspect the agent tree, and stop a run.

## Acceptance Criteria

- [ ] Criterion 1 — **Service contract**: A new interface file
      `src/sql/workbench/services/zonecog/common/agiStudio.ts` defines
      `IAgiStudioService` (via `createDecorator`) with types for:
      `StudioAgent` (id, name, role, superiorId, subordinateIds, status, depth,
      systemPrompt, createdAt, agent-local memory), `AgentMessage` (id, fromAgentId,
      toAgentId, messageType at minimum 'task-assignment' | 'result-report' |
      'status-update', content, timestamp), `StudioRun` (id, goal, rootAgentId,
      status 'running' | 'completed' | 'failed' | 'stopped', startTime, endTime?,
      result?), `AgentToolCall` (toolId, input, output, success, durationMs), and
      events (`onDidChangeRun`, `onDidSpawnAgent`, `onDidSendMessage` or equivalent).
- [ ] Criterion 2 — **Hierarchical spawning & delegation**: The implementation
      `browser/agiStudioService.ts` lets an agent spawn subordinate agents
      (`spawnSubordinate`-style API) forming a tree rooted at agent depth 0; a
      configurable max depth (default ≥ 2) and max total agents cap prevent runaway
      growth; subordinates receive task assignments as `AgentMessage`s and report
      results back to their superior as `AgentMessage`s; the full message log per
      run is queryable.
- [ ] Criterion 3 — **Autonomous run loop with tools**: `startRun(goal)` executes
      an autonomous loop: the root agent decomposes the goal (via
      `ILLMProviderService.complete()` — never direct API calls; built-in fallback
      must work with no API keys), delegates subtasks to spawned subordinates,
      subordinates execute using at least 4 registered tools that wrap the existing
      specialized agents (`ISQLAnalyzerAgent`, `ISchemaReasonerAgent`,
      `IPerformanceAdvisorAgent`, `IDataPatternAgent`) plus an LLM-reasoning tool
      and memory tools (save/recall drawing on agent-local memory and
      `ICognitiveWorkspaceService` episodic memory); tool invocations are recorded
      as `AgentToolCall`s; the run completes with a synthesized result on the
      `StudioRun`; `stopRun()` halts a running run and marks it 'stopped'.
- [ ] Criterion 4 — **ZoneCog integration**: All studio activity records membrane
      activity (`cerebral` for reasoning/decomposition, `somatic` for tool/LLM
      calls, `autonomic` for health/guard checks); runs, agents, and messages are
      persisted as hypergraph nodes following the EchoCog `HypergraphNode` schema
      (id, node_type, content, links, metadata, salience_score) with typed links
      connecting run → agents → messages; the service is registered in
      `browser/zonecog.contribution.ts` via
      `registerSingleton(IAgiStudioService, AgiStudioService, InstantiationType.Eager)`.
- [ ] Criterion 5 — **Studio UI**: A new `AgiStudioView` (ViewPane subclass, DOM
      built with `$`/`append`/`clearNode`, `localize()` for all strings,
      `zonecog-*` CSS classes) is registered in the existing Zone-Cog panel view
      container (`workbench.view.zonecog`) in `zonecogPanel.contribution.ts`,
      rendering current run status, the agent hierarchy (tree with roles/status),
      and recent agent messages, refreshing reactively via service events.
- [ ] Criterion 6 — **Command Palette actions**: At least 3 new `Action2` actions
      registered in `zonecogActions.contribution.ts` under the existing Zone-Cog
      category: `zonecog.agiStudio.startRun` (prompts for a goal via quick input),
      `zonecog.agiStudio.showStatus` (shows run/agent-tree summary), and
      `zonecog.agiStudio.stopRun`.
- [ ] Criterion 7 — **Tests**: A new
      `test/browser/agiStudioService.test.ts` suite using
      `TestInstantiationService` + `NullLogService` with **real instances** of
      dependency services (not mocks), covering: service init, run lifecycle
      (start → completed with non-empty result), hierarchical spawning (subordinate
      has correct superiorId/depth; caps enforced), inter-agent messaging (task
      assignment + result report present in message log), tool registry (≥ 6 tools;
      tool calls recorded), agent-local memory (save + recall), hypergraph
      persistence (nodes with expected node_types exist), membrane activity, event
      firing, and stopRun behavior. Minimum 12 test cases.
- [ ] Criterion 8 — **Quality gate**: `tsc --noEmit -p src/tsconfig.json` reports
      **zero errors mentioning "zonecog" or "agiStudio"** and no increase in total
      baseline error lines (baseline: 16 pre-existing error lines in
      node_modules / vs platform test files caused by `--ignore-scripts` install;
      those are out of scope).

## Scope Boundaries

**In scope:**
- New files: `common/agiStudio.ts`, `browser/agiStudioService.ts`,
  `test/browser/agiStudioService.test.ts`, and an `AgiStudioView` (either a new
  view file under `contrib/zonecog/browser/` or added to an existing views file).
- Edits to: `browser/zonecog.contribution.ts` (registration),
  `contrib/zonecog/browser/zonecogPanel.contribution.ts` (view registration),
  `contrib/zonecog/browser/zonecogActions.contribution.ts` (actions),
  `common/zonecog.ts` (view ID constant), zonecog CSS file for view styling,
  and `src/sql/workbench/services/zonecog/README.md` (document the new service).
- Reuse of existing services: LLM provider, hypergraph store, membrane service,
  cognitive workspace, specialized cognitive agents, ECAN (optional salience
  stimulation for active agents).

**Out of scope:**
- Modifying the existing `AAROrchestrationService` or
  `CognitiveWorkflowAutomationService` behavior (the Studio may *consume* services
  but must not change their contracts).
- Non-zonecog parts of Azure Data Studio; Python bridge; external network calls
  outside `ILLMProviderService`.
- The 16 pre-existing baseline tsc errors.
- Running the full ADS unit-test runner (environment lacks compiled output);
  test verification is by tsc type-checking the test file and code review.
- Real LLM API keys — everything must work with the built-in fallback provider.

## Applicable Project Conventions

**Quality gate command:**
- `node node_modules\typescript\bin\tsc --noEmit -p src\tsconfig.json`
  (prefix PATH with `C:\Users\d\AppData\Roaming\fnm\node-versions\v20.20.2\installation`)
- Gate passes when no output line contains "zonecog"/"agiStudio" and total error
  lines ≤ 16.
- Optionally `yarn sqllint` if runnable in this environment.

**Commit convention:**
- Conventional commits, ≤72 char title, `[B]`/`[I]` role marker.
- Trailer: `Assisted-by: Claude:Sonnet-4.6` (Builder) / `Claude:Haiku-4.5` (Inspector).
- Also include: `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`

**Guidelines:**
- `.github/copilot-instructions.md` and `.github/agents/zonecog.md` — ZoneCog
  conventions: service pattern (`createDecorator` in common/, `extends Disposable`
  impl in browser/, `registerSingleton(..., InstantiationType.Eager)`), events via
  `this._register(new Emitter<T>())`, constructor DI decorators, membrane activity
  recording, EchoCog HypergraphNode schema, no mocks/placeholders.

**Rules:**
- NEVER create mock/placeholder/simulated implementations — production-ready only.
- NEVER bypass `ILLMProviderService` for LLM calls; fallback must work keyless.
- NEVER mutate hypergraph nodes directly — use `addNode()`/`updateNode()`.
- ALWAYS record membrane activity for service operations.
- ALWAYS register the service in `zonecog.contribution.ts` with `Eager`.
- Tests use `TestInstantiationService` + `NullLogService` with real dependency
  instances, not mocks.
- View code: ViewPane subclass, `renderBody` override, DOM via
  `vs/base/browser/dom` helpers, `localize()` for user-visible strings.

## Reference: key existing shapes (from discovery)

- `HypergraphNode { id, node_type, content, links, metadata, salience_score }`;
  `HypergraphLink { id, link_type, outgoing, metadata }`; store API:
  `addNode/getNode/updateNode/getNodesByType/getTopSalientNodes`.
- `ICognitiveMembraneService.recordActivity('cerebral'|'somatic'|'autonomic')`.
- `ILLMProviderService.complete({ systemPrompt, userMessage, thinkingContext?, maxTokens?, temperature? }) → { content, providerId, isFallback }`.
- `ICognitiveWorkspaceService`: `addToWorkingMemory(category, content, relevance?)`,
  `recordEpisode(title, content, relatedNodes?)`, `searchEpisodes(keyword)`,
  `createTask(description, activate?)`.
- Specialized agents (registered singletons, injectable):
  `ISQLAnalyzerAgent.analyzeQuery()`, `ISchemaReasonerAgent.analyzeSchema()`,
  `IPerformanceAdvisorAgent.analyzePerformance()`, `IDataPatternAgent.detectPatterns()`.
- View container ID: `workbench.view.zonecog` (`ZONECOG_CONTAINER_ID` in
  `contrib/zonecog/common/zonecog.ts`); 7 existing views ordered 1–7 — the new
  AGI Studio view should take the next order slot.
