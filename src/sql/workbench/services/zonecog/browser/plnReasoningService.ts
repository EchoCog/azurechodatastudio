/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IPLNReasoningService,
	TruthValue,
	InferredLink,
	InferenceRunResult,
	InferenceOptions
} from 'sql/workbench/services/zonecog/common/plnReasoning';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

const INFERRED_LINK_TYPE = 'Inferred';

const DEFAULT_LINK_STRENGTH = 0.9;
const DEFAULT_LINK_CONFIDENCE = 0.5;

const DEDUCTION_CONFIDENCE_DISCOUNT = 0.9;
const INVERSION_CONFIDENCE_DISCOUNT = 0.8;
const SIMILARITY_CONFIDENCE_DISCOUNT = 0.85;

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MIN_CONFIDENCE = 0.05;

/** Safety cap on total inferred links retained, to bound runaway forward-chaining. */
const MAX_INFERRED_LINKS = 1000;

function clamp01(n: number): number {
	if (Number.isNaN(n)) { return 0; }
	return Math.max(0, Math.min(1, n));
}

/** A directed binary edge extracted from a hypergraph link's `outgoing` list. */
interface DirectedEdge {
	linkId: string;
	from: string;
	to: string;
	truthValue: TruthValue;
}

/**
 * Implementation of the PLN reasoning service - a lightweight forward-chaining
 * Unified Rule Engine (URE) over the hypergraph store's binary directed links.
 *
 * Only links whose `outgoing` list has exactly two entries are treated as
 * binary relations `outgoing[0] -> outgoing[1]`; hyperedges with other
 * arities are ignored by the reasoner. Node `salience_score` is used as a
 * proxy for prior probability in the PLN deduction formula.
 */
export class PLNReasoningService extends Disposable implements IPLNReasoningService {

	declare readonly _serviceBrand: undefined;

	private readonly _truthValues = new Map<string, TruthValue>();
	private readonly _inferred = new Map<string, InferredLink>();
	/** Dedup key `${rule}|${from}|${to}` -> already-derived inferred link id. */
	private readonly _inferredIndex = new Map<string, string>();
	private _inferenceCounter = 0;

