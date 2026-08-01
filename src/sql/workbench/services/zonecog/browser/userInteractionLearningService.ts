/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserInteractionLearningService,
	InteractionEvent,
	ActionStatistics,
	BehaviorProfile,
	BehaviorPattern,
	BehaviorPatternKind,
	PolicyUpdate,
	StrategyRecommendation,
	OutcomeObservation
} from 'sql/workbench/services/zonecog/common/userInteractionLearning';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService, ZoneCogResponse } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** Maximum number of interactions retained in the bounded history. */
const MAX_INTERACTIONS = 500;

/** Learning rate (alpha) for Q-value updates. */
const LEARNING_RATE = 0.1;

/** Discount factor (gamma) applied when a successor context is supplied. */
const DISCOUNT_FACTOR = 0.9;

/** Smoothing factor for per-action exponential-moving-average success rates. */
const SUCCESS_RATE_EMA_ALPHA = 0.2;

/** Automatically re-mine patterns every N recorded interactions. */
const AUTO_MINE_INTERVAL = 10;

/** Minimum observations before a frequent-action pattern can be reported. */
const MIN_ACTION_SUPPORT = 5;

/** Minimum share of all interactions for a frequent-action pattern. */
const MIN_ACTION_SHARE = 0.15;

/** Minimum failures before an error-prone-context pattern can be reported. */
const MIN_ERROR_SUPPORT = 3;

/** Minimum failure rate for an error-prone-context pattern. */
const MIN_ERROR_RATE = 0.5;

/** Minimum interactions before a skill-trend pattern can be reported. */
const MIN_TREND_SUPPORT = 10;

/** Minimum absolute learning velocity for a skill-trend pattern. */
const MIN_TREND_VELOCITY = 0.15;

/** Node type used for persisted behavior patterns in the hypergraph store. */
const PATTERN_NODE_TYPE = 'UserBehaviorPattern';

/**
 * Implementation of the User Interaction Learning service.
 *
 * Records workbench interactions into a bounded in-memory history, derives
 * frequency / timing / error-hot-spot / learning-velocity analytics from it,
 * mines recurring behavior patterns into hypergraph UserBehaviorPattern
 * nodes, and learns strategy values with tabular Q-learning.
 *
 * The service self-wires to the cognitive protocol: every processed query
 * is recorded as an interaction, and the (queryComplexity -> thinkingDepth)
 * strategy choice is reinforced with a reward derived from the response's
 * confidence, success, and processing time.
 */
export class UserInteractionLearningService extends Disposable implements IUserInteractionLearningService {

	declare readonly _serviceBrand: undefined;

	private readonly _interactions: InteractionEvent[] = [];
	private readonly _patterns = new Map<string, BehaviorPattern>();
	private readonly _qValues = new Map<string, number>();
	private readonly _actionSuccessRates = new Map<string, number>();
	private _interactionsSinceMine = 0;

	private readonly _onDidRecordInteraction = this._register(new Emitter<InteractionEvent>());
	readonly onDidRecordInteraction: Event<InteractionEvent> = this._onDidRecordInteraction.event;

	private readonly _onDidUpdatePatterns = this._register(new Emitter<BehaviorPattern[]>());
	readonly onDidUpdatePatterns: Event<BehaviorPattern[]> = this._onDidUpdatePatterns.event;

