/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveLoopService,
	CognitiveLoopIteration,
	CognitiveLoopPhase,
	CognitiveLoopState,
	DistributedLoopNode,
	ClusterSyncState,
	GlobalECANState,
	CollectiveIntelligenceResult,
} from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

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
 * Multiple of the tick interval after which an in-flight iteration is
 * considered hung and recovered by the watchdog timer.
 */
const WATCHDOG_HANG_MULTIPLIER = 3;

/**
 * Cognitive Loop Service - the autonomous heartbeat of the Zone-Cog system.
 *
 * Orchestrates a continuous cognitive cycle:
 *   perceive → attend → think → act → reflect
 *
 * Each iteration:
 * 1. **Perceive**: Scans the environment via embodied cognition to gather
 *    fresh sensory percepts about workspace state changes.
 * 2. **Attend**: Runs ECAN spreading activation to focus processing
 *    resources on the most salient hypergraph nodes.
 * 3. **Think**: Performs lightweight cognitive processing on focused items -
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
	private _watchdogHandle: ReturnType<typeof setInterval> | null = null;
	private _iterationInFlightSince: number | null = null;
	private _flightToken = 0;
	private _watchdogRecoveries = 0;
	private _iterationCount = 0;
	private _failedIterations = 0;
	private _totalDurationMs = 0;
	private _lastIterationTime = 0;
	private readonly _recentIterations: CognitiveLoopIteration[] = [];

	// Distributed cognitive loop state (Phase C: FlareCog)
	private _distributedMode = false;
	private _localNodeId = '';
	private _localNodeName = '';
	private _isLeader = false;
	private _leaderId: string | undefined;
	private readonly _clusterNodes = new Map<string, DistributedLoopNode>();
	private _clusterIteration = 0;
	private _lastClusterSync = 0;
	private _syncFailures = 0;
	private _failoversCompleted = 0;
	private _globalAttentionUpdates = 0;
	private _collectiveAggregations = 0;
	private _globalAttentionalFocus: string[] = [];
	private readonly _nodeAttentionContributions = new Map<string, string[]>();

	private readonly _onDidCompleteIteration = this._register(new Emitter<CognitiveLoopIteration>());
	readonly onDidCompleteIteration: Event<CognitiveLoopIteration> = this._onDidCompleteIteration.event;

	private readonly _onDidChangeState = this._register(new Emitter<CognitiveLoopState>());
	readonly onDidChangeState: Event<CognitiveLoopState> = this._onDidChangeState.event;

	private readonly _onDidChangeClusterSync = this._register(new Emitter<ClusterSyncState>());
	readonly onDidChangeClusterSync: Event<ClusterSyncState> = this._onDidChangeClusterSync.event;

	private readonly _onDidUpdateGlobalAttention = this._register(new Emitter<GlobalECANState>());
	readonly onDidUpdateGlobalAttention: Event<GlobalECANState> = this._onDidUpdateGlobalAttention.event;

	private readonly _onDidAggregateCollectiveIntelligence = this._register(new Emitter<CollectiveIntelligenceResult>());
	readonly onDidAggregateCollectiveIntelligence: Event<CollectiveIntelligenceResult> = this._onDidAggregateCollectiveIntelligence.event;

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

		this._startWatchdog();

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

		this._stopWatchdog();

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
			this._startWatchdog();
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
			watchdogRecoveries: this._watchdogRecoveries,
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
		this._watchdogRecoveries = 0;
		this._iterationInFlightSince = null;
		this._fireStateChange();
		this.logService.info('CognitiveLoopService: reset');
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}

	// -- Private: Core loop ---------------------------------------------------

	private _tick(): void {
		// Skip if a previous iteration is still in flight - the watchdog
		// timer will recover the loop if that iteration has hung.
		if (this._iterationInFlightSince !== null) {
			return;
		}
		// Fire-and-forget; errors are handled inside _executeIteration
		this._executeIteration().catch(() => { /* errors already recorded */ });
	}

	private async _executeIteration(): Promise<CognitiveLoopIteration> {
		const startTime = Date.now();
		const flightToken = ++this._flightToken;
		this._iterationInFlightSince = startTime;
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
		// Release the in-flight marker unless the watchdog already recovered
		// this iteration (a newer flight token would have been issued).
		if (this._flightToken === flightToken) {
			this._iterationInFlightSince = null;
		}
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
	 * Phase 1: Perceive - Gather sensory input from the environment.
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
	 * Phase 2: Attend - Run ECAN spreading activation to allocate attention.
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
	 * Phase 3: Think - Process focused items through cognitive evaluation.
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
	 * Phase 4: Act - Produce motor actions based on cognitive state.
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
	 * Phase 5: Reflect - Update self-model and decay transient state.
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

	// -- Watchdog (Phase 7.2: error recovery & resilience) ---------------------

	/**
	 * Start (or restart) the watchdog timer. The watchdog checks once per
	 * tick interval whether an in-flight iteration has been running for
	 * longer than WATCHDOG_HANG_MULTIPLIER tick intervals; if so, the
	 * iteration is considered hung and the loop is recovered so future
	 * ticks can execute again.
	 */
	private _startWatchdog(): void {
		this._stopWatchdog();
		this._watchdogHandle = setInterval(() => this._watchdogCheck(), this._tickIntervalMs);
	}

	private _stopWatchdog(): void {
		if (this._watchdogHandle !== null) {
			clearInterval(this._watchdogHandle);
			this._watchdogHandle = null;
		}
	}

	private _watchdogCheck(): void {
		this.membraneService.recordActivity('autonomic');

		if (!this._running || this._iterationInFlightSince === null) {
			return;
		}

		const hungMs = Date.now() - this._iterationInFlightSince;
		const hangLimitMs = this._tickIntervalMs * WATCHDOG_HANG_MULTIPLIER;

		if (hungMs > hangLimitMs) {
			// Invalidate the hung iteration's flight token and release the
			// in-flight marker so subsequent ticks resume executing.
			this._flightToken++;
			this._iterationInFlightSince = null;
			this._watchdogRecoveries++;
			this._failedIterations++;
			this.membraneService.recordError('autonomic', `Cognitive loop watchdog recovered a hung iteration after ${hungMs}ms`);
			this.logService.warn(`CognitiveLoopService: watchdog recovered hung iteration after ${hungMs}ms (limit ${hangLimitMs}ms)`);
			this._fireStateChange();
		}
	}

	// -- Helpers --------------------------------------------------------------

	private _fireStateChange(): void {
		this._onDidChangeState.fire(this.getState());
	}

	// -- Distributed Cognitive Loop (Phase C: FlareCog) -----------------------

	enableDistributedMode(nodeId: string, nodeName: string): void {
		if (this._distributedMode) {
			this.logService.info('CognitiveLoopService: distributed mode already enabled');
			return;
		}

		this._distributedMode = true;
		this._localNodeId = nodeId;
		this._localNodeName = nodeName;
		this._isLeader = true; // First node becomes leader by default
		this._leaderId = nodeId;
		this._clusterIteration = this._iterationCount;
		this._lastClusterSync = Date.now();

		// Register self as cluster node
		const localNode: DistributedLoopNode = {
			nodeId,
			nodeName,
			synchronized: true,
			currentIteration: this._iterationCount,
			lastSyncTime: Date.now(),
			cognitiveLoad: 0,
			isLeader: true,
		};
		this._clusterNodes.set(nodeId, localNode);

		this.membraneService.recordActivity('autonomic');
		this._fireClusterSyncChange();
		this.logService.info(`CognitiveLoopService: distributed mode enabled as leader (node ${nodeId})`);
	}

	disableDistributedMode(): void {
		if (!this._distributedMode) {
			return;
		}

		this._distributedMode = false;
		this._isLeader = false;
		this._leaderId = undefined;
		this._clusterNodes.clear();
		this._nodeAttentionContributions.clear();
		this._globalAttentionalFocus = [];

		this._fireClusterSyncChange();
		this.logService.info('CognitiveLoopService: distributed mode disabled');
	}

	registerClusterNode(node: Omit<DistributedLoopNode, 'synchronized' | 'currentIteration' | 'lastSyncTime' | 'cognitiveLoad'>): void {
		if (!this._distributedMode) {
			this.logService.warn('CognitiveLoopService: cannot register cluster node - distributed mode not enabled');
			return;
		}

		const fullNode: DistributedLoopNode = {
			...node,
			synchronized: false,
			currentIteration: 0,
			lastSyncTime: 0,
			cognitiveLoad: 0,
		};

		this._clusterNodes.set(node.nodeId, fullNode);
		this._fireClusterSyncChange();
		this.logService.info(`CognitiveLoopService: registered cluster node '${node.nodeName}' (${node.nodeId})`);
	}

	unregisterClusterNode(nodeId: string): void {
		if (nodeId === this._localNodeId) {
			this.logService.warn('CognitiveLoopService: cannot unregister local node');
			return;
		}

		const node = this._clusterNodes.get(nodeId);
		if (!node) {
			return;
		}

		this._clusterNodes.delete(nodeId);
		this._nodeAttentionContributions.delete(nodeId);

		// If leader left, trigger failover
		if (nodeId === this._leaderId) {
			this.handleLeaderFailover();
		}

		this._fireClusterSyncChange();
		this.logService.info(`CognitiveLoopService: unregistered cluster node '${nodeId}'`);
	}

	getClusterSyncState(): ClusterSyncState {
		return {
			distributedMode: this._distributedMode,
			localNodeId: this._localNodeId,
			isLeader: this._isLeader,
			leaderId: this._leaderId,
			nodes: Array.from(this._clusterNodes.values()),
			clusterIteration: this._clusterIteration,
			lastClusterSync: this._lastClusterSync,
			syncFailures: this._syncFailures,
			failoversCompleted: this._failoversCompleted,
		};
	}

	async syncWithCluster(): Promise<void> {
		if (!this._distributedMode) {
			return;
		}

		this.membraneService.recordActivity('autonomic');

		try {
			// Update local node state
			const localNode = this._clusterNodes.get(this._localNodeId);
			if (localNode) {
				localNode.currentIteration = this._iterationCount;
				localNode.lastSyncTime = Date.now();
				localNode.cognitiveLoad = this._calculateLocalLoad();
				localNode.synchronized = true;
			}

			// In distributed mode, broadcast to other nodes
			// Simulate network sync
			await new Promise<void>(resolve => setTimeout(resolve, 10));

			// Update cluster iteration to highest among synchronized nodes
			const syncedNodes = Array.from(this._clusterNodes.values()).filter(n => n.synchronized);
			if (syncedNodes.length > 0) {
				this._clusterIteration = Math.max(...syncedNodes.map(n => n.currentIteration));
			}

			this._lastClusterSync = Date.now();
			this._fireClusterSyncChange();

		} catch {
			this._syncFailures++;
			this.membraneService.recordError('autonomic', 'Cluster sync failed');
			this._fireClusterSyncChange();
		}
	}

	private _calculateLocalLoad(): number {
		// Estimate load based on iteration timing
		const avgDuration = this._iterationCount > 0
			? this._totalDurationMs / this._iterationCount
			: 0;
		return Math.min(1, avgDuration / this._tickIntervalMs);
	}

	async proposeAsLeader(): Promise<boolean> {
		if (!this._distributedMode) {
			return false;
		}

		// Simple leader election: propose self, wait for objections
		this.membraneService.recordActivity('cerebral');

		// In real implementation, would use consensus protocol
		// For now, accept if current leader is unreachable or self
		if (!this._leaderId || this._leaderId === this._localNodeId) {
			this._isLeader = true;
			this._leaderId = this._localNodeId;

			const localNode = this._clusterNodes.get(this._localNodeId);
			if (localNode) {
				localNode.isLeader = true;
			}

			// Mark other nodes as not leader
			for (const node of this._clusterNodes.values()) {
				if (node.nodeId !== this._localNodeId) {
					node.isLeader = false;
				}
			}

			this._fireClusterSyncChange();
			this.logService.info('CognitiveLoopService: became cluster leader');
			return true;
		}

		return false;
	}

	async handleLeaderFailover(): Promise<void> {
		if (!this._distributedMode) {
			return;
		}

		this.membraneService.recordActivity('autonomic');

		// Find eligible nodes (excluding current leader)
		const eligibleNodes = Array.from(this._clusterNodes.values())
			.filter(n => n.nodeId !== this._leaderId && n.synchronized)
			.sort((a, b) => {
				// Prefer nodes with lower load
				return a.cognitiveLoad - b.cognitiveLoad;
			});

		if (eligibleNodes.length === 0) {
			this.logService.warn('CognitiveLoopService: no eligible nodes for failover');
			return;
		}

		// If local node is eligible and has lowest load, become leader
		const localNode = this._clusterNodes.get(this._localNodeId);
		if (localNode && eligibleNodes[0].nodeId === this._localNodeId) {
			this._isLeader = true;
			this._leaderId = this._localNodeId;
			localNode.isLeader = true;
			this._failoversCompleted++;

			this._fireClusterSyncChange();
			this.logService.info('CognitiveLoopService: failover complete - became new leader');
		} else {
			// Another node becomes leader
			this._isLeader = false;
			this._leaderId = eligibleNodes[0].nodeId;
			eligibleNodes[0].isLeader = true;
			this._failoversCompleted++;

			this._fireClusterSyncChange();
			this.logService.info(`CognitiveLoopService: failover complete - new leader is ${this._leaderId}`);
		}
	}

	getGlobalECANState(): GlobalECANState {
		return {
			globalAttentionalFocus: [...this._globalAttentionalFocus],
			nodeContributions: new Map(this._nodeAttentionContributions),
			globalAttentionThreshold: 0.5,
			lastAggregationTime: this._lastClusterSync,
		};
	}

	contributeToGlobalAttention(nodeIds: string[]): void {
		if (!this._distributedMode) {
			return;
		}

		this.membraneService.recordActivity('cerebral');

		// Store local contribution
		this._nodeAttentionContributions.set(this._localNodeId, nodeIds);

		// Aggregate global attentional focus
		const allNodeIds = new Map<string, number>();
		for (const contribution of this._nodeAttentionContributions.values()) {
			for (const id of contribution) {
				allNodeIds.set(id, (allNodeIds.get(id) || 0) + 1);
			}
		}

		// Select nodes with highest occurrence across cluster
		const sorted = Array.from(allNodeIds.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([id]) => id);

		this._globalAttentionalFocus = sorted;
		this._globalAttentionUpdates++;

		this._onDidUpdateGlobalAttention.fire(this.getGlobalECANState());
		this.logService.trace(`CognitiveLoopService: updated global attention with ${sorted.length} focused nodes`);
	}

	async aggregateCollectiveIntelligence(topic: string, localContribution: unknown): Promise<CollectiveIntelligenceResult> {
		this.membraneService.recordActivity('cerebral');

		const nodeContributions = new Map<string, unknown>();
		nodeContributions.set(this._localNodeId, localContribution);

		// In real implementation, would gather from all cluster nodes
		// Simulate gathering contributions
		if (this._distributedMode) {
			await new Promise<void>(resolve => setTimeout(resolve, 50));
		}

		// Aggregate contributions (simple merge for now)
		let collectiveResult: unknown;
		let confidence = 0.5;

		if (nodeContributions.size === 1) {
			collectiveResult = localContribution;
			confidence = 0.6;
		} else {
			// Would implement more sophisticated aggregation
			collectiveResult = {
				aggregated: true,
				contributions: nodeContributions.size,
				topic,
			};
			confidence = Math.min(0.95, 0.5 + nodeContributions.size * 0.1);
		}

		this._collectiveAggregations++;

		const result: CollectiveIntelligenceResult = {
			id: generateUuid(),
			topic,
			nodeContributions,
			collectiveResult,
			confidence,
			timestamp: Date.now(),
		};

		this._onDidAggregateCollectiveIntelligence.fire(result);
		this.logService.info(`CognitiveLoopService: aggregated collective intelligence for '${topic}' (confidence: ${confidence.toFixed(2)})`);

		return result;
	}

	getDistributedStats(): {
		nodeCount: number;
		synchronizedNodeCount: number;
		clusterIterations: number;
		syncFailures: number;
		failoversCompleted: number;
		globalAttentionUpdates: number;
		collectiveAggregations: number;
	} {
		const nodes = Array.from(this._clusterNodes.values());
		return {
			nodeCount: nodes.length,
			synchronizedNodeCount: nodes.filter(n => n.synchronized).length,
			clusterIterations: this._clusterIteration,
			syncFailures: this._syncFailures,
			failoversCompleted: this._failoversCompleted,
			globalAttentionUpdates: this._globalAttentionUpdates,
			collectiveAggregations: this._collectiveAggregations,
		};
	}

	private _fireClusterSyncChange(): void {
		this._onDidChangeClusterSync.fire(this.getClusterSyncState());
	}
}
