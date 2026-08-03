/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

export const IFederatedQueryService = createDecorator<IFederatedQueryService>('federatedQueryService');

// ---------------------------------------------------------------------------
// Federated query types
// ---------------------------------------------------------------------------

/** Criteria used to match hypergraph nodes, locally and on remote peers. */
export interface FederatedQueryFilter {
	/** Exact node_type match. */
	nodeType?: string;
	/** Case-insensitive substring match against node content. */
	keyword?: string;
	/** Minimum salience_score, inclusive. */
	minSalience?: number;
	/** Maximum nodes returned per participant (local or remote). Default 25. */
	limit?: number;
}

/** Nodes contributed by a single participant (self or a remote peer) for one query. */
export interface FederatedQueryResult {
	peerId: string;
	/** True for the participant that issued the query. */
	isSelf: boolean;
	nodes: HypergraphNode[];
}

/** State of the federated query session. */
export interface FederatedQueryState {
	active: boolean;
	/** Stable identifier of this participant. */
	peerId: string;
	/** Peer ids seen since the session started (excluding self). */
	knownPeers: string[];
	/** Query requests broadcast to peers since the session started. */
	queriesSent: number;
	/** Query responses received from peers since the session started. */
	responsesReceived: number;
	/** Query requests answered on behalf of a peer since the session started. */
	requestsAnswered: number;
	/** Whether distributed (cross-machine) federation is active. */
	distributedActive: boolean;
	/** Remote peers connected via WebSocket. */
	remotePeers: string[];
}

// ---------------------------------------------------------------------------
// Distributed Federation types (Phase C: FlareCog)
// ---------------------------------------------------------------------------

/** Query plan for distributed hypergraph queries. */
export interface DistributedQueryPlan {
	/** Unique plan ID. */
	id: string;
	/** Target peer IDs to query. */
	targetPeers: string[];
	/** Filter to apply on each peer. */
	filter: FederatedQueryFilter;
	/** Whether to include local results. */
	includeLocal: boolean;
	/** Aggregation strategy. */
	aggregationStrategy: QueryAggregationStrategy;
	/** Conflict resolution strategy. */
	conflictResolution: ConflictResolutionStrategy;
	/** Created timestamp. */
	createdAt: number;
	/** Timeout per peer (ms). */
	peerTimeoutMs: number;
}

/** Strategy for aggregating results from multiple peers. */
export type QueryAggregationStrategy =
	| 'merge'          // Merge all results, dedupe by node ID
	| 'union'          // Union all results (no deduplication)
	| 'intersect'      // Only nodes present in all peers
	| 'vote'           // Include nodes present in majority of peers
	| 'salience-rank'; // Rank by salience across peers

/** Strategy for resolving conflicts when the same node exists on multiple peers. */
export type ConflictResolutionStrategy =
	| 'highest-salience'   // Keep version with highest salience
	| 'most-recent'        // Keep most recently updated version
	| 'origin-wins'        // Keep version from originating peer
	| 'local-wins'         // Prefer local version
	| 'merge-metadata';    // Merge metadata from all versions

/** Result from a distributed query. */
export interface DistributedQueryResult {
	/** Query plan used. */
	plan: DistributedQueryPlan;
	/** Results per peer. */
	peerResults: FederatedQueryResult[];
	/** Aggregated/merged nodes after conflict resolution. */
	mergedNodes: HypergraphNode[];
	/** Total query duration (ms). */
	totalDurationMs: number;
	/** Per-peer durations (ms). */
	peerDurations: Record<string, number>;
	/** Peers that failed or timed out. */
	failedPeers: string[];
	/** Conflicts resolved. */
	conflictsResolved: number;
}

/** Salience propagation request for distributed ECAN. */
export interface SaliencePropagationRequest {
	/** Source node ID. */
	nodeId: string;
	/** Salience delta to propagate. */
	salienceDelta: number;
	/** Propagation depth (hops). */
	depth: number;
	/** Originating peer ID. */
	originPeerId: string;
	/** Timestamp. */
	timestamp: number;
}

