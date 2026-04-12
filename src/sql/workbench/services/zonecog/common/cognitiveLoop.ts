/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ICognitiveLoopService = createDecorator<ICognitiveLoopService>('cognitiveLoopService');

// ---------------------------------------------------------------------------
// Loop state types
// ---------------------------------------------------------------------------

/**
 * One completed iteration of the cognitive loop.
 */
export interface CognitiveLoopIteration {
	/** Monotonically increasing iteration number. */
	iteration: number;
	/** Timestamp when this iteration started. */
	startTime: number;
	/** Duration of the iteration in ms. */
	durationMs: number;
	/** Phases executed in this iteration. */
	phases: CognitiveLoopPhase[];
	/** Whether the iteration completed successfully. */
	success: boolean;
	/** Error message if the iteration failed. */
	error?: string;
}

/**
 * A single phase within a cognitive loop iteration.
 */
export interface CognitiveLoopPhase {
	/** Phase name from the cognitive cycle. */
	name: 'perceive' | 'attend' | 'think' | 'act' | 'reflect';
	/** Duration of this phase in ms. */
	durationMs: number;
	/** Summary of what happened in this phase. */
	summary: string;
}

/**
 * Current state of the cognitive loop.
 */
export interface CognitiveLoopState {
	/** Whether the loop is currently running. */
	running: boolean;
	/** Whether the loop is paused. */
	paused: boolean;
	/** Total iterations completed. */
	totalIterations: number;
	/** Total failed iterations. */
	failedIterations: number;
	/** Average iteration duration in ms. */
	averageIterationMs: number;
	/** Current tick interval in ms. */
	tickIntervalMs: number;
	/** Timestamp of the last completed iteration. */
	lastIterationTime: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive Loop Service — the autonomous heartbeat of the Zone-Cog system.
 *
 * Orchestrates a continuous perceive → attend → think → act → reflect cycle:
 *
 * 1. **Perceive**: Gather sensory percepts from the environment
 *    (embodied cognition layer scans workspace state)
 * 2. **Attend**: Run ECAN spreading activation to focus resources
 *    on the most salient hypergraph nodes
 * 3. **Think**: Invoke cognitive processing on the highest-attention
 *    items (ZoneCog thinking protocol for complex items)
 * 4. **Act**: Produce motor actions based on cognitive processing
 *    (query suggestions, insights, alerts)
 * 5. **Reflect**: Update proprioceptive state, record episodes,
 *    decay working memory, and adjust attention boundaries
 *
 * The loop runs on a configurable interval (default 5 seconds) and
 * can be started, stopped, and paused.
 */
export interface ICognitiveLoopService {
	readonly _serviceBrand: undefined;

	/** Fired after each completed iteration. */
	readonly onDidCompleteIteration: Event<CognitiveLoopIteration>;

	/** Fired when the loop state changes (start/stop/pause). */
	readonly onDidChangeState: Event<CognitiveLoopState>;

	// -- Lifecycle ------------------------------------------------------------

	/**
	 * Start the cognitive loop. No-op if already running.
	 */
	start(): void;

	/**
	 * Stop the cognitive loop. No-op if not running.
	 */
	stop(): void;

	/**
	 * Pause the cognitive loop. The loop remains "running" but
	 * iterations are skipped until resumed.
	 */
	pause(): void;

	/**
	 * Resume a paused loop. No-op if not paused.
	 */
	resume(): void;

	/**
	 * Run exactly one iteration of the cognitive loop (for testing
	 * or manual triggering). Does not require the loop to be started.
	 */
	runOnce(): Promise<CognitiveLoopIteration>;

	// -- Configuration -------------------------------------------------------

	/**
	 * Set the tick interval in milliseconds. Minimum 1000ms.
	 */
	setTickInterval(ms: number): void;

	/**
	 * Get the current loop state.
	 */
	getState(): CognitiveLoopState;

	/**
	 * Get the last N completed iterations.
	 */
	getRecentIterations(limit?: number): CognitiveLoopIteration[];

	/**
	 * Reset the loop: stop if running, clear iteration history and counters.
	 */
	reset(): void;
}
