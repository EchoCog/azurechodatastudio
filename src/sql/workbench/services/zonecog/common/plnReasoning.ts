/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IPLNReasoningService = createDecorator<IPLNReasoningService>('plnReasoningService');

// ---------------------------------------------------------------------------
// PLN reasoning types
// ---------------------------------------------------------------------------

/**
 * PLN-style truth value: `strength` is the probability estimate for the
 * relation holding, `confidence` is the amount of evidence backing that
 * estimate. Both are in [0, 1].
 */
export interface TruthValue {
	strength: number;
	confidence: number;
}

/** Names of the inference rules the URE-lite forward-chainer applies. */
export type InferenceRuleName = 'deduction' | 'inversion' | 'similarity';

/** A directed binary relation produced by forward-chaining inference. */
export interface InferredLink {
	/** Hypergraph link id this conclusion was persisted as. */
	id: string;
	from: string;
	to: string;
	truthValue: TruthValue;
	rule: InferenceRuleName;
	/** IDs of the premise links this conclusion was derived from. */
	premises: string[];
}

export interface InferenceRunResult {
	inferred: InferredLink[];
	iterations: number;
	/** Number of binary directed edges considered as inference premises. */
	linksExamined: number;
}

export interface InferenceOptions {
	/** Maximum forward-chaining passes. Default 3. */
	maxIterations?: number;
	/** Conclusions with confidence below this are discarded. Default 0.05. */
	minConfidence?: number;
}

/**
 * PLN (Probabilistic Logic Networks) reasoning service - a lightweight
 * Unified Rule Engine (URE) forward-chainer over the hypergraph store.
 *
 * Closes the "AtomSpace Reasoning" roadmap item (Phase 3.2): PLN-style truth
 * values (strength/confidence) can be attached to any hypergraph link, and
 * `infer()` repeatedly applies deduction, inversion, and similarity rules to
 * derive new links from existing ones, persisting each conclusion back into
 * the hypergraph store so later reasoning passes (and other services) can
 * build on it. This operates entirely on `HypergraphStore` - it does not
 * require a real AtomSpace transport (see roadmap note: a real backend
 * remains separate future work).
 */
export interface IPLNReasoningService {
	readonly _serviceBrand: undefined;

	/** Fired each time a new inferred link is derived and persisted. */
	readonly onDidInferLink: Event<InferredLink>;

	/**
	 * Assign or update the truth value for an existing hypergraph link.
	 * Links with no explicit truth value default to
	 * `{ strength: 0.9, confidence: 0.5 }` when used as inference premises.
	 */
	setTruthValue(linkId: string, truthValue: TruthValue): void;

	/** The truth value explicitly assigned to a link, if any. */
	getTruthValue(linkId: string): TruthValue | undefined;

	/**
	 * Run forward-chaining inference over the hypergraph store: applies
	 * deduction (A->B, B->C => A->C), inversion (A->B => B->A), and
	 * similarity (A->B and B->A => Similarity(A,B)) rules over binary
	 * directed links, repeating until no new conclusions are derived or
	 * `maxIterations` is reached. New conclusions are persisted as
	 * hypergraph links (`link_type: 'Inferred'`) so they feed subsequent
	 * inference passes. Degenerate derivations that merely recycle their own
	 * evidence - inverting an inversion, or similarity between a link and
	 * its own inversion - are skipped, so repeated calls converge to a
	 * fixed point instead of accumulating noise.
	 */
	infer(options?: InferenceOptions): InferenceRunResult;

	/** All links inferred so far in this session (persisted, inferred: true). */
	getInferredLinks(): InferredLink[];

	/** Clear all inferred links and explicit truth-value assignments. */
	reset(): void;
}
