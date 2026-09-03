# ZoneCog Hypergraph Visualization & Animation Suite

**Status**: Phase 6 (Visual Integration) — core suite implemented
**Scope**: `src/sql/workbench/services/zonecog/` + `src/sql/workbench/contrib/zonecog/`

This document catalogues every hypergraph visualization and animation in the
Zone-Cog cognitive workbench, its data sources, and its integration points
with host Azure Data Studio features.

---

## Shared foundation: `IHypergraphVisualizationService`

All views render through one shared engine
(`services/zonecog/common/hypergraphVisualization.ts`,
`browser/hypergraphVisualizationService.ts`):

- **Force-directed simulation core** — extracted/generalized from the
  original explorer; layout positions persist across rebuilds; node budget
  capped (default 120, top-salience); pin/move support for drag interaction.
- **Node-type color registry** — explicit registrations override a
  deterministic HSL hash fallback; reused by every view so a node type has
  the same color everywhere.
- **Selection bus** — `focusNode(nodeId, source)` fires `onDidFocusNode`;
  every view highlights the same node; `zonecog.focusNode` is the single
  command entry point.
- **Animation channels** — `pulse` (node birth/ECAN boost), `decay` (salience
  decay/rent eviction), `flow` (packets along edges: link creation, ECAN
  diffusion, PLN inference, AAR task paths, membrane traffic), `trail`
  (focus/provenance/episodic highlight). Effects are auto-synthesized from
  `IHypergraphStore` and `IECANAttentionService` events, expire by duration,
  and are culled per frame against each renderer's viewport.
- **One requestAnimationFrame clock** — renderers attach via
  `attachRenderer(cb)` (disposable); the loop runs only while a renderer is
  attached, there is simulation work, or animations are live. Low-power mode
  (`zonecog.visualize.toggleLowPower`) suspends continuous animation.

## View catalogue (Zone-Cog panel container)

| # | View | File | Data sources | Animations |
|---|---|---|---|---|
| 10 | **Hypergraph Explorer** | `zonecogHypergraphView.ts` | `IHypergraphStore`, `IHypergraphSemanticSearchService` | pulse/decay/flow/trail, hover tooltip, click-inspect pane, drag/pin, zoom/pan, type filter chips, semantic search highlights, link-type edge styling (dashed for monitors/modulates/SimilarTo), keyboard walk (arrows + Enter/Esc) |
| 13 | **Attention Heatmap** | `zonecogVisualizationViews.ts` | `IECANAttentionService` (STI/LTI, focus boundary), shared simulation | focus glow halos, spread pulses, rent-eviction flashes, diffusion packets |
| 14 | **Thinking Timeline** | `zonecogInsightViews.ts` | `IZoneCogService.onDidCompleteThinkingPhase`, `ICognitiveTraceService` replay | swim-lane bars with duration-proportional width and CSS grow-in animation |
| 15 | **Membrane Triads** | `zonecogVisualizationViews.ts` | `ICognitiveMembraneService` statuses + activity | pulsing triad rings (rate tied to recent activity), inter-membrane flow packets, health-colored rings |
| 16 | **Episode Timeline** | `zonecogInsightViews.ts` | `ICognitiveWorkspaceService` episodes | scrubber re-highlights episode nodes via `trail` animations + selection bus |
| 17 | **DTESN Reservoir** | `zonecogVisualizationViews.ts` | `IDTESNService` ticks, `ICognitiveAnalyticsService` MSE history | live activation scatter per layer, spectral-radius gauges, convergence sparkline |
| 18 | **AAR Graph** | `zonecogVisualizationViews.ts` | `IAAROrchestrationService` agents/relations/tasks | task-completion flow packets along the agent path, role-colored agents, relation-styled directed edges |
| 19 | **Provenance Chains** | `zonecogInsightViews.ts` | `ICognitiveProvenanceService` audit trail + transitive chains | step-through `trail` pulses over chain hops (depth-ordered) |
| 20 | **PLN Inference** | `zonecogInsightViews.ts` | `IPLNReasoningService.onDidInferLink` | materializing deduction edges (`flow` packets with truth values in payload) |

Plus upgraded **Schema-Cognition Map** (view 12): cognition overlay counting
nodes/changes/decisions per table, provenance trail counts, and click-to-focus
deep links into the shared hypergraph views.

## Host-feature integration points

| Host feature | Integration | File |
|---|---|---|
| Connections | `onConnect`/`onDisconnect` → `SensoryPercept` nodes + pulse animation | `zonecogHostIntegration.contribution.ts` |
| Editors (all) | Active-editor changes → throttled interaction percepts | same |
| Object Explorer | Context menu **Show in Hypergraph** focuses the most salient node mentioning the selected schema element | same (`MenuId.ObjectExplorerItemContext`) |
| Command Palette | `zonecog.focusNode`, `zonecog.visualize.openView`, `zonecog.visualize.exportSnapshot` (JSON + layout), `zonecog.visualize.exportImage` (PNG), `zonecog.visualize.toggleLowPower` | same |
| Zone-Cog panel | 9 new registered views (orders 13–20), all `canToggleVisibility` | `zonecogPanel.contribution.ts` |
| Schema map | Per-table cognition overlay with provenance counts | `zonecogSchemaMapView.ts` |

Percepts recorded by host integration flow through the existing
`EmbodiedCognitionService` → hypergraph → animation pipeline, so every host
event is immediately visible across all visualizations.

## Performance guards

- Node budget (default 120, clamp 10–1000) with top-salience culling.
- Viewport culling of animations per renderer.
- Frame clock suspends with no renderers attached or when low-power mode on.
- Debounced rebuilds via `RunOnceScheduler` (500 ms) on store changes.
- `prefers-reduced-motion` honored for CSS animations; the workbench
  `workbench.reduceMotion` accessibility setting additionally suspends the
  shared canvas animation clock (low-power semantics) via
  `IAccessibilityService.isMotionReduced()`, re-arming when motion is no
  longer reduced.

## Accessibility

- Explorer canvas: `role="application"`, aria-label, arrow-key node walk,
  Enter to inspect, Escape to clear.
- Filter chips and list items keyboard-activatable (`role="button"`, tabIndex).
- All colors via VS Code theme tokens (`--vscode-*`).
- Reduced motion: continuous canvas animation suspends when
  `IAccessibilityService.isMotionReduced()` is true (driven by
  `workbench.reduceMotion`), and resumes on `onDidChangeReducedMotion`.

## Verification

- `bash scripts/test-zonecog-smoke.sh` — gates service count (≥40), action
  count (≥80 across both contributions), all 9 visualization view
  registrations, and visualization service/test file presence.
- Unit tests: `services/zonecog/test/browser/hypergraphVisualizationService.test.ts`
  (simulation budgets, layout persistence, pinning, edge filtering, color
  registry, selection bus, animation synthesis/culling, perf guards).
- Type-check: scoped tsconfig `tsc --noEmit` — 0 errors in zonecog files.
