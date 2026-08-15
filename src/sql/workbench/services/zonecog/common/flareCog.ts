/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import {
	CognitiveMeshEnvelope,
	CognitiveMeshRequestHandler,
	CognitiveMeshResponsePayload,
} from 'sql/workbench/services/zonecog/common/cognitiveMesh';

export const IFlareCogService = createDecorator<IFlareCogService>('flareCogService');

// ---------------------------------------------------------------------------
// Peer / Node types
// ---------------------------------------------------------------------------

/**
 * A cognitive peer in the FlareCog distributed network.
 * Each peer represents a Zone-Cog workbench instance that can participate
 * in distributed cognitive processing.
 */
export interface FlareCogPeer {
	/** Unique identifier for this peer (UUID). */
	id: string;
	/** Human-readable name for this peer. */
	name: string;
	/** Network address (host:port). */
	address: string;
	/** Discovery method used to find this peer. */
	discoveryMethod: PeerDiscoveryMethod;
	/** Whether this peer is currently online and reachable. */
	online: boolean;
	/** Last heartbeat timestamp (epoch-ms). */
	lastHeartbeat: number;
	/** Peer capabilities for workload distribution. */
	capabilities: PeerCapabilities;
	/** Current cognitive load on this peer (0-1). */
	cognitiveLoad: number;
	/** Authentication status. */
	authenticated: boolean;
}

/**
 * Methods by which a peer can be discovered.
 */
export type PeerDiscoveryMethod = 'manual' | 'mdns' | 'broadcast' | 'registry';

/**
 * Capabilities a peer can advertise for workload distribution.
 */
export interface PeerCapabilities {
	/** Maximum concurrent cognitive tasks. */
	maxConcurrentTasks: number;
	/** Supported agent types (e.g., 'perceiver', 'thinker'). */
	supportedAgentRoles: string[];
	/** Available LLM providers. */
	availableLLMProviders: string[];
	/** Hypergraph node capacity. */
	hypergraphCapacity: number;
	/** Whether this peer can accept migrated agents. */
	acceptsMigration: boolean;
	/** Custom capability tags. */
	customCapabilities: string[];
}

// ---------------------------------------------------------------------------
// Security / Transport types
// ---------------------------------------------------------------------------

/**
 * Authentication token for secure peer communication.
 */
export interface FlareCogAuthToken {
	/** Token value (opaque string). */
	token: string;
	/** Peer ID this token authenticates. */
	peerId: string;
	/** Expiration timestamp (epoch-ms). */
	expiresAt: number;
	/** Scopes granted by this token. */
	scopes: FlareCogScope[];
}

/**
 * Authorization scopes for peer operations.
 */
export type FlareCogScope =
	| 'query:read'       // Can query the hypergraph
	| 'query:write'      // Can write to the hypergraph
	| 'agent:spawn'      // Can spawn agents on this node
	| 'agent:migrate'    // Can migrate agents to/from this node
	| 'loop:sync'        // Can participate in cognitive loop sync
	| 'attention:global' // Can participate in global ECAN
	| 'admin';           // Full administrative access

/**
 * Transport security configuration.
 */
export interface TransportSecurityConfig {
	/** Whether TLS is required. */
	tlsRequired: boolean;
	/** TLS certificate (PEM-encoded). */
	tlsCertificate?: string;
	/** TLS private key (PEM-encoded). */
	tlsPrivateKey?: string;
	/** Trusted CA certificates (PEM-encoded). */
	trustedCAs?: string[];
	/** Whether to verify peer certificates. */
	verifyPeerCert: boolean;
	/** Token-based authentication enabled. */
	tokenAuthEnabled: boolean;
	/** Shared secret for token generation (should be securely stored). */
	tokenSecret?: string;
}

// ---------------------------------------------------------------------------
// Workload partitioning types
// ---------------------------------------------------------------------------

/**
 * A cognitive workload that can be distributed across peers.
 */
export interface CognitiveWorkload {
	/** Unique workload identifier. */
	id: string;
	/** Type of workload. */
	type: WorkloadType;
	/** Payload data. */
	payload: unknown;
	/** Required capabilities for processing. */
	requiredCapabilities: string[];
	/** Priority (0-1, higher = more urgent). */
	priority: number;
	/** Estimated cognitive cost (0-1). */
	estimatedCost: number;
	/** Created timestamp. */
	createdAt: number;
	/** Optional deadline. */
	deadline?: number;
	/** Originating peer ID. */
	originPeerId: string;
}

/**
 * Types of cognitive workloads.
 */
