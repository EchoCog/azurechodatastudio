# Goal: ZoneCog protocol conformance with ZONECOG.md

## User Request

`/goal @[ZONECOG.md]` — align the Zone-Cog Cognitive Workbench subsystem with the
Zone-Cog cognitive protocol specification in `ZONECOG.md` (repo root).

## Refined Goal

Audit the ZoneCog subsystem (`src/sql/workbench/services/zonecog/`) against the
protocol specification in `ZONECOG.md` and close any conformance gaps. The spec
defines an Adaptive Thinking Framework, an 11-phase Core Thinking Sequence
(Initial Engagement, Problem Space Exploration, Multiple Hypothesis Generation,
Natural Discovery Process, Testing and Verification, Error Recognition and
Correction, Knowledge Synthesis, Pattern Recognition and Analysis, Progress
Tracking, Recursive Thinking, Response Preparation), Verification and Quality
Control (Systematic Verification, Error Prevention, Quality Metrics), Advanced
Thinking Techniques (Domain Integration, Strategic Meta-Cognition, Synthesis
Techniques), Critical Elements (Natural Language markers, Progressive
Understanding), Authentic Thought Flow (Transitional Connections, Depth
Progression, Handling Complexity, Problem-Solving Approach), Essential
Characteristics (Authenticity, Balance, Focus), and Response Preparation rules.
The `ZoneCogService` implementation must demonstrably cover these protocol
elements, with adaptive depth scaling (simple/moderate/complex →
shallow/moderate/deep), and comprehensive unit tests must verify each phase and
protocol property.

## Acceptance Criteria

- [ ] Criterion 1: All 11 Core Thinking Sequence phases from ZONECOG.md are
      implemented in `browser/zonecogService.ts` and produce non-empty
      `ThinkingPhase` content when exercised at the appropriate depth.
- [ ] Criterion 2: Adaptive depth scaling exists and is tested — simple queries
      run a reduced phase set; complex queries run the full set including
      Recursive Thinking; Response Preparation always runs.
- [ ] Criterion 3: Thinking output uses natural-language markers from the spec
      (e.g. "Hmm...", "Wait, let me think about...", "This is interesting
      because...", transitional/depth-progression phrases) — verified by tests.
- [ ] Criterion 4: Verification & Quality Control is represented: the response
      carries a confidence score in [0,1] and the Testing and Verification /
      Error Recognition phases check earlier phase output (not static text).
- [ ] Criterion 5: Protocol state is persisted to the hypergraph store using the
      EchoCog `HypergraphNode` schema (id, node_type, content, links, metadata,
      salience_score), and membrane activity is recorded (cerebral triad) during
      processing.
- [ ] Criterion 6: `src/sql/workbench/services/zonecog/test/browser/zonecogService.test.ts`
      contains passing-style tests covering criteria 1–5 (per-phase presence,
      depth scaling, natural language markers, confidence bounds, hypergraph
      persistence).
- [ ] Criterion 7: `node node_modules\typescript\bin\tsc --noEmit -p src\tsconfig.json`
      reports **zero errors mentioning "zonecog"**. (Baseline note: 16
      pre-existing error lines exist in node_modules / vs test files unrelated
      to zonecog because deps were installed with `--ignore-scripts`; those are
      out of scope and must not increase.)

## Scope Boundaries

**In scope:**
- `src/sql/workbench/services/zonecog/common/zonecogService.ts`
- `src/sql/workbench/services/zonecog/browser/zonecogService.ts`
- `src/sql/workbench/services/zonecog/test/browser/zonecogService.test.ts`
- Small supporting edits in other zonecog files only if required for conformance.

**Out of scope:**
- Non-zonecog parts of Azure Data Studio.
- The 16 pre-existing baseline tsc errors (node_modules, vs platform tests).
- UI/contrib work, LLM provider backends, Python bridge.
- Running the full ADS unit-test runner (environment lacks compiled output);
  test verification is by tsc type-checking the test file and code review.

## Applicable Project Conventions

**Quality gate command:**
- `node node_modules\typescript\bin\tsc --noEmit -p src\tsconfig.json`
  (prefix PATH with `C:\Users\d\AppData\Roaming\fnm\node-versions\v20.20.2\installation`)
- Gate passes when no output line contains "zonecog" and total error lines ≤ 16.

**Commit convention:**
- Conventional commits, ≤72 char title, `[B]`/`[I]` role marker.
- Trailer: `Assisted-by: Claude:Sonnet-4.6` (Builder) / `Claude:Haiku-4.5` (Inspector).
- Also include: `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`

**Guidelines:**
- `.github/copilot-instructions.md` — ZoneCog conventions (service pattern,
  DI decorators, `this._register(new Emitter<T>())`, membrane activity
  recording, HypergraphNode schema, no mocks/placeholders).

**Rules:**
- NEVER create mock/placeholder implementations — production-ready only.
- ALWAYS record membrane activity for service operations.
- ALWAYS use the EchoCog HypergraphNode standard.
- Tests use `TestInstantiationService` + `NullLogService` with real dependency
  instances, not mocks.