/** Remote peer connection for distributed queries. */
export interface RemotePeerConnection {
	/** Peer ID. */
	peerId: string;
	/** WebSocket URL. */
	wsUrl: string;
	/** Connection state. */
	state: 'connecting' | 'connected' | 'disconnected' | 'error';
	/** Last activity timestamp. */
	lastActivity: number;
	/** Pending queries to this peer. */
	pendingQueries: number;
	/** Total queries sent. */
	queriesSent: number;
	/** Total responses received. */
	responsesReceived: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Federated hypergraph query service.
 *
 * Same-machine slice of the Phase 3.4 "Federated hypergraph queries" roadmap
 * item, built on the same BroadcastChannel transport as
 * {@link ISharedCognitionService}: a query is answered locally and, while a
 * session is active, also broadcast to every other workbench window on this
 * machine, whose matching nodes are collected back and returned per
 * participant. A true FlareCog cross-machine federation transport remains
 * future work.
 */
export interface IFederatedQueryService {
	readonly _serviceBrand: undefined;

	/** Fired when the session starts or stops, or peers/counters change. */
	readonly onDidChangeSessionState: Event<FederatedQueryState>;

	/** Fired when a distributed query completes. */
	readonly onDidCompleteDistributedQuery: Event<DistributedQueryResult>;

	/** Fired when salience propagation is received from a remote peer. */
	readonly onDidReceiveSaliencePropagation: Event<SaliencePropagationRequest>;

	/** Fired when a remote peer connects or disconnects. */
	readonly onDidChangeRemotePeer: Event<RemotePeerConnection>;

	/**
	 * Start federating: opens the channel and announces this peer. Returns
	 * false when BroadcastChannel is unavailable in the current environment.
	 * Local-only querying via {@link query} still works without a session.
	 */
	startSession(): boolean;

	/** Stop federating and close the channel. */
	stopSession(): void;

	/** Current session state. */
	getState(): FederatedQueryState;

	/**
	 * Run a query against the local hypergraph and, when a session is
	 * active, against every known peer. Resolves once every known peer has
	 * answered or `timeoutMs` elapses, whichever is first.
	 */
	query(filter: FederatedQueryFilter, timeoutMs?: number): Promise<FederatedQueryResult[]>;

	/**
	 * Convenience wrapper over {@link query} that flattens every
	 * participant's nodes into a single list, deduplicated by node id
	 * (highest salience_score wins), sorted by salience_score descending.
	 */
	queryMerged(filter: FederatedQueryFilter, timeoutMs?: number): Promise<HypergraphNode[]>;

	// -- Distributed Federation (Phase C: FlareCog) ---------------------------

	/**
	 * Connect to a remote peer via WebSocket for cross-machine federation.
	 * @param wsUrl WebSocket URL of the remote peer.
	 * @returns The connection, or undefined if connection failed.
	 */
	connectRemotePeer(wsUrl: string): Promise<RemotePeerConnection | undefined>;

	/**
	 * Disconnect from a remote peer.
	 * @param peerId The peer ID to disconnect.
	 */
	disconnectRemotePeer(peerId: string): void;

	/**
	 * Get all remote peer connections.
	 */
	getRemotePeers(): RemotePeerConnection[];

	/**
	 * Plan a distributed query across specific peers.
	 * @param filter Query filter.
	 * @param options Query planning options.
	 */
	planDistributedQuery(
		filter: FederatedQueryFilter,
		options?: Partial<{
			targetPeers: string[];
			includeLocal: boolean;
			aggregationStrategy: QueryAggregationStrategy;
			conflictResolution: ConflictResolutionStrategy;
			peerTimeoutMs: number;
		}>
	): DistributedQueryPlan;

	/**
	 * Execute a distributed query plan.
	 * @param plan The query plan to execute.
	 */
	executeDistributedQuery(plan: DistributedQueryPlan): Promise<DistributedQueryResult>;

	/**
	 * Propagate salience changes to remote peers for distributed ECAN.
	 * @param nodeId The node whose salience changed.
	 * @param salienceDelta The change in salience.
	 * @param depth Propagation depth (hops).
	 */
	propagateSalience(nodeId: string, salienceDelta: number, depth?: number): void;

	/**
	 * Get distributed query statistics.
	 */
	getDistributedStats(): {
		remotePeerCount: number;
		distributedQueriesSent: number;
		distributedResponsesReceived: number;
		averageDistributedLatencyMs: number;
		saliencePropagationsSent: number;
		saliencePropagationsReceived: number;
	};
}
