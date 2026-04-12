/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveLoopService,
	CognitiveLoopIteration,
	CognitiveLoopPhase,
	CognitiveLoopState
} from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Default tick interval for the cognitive loop (5 seconds).
 */
const DEFAULT_TICK_INTERVAL_MS = 5000;

/**
 * Minimum tick interval (1 second).
 */
const MIN_TICK_INTERVAL_MS = 1000;

/**
 * Maximum number of recent iterations to retain.
 */
const MAX_ITERATION_HISTORY = 100;

/**
 * Cognitive Loop Service — the autonomous heartbeat of the Zone-Cog system.
 *
 * Orchestrates a continuous cognitive cycle:
 *   perceive → attend → think → act → reflect
 *
 * Each iteration:
 * 1. **Perceive**: Scans the environment via embodied cognition to gather
 *    fresh sensory percepts about workspace state changes.
 * 2. **Attend**: Runs ECAN spreading activation to focus processing
 *    resources on the most salient hypergraph nodes.
 * 3. **Think**: Performs lightweight cognitive processing on focused items —
 *    updates working memory and identifies patterns.
 * 4. **Act**: Produces motor actions (insights, suggestions) based on
 *    the cognitive processing results.
 * 5. **Reflect**: Updates proprioceptive state, records episodes, decays
 *    working memory, and adjusts the system's self-model.
 */
export class CognitiveLoopService extends Disposable implements ICognitiveLoopService {

	declare readonly _serviceBrand: undefined;

	private _running = false;
	private _paused = false;
	private _tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
	private _timerHandle: ReturnType<typeof setInterval> | null = null;
	private _iterationCount = 0;
	private _failedIterations = 0;
	private _totalDurationMs = 0;
	private _lastIterationTime = 0;
	private readonly _recentIterations: CognitiveLoopIteration[] = [];

	private readonly _onDidCompleteIteration = this._register(new Emitter<CognitiveLoopIteration>());
	readonly onDidCompleteIteration: Event<CognitiveLoopIteration> = this._onDidCompleteIteration.event;