export type WorkloadType =
	| 'query'           // Hypergraph query
	| 'thinking'        // Deep cognitive processing
	| 'attention'       // ECAN attention allocation
	| 'perception'      // Sensory processing
	| 'action'          // Motor action execution
	| 'agent-task'      // Agent-specific task
	| 'migration';      // Agent migration

/**
 * Strategy for partitioning workloads across peers.
 */
export interface WorkloadPartitionStrategy {
	/** Strategy name. */
	name: string;
	/** Strategy type. */
	type: PartitionStrategyType;
	/** Configuration parameters. */
	config: Record<string, unknown>;
}

/**
 * Types of workload partitioning strategies.
 */
export type PartitionStrategyType =
	| 'round-robin'      // Distribute evenly in sequence
	| 'load-balanced'    // Distribute by current load
	| 'capability-match' // Route to peers with required capabilities
	| 'locality'         // Prefer local processing
	| 'salience-based';  // Route by hypergraph salience

/**
 * Result of assigning a workload to a peer.
 */
export interface WorkloadAssignment {
	/** The workload. */
	workload: CognitiveWorkload;
	/** Assigned peer ID. */
	assignedPeerId: string;
	/** Assignment timestamp. */
	assignedAt: number;
	/** Assignment reason/rationale. */
	reason: string;
}

// ---------------------------------------------------------------------------
// Cluster state types
// ---------------------------------------------------------------------------

/**
 * State of the FlareCog cluster.
 */
export interface FlareCogClusterState {
	/** This node's peer ID. */
	localPeerId: string;
	/** This node's peer info. */
	localPeer: FlareCogPeer;
	/** All known peers (including self). */
	peers: Map<string, FlareCogPeer>;
	/** Total online peers. */
	onlinePeerCount: number;
	/** Total cluster cognitive capacity. */
	totalCapacity: number;
	/** Current cluster cognitive load (0-1). */
	clusterLoad: number;
	/** Active partition strategy. */
	partitionStrategy: WorkloadPartitionStrategy;
	/** Cluster health status. */
	healthy: boolean;
	/** Cluster formed timestamp. */
	formedAt: number;
}

/**
 * Configuration for FlareCog distributed cognition.
 */
export interface FlareCogConfig {
	/** This node's name. */
	nodeName: string;
	/** Listen address (host:port). */
	listenAddress: string;
	/** Manually configured peer addresses. */
	manualPeers: string[];
	/** Enable mDNS discovery. */
	enableMdns: boolean;
	/** Heartbeat interval (ms). */
	heartbeatIntervalMs: number;
	/** Peer timeout (ms). */
	peerTimeoutMs: number;
	/** Default partition strategy. */
	defaultPartitionStrategy: PartitionStrategyType;
	/** Security configuration. */
	security: TransportSecurityConfig;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * FlareCog Distributed Cognition Service.
 *
 * Implements the distributed coordination layer for Zone-Cog, enabling
 * multiple workbench instances to form a cognitive cluster:
 *
 * 1. **Peer Discovery**: Finds other Zone-Cog instances via mDNS,
 *    manual configuration, or broadcast discovery.
 *
 * 2. **Secure Transport**: Establishes TLS-encrypted WebSocket
 *    connections with token-based authentication.
 *
 * 3. **Workload Partitioning**: Distributes cognitive tasks across
 *    the cluster based on load, capabilities, and salience.
 *
 * 4. **Cluster Coordination**: Maintains cluster state, handles
 *    peer failures, and coordinates distributed operations.
 */
export interface IFlareCogService {
	readonly _serviceBrand: undefined;

	/** Fired when a peer joins or leaves the cluster. */
	readonly onDidChangePeer: Event<FlareCogPeer>;

	/** Fired when the cluster state changes. */
	readonly onDidChangeClusterState: Event<FlareCogClusterState>;

	/** Fired when a workload is assigned. */
	readonly onDidAssignWorkload: Event<WorkloadAssignment>;

	/** Fired when a peer heartbeat is received. */
	readonly onDidReceiveHeartbeat: Event<{ peerId: string; timestamp: number }>;

	/** Fired for inbound mesh events (hello, heartbeat, broadcast, event). */
	readonly onDidReceiveMessage: Event<CognitiveMeshEnvelope>;

	// -- Lifecycle ------------------------------------------------------------

	/**
	 * Initialize the FlareCog service with the given configuration.
	 */
	initialize(config: Partial<FlareCogConfig>): Promise<void>;

	/**
	 * Start the FlareCog service: begin listening for connections,
	 * start discovery, and join the cluster.
	 */
	start(): Promise<void>;