	private readonly _onDidUpdatePolicy = this._register(new Emitter<PolicyUpdate>());
	readonly onDidUpdatePolicy: Event<PolicyUpdate> = this._onDidUpdatePolicy.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IZoneCogService zonecogService: IZoneCogService
	) {
		super();
		this._register(zonecogService.onDidProcessQuery(response => this._onQueryProcessed(response)));
		this.logService.info('UserInteractionLearningService: initialized interaction learning');
	}

	// -- Interaction recording & analytics -------------------------------------

	recordInteraction(event: Omit<InteractionEvent, 'timestamp'> & { timestamp?: number }): void {
		const recorded: InteractionEvent = {
			action: event.action,
			context: event.context,
			timestamp: event.timestamp ?? Date.now(),
			durationMs: event.durationMs,
			success: event.success
		};
		this._interactions.push(recorded);
		if (this._interactions.length > MAX_INTERACTIONS) {
			this._interactions.shift();
		}

		// Interactions with an unknown outcome count as successes (optimistic prior).
		const observed = recorded.success !== false ? 1 : 0;
		const previous = this._actionSuccessRates.get(recorded.action);
		const updated = previous === undefined
			? observed
			: previous * (1 - SUCCESS_RATE_EMA_ALPHA) + observed * SUCCESS_RATE_EMA_ALPHA;
		this._actionSuccessRates.set(recorded.action, updated);

		this.membraneService.recordActivity('somatic');
		this._onDidRecordInteraction.fire(recorded);

		this._interactionsSinceMine++;
		if (this._interactionsSinceMine >= AUTO_MINE_INTERVAL) {
			this.minePatterns();
		}
	}

	getInteractionCount(): number {
		return this._interactions.length;
	}

	getProfile(): BehaviorProfile {
		this.membraneService.recordActivity('autonomic');

		const total = this._interactions.length;
		const failures = this._interactions.filter(i => i.success === false);

		const actionCounts = new Map<string, number>();
		const hourCounts = new Map<number, number>();
		const contextTotals = new Map<string, number>();
		const contextFailures = new Map<string, number>();
		for (const interaction of this._interactions) {
			actionCounts.set(interaction.action, (actionCounts.get(interaction.action) ?? 0) + 1);
			const hour = new Date(interaction.timestamp).getHours();
			hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
			contextTotals.set(interaction.context, (contextTotals.get(interaction.context) ?? 0) + 1);
			if (interaction.success === false) {
				contextFailures.set(interaction.context, (contextFailures.get(interaction.context) ?? 0) + 1);
			}
		}

		const frequentActions: ActionStatistics[] = Array.from(actionCounts.entries())
			.map(([action, count]) => ({
				action,
				count,
				successRate: this._actionSuccessRates.get(action) ?? 1
			}))
			.sort((a, b) => b.count - a.count);

		const activeHours = Array.from(hourCounts.entries())
			.map(([hour, count]) => ({ hour, count }))
			.sort((a, b) => b.count - a.count);

		const errorProneContexts = Array.from(contextFailures.entries())
			.map(([context, errorCount]) => ({
				context,
				errorCount,
				errorRate: errorCount / (contextTotals.get(context) ?? errorCount)
			}))
			.sort((a, b) => b.errorCount - a.errorCount);

		return {
			totalInteractions: total,
			errorRate: total > 0 ? failures.length / total : 0,
			frequentActions,
			activeHours,
			errorProneContexts,
			learningVelocity: this._computeLearningVelocity()
		};
	}

	// -- Pattern mining ---------------------------------------------------------

	minePatterns(): BehaviorPattern[] {
		this.membraneService.recordActivity('cerebral');
		this._interactionsSinceMine = 0;

		const profile = this.getProfile();
		const mined: BehaviorPattern[] = [];

		for (const stats of profile.frequentActions) {
			const share = profile.totalInteractions > 0 ? stats.count / profile.totalInteractions : 0;
			if (stats.count >= MIN_ACTION_SUPPORT && share >= MIN_ACTION_SHARE) {
				mined.push(this._buildPattern(
					'frequent-action',
					stats.action,
					`Action "${stats.action}" accounts for ${Math.round(share * 100)}% of interactions (${stats.count} of ${profile.totalInteractions})`,
					Math.min(0.95, share + Math.min(0.3, stats.count / 50)),
					stats.count
				));
			}
		}

		const totalHours = profile.activeHours.reduce((sum, h) => sum + h.count, 0);
		const averagePerActiveHour = profile.activeHours.length > 0 ? totalHours / profile.activeHours.length : 0;
		for (const bucket of profile.activeHours) {
			if (bucket.count >= MIN_ACTION_SUPPORT && bucket.count >= averagePerActiveHour * 2) {
				mined.push(this._buildPattern(
					'active-hours',
					String(bucket.hour),
					`Activity concentrates around ${bucket.hour}:00 (${bucket.count} of ${totalHours} interactions)`,
					Math.min(0.95, bucket.count / totalHours + 0.3),
					bucket.count
				));
			}
		}

		for (const errorContext of profile.errorProneContexts) {
			if (errorContext.errorCount >= MIN_ERROR_SUPPORT && errorContext.errorRate >= MIN_ERROR_RATE) {
				mined.push(this._buildPattern(
					'error-prone-context',
					errorContext.context,
					`Context "${errorContext.context}" fails ${Math.round(errorContext.errorRate * 100)}% of the time (${errorContext.errorCount} failures)`,
					Math.min(0.95, errorContext.errorRate * Math.min(1, errorContext.errorCount / 10) + 0.3),
					errorContext.errorCount
				));
			}
		}

		if (profile.totalInteractions >= MIN_TREND_SUPPORT && Math.abs(profile.learningVelocity) >= MIN_TREND_VELOCITY) {
			const direction = profile.learningVelocity > 0 ? 'improving' : 'declining';
			mined.push(this._buildPattern(
				'skill-trend',
				direction,
				`Session success rate is ${direction}: recent-half vs early-half delta of ${(profile.learningVelocity * 100).toFixed(0)}%`,
				Math.min(0.95, Math.abs(profile.learningVelocity) + 0.4),
				profile.totalInteractions
			));
		}

		// Persist mined patterns and drop stale ones from earlier passes.
		const minedIds = new Set(mined.map(p => p.nodeId));
		for (const staleId of Array.from(this._patterns.keys())) {
			if (!minedIds.has(staleId)) {
				this._patterns.delete(staleId);
				this.hypergraphStore.removeNode(staleId);
			}
		}
		for (const pattern of mined) {
			this._patterns.set(pattern.nodeId, pattern);
			this._persistPattern(pattern);
		}

		this._onDidUpdatePatterns.fire(mined);
		return mined;
	}

	getPatterns(): BehaviorPattern[] {
		return Array.from(this._patterns.values());
	}

	// -- Strategy learning (tabular Q-learning) ---------------------------------

	recordOutcome(context: string, action: string, reward: number, nextContext?: string): number {
		this.membraneService.recordActivity('cerebral');

		const clampedReward = Math.max(-1, Math.min(1, reward));
		const key = this._qKey(context, action);
		const currentQ = this._qValues.get(key) ?? 0;

		// Q(s,a) <- Q(s,a) + alpha * (r + gamma * max_a' Q(s',a') - Q(s,a));
		// without a successor context the future term is omitted (contextual bandit).
		const futureValue = nextContext !== undefined ? this._maxQForContext(nextContext) : 0;
		const newQ = currentQ + LEARNING_RATE * (clampedReward + DISCOUNT_FACTOR * futureValue - currentQ);
		this._qValues.set(key, newQ);

		this._onDidUpdatePolicy.fire({ context, action, reward: clampedReward, qValue: newQ });
		return newQ;
	}

	deriveReward(outcome: OutcomeObservation): number {
		let reward = outcome.success ? 0.5 : -0.5;
		if (outcome.confidence !== undefined) {
			reward += (Math.max(0, Math.min(1, outcome.confidence)) - 0.5) * 0.6;
		}
		if (outcome.durationMs !== undefined && outcome.durationMs > 0) {
			// Penalize slow outcomes, capped at -0.2 for one minute or longer.
			reward -= Math.min(0.2, (outcome.durationMs / 60_000) * 0.2);
		}
		return Math.max(-1, Math.min(1, reward));
	}

	recommendAction(context: string, candidates: string[], explorationRate: number = 0): StrategyRecommendation | undefined {
		if (candidates.length === 0) {
			return undefined;
		}
		this.membraneService.recordActivity('cerebral');

		if (explorationRate > 0 && Math.random() < explorationRate) {
			const action = candidates[Math.floor(Math.random() * candidates.length)];
			return { action, qValue: this.getQValue(context, action), explored: true };
		}

		let best = candidates[0];
		let bestQ = this.getQValue(context, best);
		for (const candidate of candidates.slice(1)) {
			const q = this.getQValue(context, candidate);
			if (q > bestQ) {
				best = candidate;
				bestQ = q;
			}
		}
		return { action: best, qValue: bestQ, explored: false };
	}

	getQValue(context: string, action: string): number {
		return this._qValues.get(this._qKey(context, action)) ?? 0;
	}

	// -- Lifecycle ---------------------------------------------------------------

	reset(): void {
		for (const nodeId of this._patterns.keys()) {
			this.hypergraphStore.removeNode(nodeId);
		}
		this._interactions.length = 0;
		this._patterns.clear();
		this._qValues.clear();
		this._actionSuccessRates.clear();
		this._interactionsSinceMine = 0;
		this.logService.info('UserInteractionLearningService: reset interaction history, patterns, and policy');
	}

	// -- Internals ----------------------------------------------------------------

	private _onQueryProcessed(response: ZoneCogResponse): void {
		const context = response.metadata.queryComplexity;
		const success = response.confidence >= 0.5;
		this.recordInteraction({
			action: 'zonecog.processQuery',
			context,
			durationMs: response.metadata.processingTime,
			success
		});
		const reward = this.deriveReward({
			success,
			durationMs: response.metadata.processingTime,
			confidence: response.confidence
		});
		this.recordOutcome(context, response.metadata.thinkingDepth, reward);
	}

	private _computeLearningVelocity(): number {
		if (this._interactions.length < MIN_TREND_SUPPORT) {
			return 0;
		}
		const midpoint = Math.floor(this._interactions.length / 2);
		const early = this._interactions.slice(0, midpoint);
		const recent = this._interactions.slice(midpoint);
		const successRate = (events: InteractionEvent[]) =>
			events.filter(e => e.success !== false).length / events.length;
		return successRate(recent) - successRate(early);
	}

	private _buildPattern(kind: BehaviorPatternKind, key: string, description: string, confidence: number, support: number): BehaviorPattern {
		return { nodeId: this._patternNodeId(kind, key), kind, key, description, confidence, support };
	}

	private _patternNodeId(kind: BehaviorPatternKind, key: string): string {
		return `uilp-${kind}-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
	}

	private _persistPattern(pattern: BehaviorPattern): void {
		const metadata: Record<string, unknown> = {
			kind: pattern.kind,
			key: pattern.key,
			support: pattern.support,
			confidence: pattern.confidence,
			updatedAt: Date.now()
		};
		const existing = this.hypergraphStore.getNode(pattern.nodeId);
		if (existing) {
			this.hypergraphStore.updateNode(pattern.nodeId, {
				content: pattern.description,
				metadata,
				salience_score: pattern.confidence
			});
		} else {
			this.hypergraphStore.addNode({
				id: pattern.nodeId,
				node_type: PATTERN_NODE_TYPE,
				content: pattern.description,
				links: [],
				metadata,
				salience_score: pattern.confidence
			});
		}
	}

	private _qKey(context: string, action: string): string {
		return `${context}::${action}`;
	}

	private _maxQForContext(context: string): number {
		const prefix = `${context}::`;
		let max = 0;
		for (const [key, value] of this._qValues) {
			if (key.startsWith(prefix) && value > max) {
				max = value;
			}
		}
		return max;
	}
}
