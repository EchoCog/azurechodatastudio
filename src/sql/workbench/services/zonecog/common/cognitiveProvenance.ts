/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ICognitiveProvenanceService = createDecorator<ICognitiveProvenanceService>('cognitiveProvenanceService');

// ---------------------------------------------------------------------------
// Cognitive decision provenance types
// ---------------------------------------------------------------------------

/**
 * Input facts for recording a cognitive decision. The service assigns the
 * stable id and defaults the timestamp to now.
 */
export interface DecisionRecordInput {
	/** The subsystem that made the decision, e.g. "zonecogService", "ecanAttentionService". */
	actor: string;
	/** Categorical decision type, e.g. "thinking-depth-selection", "attention-allocation". */
	decisionType: string;
	/** Human-readable one-line summary of what was decided. */
	summary: string;
	/** Optional longer explanation of why the decision was made. */
	rationale?: string;
	/**
	 * Hypergraph node ids that served as evidence for this decision. Each is
	 * linked to the decision node with an EvidencedBy link; ids of other
	 * CognitiveDecision nodes are allowed, forming transitive provenance chains.
	 */
	evidenceNodeIds?: string[];
	/** Structured inputs the decision was computed from (persisted in node metadata). */
	inputs?: Record<string, unknown>;
	/** Decision confidence in [0, 1] when the deciding subsystem reports one. */
	confidence?: number;
	/** Epoch milliseconds when the decision was made. Defaults to now. */
	timestamp?: number;
}

/**
 * A fully recorded cognitive decision as retained in the audit trail and
 * persisted as a CognitiveDecision hypergraph node.
 */
export interface CognitiveDecision {
	/** Stable hypergraph node id of the decision. */
	id: string;
	actor: string;
	decisionType: string;
	summary: string;
	rationale?: string;
	/** Evidence node ids that existed in the hypergraph store at record time. */
	evidenceNodeIds: string[];
	inputs: Record<string, unknown>;
	confidence: number;
	timestamp: number;
}

/**
 * Filter for querying the audit trail. All supplied criteria must match.
 */
export interface AuditTrailFilter {
	actor?: string;
	decisionType?: string;
	/** Inclusive lower bound on decision timestamp (epoch ms). */
	since?: number;
	/** Inclusive upper bound on decision timestamp (epoch ms). */
	until?: number;
	/** Maximum number of decisions to return (most recent first). */
	limit?: number;
}

/**
 * One entry in a transitively resolved provenance chain.
 */
export interface ProvenanceChainEntry {
	/** The evidence node id. */
	nodeId: string;
	/** The evidence node's hypergraph node_type (e.g. "CognitiveDecision", "UserBehaviorPattern"). */
	nodeType: string;
	/** The evidence node's content payload. */
	content: string;
	/** Hops from the root decision (direct evidence is depth 1). */
	depth: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive Provenance service.
 *
 * Closes the "provenance and audit trails for cognitive decisions" roadmap
 * item (Phase 3.4): every recorded decision is retained in a bounded
 * in-memory audit trail and persisted as a CognitiveDecision hypergraph node
 * whose evidence is expressed with EvidencedBy links, so decision lineage
 * can be reconstructed transitively across the knowledge graph.
 */
export interface ICognitiveProvenanceService {
	readonly _serviceBrand: undefined;

	/** Fired for every recorded decision. */
	readonly onDidRecordDecision: Event<CognitiveDecision>;

	/**
	 * Record a cognitive decision. Persists a CognitiveDecision hypergraph
	 * node and one EvidencedBy link per evidence node that exists in the
	 * store; evidence ids that do not resolve to a stored node are dropped.
	 */
	recordDecision(input: DecisionRecordInput): CognitiveDecision;

	/** Look up a recorded decision by id. */
	getDecision(id: string): CognitiveDecision | undefined;

	/** Query the audit trail, most recent decisions first. */
	getAuditTrail(filter?: AuditTrailFilter): CognitiveDecision[];

	/** Number of decisions currently retained in the (bounded) audit trail. */
	getDecisionCount(): number;

	/**
	 * Resolve the transitive evidence chain for a decision by walking
	 * EvidencedBy links breadth-first, up to `maxDepth` hops (default 5).
	 * Cycles are guarded; each evidence node appears at most once at its
	 * shallowest depth. Returns an empty array for unknown decisions.
	 */
	getProvenanceChain(decisionId: string, maxDepth?: number): ProvenanceChainEntry[];

	/** Clear the audit trail and remove persisted CognitiveDecision nodes. */
	clear(): void;
}
