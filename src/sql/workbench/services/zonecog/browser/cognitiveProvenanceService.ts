/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveProvenanceService,
	DecisionRecordInput,
	CognitiveDecision,
	AuditTrailFilter,
	ProvenanceChainEntry
} from 'sql/workbench/services/zonecog/common/cognitiveProvenance';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum number of decisions retained in the bounded audit trail. */
const MAX_DECISIONS = 1000;

/** Node type used for persisted decisions in the hypergraph store. */
const DECISION_NODE_TYPE = 'CognitiveDecision';

/** Link type connecting a decision node to its evidence nodes. */
const EVIDENCE_LINK_TYPE = 'EvidencedBy';

/** Default maximum depth for transitive provenance chain resolution. */
const DEFAULT_CHAIN_DEPTH = 5;

/**
 * Implementation of the Cognitive Provenance service.
 *
 * Retains a bounded in-memory audit trail of cognitive decisions and mirrors
 * each decision into the hypergraph store as a CognitiveDecision node with
 * EvidencedBy links to its evidence nodes, enabling transitive provenance
 * chain reconstruction across the knowledge graph.
 */
export class CognitiveProvenanceService extends Disposable implements ICognitiveProvenanceService {

	declare readonly _serviceBrand: undefined;

	private readonly _decisions = new Map<string, CognitiveDecision>();
	private _decisionCounter = 0;

	private readonly _onDidRecordDecision = this._register(new Emitter<CognitiveDecision>());
	readonly onDidRecordDecision: Event<CognitiveDecision> = this._onDidRecordDecision.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('CognitiveProvenanceService: initialized cognitive decision provenance tracking');
	}

	// -- Decision recording -----------------------------------------------------

	recordDecision(input: DecisionRecordInput): CognitiveDecision {
		this.membraneService.recordActivity('cerebral');

		const id = `cogdec-${Date.now()}-${++this._decisionCounter}`;
		// Only keep evidence ids that resolve to stored nodes so every
		// persisted EvidencedBy link is grounded in the hypergraph.
		const evidenceNodeIds = (input.evidenceNodeIds ?? []).filter(nodeId => {
			const exists = this.hypergraphStore.getNode(nodeId) !== undefined;
			if (!exists) {
				this.logService.warn(`CognitiveProvenanceService: dropping unknown evidence node ${nodeId}`);
			}
			return exists;
		});

		const decision: CognitiveDecision = {
			id,
			actor: input.actor,
			decisionType: input.decisionType,
			summary: input.summary,
			rationale: input.rationale,
			evidenceNodeIds,
			inputs: input.inputs ?? {},
			confidence: input.confidence !== undefined ? Math.max(0, Math.min(1, input.confidence)) : 0.5,
			timestamp: input.timestamp ?? Date.now()
		};

		this._decisions.set(id, decision);
		if (this._decisions.size > MAX_DECISIONS) {
			const oldest = this._decisions.keys().next().value;
			if (oldest !== undefined) {
				this._decisions.delete(oldest);
				this.hypergraphStore.removeNode(oldest);
			}
		}

		this._persistDecision(decision);
		this._onDidRecordDecision.fire(decision);
		return decision;
	}

	getDecision(id: string): CognitiveDecision | undefined {
		return this._decisions.get(id);
	}

	// -- Audit trail --------------------------------------------------------------

	getAuditTrail(filter?: AuditTrailFilter): CognitiveDecision[] {
		this.membraneService.recordActivity('autonomic');

		let trail = Array.from(this._decisions.values());
		// Reverse insertion order first so the stable sort breaks timestamp
		// ties in favor of the most recently recorded decision.
		trail.reverse();
		if (filter?.actor !== undefined) {
			trail = trail.filter(d => d.actor === filter.actor);
		}
		if (filter?.decisionType !== undefined) {
			trail = trail.filter(d => d.decisionType === filter.decisionType);
		}
		if (filter?.since !== undefined) {
			trail = trail.filter(d => d.timestamp >= filter.since);
		}
		if (filter?.until !== undefined) {
			trail = trail.filter(d => d.timestamp <= filter.until);
		}

		trail.sort((a, b) => b.timestamp - a.timestamp);
		if (filter?.limit !== undefined && filter.limit >= 0) {
			trail = trail.slice(0, filter.limit);
		}
		return trail;
	}

	getDecisionCount(): number {
		return this._decisions.size;
	}

	// -- Provenance chain resolution -----------------------------------------------

	getProvenanceChain(decisionId: string, maxDepth: number = DEFAULT_CHAIN_DEPTH): ProvenanceChainEntry[] {
		this.membraneService.recordActivity('cerebral');

		if (this.hypergraphStore.getNode(decisionId) === undefined) {
			return [];
		}

		const chain: ProvenanceChainEntry[] = [];
		const visited = new Set<string>([decisionId]);
		let frontier = [decisionId];

		for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
			const next: string[] = [];
			for (const nodeId of frontier) {
				for (const evidenceId of this._directEvidenceIds(nodeId)) {
					if (visited.has(evidenceId)) {
						continue;
					}
					visited.add(evidenceId);
					const evidenceNode = this.hypergraphStore.getNode(evidenceId);
					if (!evidenceNode) {
						continue;
					}
					chain.push({
						nodeId: evidenceId,
						nodeType: evidenceNode.node_type,
						content: evidenceNode.content,
						depth
					});
					next.push(evidenceId);
				}
			}
			frontier = next;
		}
		return chain;
	}

	// -- Lifecycle ------------------------------------------------------------------

	clear(): void {
		for (const id of this._decisions.keys()) {
			this.hypergraphStore.removeNode(id);
		}
		this._decisions.clear();
		this.logService.info('CognitiveProvenanceService: cleared audit trail');
	}

	// -- Internals --------------------------------------------------------------------

	private _persistDecision(decision: CognitiveDecision): void {
		this.hypergraphStore.addNode({
			id: decision.id,
			node_type: DECISION_NODE_TYPE,
			content: decision.summary,
			links: [],
			metadata: {
				actor: decision.actor,
				decisionType: decision.decisionType,
				rationale: decision.rationale,
				inputs: decision.inputs,
				confidence: decision.confidence,
				timestamp: decision.timestamp
			},
			salience_score: decision.confidence
		});

		for (const evidenceId of decision.evidenceNodeIds) {
			this.hypergraphStore.addLink({
				id: `${decision.id}-evidence-${evidenceId}`,
				link_type: EVIDENCE_LINK_TYPE,
				outgoing: [decision.id, evidenceId],
				metadata: { recordedAt: decision.timestamp }
			});
		}
	}

	/**
	 * The evidence node ids directly linked to `nodeId` via EvidencedBy links
	 * where `nodeId` is the deciding (first outgoing) node.
	 */
	private _directEvidenceIds(nodeId: string): string[] {
		return this.hypergraphStore.getLinksForNode(nodeId)
			.filter(link => link.link_type === EVIDENCE_LINK_TYPE && link.outgoing[0] === nodeId)
			.map(link => link.outgoing[1])
			.filter(id => id !== undefined);
	}
}
