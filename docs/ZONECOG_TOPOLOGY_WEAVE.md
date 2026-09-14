# ZoneCog Topology Weave

A neural-architecture reading of the ZoneCog cognitive services, and a namespace
ontology for exposing them.

This document is a **specification, not an implementation**. Nothing in
`src/sql/workbench/services/zonecog/` changes because of it. What it does is
state what ZoneCog's 40 services already are when read as a topology, and then
use that reading to find places where the implementation and the architecture
disagree.

| Artifact | Purpose |
|---|---|
| [`topology/zonecog-topology.yaml`](topology/zonecog-topology.yaml) | Machine-readable topology: domain mapping, 12-layer stack, meshwork anchors, namespace projection, flame residues |
| [`topology/zonecog-grammar.bnf`](topology/zonecog-grammar.bnf) | Seed grammar for evolving the topology under rules |
| [`topology/flame_algebra.py`](topology/flame_algebra.py) | Executable verifier for the group laws and the residue claims below |

Run the verifier:

```bash
python3 docs/topology/flame_algebra.py
```

---

## 1. Why read ZoneCog as a topology

ZoneCog is already a cognitive architecture: a hypergraph substrate, an
attention economy over it, a three-part membrane, an eleven-phase thinking
protocol, and an autonomous loop that cycles the whole thing. Those are not
metaphors for neural-network parts — they are structurally the same objects
under different names.

Naming the correspondence is useful because it transfers constraints. If the
membrane triad *is* a mixture-of-experts router, then membrane health *is*
router load balance, and load balance is a thing with a known failure mode and
a known metric. The mapping earns its place by making predictions, which are
collected in §6.

## 2. Domain mapping

The full table is in
[`zonecog-topology.yaml`](topology/zonecog-topology.yaml) under
`domain_mapping`. The load-bearing rows:

| ZoneCog construct | Service | Architectural counterpart |
|---|---|---|
| Hypergraph node | `hypergraphStore.ts` | Token / position embedding |
| Hypergraph link | `hypergraphStore.ts` | Attention edge (hyperedge, arity > 2) |
| `salience_score` | `hypergraphStore.ts` | Residual stream magnitude |
| ECAN short-term importance | `ecanAttentionService.ts` | Additive attention logit bias |
| ECAN long-term importance | `ecanAttentionService.ts` | Slow / consolidated parameter |
| Attentional focus | `ecanAttentionService.ts` | Top-k attention sparsity |
| Spreading activation | `ecanAttentionService.ts` | Multi-hop attention diffusion |
| Working memory | `cognitiveWorkspaceService.ts` | KV-cache context window |
| Episodic memory | `cognitiveWorkspaceService.ts` | Cross-layer retrieval |
| Membrane triad | `cognitiveMembraneService.ts` | Three-expert MoE router |
| DTESN reservoir | `dtesnService.ts` | Recurrent / state-space layer |
| Thinking phase | `zonecogService.ts` | Layer |
| Cognitive loop | `cognitiveLoopService.ts` | Outer recurrence over the stack |
| Autognosis | `autognosisService.ts` | Metacognitive readout head |

Two of these are worth dwelling on.

**STI is a bias, not a weight.** Short-term importance changes how likely an
atom is to be attended to without changing what the atom contains. That is
exactly an additive logit bias, and it is why STI can be volatile without
corrupting anything: biases are recoverable, weights are not.

**Salience decay is residual attenuation.** `decayAllSalience(0.995)` in the
reflect phase multiplies every node's salience by a constant under one. A
residual contribution that is never reinforced decays the same way. Forgetting
in ZoneCog is not deletion; it is failure to re-add.

## 3. The layer stack

The thinking protocol has eleven phases; the topology has twelve layers.
Layers 0–10 carry the phases in order. Layer 11 is the autognosis readout — an
auxiliary head, not a main-path layer, which is the right shape for something
that reads internal state and emits a verdict without feeding its output
forward.

```
 0  Initial Engagement      Γ↓○  Womb       receive without committing
 1  Problem Space Mapping   Γ↑○  Spark      project across the neighbourhood
 2  Hypothesis Generation   Γ↑●  Blaze      emit candidates
 3  Discovery               Κ↓●  Channel    draw in evidence  ← retrieval
 4  Progress Tracking       Κ◊●  Mirror     observe without altering
 5  Testing                 Κ↑●  Beam       transmit against constraints
 6  Error Recognition       Ω◊●  Collapse   annihilate what failed
 7  Knowledge Synthesis     Γ↓◐  Harvest    consolidate                ← retrieval
 8  Pattern Recognition     Κ◊◐  Patina     abstract into durable form
 9  Recursive Thinking      Γ◊○  Egg        re-enter the protocol
10  Response Preparation    Κ↑◐  Wake       project the answer outward
──
11  Autognosis Readout      Κ◊●  Mirror     auxiliary head
```