	private readonly _onDidInferLink = this._register(new Emitter<InferredLink>());
	readonly onDidInferLink: Event<InferredLink> = this._onDidInferLink.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('PLNReasoningService: initialized PLN/URE-lite forward-chaining reasoner');
	}

	// -- Truth values ------------------------------------------------------------------

	setTruthValue(linkId: string, truthValue: TruthValue): void {
		this._truthValues.set(linkId, {
			strength: clamp01(truthValue.strength),
			confidence: clamp01(truthValue.confidence)
		});
	}

	getTruthValue(linkId: string): TruthValue | undefined {
		return this._truthValues.get(linkId);
	}

	private _truthValueOf(linkId: string): TruthValue {
		return this._truthValues.get(linkId) ?? { strength: DEFAULT_LINK_STRENGTH, confidence: DEFAULT_LINK_CONFIDENCE };
	}

	// -- Inference -----------------------------------------------------------------------

	infer(options?: InferenceOptions): InferenceRunResult {
		this.membraneService.recordActivity('cerebral');

		const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
		const minConfidence = options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

		const newlyInferred: InferredLink[] = [];
		let iterations = 0;
		let linksExamined = 0;

		for (let i = 0; i < maxIterations; i++) {
			iterations++;
			const edges = this._collectDirectedEdges();
			linksExamined = Math.max(linksExamined, edges.length);

			const candidates = [
				...this._applyDeduction(edges),
				...this._applyInversion(edges),
				...this._applySimilarity(edges)
			];

			let producedThisRound = 0;
			for (const candidate of candidates) {
				if (this._inferred.size >= MAX_INFERRED_LINKS) {
					this.logService.warn('PLNReasoningService: reached max inferred link cap, stopping early');
					break;
				}
				if (candidate.truthValue.confidence < minConfidence) {
					continue;
				}
				const dedupKey = `${candidate.rule}|${candidate.from}|${candidate.to}`;
				if (this._inferredIndex.has(dedupKey)) {
					continue;
				}
				const persisted = this._persistInference(candidate);
				this._inferredIndex.set(dedupKey, persisted.id);
				this._inferred.set(persisted.id, persisted);
				newlyInferred.push(persisted);
				producedThisRound++;
				this._onDidInferLink.fire(persisted);
			}

			if (producedThisRound === 0 || this._inferred.size >= MAX_INFERRED_LINKS) {
				break;
			}
		}

		this.logService.info(`PLNReasoningService: inferred ${newlyInferred.length} new link(s) over ${iterations} iteration(s)`);
		return { inferred: newlyInferred, iterations, linksExamined };
	}

	getInferredLinks(): InferredLink[] {
		return Array.from(this._inferred.values());
	}

	reset(): void {
		for (const id of this._inferred.keys()) {
			this.hypergraphStore.removeLink(id);
		}
		this._inferred.clear();
		this._inferredIndex.clear();
		this._truthValues.clear();
		this.logService.info('PLNReasoningService: reset all inferred links and truth values');
	}

	// -- Rule application --------------------------------------------------------------------

	private _collectDirectedEdges(): DirectedEdge[] {
		const edges: DirectedEdge[] = [];
		const seenLinkIds = new Set<string>();
		for (const node of this.hypergraphStore.getAllNodes()) {
			for (const link of this.hypergraphStore.getLinksForNode(node.id)) {
				if (seenLinkIds.has(link.id) || link.outgoing.length !== 2) {
					continue;
				}
				seenLinkIds.add(link.id);
				edges.push({
					linkId: link.id,
					from: link.outgoing[0],
					to: link.outgoing[1],
					truthValue: this._truthValueOf(link.id)
				});
			}
		}
		return edges;
	}

	private _priorOf(nodeId: string): number {
		const node = this.hypergraphStore.getNode(nodeId);
		const salience = node?.salience_score ?? 0.5;
		// Clamp away from the extremes: the deduction formula divides by (1 - P(B)),
		// and a 0/1 prior would either blow up or degenerate the estimate.
		return Math.max(0.01, Math.min(0.99, salience));
	}

	/** Deduction: A->B, B->C |- A->C */
	private _applyDeduction(edges: DirectedEdge[]): InferredLink[] {
		const byFrom = new Map<string, DirectedEdge[]>();
		for (const edge of edges) {
			const bucket = byFrom.get(edge.from);
			if (bucket) { bucket.push(edge); } else { byFrom.set(edge.from, [edge]); }
		}

		const results: InferredLink[] = [];
		for (const ab of edges) {
			const bcCandidates = byFrom.get(ab.to);
			if (!bcCandidates) { continue; }
			for (const bc of bcCandidates) {
				if (bc.to === ab.from) { continue; } // skip trivial A->B->A cycles
				const sB = this._priorOf(ab.to);
				const sC = this._priorOf(bc.to);
				const denom = 1 - sB;
				const strength = denom > 0.0001
					? clamp01(ab.truthValue.strength * bc.truthValue.strength + (1 - ab.truthValue.strength) * (sC - sB * bc.truthValue.strength) / denom)
					: clamp01(ab.truthValue.strength * bc.truthValue.strength);
				const confidence = clamp01(ab.truthValue.confidence * bc.truthValue.confidence * DEDUCTION_CONFIDENCE_DISCOUNT);
				results.push({
					id: '',
					from: ab.from,
					to: bc.to,
					truthValue: { strength, confidence },
					rule: 'deduction',
					premises: [ab.linkId, bc.linkId]
				});
			}
		}
		return results;
	}

	/** Inversion: A->B |- B->A (Bayes' rule) */
	private _applyInversion(edges: DirectedEdge[]): InferredLink[] {
		const results: InferredLink[] = [];
		for (const edge of edges) {
			const sA = this._priorOf(edge.from);
			const sB = this._priorOf(edge.to);
			const strength = sB > 0.0001 ? clamp01((edge.truthValue.strength * sA) / sB) : 0;
			const confidence = clamp01(edge.truthValue.confidence * INVERSION_CONFIDENCE_DISCOUNT);
			results.push({
				id: '',
				from: edge.to,
				to: edge.from,
				truthValue: { strength, confidence },
				rule: 'inversion',
				premises: [edge.linkId]
			});
		}
		return results;
	}

	/** Similarity: A->B and B->A |- Similarity(A,B) (symmetric, stored as A->B) */
	private _applySimilarity(edges: DirectedEdge[]): InferredLink[] {
		const byPair = new Map<string, DirectedEdge>();
		for (const edge of edges) {
			byPair.set(`${edge.from}|${edge.to}`, edge);
		}

		const results: InferredLink[] = [];
		const seenPairs = new Set<string>();
		for (const edge of edges) {
			const reverse = byPair.get(`${edge.to}|${edge.from}`);
			if (!reverse) { continue; }
			const pairKey = [edge.from, edge.to].sort().join('|');
			if (seenPairs.has(pairKey)) { continue; }
			seenPairs.add(pairKey);

			const strength = clamp01(Math.sqrt(edge.truthValue.strength * reverse.truthValue.strength));
			const confidence = clamp01(Math.min(edge.truthValue.confidence, reverse.truthValue.confidence) * SIMILARITY_CONFIDENCE_DISCOUNT);
			results.push({
				id: '',
				from: edge.from,
				to: edge.to,
				truthValue: { strength, confidence },
				rule: 'similarity',
				premises: [edge.linkId, reverse.linkId]
			});
		}
		return results;
	}

	private _persistInference(candidate: InferredLink): InferredLink {
		const id = `pln-${candidate.rule}-${Date.now()}-${++this._inferenceCounter}`;
		const link: HypergraphLink = {
			id,
			link_type: INFERRED_LINK_TYPE,
			outgoing: [candidate.from, candidate.to],
			metadata: {
				inferred: true,
				rule: candidate.rule,
				truthValue: candidate.truthValue,
				premises: candidate.premises
			}
		};
		this.hypergraphStore.addLink(link);
		this._truthValues.set(id, candidate.truthValue);
		return { ...candidate, id };
	}
}