	private readonly _onDidChangeState = this._register(new Emitter<CognitiveLoopState>());
	readonly onDidChangeState: Event<CognitiveLoopState> = this._onDidChangeState.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService
	) {
		super();
		this.logService.info('CognitiveLoopService: initialized autonomous cognitive cycle');
	}

	// -- Lifecycle ------------------------------------------------------------

	start(): void {
		if (this._running) {
			return;
		}

		this._running = true;
		this._paused = false;

		this._timerHandle = setInterval(() => {
			if (!this._paused) {
				this._tick();
			}
		}, this._tickIntervalMs);

		this.membraneService.recordActivity('cerebral');
		this._fireStateChange();
		this.logService.info(`CognitiveLoopService: started (interval=${this._tickIntervalMs}ms)`);
	}

	stop(): void {
		if (!this._running) {
			return;
		}

		if (this._timerHandle !== null) {
			clearInterval(this._timerHandle);
			this._timerHandle = null;
		}

		this._running = false;
		this._paused = false;

		this._fireStateChange();
		this.logService.info('CognitiveLoopService: stopped');
	}

	pause(): void {
		if (!this._running || this._paused) {
			return;
		}
		this._paused = true;
		this._fireStateChange();
		this.logService.info('CognitiveLoopService: paused');
	}

	resume(): void {
		if (!this._paused) {
			return;
		}
		this._paused = false;
		this._fireStateChange();
		this.logService.info('CognitiveLoopService: resumed');
	}

	async runOnce(): Promise<CognitiveLoopIteration> {
		return this._executeIteration();
	}

	// -- Configuration -------------------------------------------------------

	setTickInterval(ms: number): void {
		this._tickIntervalMs = Math.max(MIN_TICK_INTERVAL_MS, ms);

		// Restart the timer if currently running
		if (this._running && this._timerHandle !== null) {
			clearInterval(this._timerHandle);
			this._timerHandle = setInterval(() => {
				if (!this._paused) {
					this._tick();
				}
			}, this._tickIntervalMs);
		}

		this._fireStateChange();
		this.logService.info(`CognitiveLoopService: tick interval set to ${this._tickIntervalMs}ms`);
	}

	getState(): CognitiveLoopState {
		return {
			running: this._running,
			paused: this._paused,
			totalIterations: this._iterationCount,
			failedIterations: this._failedIterations,
			averageIterationMs: this._iterationCount > 0
				? Math.round(this._totalDurationMs / this._iterationCount)
				: 0,
			tickIntervalMs: this._tickIntervalMs,
			lastIterationTime: this._lastIterationTime,
		};
	}

	getRecentIterations(limit: number = 20): CognitiveLoopIteration[] {
		return this._recentIterations.slice(-limit);
	}

	reset(): void {
		this.stop();
		this._iterationCount = 0;
		this._failedIterations = 0;
		this._totalDurationMs = 0;
		this._lastIterationTime = 0;
		this._recentIterations.length = 0;
		this._tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
		this._fireStateChange();
		this.logService.info('CognitiveLoopService: reset');
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}

	// -- Private: Core loop ---------------------------------------------------

	private _tick(): void {
		// Fire-and-forget; errors are handled inside _executeIteration
		this._executeIteration().catch(() => { /* errors already recorded */ });
	}

	private async _executeIteration(): Promise<CognitiveLoopIteration> {
		const startTime = Date.now();
		const phases: CognitiveLoopPhase[] = [];
		let success = true;
		let error: string | undefined;

		try {
			// Phase 1: Perceive
			phases.push(this._phasePerceive());

			// Phase 2: Attend
			phases.push(this._phaseAttend());

			// Phase 3: Think
			phases.push(this._phaseThink());

			// Phase 4: Act
			phases.push(this._phaseAct());

			// Phase 5: Reflect
			phases.push(this._phaseReflect());

		} catch (err) {
			success = false;
			error = err instanceof Error ? err.message : String(err);
			this._failedIterations++;
			this.membraneService.recordError('cerebral', `Cognitive loop iteration failed: ${error}`);
			this.logService.warn('CognitiveLoopService: iteration failed', err);
		}

		const durationMs = Date.now() - startTime;
		this._iterationCount++;
		this._totalDurationMs += durationMs;
		this._lastIterationTime = startTime;

		const iteration: CognitiveLoopIteration = {
			iteration: this._iterationCount,
			startTime,
			durationMs,
			phases,
			success,
			error,
		};

		this._recentIterations.push(iteration);
		if (this._recentIterations.length > MAX_ITERATION_HISTORY) {
			this._recentIterations.shift();
		}

		this._onDidCompleteIteration.fire(iteration);

		this.logService.trace(
			`CognitiveLoopService: iteration ${iteration.iteration} completed in ${durationMs}ms ` +
			`(${success ? 'OK' : 'FAILED'})`
		);

		return iteration;
	}

	// -- Phase implementations ------------------------------------------------

	/**
	 * Phase 1: Perceive — Gather sensory input from the environment.
	 *
	 * Scans the hypergraph for recently added nodes and registers them
	 * as percepts via the embodied cognition layer. This creates an
	 * awareness of what's changed since the last iteration.
	 */
	private _phasePerceive(): CognitiveLoopPhase {
		const start = Date.now();

		// Observe the current hypergraph state
		const nodeCount = this.hypergraphStore.nodeCount();
		const topNodes = this.hypergraphStore.getTopSalientNodes(5);

		// Register an environment observation percept
		if (topNodes.length > 0) {
			const summary = `Hypergraph scan: ${nodeCount} nodes, top salient: ${topNodes.map(n => n.node_type).join(', ')}`;
			this.embodiedService.perceive('interaction', summary, JSON.stringify({
				nodeCount,
				topTypes: topNodes.map(n => n.node_type),
			}), 0.3);
		}

		return {
			name: 'perceive',
			durationMs: Date.now() - start,
			summary: `Scanned ${nodeCount} nodes, observed ${topNodes.length} salient items`,
		};
	}

	/**
	 * Phase 2: Attend — Run ECAN spreading activation to allocate attention.
	 *
	 * Ensures all hypergraph nodes have attention values, then runs one
	 * cycle of spreading activation. Nodes in the attentional focus are
	 * prioritized for cognitive processing.
	 */
	private _phaseAttend(): CognitiveLoopPhase {
		const start = Date.now();

		// Ensure new hypergraph nodes get initial attention values
		const allNodes = this.hypergraphStore.getAllNodes();
		for (const node of allNodes) {
			const av = this.ecanService.getAttentionValue(node.id);
			if (av.sti === 0 && av.lti === 0) {
				// Initialize from the node's salience_score
				this.ecanService.setAttentionValue(node.id, {
					sti: node.salience_score * 2 - 1, // Map [0,1] to [-1,1]
					lti: node.salience_score * 0.5,
				});
			}
		}

		// Run spreading activation
		const spreadResult = this.ecanService.spreadActivation();
		const focusNodes = this.ecanService.getAttentionalFocus();

		return {
			name: 'attend',
			durationMs: Date.now() - start,
			summary: `ECAN spread: boosted=${spreadResult.boosted.length}, focus=${focusNodes.length} nodes`,
		};
	}

	/**
	 * Phase 3: Think — Process focused items through cognitive evaluation.
	 *
	 * Examines the nodes in attentional focus, updates working memory
	 * with the most relevant items, and identifies patterns.
	 */
	private _phaseThink(): CognitiveLoopPhase {
		const start = Date.now();

		const focusNodeIds = this.ecanService.getAttentionalFocus();
		let processed = 0;

		for (const nodeId of focusNodeIds.slice(0, 5)) {
			const node = this.hypergraphStore.getNode(nodeId);
			if (!node) {
				continue;
			}

			// Add high-attention items to working memory
			const av = this.ecanService.getAttentionValue(nodeId);
			if (av.sti > 0.3) {
				this.workspaceService.addToWorkingMemory(
					node.node_type,
					node.content.substring(0, 200),
					(av.sti + 1) / 2 // Map STI to relevance [0, 1]
				);
				processed++;
			}
		}

		this.membraneService.recordActivity('cerebral');

		return {
			name: 'think',
			durationMs: Date.now() - start,
			summary: `Processed ${processed} focused items into working memory`,
		};
	}

	/**
	 * Phase 4: Act — Produce motor actions based on cognitive state.
	 *
	 * Examines working memory for actionable patterns and produces
	 * appropriate motor outputs (insights, suggestions).
	 */
	private _phaseAct(): CognitiveLoopPhase {
		const start = Date.now();

		const workingMemory = this.workspaceService.getWorkingMemory();
		let actionCount = 0;

		// If working memory has enough items, generate an insight
		if (workingMemory.length >= 3) {
			const topItems = workingMemory.slice(0, 3);
			const categories = [...new Set(topItems.map(i => i.category))];

			if (categories.length > 1) {
				this.embodiedService.act(
					'insight',
					`Cross-domain pattern: ${categories.join(' ↔ ')}`,
					JSON.stringify({
						categories,
						items: topItems.map(i => ({ category: i.category, content: i.content.substring(0, 80) })),
					}),
					0.6,
					[]
				);
				actionCount++;
			}
		}

		this.membraneService.recordActivity('somatic');

		return {
			name: 'act',
			durationMs: Date.now() - start,
			summary: `Produced ${actionCount} action${actionCount !== 1 ? 's' : ''}`,
		};
	}

	/**
	 * Phase 5: Reflect — Update self-model and decay transient state.
	 *
	 * Runs working memory decay, updates proprioceptive state, and
	 * records the iteration as an episodic memory event.
	 */
	private _phaseReflect(): CognitiveLoopPhase {
		const start = Date.now();

		// Decay working memory relevance
		this.workspaceService.decayWorkingMemory();

		// Decay hypergraph salience
		this.hypergraphStore.decayAllSalience(0.995);

		// Record this cognitive cycle as a micro-episode
		const wm = this.workspaceService.getWorkingMemory();
		const snapshot = this.ecanService.getSnapshot();

		this.workspaceService.recordEpisode(
			`Cognitive cycle #${this._iterationCount}`,
			`Focus: ${snapshot.nodesInFocus} nodes, WM: ${wm.length} items, ` +
			`ECAN cycles: ${snapshot.spreadingCycles}`,
			[]
		);

		this.membraneService.recordActivity('autonomic');

		return {
			name: 'reflect',
			durationMs: Date.now() - start,
			summary: `Decayed WM (${wm.length} items), recorded episode`,
		};
	}

	// -- Helpers --------------------------------------------------------------

	private _fireStateChange(): void {
		this._onDidChangeState.fire(this.getState());
	}
}