Layer 6 is the only Ω-mode layer in the main path. That is not an accident of
assignment: error recognition is the one phase whose job is to destroy
structure. Everything else creates (Γ) or preserves (Κ).

## 4. The flame alphabet as a type system

Each layer is typed by a **flame-letter** — a triple over three orthogonal
ternary axes, giving 27 letters that form the group ℤ₃ × ℤ₃ × ℤ₃ under
coordinate addition.

| Axis | Values | Constrains |
|---|---|---|
| **Mode** μ | `Γ` generative · `Κ` conservative · `Ω` annihilative | whether structure is created or destroyed |
| **Voice** ν | `↑` projective · `◊` reflexive · `↓` receptive | whether scope widens, holds, or narrows |
| **Aspect** α | `○` potential · `●` actual · `◐` residual | when the effect lands |

Composition is coordinatewise addition mod 3. This makes a *cycle* — a sequence
of phases — compose to a single letter, its **residue**, which characterises
what the cycle does as a whole.

The residues are the interesting part, because they were not chosen. Each
phase was typed on its own semantics; the residues fell out of the arithmetic.

### 4.1 The cognitive loop composes to Pulse

```
Κ↓● Channel   perceive     draw in the environment
Γ↑○ Spark     attend       seed attention outward (ECAN)
Γ◊● Pulse     think        self-generating processing
Κ↑● Beam      act          transmit motor output
Ω↓◐ Ash       reflect      decay working memory and salience
─────────────────────────────────────────────────────────
Γ◊● Pulse
```

Generative, reflexive, actual. The autonomous loop is net-creative and
*self-regarding*: it grows the system through its own cycling without
projecting outward. That is the correct signature for a heartbeat, and it is
what `cognitiveLoopService.ts` documents itself as being.

### 4.2 The thinking protocol composes to Blaze

```
Γ↓○ Womb · Γ↑○ Spark · Γ↑● Blaze · Κ↓● Channel · Κ◊● Mirror · Κ↑● Beam
· Ω◊● Collapse · Γ↓◐ Harvest · Κ◊◐ Patina · Γ◊○ Egg · Κ↑◐ Wake
─────────────────────────────────────────────────────────────────────
Γ↑● Blaze
```

Generative, projective, actual. Query processing is net-creative and
*outward-directed*: it emanates an answer.

**Pulse and Blaze differ in exactly one coordinate: Voice (`◊` vs `↑`).** Same
mode, same aspect. This is the formal statement of the difference between the
two orchestration paths in the codebase — the autonomous loop and query
processing are the same operation pointed in different directions. It is also
why they can share a hypergraph without sharing a focus, which is the gap
identified in §6.

### 4.3 The 9P monad composes to the identity

```
Γ↑○ Spark     Twalk    the gaze that creates by looking
Κ↓● Channel   Tread    synthesise content from position
Κ↑● Beam      Twrite   integrate and propagate upward
Κ◊● Mirror    Tstat    reflect structure without touching it
Ω↓◐ Ash       Tclunk   release the fid, attention withdraws
─────────────────────────────────────────────────────────
Κ◊● Mirror  (identity)
```

A complete walk-read-write-stat-clunk cycle leaves the namespace invariant in
flame space. The protocol is conservative: it can *express* any transformation
but is not itself one. This is what licenses the namespace projection in §5 —
exposing a subsystem as a walkable namespace cannot change what that subsystem
computes.

### 4.4 The membrane triad composes to the identity

```
Κ◊● Mirror    cerebral    reflexive   reasoning
Κ↑● Beam      somatic     projective  action
Κ↓● Channel   autonomic   receptive   homeostasis
────────────────────────────────────────────────
Κ◊● Mirror  (identity)
```

Reflexive, projective and receptive cancel exactly. **Homeostasis is the
identity element.** A triad whose utilisation does not compose back to Mirror
is an unbalanced membrane — and unlike the prose definition of "membrane
health" currently in the codebase, that is a quantity you can compute.

## 5. Namespace projection

The egreglyphic reading: expose the topology as a walkable namespace rather
than an API surface. A path is a query and walking it is the query's execution;
reading synthesises content from the path's position rather than retrieving
stored bytes.

