/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IUserInteractionLearningService = createDecorator<IUserInteractionLearningService>('userInteractionLearningService');

// ---------------------------------------------------------------------------
// Interaction event types
// ---------------------------------------------------------------------------

/**
 * A single observed user interaction with the cognitive workbench.
 */
export interface InteractionEvent {
	/** What the user (or the workbench on their behalf) did, e.g. "zonecog.processQuery". */
	action: string;
	/** Categorical context the action occurred in, e.g. a query complexity class. */
	context: string;
	/** Epoch milliseconds when the interaction occurred. */
	timestamp: number;
	/** How long the interaction took, when known. */
	durationMs?: number;
	/** Whether the interaction succeeded, when known. */
	success?: boolean;
}

/**
 * Per-action aggregate statistics.
 */
export interface ActionStatistics {
	action: string;
	count: number;
	/**
	 * Exponential-moving-average success rate in [0, 1]. Interactions with an
	 * unknown outcome are counted as successes, matching the optimistic prior.
	 */
	successRate: number;
}

/**
 * Aggregate behavioral profile derived from the recorded interaction history.
 */
export interface BehaviorProfile {
	totalInteractions: number;
	/** Fraction of interactions with success === false. */
	errorRate: number;
	/** Actions ordered by descending frequency. */
	frequentActions: ActionStatistics[];
	/** Hour-of-day activity histogram entries with at least one interaction, descending by count. */
	activeHours: Array<{ hour: number; count: number }>;
	/** Contexts ordered by descending failure count (only contexts with failures). */
	errorProneContexts: Array<{ context: string; errorCount: number; errorRate: number }>;
	/**
	 * Success-rate delta between the recent half and the early half of the
	 * history, in [-1, 1]. Positive values indicate the user (or the system's
	 * assistance) is improving over the session.
	 */
	learningVelocity: number;
}

// ---------------------------------------------------------------------------
// Mined behavior patterns
// ---------------------------------------------------------------------------

export type BehaviorPatternKind = 'frequent-action' | 'active-hours' | 'error-prone-context' | 'skill-trend';

/**
 * A cognitive pattern mined from the interaction history and persisted as a
 * UserBehaviorPattern node in the hypergraph store.
 */
export interface BehaviorPattern {
	/** Stable hypergraph node id (deterministic per kind + key). */
	nodeId: string;
	kind: BehaviorPatternKind;
	/** The discriminating value: the action name, hour bucket, context, or trend direction. */
	key: string;
	/** Human-readable description of the pattern. */
	description: string;
	/** Evidence-based confidence in [0, 1], derived from support and effect size. */
	confidence: number;
	/** Number of observations backing this pattern. */
	support: number;
}

// ---------------------------------------------------------------------------
// Strategy learning (tabular Q-learning)
// ---------------------------------------------------------------------------

/**
 * Fired after each Q-value update.
 */
export interface PolicyUpdate {
	context: string;
	action: string;
	reward: number;
	/** The updated Q-value for (context, action). */
	qValue: number;
}

/**
 * The outcome of a strategy recommendation.
 */
export interface StrategyRecommendation {
	action: string;
	/** Learned value estimate for the recommended (context, action) pair. */
	qValue: number;
	/** True when the action was chosen by epsilon-greedy exploration rather than greedily. */
	explored: boolean;
}

/**
 * Observable outcome facts used to derive a scalar reward.
 */
export interface OutcomeObservation {
	success: boolean;
	/** Elapsed time; longer outcomes are penalized slightly. */
	durationMs?: number;
	/** Solution confidence in [0, 1] when the producing subsystem reports one. */
	confidence?: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * User Interaction Learning service.
 *
 * Closes the "cognitive pattern recognition in user interaction history"
 * roadmap item: it records workbench interactions, derives a behavioral
 * profile (frequency, timing, error hot-spots, learning velocity), mines
 * recurring patterns into the hypergraph store, and learns which cognitive
 * strategies pay off per context via tabular Q-learning:
 *
 *   Q(s,a) <- Q(s,a) + alpha * (r + gamma * max_a' Q(s',a') - Q(s,a))
 *
 * When no successor context is supplied the update degenerates to a
 * contextual bandit (gamma term omitted), which is the honest formulation
 * for one-shot strategy choices such as thinking-depth selection.
 */
export interface IUserInteractionLearningService {
	readonly _serviceBrand: undefined;

	/** Fired for every recorded interaction. */
	readonly onDidRecordInteraction: Event<InteractionEvent>;

	/** Fired when pattern mining completes with the full current pattern set. */
	readonly onDidUpdatePatterns: Event<BehaviorPattern[]>;

	/** Fired after each Q-value update. */
	readonly onDidUpdatePolicy: Event<PolicyUpdate>;

	// -- Interaction recording & analytics --

	/** Record a user interaction. Timestamp defaults to now. */
	recordInteraction(event: Omit<InteractionEvent, 'timestamp'> & { timestamp?: number }): void;

	/** Number of interactions currently retained (bounded history). */
	getInteractionCount(): number;

	/** Compute the aggregate behavioral profile from the retained history. */
	getProfile(): BehaviorProfile;

	// -- Pattern mining --

	/**
	 * Mine behavior patterns from the retained history and persist them as
	 * UserBehaviorPattern hypergraph nodes (stable ids; re-mining updates
	 * existing nodes in place). Returns the current full pattern set.
	 */
	minePatterns(): BehaviorPattern[];

	/** The patterns produced by the most recent mining pass. */
	getPatterns(): BehaviorPattern[];

	// -- Strategy learning --

	/**
	 * Apply a Q-learning update for taking `action` in `context` and
	 * observing `reward` in [-1, 1]. When `nextContext` is given, the update
	 * bootstraps from max Q(nextContext, *); otherwise the future term is
	 * omitted (contextual bandit). Returns the updated Q-value.
	 */
	recordOutcome(context: string, action: string, reward: number, nextContext?: string): number;

	/** Derive a scalar reward in [-1, 1] from observable outcome facts. */
	deriveReward(outcome: OutcomeObservation): number;

	/**
	 * Recommend an action for `context` from `candidates` using an
	 * epsilon-greedy policy. `explorationRate` defaults to 0 (pure greedy);
	 * ties are broken by candidate order. Returns undefined when
	 * `candidates` is empty.
	 */
	recommendAction(context: string, candidates: string[], explorationRate?: number): StrategyRecommendation | undefined;

	/** The learned Q-value for (context, action); 0 when never updated. */
	getQValue(context: string, action: string): number;

	// -- Lifecycle --

	/** Clear all retained interactions, patterns, and learned Q-values. */
	reset(): void;
}
