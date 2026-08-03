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
	/** Number of hung iterations recovered by the watchdog timer. */
	watchdogRecoveries: number;
}

// ---------------------------------------------------------------------------
// Distributed Cognitive Loop types (Phase C: FlareCog)
// ---------------------------------------------------------------------------

/**
 * A remote cognitive node participating in the distributed loop.
 */
export interface DistributedLoopNode {
	/** Node ID. */
	nodeId: string;
	/** Node name. */
	nodeName: string;
	/** Whether the node is synchronized with the cluster. */
	synchronized: boolean;
	/** Node's current iteration number. */
	currentIteration: number;
	/** Last sync timestamp. */
	lastSyncTime: number;
	/** Node's cognitive load (0-1). */
	cognitiveLoad: number;
	/** Whether the node is the cluster leader. */
	isLeader: boolean;
}

/**
 * Cluster-wide synchronization state.
 */
export interface ClusterSyncState {
	/** Whether distributed mode is active. */
	distributedMode: boolean;
	/** This node's ID. */
	localNodeId: string;
	/** Whether this node is the cluster leader. */
	isLeader: boolean;
	/** Current cluster leader's node ID. */
	leaderId: string | undefined;
	/** All participating nodes. */
	nodes: DistributedLoopNode[];
	/** Cluster-wide iteration number. */
	clusterIteration: number;
	/** Last cluster sync timestamp. */
	lastClusterSync: number;
	/** Number of sync failures. */
	syncFailures: number;
	/** Number of successful failovers. */
	failoversCompleted: number;
}

/**
 * Global attention state aggregated across the cluster.
 */
export interface GlobalECANState {
	/** Top salient node IDs across the cluster. */
	globalAttentionalFocus: string[];
	/** Per-node attention contributions. */
	nodeContributions: Map<string, string[]>;
	/** Global attention threshold. */
	globalAttentionThreshold: number;
	/** Last aggregation timestamp. */
	lastAggregationTime: number;
}

/**
 * Collective intelligence aggregation result.
 */
export interface CollectiveIntelligenceResult {
	/** Aggregation ID. */
	id: string;
	/** Query or topic being aggregated. */
	topic: string;
	/** Per-node contributions. */
	nodeContributions: Map<string, unknown>;
	/** Aggregated collective result. */
	collectiveResult: unknown;
	/** Confidence in the collective result (0-1). */
	confidence: number;
	/** Aggregation timestamp. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive Loop Service - the autonomous heartbeat of the Zone-Cog system.
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
 * can be started, stopped, and paused. While running, a watchdog timer
 * monitors iteration execution and recovers the loop if an iteration
 * hangs, ensuring the autonomous cycle cannot stall permanently.
 */
export interface ICognitiveLoopService {
	readonly _serviceBrand: undefined;

	/** Fired after each completed iteration. */
	readonly onDidCompleteIteration: Event<CognitiveLoopIteration>;

	/** Fired when the loop state changes (start/stop/pause). */
	readonly onDidChangeState: Event<CognitiveLoopState>;

	/** Fired when cluster sync state changes. */
	readonly onDidChangeClusterSync: Event<ClusterSyncState>;

	/** Fired when global attention is updated. */
	readonly onDidUpdateGlobalAttention: Event<GlobalECANState>;

	/** Fired when collective intelligence is aggregated. */
	readonly onDidAggregateCollectiveIntelligence: Event<CollectiveIntelligenceResult>;

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

	// -- Distributed Cognitive Loop (Phase C: FlareCog) -----------------------

	/**
	 * Enable distributed mode and join the cognitive cluster.
	 * @param nodeId This node's unique identifier.
	 * @param nodeName Human-readable name for this node.
	 */
	enableDistributedMode(nodeId: string, nodeName: string): void;

	/**
	 * Disable distributed mode and leave the cluster.
	 */
	disableDistributedMode(): void;

	/**
	 * Register a remote node in the cluster.
	 */
	registerClusterNode(node: Omit<DistributedLoopNode, 'synchronized' | 'currentIteration' | 'lastSyncTime' | 'cognitiveLoad'>): void;

	/**
	 * Unregister a remote node from the cluster.
	 */
	unregisterClusterNode(nodeId: string): void;

	/**
	 * Get the current cluster sync state.
	 */
	getClusterSyncState(): ClusterSyncState;

	/**
	 * Synchronize loop iteration with the cluster.
	 */
	syncWithCluster(): Promise<void>;

	/**
	 * Propose this node as the cluster leader.
	 */
	proposeAsLeader(): Promise<boolean>;

	/**
	 * Handle failover when the current leader fails.
	 */
	handleLeaderFailover(): Promise<void>;

	/**
	 * Get the global ECAN state aggregated across the cluster.
	 */
	getGlobalECANState(): GlobalECANState;

	/**
	 * Contribute local attention focus to global ECAN.
	 */
	contributeToGlobalAttention(nodeIds: string[]): void;

	/**
	 * Aggregate collective intelligence from all cluster nodes.
	 * @param topic The query or topic to aggregate intelligence for.
	 * @param localContribution This node's contribution.
	 */
	aggregateCollectiveIntelligence(topic: string, localContribution: unknown): Promise<CollectiveIntelligenceResult>;

	/**
	 * Get distributed loop statistics.
	 */
	getDistributedStats(): {
		nodeCount: number;
		synchronizedNodeCount: number;
		clusterIterations: number;
		syncFailures: number;
		failoversCompleted: number;
		globalAttentionUpdates: number;
		collectiveAggregations: number;
	};
}