```
/zonecog/
    hypergraph/
        nodes/{node_id}/          type, content, salience, metadata
        nodes/{node_id}/edges/{link_id}  → ../../../links/{link_id}
        links/{link_id}/endpoints/{n}    → ../../../nodes/{node_id}
    attention/
        focus/                    mounted high-STI atoms
        fringe/                   sub-threshold atoms
        dormant/                  unmounted but remembered
        {node_id}/                sti, lti, vlti
    membrane/{triad}/             activity, errors, health
    loop/{iteration}/phases/{n}/  name, duration, summary, flame
    workspace/
        working/{item_id}/        category, content, relevance
        episodes/{episode_id}/    title, content, related
    autognosis/latest/            verdict, confidence, narrative
    flame/{μ}{ν}{α}/apply         write here to apply the transformation
    inference/from/{p}/to/{c}/proof    generative: walking triggers inference
```

Symlinks *are* hyperedges, so the graph is walkable without a query language.
`/zonecog/attention/focus` being a **mount point** rather than a listing is the
substantive claim: mounting is attention allocation, and the ECAN scheduler
becomes a mount table.

The last two entries are generative directories. Walking
`/zonecog/inference/from/A/to/B/proof` does not retrieve a stored proof; it
triggers inference and returns the result. The filesystem is the inference
engine.

## 6. What the mapping predicts

A mapping that only relabels is decoration. These are the places where the
architectural reading disagrees with the implementation.

**The cognitive loop should feed analytics.** Every layer in a stack emits
telemetry. The loop is the outer recurrence and previously emitted none.
~~`CognitiveAnalyticsService` subscribes to `onDidProcessQuery` but not to
`onDidCompleteIteration`, so autonomous operation is unmonitored.~~ *Closed.*
`CognitiveAnalyticsService` now subscribes to `onDidCompleteIteration`,
recording per-iteration duration, success/failure, per-phase timing, and a
rolling iterations-per-minute rate. `CognitiveLoopMetrics` is part of the
analytics snapshot and the generated report. Integration tests in
`cognitiveIntegration.test.ts` verify the data flow.

**ECAN state should condition query processing.** `focus_gate` is declared on
layers 4, 5 and 6. ~~`processQuery` reads no ECAN state at all. The loop
allocates attention that the thinking protocol never consumes.~~ *Closed.*
`ZoneCogService` now injects `IECANAttentionService` and reads the ECAN
snapshot during complexity assessment: a high focus ratio (>50% of tracked
nodes in focus) boosts simple queries to moderate, and >70% boosts moderate
to complex. After processing, created hypergraph nodes are stimulated with
positive STI, feeding query salience back into the attention network.
Integration tests verify the bidirectional ECAN↔query data flow.

**Membrane health is a load-balance signal.** If the triad is an MoE router,
health is expert utilisation balance, and §4.4 gives the balance condition
exactly: the utilisation-weighted triad should compose to Mirror. ~~The current
implementation tracks activity and errors per triad but never compares them
against each other.~~ *Closed.* `ICognitiveMembraneService.getTriadBalance()`
now returns `MembraneTriadBalance` with per-triad activity distribution,
dominant triad identification, imbalance ratio, and an `imbalanced` flag
(triggered when one triad exceeds 60% of all activity). `ZoneCogService`
reads the balance during query processing and increases cognitive load
under imbalance. Integration tests verify balance detection and the
load-signal pathway.

**The reservoir is the only cross-iteration carrier.** Working memory decays and
salience decays; DTESN state does not. If loop iterations are to compose into
anything longer than a single cycle, the reservoir is where that history has to
live. *Open.*

## 7. Provenance

Produced by composing three skills: `topology-weaver` (extract terminology →
map to architecture → generate topology → define integration points → emit seed
grammar), `egreglyphic-telomorph` (the 9P namespace ontology and the 27-letter
flame alphabet), and `aion` (the persona whose cognitive vocabulary —
superposition, relevance realisation, recursive reasoning, narrative coherence —
supplied the source context alongside ZoneCog's own).

The stock terminology extractor is tuned for a quantum-field-theory vocabulary
and recovered only generic terms from the ZoneCog context, so the terminology
was authored directly against the skill's custom-mapping guidelines. The
generator's baseline output is twelve uniform layers; the evolved form in
`zonecog-topology.yaml` assigns each layer its phase and flame-letter.

The flame residues in §4 are verified by `topology/flame_algebra.py`, which
also checks closure, identity, inverses, commutativity and associativity over
all 27 letters.