	/**
	 * Stop the FlareCog service: disconnect from peers, stop listening.
	 */
	stop(): Promise<void>;

	/**
	 * Check if the service is running.
	 */
	isRunning(): boolean;

	// -- Peer Management ------------------------------------------------------

	/**
	 * Add a peer manually by address.
	 */
	addPeer(address: string): Promise<FlareCogPeer | undefined>;

	/**
	 * Remove a peer from the cluster.
	 */
	removePeer(peerId: string): boolean;

	/**
	 * Get a peer by ID.
	 */
	getPeer(peerId: string): FlareCogPeer | undefined;

	/**
	 * Get all known peers.
	 */
	getAllPeers(): FlareCogPeer[];

	/**
	 * Get all online peers.
	 */
	getOnlinePeers(): FlareCogPeer[];

	/**
	 * Get the local peer info.
	 */
	getLocalPeer(): FlareCogPeer;

	/**
	 * Refresh peer discovery (re-scan mDNS, etc.).
	 */
	refreshDiscovery(): Promise<void>;

	// -- Authentication -------------------------------------------------------

	/**
	 * Generate an authentication token for a peer.
	 */
	generateToken(peerId: string, scopes: FlareCogScope[], expiresInMs?: number): FlareCogAuthToken;

	/**
	 * Validate an authentication token.
	 */
	validateToken(token: string): FlareCogAuthToken | undefined;

	/**
	 * Revoke a token.
	 */
	revokeToken(token: string): boolean;

	/**
	 * Check if a peer is authenticated.
	 */
	isPeerAuthenticated(peerId: string): boolean;

	// -- Workload Distribution ------------------------------------------------

	/**
	 * Set the workload partition strategy.
	 */
	setPartitionStrategy(strategy: WorkloadPartitionStrategy): void;

	/**
	 * Get the current partition strategy.
	 */
	getPartitionStrategy(): WorkloadPartitionStrategy;

	/**
	 * Submit a workload for distributed processing.
	 * Returns the assigned peer ID.
	 */
	submitWorkload(workload: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>): Promise<WorkloadAssignment>;

	/**
	 * Get the best peer for a workload based on the current strategy.
	 */
	selectPeerForWorkload(workload: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>): FlareCogPeer | undefined;

	/**
	 * Report workload completion.
	 */
	reportWorkloadComplete(workloadId: string, success: boolean, result?: unknown): void;

	// -- Mesh Messaging -------------------------------------------------------

	/**
	 * Send a fire-and-forget event payload to a specific peer over the mesh.
	 * Returns false when the peer is unknown or offline.
	 */
	sendMessage(peerId: string, payload: unknown): boolean;

	/**
	 * Broadcast a payload to every connected peer and the discovery channel.
	 */
	broadcast(payload: unknown): void;

	/**
	 * Request/response round-trip to a peer. Rejects on timeout or transport failure.
	 */
	request(peerId: string, op: string, args?: unknown, timeoutMs?: number): Promise<CognitiveMeshResponsePayload>;

	/**
	 * Register a handler for inbound mesh request operations.
	 */
	registerHandler(op: string, handler: CognitiveMeshRequestHandler): IDisposable;

	// -- Cluster State --------------------------------------------------------

	/**
	 * Get the current cluster state.
	 */
	getClusterState(): FlareCogClusterState;

	/**
	 * Get the current configuration.
	 */
	getConfig(): FlareCogConfig;

	/**
	 * Update the configuration.
	 */
	updateConfig(config: Partial<FlareCogConfig>): void;

	/**
	 * Check cluster health.
	 */
	isClusterHealthy(): boolean;

	/**
	 * Get cluster statistics.
	 */
	getClusterStats(): {
		totalPeers: number;
		onlinePeers: number;
		totalCapacity: number;
		usedCapacity: number;
		workloadsProcessed: number;
		averageLatencyMs: number;
	};

	/**
	 * Reset the service state.
	 */
	reset(): void;
}

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

/**
 * Default FlareCog configuration.
 */
export const DEFAULT_FLARECOG_CONFIG: FlareCogConfig = {
	nodeName: 'zonecog-node',
	listenAddress: '0.0.0.0:9420',
	manualPeers: [],
	enableMdns: false,
	heartbeatIntervalMs: 5000,
	peerTimeoutMs: 15000,
	defaultPartitionStrategy: 'load-balanced',
	security: {
		tlsRequired: false,
		verifyPeerCert: false,
		tokenAuthEnabled: true,
	},
};
