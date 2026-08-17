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
import {
	CognitiveMeshNode,
	ICognitiveMeshChannel,
	InProcessMeshHub,
	createMeshChannel,
	getDefaultMeshHub,
} from 'sql/workbench/services/zonecog/browser/cognitiveMeshTransport';
import {
	CognitiveMeshEnvelope,
	CognitiveMeshRequestPayload,
	CognitiveMeshResponsePayload,
} from 'sql/workbench/services/zonecog/common/cognitiveMesh';
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
	private readonly _meshHub: InProcessMeshHub = getDefaultMeshHub();
	private _mesh: CognitiveMeshNode | undefined;
	/** Node-side mesh endpoints that answer loop-sync / vote / collective ops. */
	private readonly _nodeSideChannels = new Map<string, ICognitiveMeshChannel>();
	/** Pending collective-intelligence contributions keyed by `${nodeId}:${topic}`. */
	private readonly _pendingCollective = new Map<string, unknown>();

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
		this.disableDistributedMode();
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
		this._isLeader = true; // First node becomes leader by default
		this._leaderId = nodeId;
		this._clusterIteration = this._iterationCount;
		this._lastClusterSync = Date.now();

		// Mesh node for cluster messaging
		if (this._mesh) {
			this._mesh.dispose();
		}
		this._mesh = new CognitiveMeshNode(
			nodeId,
			address => createMeshChannel(address, { hub: this._meshHub })
		);
		this._register(this._mesh.onDidReceiveEvent(envelope => this._onClusterMeshEvent(envelope)));
		this._register(this._mesh.registerHandler('loop-sync', async (envelope) => {
			const args = envelope.payload?.args as {
				iteration?: number;
				cognitiveLoad?: number;
				attention?: string[];
			} | undefined;
			const remoteId = envelope.fromPeerId;
			const remote = this._clusterNodes.get(remoteId);
			if (remote) {
				remote.synchronized = true;
				remote.currentIteration = args?.iteration ?? remote.currentIteration;
				remote.lastSyncTime = Date.now();
				remote.cognitiveLoad = args?.cognitiveLoad ?? remote.cognitiveLoad;
			}
			if (args?.attention) {
				this._nodeAttentionContributions.set(remoteId, args.attention);
			}
			return {
				ok: true,
				result: {
					nodeId: this._localNodeId,
					iteration: this._iterationCount,
					cognitiveLoad: this._calculateLocalLoad(),
					isLeader: this._isLeader,
					attention: this._nodeAttentionContributions.get(this._localNodeId) ?? [],
				},
			};
		}));
		this._register(this._mesh.registerHandler('collective-contribute', async (envelope) => {
			const args = envelope.payload?.args as { topic?: string; contribution?: unknown } | undefined;
			const topic = args?.topic ?? 'default';
			const stored = this._pendingCollective.get(`${envelope.fromPeerId}:${topic}`);
			return {
				ok: true,
				result: {
					nodeId: this._localNodeId,
					topic,
					contribution: this._pendingCollective.get(`${this._localNodeId}:${topic}`) ?? stored ?? args?.contribution,
				},
			};
		}));
		this._register(this._mesh.registerHandler('leader-propose', async (envelope) => {
			const args = envelope.payload?.args as { candidateId?: string; load?: number } | undefined;
			const candidateId = args?.candidateId ?? envelope.fromPeerId;
			const candidateLoad = args?.load ?? 1;
			const localLoad = this._calculateLocalLoad();
			// Accept if candidate has lower load, or equal load with lexicographically smaller id
			const accept = candidateLoad < localLoad
				|| (candidateLoad === localLoad && candidateId <= this._localNodeId);
			return { ok: true, result: { accept, nodeId: this._localNodeId, load: localLoad } };
		}));

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

		// Local node-side endpoint so peers can reach us on the hub
		const selfSide = this._meshHub.connect(`loop-node:${nodeId}`);
		selfSide.onmessage = event => {
			void this._mesh?.correlator.handleMessage(event.data);
		};
		this._nodeSideChannels.set(nodeId, selfSide);

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
		for (const channel of this._nodeSideChannels.values()) {
			channel.close();
		}
		this._nodeSideChannels.clear();
		this._clusterNodes.clear();
		this._nodeAttentionContributions.clear();
		this._globalAttentionalFocus = [];
		this._pendingCollective.clear();
		if (this._mesh) {
			this._mesh.dispose();
			this._mesh = undefined;
		}

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
		this._mesh?.connectPeer(node.nodeId, node.nodeId);

		// Node-side responder for this cluster member (in-process multi-node)
		if (!this._nodeSideChannels.has(node.nodeId)) {
			const nodeSide = this._meshHub.connect(`loop-node:${node.nodeId}`);
			nodeSide.onmessage = event => {
				void this._handleRemoteLoopNodeMessage(node.nodeId, nodeSide, event.data);
			};
			this._nodeSideChannels.set(node.nodeId, nodeSide);
		}

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
		this._mesh?.disconnectPeer(nodeId);
		const nodeSide = this._nodeSideChannels.get(nodeId);
		if (nodeSide) {
			nodeSide.close();
			this._nodeSideChannels.delete(nodeId);
		}

		// If leader left, trigger failover
		if (nodeId === this._leaderId) {
			void this.handleLeaderFailover();
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
		if (!this._distributedMode || !this._mesh) {
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

			const attention = this._nodeAttentionContributions.get(this._localNodeId) ?? [];
			const peers = Array.from(this._clusterNodes.keys()).filter(id => id !== this._localNodeId);

			await Promise.all(peers.map(async peerId => {
				try {
					const response = await this._mesh!.request(peerId, 'loop-sync', {
						iteration: this._iterationCount,
						cognitiveLoad: this._calculateLocalLoad(),
						attention,
					}, 2000);
					if (response.ok && response.result && typeof response.result === 'object') {
						const result = response.result as {
							nodeId?: string;
							iteration?: number;
							cognitiveLoad?: number;
							isLeader?: boolean;
							attention?: string[];
						};
						const remote = this._clusterNodes.get(peerId);
						if (remote) {
							remote.synchronized = true;
							remote.currentIteration = result.iteration ?? remote.currentIteration;
							remote.cognitiveLoad = result.cognitiveLoad ?? remote.cognitiveLoad;
							remote.lastSyncTime = Date.now();
							if (result.isLeader) {
								this._leaderId = peerId;
								this._isLeader = false;
								remote.isLeader = true;
							}
						}
						if (Array.isArray(result.attention)) {
							this._nodeAttentionContributions.set(peerId, result.attention);
						}
					}
				} catch {
					const remote = this._clusterNodes.get(peerId);
					if (remote) {
						remote.synchronized = false;
					}
				}
			}));

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
		if (!this._distributedMode || !this._mesh) {
			return false;
		}

		this.membraneService.recordActivity('cerebral');

		const peers = Array.from(this._clusterNodes.keys()).filter(id => id !== this._localNodeId);
		const localLoad = this._calculateLocalLoad();

		// If no peers, or current leader is self / missing, claim leadership after peer votes
		let acceptances = 0;
		let votes = 0;
		for (const peerId of peers) {
			try {
				const response = await this._mesh.request(peerId, 'leader-propose', {
					candidateId: this._localNodeId,
					load: localLoad,
				}, 1500);
				votes++;
				const result = response.result as { accept?: boolean } | undefined;
				if (response.ok && result?.accept) {
					acceptances++;
				}
			} catch {
				// Unreachable peers abstain
			}
		}

		const quorumMet = peers.length === 0 || (votes > 0 && acceptances >= Math.ceil(votes / 2));
		const leaderMissing = !this._leaderId || this._leaderId === this._localNodeId
			|| !this._clusterNodes.get(this._leaderId!)?.synchronized;

		if (quorumMet && (leaderMissing || acceptances === votes)) {
			this._isLeader = true;
			this._leaderId = this._localNodeId;

			const localNode = this._clusterNodes.get(this._localNodeId);
			if (localNode) {
				localNode.isLeader = true;
			}

			for (const node of this._clusterNodes.values()) {
				if (node.nodeId !== this._localNodeId) {
					node.isLeader = false;
				}
			}

			this._mesh.broadcast({
				kind: 'loop-leader',
				leaderId: this._localNodeId,
			});

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

		// Clear the failed leader so proposeAsLeader can run a mesh vote.
		const failedLeader = this._leaderId;
		this._leaderId = undefined;
		this._isLeader = false;
		for (const node of this._clusterNodes.values()) {
			if (node.nodeId === failedLeader) {
				node.isLeader = false;
				node.synchronized = false;
			}
		}

		const becameLeader = await this.proposeAsLeader();
		if (becameLeader) {
			this._failoversCompleted++;
			this.logService.info('CognitiveLoopService: failover complete - became new leader via mesh vote');
			return;
		}

		// Fall back to deterministic lowest-load selection among synchronized peers
		const eligibleNodes = Array.from(this._clusterNodes.values())
			.filter(n => n.nodeId !== failedLeader && n.synchronized)
			.sort((a, b) => a.cognitiveLoad - b.cognitiveLoad || a.nodeId.localeCompare(b.nodeId));

		if (eligibleNodes.length === 0) {
			this.logService.warn('CognitiveLoopService: no eligible nodes for failover');
			this._fireClusterSyncChange();
			return;
		}

		this._leaderId = eligibleNodes[0].nodeId;
		this._isLeader = eligibleNodes[0].nodeId === this._localNodeId;
		for (const node of this._clusterNodes.values()) {
			node.isLeader = node.nodeId === this._leaderId;
		}
		this._failoversCompleted++;
		this._mesh?.broadcast({ kind: 'loop-leader', leaderId: this._leaderId });
		this._fireClusterSyncChange();
		this.logService.info(`CognitiveLoopService: failover complete - new leader is ${this._leaderId}`);
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
		this._pendingCollective.set(`${this._localNodeId}:${topic}`, localContribution);

		if (this._distributedMode && this._mesh) {
			const peers = Array.from(this._clusterNodes.keys()).filter(id => id !== this._localNodeId);
			await Promise.all(peers.map(async peerId => {
				try {
					const response = await this._mesh!.request(peerId, 'collective-contribute', {
						topic,
						contribution: localContribution,
					}, 2000);
					if (response.ok && response.result && typeof response.result === 'object') {
						const result = response.result as { nodeId?: string; contribution?: unknown };
						const id = result.nodeId ?? peerId;
						if (result.contribution !== undefined) {
							nodeContributions.set(id, result.contribution);
						}
					}
				} catch {
					// Peer unavailable - continue with partial aggregation
				}
			}));
		}

		// Aggregate contributions
		let collectiveResult: unknown;
		let confidence = 0.5;

		if (nodeContributions.size === 1) {
			collectiveResult = localContribution;
			confidence = 0.6;
		} else {
			collectiveResult = {
				aggregated: true,
				contributions: nodeContributions.size,
				topic,
				values: Array.from(nodeContributions.entries()).map(([nodeId, value]) => ({ nodeId, value })),
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

	private _onClusterMeshEvent(envelope: CognitiveMeshEnvelope): void {
		const payload = envelope.payload as { kind?: string; leaderId?: string } | undefined;
		if (payload?.kind === 'loop-leader' && payload.leaderId) {
			this._leaderId = payload.leaderId;
			this._isLeader = payload.leaderId === this._localNodeId;
			for (const node of this._clusterNodes.values()) {
				node.isLeader = node.nodeId === payload.leaderId;
			}
			this._fireClusterSyncChange();
		}
	}

	/**
	 * Handles loop protocol requests addressed to a non-local cluster node
	 * that is proxied in-process (registered via registerClusterNode).
	 */
	private async _handleRemoteLoopNodeMessage(
		nodeId: string,
		channel: ICognitiveMeshChannel,
		data: unknown
	): Promise<void> {
		if (!data || typeof data !== 'object') {
			return;
		}
		const envelope = data as CognitiveMeshEnvelope<CognitiveMeshRequestPayload>;
		if (envelope.type !== 'request' || !envelope.payload?.op) {
			return;
		}
		if (envelope.toPeerId && envelope.toPeerId !== nodeId) {
			return;
		}

		const op = envelope.payload.op;
		const node = this._clusterNodes.get(nodeId);
		let response: CognitiveMeshResponsePayload;

		if (op === 'loop-sync') {
			const args = envelope.payload.args as { iteration?: number; cognitiveLoad?: number; attention?: string[] } | undefined;
			if (node) {
				node.synchronized = true;
				node.lastSyncTime = Date.now();
				if (typeof args?.iteration === 'number') {
					// Keep the remote node's own iteration if higher
					node.currentIteration = Math.max(node.currentIteration, args.iteration);
				}
			}
			if (args?.attention) {
				this._nodeAttentionContributions.set(envelope.fromPeerId, args.attention);
			}
			response = {
				ok: true,
				result: {
					nodeId,
					iteration: node?.currentIteration ?? 0,
					cognitiveLoad: node?.cognitiveLoad ?? 0,
					isLeader: node?.isLeader ?? false,
					attention: this._nodeAttentionContributions.get(nodeId) ?? [],
				},
			};
		} else if (op === 'collective-contribute') {
			const args = envelope.payload.args as { topic?: string; contribution?: unknown } | undefined;
			const topic = args?.topic ?? 'default';
			const existing = this._pendingCollective.get(`${nodeId}:${topic}`);
			if (existing === undefined && args?.contribution !== undefined) {
				// Seed the proxied node with a contribution echo so aggregation has peer data
				this._pendingCollective.set(`${nodeId}:${topic}`, {
					echo: true,
					from: envelope.fromPeerId,
					seed: args.contribution,
				});
			}
			response = {
				ok: true,
				result: {
					nodeId,
					topic,
					contribution: this._pendingCollective.get(`${nodeId}:${topic}`) ?? { nodeId, topic },
				},
			};
		} else if (op === 'leader-propose') {
			const args = envelope.payload.args as { candidateId?: string; load?: number } | undefined;
			const candidateId = args?.candidateId ?? envelope.fromPeerId;
			const candidateLoad = args?.load ?? 1;
			const nodeLoad = node?.cognitiveLoad ?? 1;
			const accept = candidateLoad < nodeLoad
				|| (candidateLoad === nodeLoad && candidateId <= nodeId);
			response = { ok: true, result: { accept, nodeId, load: nodeLoad } };
		} else {
			response = { ok: false, error: `unsupported op '${op}'` };
		}

		channel.postMessage({
			type: 'response',
			id: generateUuid(),
			fromPeerId: nodeId,
			toPeerId: envelope.fromPeerId,
			replyTo: envelope.id,
			timestamp: Date.now(),
			payload: response,
		} satisfies CognitiveMeshEnvelope<CognitiveMeshResponsePayload>);
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
