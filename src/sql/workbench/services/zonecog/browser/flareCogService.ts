/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IFlareCogService,
	FlareCogPeer,
	FlareCogAuthToken,
	FlareCogScope,
	FlareCogClusterState,
	FlareCogConfig,
	CognitiveWorkload,
	WorkloadAssignment,
	WorkloadPartitionStrategy,
	PeerCapabilities,
	DEFAULT_FLARECOG_CONFIG,
} from 'sql/workbench/services/zonecog/common/flareCog';
import {
	CognitiveMeshEnvelope,
	CognitiveMeshRequestHandler,
	CognitiveMeshResponsePayload,
	normalizeMeshAddress,
} from 'sql/workbench/services/zonecog/common/cognitiveMesh';
import {
	CognitiveMeshNode,
	ICognitiveMeshChannel,
	createMeshChannel,
	getDefaultMeshHub,
} from 'sql/workbench/services/zonecog/browser/cognitiveMeshTransport';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

/**
 * Default heartbeat interval in milliseconds.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

/**
 * Default peer timeout in milliseconds (3x heartbeat).
 */
const DEFAULT_PEER_TIMEOUT_MS = 15000;

/**
 * Default token expiration (1 hour).
 */
const DEFAULT_TOKEN_EXPIRATION_MS = 3600000;

/** Discovery channel for same-machine FlareCog peers. */
const FLARECOG_DISCOVERY_CHANNEL = 'zonecog-flarecog-discovery';

/**
 * FlareCog Distributed Cognition Service.
 *
 * Implements peer discovery, secure mesh transport, and workload partitioning
 * for distributed Zone-Cog cognitive processing across multiple nodes.
 *
 * Transport:
 * - WebSocket mesh channels for cross-machine peers (`ws://` / `host:port`)
 * - BroadcastChannel discovery for same-machine workbench windows
 * - In-process mesh hub for same-realm multi-node registration
 */
export class FlareCogService extends Disposable implements IFlareCogService {

	declare readonly _serviceBrand: undefined;

	private _running = false;
	private _config: FlareCogConfig = { ...DEFAULT_FLARECOG_CONFIG };
	private readonly _localPeerId = generateUuid();
	private readonly _peers = new Map<string, FlareCogPeer>();
	private readonly _tokens = new Map<string, FlareCogAuthToken>();
	private readonly _revokedTokens = new Set<string>();
	private readonly _pendingWorkloads = new Map<string, CognitiveWorkload>();
	private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private _workloadsProcessed = 0;
	private _totalLatencyMs = 0;
	private _clusterFormedAt = 0;
	private _partitionStrategy: WorkloadPartitionStrategy = {
		name: 'Default Load Balanced',
		type: 'load-balanced',
		config: {},
	};
	private readonly _mesh: CognitiveMeshNode;

	private readonly _onDidChangePeer = this._register(new Emitter<FlareCogPeer>());
	readonly onDidChangePeer: Event<FlareCogPeer> = this._onDidChangePeer.event;

	private readonly _onDidChangeClusterState = this._register(new Emitter<FlareCogClusterState>());
	readonly onDidChangeClusterState: Event<FlareCogClusterState> = this._onDidChangeClusterState.event;

	private readonly _onDidAssignWorkload = this._register(new Emitter<WorkloadAssignment>());
	readonly onDidAssignWorkload: Event<WorkloadAssignment> = this._onDidAssignWorkload.event;

	private readonly _onDidReceiveHeartbeat = this._register(new Emitter<{ peerId: string; timestamp: number }>());
	readonly onDidReceiveHeartbeat: Event<{ peerId: string; timestamp: number }> = this._onDidReceiveHeartbeat.event;

	private readonly _onDidReceiveMessage = this._register(new Emitter<CognitiveMeshEnvelope>());
	readonly onDidReceiveMessage: Event<CognitiveMeshEnvelope> = this._onDidReceiveMessage.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this._mesh = this._register(new CognitiveMeshNode(
			this._localPeerId,
			address => this._createPeerChannel(address)
		));
		this._register(this._mesh.onDidReceiveEvent(envelope => this._handleMeshEvent(envelope)));
		this._register(this._mesh.onDidChangePeerConnection(conn => {
			const peer = this._peers.get(conn.peerId);
			if (peer) {
				const wasOnline = peer.online;
				peer.online = conn.open;
				if (conn.open) {
					peer.lastHeartbeat = Date.now();
				}
				if (wasOnline !== peer.online) {
					this._onDidChangePeer.fire(peer);
					this._fireClusterStateChange();
				}
			}
		}));
		// Local listen endpoint so peers that address us by localPeerId
		// (same-realm multi-node / in-process hub) reach this node's handlers.
		const localListen = this._createPeerChannel(this._localPeerId);
		if (localListen) {
			localListen.onmessage = event => {
				void this._mesh.correlator.handleMessage(event.data);
			};
			this._register({ dispose: () => localListen.close() });
		}
		this._initializeLocalPeer();
		this.logService.info(`FlareCogService: initialized with local peer ${this._localPeerId}`);
	}

	/**
	 * Override point for tests to substitute mesh channels.
	 * Production opens WebSocket / in-process / broadcast via createMeshChannel.
	 */
	protected _createPeerChannel(address: string): ICognitiveMeshChannel | undefined {
		return createMeshChannel(address, {
			hub: getDefaultMeshHub(),
			onLog: (level, message) => {
				if (level === 'warn') {
					this.logService.warn(message);
				} else {
					this.logService.info(message);
				}
			},
		});
	}

	// -- Initialization -------------------------------------------------------

	private _initializeLocalPeer(): void {
		const localPeer: FlareCogPeer = {
			id: this._localPeerId,
			name: this._config.nodeName,
			address: this._config.listenAddress,
			discoveryMethod: 'manual',
			online: true,
			lastHeartbeat: Date.now(),
			capabilities: this._buildLocalCapabilities(),
			cognitiveLoad: 0,
			authenticated: true,
		};
		this._peers.set(this._localPeerId, localPeer);
	}

	private _buildLocalCapabilities(): PeerCapabilities {
		return {
			maxConcurrentTasks: 10,
			supportedAgentRoles: ['perceiver', 'attender', 'thinker', 'actor', 'reflector', 'orchestrator'],
			availableLLMProviders: ['built-in'],
			hypergraphCapacity: 100000,
			acceptsMigration: true,
			customCapabilities: ['zonecog', 'ecan', 'embodied'],
		};
	}

	// -- Lifecycle ------------------------------------------------------------

	async initialize(config: Partial<FlareCogConfig>): Promise<void> {
		this._config = { ...DEFAULT_FLARECOG_CONFIG, ...config };

		// Update local peer with new config
		const localPeer = this._peers.get(this._localPeerId);
		if (localPeer) {
			localPeer.name = this._config.nodeName;
			localPeer.address = this._config.listenAddress;
		}

		// Initialize manual peers
		for (const address of this._config.manualPeers) {
			await this.addPeer(address);
		}

		this.membraneService.recordActivity('autonomic');
		this.logService.info('FlareCogService: configuration initialized');
	}

	async start(): Promise<void> {
		if (this._running) {
			return;
		}

		this._running = true;
		this._clusterFormedAt = Date.now();

		// Same-machine discovery over BroadcastChannel
		this._mesh.joinDiscovery(FLARECOG_DISCOVERY_CHANNEL);

		// Start heartbeat timer
		this._heartbeatTimer = setInterval(() => {
			this._sendHeartbeat();
			this._checkPeerTimeouts();
		}, this._config.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS);

		// Perform initial discovery
		await this.refreshDiscovery();

		// Announce presence on the discovery mesh
		this._mesh.broadcast({
			kind: 'flarecog-hello',
			peer: this.getLocalPeer(),
		});

		this.membraneService.recordActivity('somatic');
		this._fireClusterStateChange();
		this.logService.info('FlareCogService: started, listening on ' + this._config.listenAddress);
	}

	async stop(): Promise<void> {
		if (!this._running) {
			return;
		}

		// Stop heartbeat timer
		if (this._heartbeatTimer !== null) {
			clearInterval(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}

		// Drop peer mesh channels (local peer record retained)
		for (const peer of this._peers.values()) {
			if (peer.id !== this._localPeerId) {
				this._mesh.disconnectPeer(peer.id);
				peer.online = false;
			}
		}

		this._running = false;
		this._fireClusterStateChange();
		this.logService.info('FlareCogService: stopped');
	}

	isRunning(): boolean {
		return this._running;
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}

	// -- Peer Management ------------------------------------------------------

	async addPeer(address: string): Promise<FlareCogPeer | undefined> {
		this.membraneService.recordActivity('somatic');

		const normalized = normalizeMeshAddress(address) || address;

		// Check if peer already exists by address
		for (const peer of this._peers.values()) {
			if (peer.address === address || peer.address === normalized) {
				this.logService.info(`FlareCogService: peer at ${address} already registered`);
				// Ensure mesh channel exists
				if (!this._mesh.getPeer(peer.id)) {
					this._mesh.connectPeer(peer.id, peer.address);
				}
				return peer;
			}
		}

		const peerId = generateUuid();
		const peer: FlareCogPeer = {
			id: peerId,
			name: `peer-${address}`,
			address: normalized || address,
			discoveryMethod: 'manual',
			online: false,
			lastHeartbeat: 0,
			capabilities: {
				maxConcurrentTasks: 5,
				supportedAgentRoles: ['perceiver', 'thinker'],
				availableLLMProviders: [],
				hypergraphCapacity: 50000,
				acceptsMigration: true,
				customCapabilities: [],
			},
			cognitiveLoad: 0,
			authenticated: false,
		};

		this._peers.set(peer.id, peer);

		// Open real mesh channel (WebSocket / in-process)
		const connection = this._mesh.connectPeer(peer.id, peer.address);
		if (connection?.open) {
			peer.online = true;
			peer.lastHeartbeat = Date.now();
			// Authenticate with a freshly minted token when token auth is enabled
			if (this._config.security.tokenAuthEnabled) {
				const token = this.generateToken(peer.id, ['query:read', 'query:write', 'loop:sync']);
				peer.authenticated = !!this.validateToken(token.token);
			} else {
				peer.authenticated = true;
			}
		}

		this._onDidChangePeer.fire(peer);
		this._fireClusterStateChange();

		this.logService.info(`FlareCogService: added peer ${peer.id} at ${peer.address} (online=${peer.online})`);
		return peer;
	}

	removePeer(peerId: string): boolean {
		if (peerId === this._localPeerId) {
			this.logService.warn('FlareCogService: cannot remove local peer');
			return false;
		}

		const peer = this._peers.get(peerId);
		if (!peer) {
			return false;
		}

		this._mesh.disconnectPeer(peerId);
		this._peers.delete(peerId);
		peer.online = false;
		this._onDidChangePeer.fire(peer);
		this._fireClusterStateChange();

		this.logService.info(`FlareCogService: removed peer ${peerId}`);
		return true;
	}

	getPeer(peerId: string): FlareCogPeer | undefined {
		return this._peers.get(peerId);
	}

	getAllPeers(): FlareCogPeer[] {
		return Array.from(this._peers.values());
	}

	getOnlinePeers(): FlareCogPeer[] {
		return Array.from(this._peers.values()).filter(p => p.online);
	}

	getLocalPeer(): FlareCogPeer {
		return this._peers.get(this._localPeerId)!;
	}

	async refreshDiscovery(): Promise<void> {
		this.membraneService.recordActivity('somatic');

		// Browser workbench: mDNS requires a native host bridge. Discovery is
		// performed via BroadcastChannel + configured manual peers / WebSocket.
		if (this._config.enableMdns) {
			this.logService.info('FlareCogService: mDNS discovery requires host bridge; using BroadcastChannel + manual peers');
		}

		// Ensure discovery channel is joined when running
		if (this._running) {
			this._mesh.joinDiscovery(FLARECOG_DISCOVERY_CHANNEL);
			this._mesh.broadcast({
				kind: 'flarecog-hello',
				peer: this.getLocalPeer(),
			});
		}

		// Re-check manual peers
		for (const address of this._config.manualPeers) {
			const normalized = normalizeMeshAddress(address) || address;
			const existing = Array.from(this._peers.values()).find(
				p => p.address === address || p.address === normalized
			);
			if (!existing) {
				await this.addPeer(address);
			} else if (!this._mesh.getPeer(existing.id)) {
				this._mesh.connectPeer(existing.id, existing.address);
			}
		}
	}

	// -- Authentication -------------------------------------------------------

	generateToken(peerId: string, scopes: FlareCogScope[], expiresInMs: number = DEFAULT_TOKEN_EXPIRATION_MS): FlareCogAuthToken {
		this.membraneService.recordActivity('autonomic');

		const token: FlareCogAuthToken = {
			token: generateUuid() + '-' + generateUuid(),
			peerId,
			expiresAt: Date.now() + expiresInMs,
			scopes,
		};

		this._tokens.set(token.token, token);
		this.logService.info(`FlareCogService: generated token for peer ${peerId} with scopes ${scopes.join(', ')}`);
		return token;
	}

	validateToken(tokenValue: string): FlareCogAuthToken | undefined {
		if (this._revokedTokens.has(tokenValue)) {
			return undefined;
		}

		const token = this._tokens.get(tokenValue);
		if (!token) {
			return undefined;
		}

		if (token.expiresAt < Date.now()) {
			this._tokens.delete(tokenValue);
			return undefined;
		}

		return token;
	}

	revokeToken(tokenValue: string): boolean {
		if (!this._tokens.has(tokenValue)) {
			return false;
		}

		this._tokens.delete(tokenValue);
		this._revokedTokens.add(tokenValue);
		this.logService.info('FlareCogService: revoked token');
		return true;
	}

	isPeerAuthenticated(peerId: string): boolean {
		const peer = this._peers.get(peerId);
		return peer?.authenticated ?? false;
	}

	// -- Workload Distribution ------------------------------------------------

	setPartitionStrategy(strategy: WorkloadPartitionStrategy): void {
		this._partitionStrategy = strategy;
		this._fireClusterStateChange();
		this.logService.info(`FlareCogService: partition strategy set to ${strategy.type}`);
	}

	getPartitionStrategy(): WorkloadPartitionStrategy {
		return this._partitionStrategy;
	}

	async submitWorkload(
		workloadSpec: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>
	): Promise<WorkloadAssignment> {
		this.membraneService.recordActivity('cerebral');

		const workload: CognitiveWorkload = {
			...workloadSpec,
			id: `workload-${Date.now()}-${generateUuid().substring(0, 8)}`,
			createdAt: Date.now(),
			originPeerId: this._localPeerId,
		};

		// Select best peer for this workload
		const selectedPeer = this.selectPeerForWorkload(workloadSpec);
		const assignedPeerId = selectedPeer?.id ?? this._localPeerId;

		const assignment: WorkloadAssignment = {
			workload,
			assignedPeerId,
			assignedAt: Date.now(),
			reason: this._buildAssignmentReason(workload, assignedPeerId),
		};

		this._pendingWorkloads.set(workload.id, workload);
		this._onDidAssignWorkload.fire(assignment);

		// Persist assignment to hypergraph
		this.hypergraphStore.addNode({
			id: `flare-assignment-${workload.id}`,
			node_type: 'FlareCogAssignment',
			content: JSON.stringify({
				workloadId: workload.id,
				type: workload.type,
				assignedTo: assignedPeerId,
			}),
			links: [],
			metadata: {
				workloadId: workload.id,
				assignedPeerId,
				assignedAt: assignment.assignedAt,
			},
			salience_score: workload.priority,
		});

		this.logService.info(`FlareCogService: assigned workload ${workload.id} to peer ${assignedPeerId}`);
		return assignment;
	}

	selectPeerForWorkload(
		workloadSpec: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>
	): FlareCogPeer | undefined {
		const onlinePeers = this.getOnlinePeers();
		if (onlinePeers.length === 0) {
			return undefined;
		}

		// Filter by required capabilities
		const capablePeers = workloadSpec.requiredCapabilities.length > 0
			? onlinePeers.filter(peer =>
				workloadSpec.requiredCapabilities.every(cap =>
					peer.capabilities.customCapabilities.includes(cap) ||
					peer.capabilities.supportedAgentRoles.includes(cap)
				)
			)
			: onlinePeers;

		if (capablePeers.length === 0) {
			return undefined;
		}

		// Apply partition strategy
		switch (this._partitionStrategy.type) {
			case 'round-robin':
				return this._selectRoundRobin(capablePeers);
			case 'load-balanced':
				return this._selectLoadBalanced(capablePeers);
			case 'capability-match':
				return this._selectCapabilityMatch(capablePeers, workloadSpec);
			case 'locality':
				return this._selectLocality(capablePeers);
			case 'salience-based':
				return this._selectSalienceBased(capablePeers, workloadSpec);
			default:
				return capablePeers[0];
		}
	}

	private _selectRoundRobin(peers: FlareCogPeer[]): FlareCogPeer {
		// Simple round-robin based on workloads processed
		const sorted = peers.sort((a, b) => {
			const aLoad = this._getPeerWorkloadCount(a.id);
			const bLoad = this._getPeerWorkloadCount(b.id);
			return aLoad - bLoad;
		});
		return sorted[0];
	}

	private _selectLoadBalanced(peers: FlareCogPeer[]): FlareCogPeer {
		// Select peer with lowest cognitive load
		const sorted = peers.sort((a, b) => a.cognitiveLoad - b.cognitiveLoad);
		return sorted[0];
	}

	private _selectCapabilityMatch(
		peers: FlareCogPeer[],
		workloadSpec: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>
	): FlareCogPeer {
		// Score peers by capability match
		const scored = peers.map(peer => {
			let score = 0;
			for (const cap of workloadSpec.requiredCapabilities) {
				if (peer.capabilities.customCapabilities.includes(cap)) {
					score += 2;
				}
				if (peer.capabilities.supportedAgentRoles.includes(cap)) {
					score += 1;
				}
			}
			return { peer, score };
		});
		scored.sort((a, b) => b.score - a.score);
		return scored[0].peer;
	}

	private _selectLocality(peers: FlareCogPeer[]): FlareCogPeer {
		// Prefer local peer
		const local = peers.find(p => p.id === this._localPeerId);
		return local ?? peers[0];
	}

	private _selectSalienceBased(
		peers: FlareCogPeer[],
		workloadSpec: Omit<CognitiveWorkload, 'id' | 'createdAt' | 'originPeerId'>
	): FlareCogPeer {
		// Select based on workload priority and peer capacity
		const scored = peers.map(peer => {
			const capacityRatio = 1 - peer.cognitiveLoad;
			const priorityMatch = workloadSpec.priority * capacityRatio;
			return { peer, score: priorityMatch };
		});
		scored.sort((a, b) => b.score - a.score);
		return scored[0].peer;
	}

	private _getPeerWorkloadCount(peerId: string): number {
		return Array.from(this._pendingWorkloads.values())
			.filter(w => w.originPeerId === peerId).length;
	}

	private _buildAssignmentReason(workload: CognitiveWorkload, assignedPeerId: string): string {
		const peer = this._peers.get(assignedPeerId);
		if (!peer) {
			return 'fallback assignment';
		}

		if (assignedPeerId === this._localPeerId) {
			return `local processing (strategy: ${this._partitionStrategy.type})`;
		}

		return `distributed to ${peer.name} (strategy: ${this._partitionStrategy.type}, load: ${(peer.cognitiveLoad * 100).toFixed(1)}%)`;
	}

	reportWorkloadComplete(workloadId: string, success: boolean, result?: unknown): void {
		const workload = this._pendingWorkloads.get(workloadId);
		if (!workload) {
			return;
		}

		const duration = Date.now() - workload.createdAt;
		this._workloadsProcessed++;
		this._totalLatencyMs += duration;
		this._pendingWorkloads.delete(workloadId);

		// Update hypergraph with completion
		this.hypergraphStore.addNode({
			id: `flare-complete-${workloadId}`,
			node_type: 'FlareCogCompletion',
			content: JSON.stringify({
				workloadId,
				success,
				durationMs: duration,
				result: result !== undefined ? String(result).substring(0, 500) : null,
			}),
			links: [`flare-assignment-${workloadId}`],
			metadata: {
				workloadId,
				success,
				completedAt: Date.now(),
			},
			salience_score: success ? 0.7 : 0.9,
		});

		this.membraneService.recordActivity('cerebral');
		this.logService.info(`FlareCogService: workload ${workloadId} completed (${success ? 'success' : 'failure'}, ${duration}ms)`);
	}

	// -- Mesh Messaging -------------------------------------------------------

	sendMessage(peerId: string, payload: unknown): boolean {
		this.membraneService.recordActivity('somatic');
		if (peerId === this._localPeerId) {
			this._onDidReceiveMessage.fire({
				type: 'event',
				id: generateUuid(),
				fromPeerId: this._localPeerId,
				toPeerId: peerId,
				timestamp: Date.now(),
				payload,
			});
			return true;
		}
		const peer = this._peers.get(peerId);
		if (!peer) {
			return false;
		}
		if (!this._mesh.getPeer(peerId)) {
			this._mesh.connectPeer(peerId, peer.address);
		}
		return this._mesh.sendTo(peerId, 'event', payload);
	}

	broadcast(payload: unknown): void {
		this.membraneService.recordActivity('somatic');
		this._mesh.broadcast(payload);
	}

	request(peerId: string, op: string, args?: unknown, timeoutMs?: number): Promise<CognitiveMeshResponsePayload> {
		this.membraneService.recordActivity('somatic');
		const peer = this._peers.get(peerId);
		if (!peer && peerId !== this._localPeerId) {
			return Promise.resolve({ ok: false, error: `unknown peer '${peerId}'` });
		}
		if (peer && !this._mesh.getPeer(peerId)) {
			this._mesh.connectPeer(peerId, peer.address);
		}
		return this._mesh.request(peerId, op, args, timeoutMs);
	}

	registerHandler(op: string, handler: CognitiveMeshRequestHandler): IDisposable {
		return this._mesh.registerHandler(op, handler);
	}

	// -- Cluster State --------------------------------------------------------

	getClusterState(): FlareCogClusterState {
		const onlinePeers = this.getOnlinePeers();
		const totalCapacity = onlinePeers.reduce((sum, p) => sum + p.capabilities.maxConcurrentTasks, 0);
		const usedCapacity = onlinePeers.reduce((sum, p) => sum + p.cognitiveLoad * p.capabilities.maxConcurrentTasks, 0);

		return {
			localPeerId: this._localPeerId,
			localPeer: this.getLocalPeer(),
			peers: new Map(this._peers),
			onlinePeerCount: onlinePeers.length,
			totalCapacity,
			clusterLoad: totalCapacity > 0 ? usedCapacity / totalCapacity : 0,
			partitionStrategy: this._partitionStrategy,
			healthy: this._isClusterHealthyInternal(),
			formedAt: this._clusterFormedAt,
		};
	}

	getConfig(): FlareCogConfig {
		return { ...this._config };
	}

	updateConfig(config: Partial<FlareCogConfig>): void {
		this._config = { ...this._config, ...config };
		this._fireClusterStateChange();
		this.logService.info('FlareCogService: configuration updated');
	}

	isClusterHealthy(): boolean {
		return this._isClusterHealthyInternal();
	}

	private _isClusterHealthyInternal(): boolean {
		const localPeer = this.getLocalPeer();
		if (!localPeer.online) {
			return false;
		}

		// Cluster is healthy if local peer is online
		// Could add more checks for minimum quorum, etc.
		return true;
	}

	getClusterStats(): {
		totalPeers: number;
		onlinePeers: number;
		totalCapacity: number;
		usedCapacity: number;
		workloadsProcessed: number;
		averageLatencyMs: number;
	} {
		const onlinePeers = this.getOnlinePeers();
		const totalCapacity = onlinePeers.reduce((sum, p) => sum + p.capabilities.maxConcurrentTasks, 0);
		const usedCapacity = onlinePeers.reduce((sum, p) => sum + p.cognitiveLoad * p.capabilities.maxConcurrentTasks, 0);

		return {
			totalPeers: this._peers.size,
			onlinePeers: onlinePeers.length,
			totalCapacity,
			usedCapacity,
			workloadsProcessed: this._workloadsProcessed,
			averageLatencyMs: this._workloadsProcessed > 0
				? Math.round(this._totalLatencyMs / this._workloadsProcessed)
				: 0,
		};
	}

	reset(): void {
		void this.stop();

		// Disconnect mesh peers
		for (const peer of this._peers.values()) {
			if (peer.id !== this._localPeerId) {
				this._mesh.disconnectPeer(peer.id);
			}
		}

		// Clear peers except local
		const localPeer = this._peers.get(this._localPeerId);
		this._peers.clear();
		if (localPeer) {
			localPeer.online = true;
			localPeer.cognitiveLoad = 0;
			this._peers.set(this._localPeerId, localPeer);
		}

		// Clear tokens and workloads
		this._tokens.clear();
		this._revokedTokens.clear();
		this._pendingWorkloads.clear();

		// Reset counters
		this._workloadsProcessed = 0;
		this._totalLatencyMs = 0;
		this._clusterFormedAt = 0;

		// Reset strategy
		this._partitionStrategy = {
			name: 'Default Load Balanced',
			type: 'load-balanced',
			config: {},
		};

		this._fireClusterStateChange();
		this.logService.info('FlareCogService: reset');
	}

	// -- Private: Heartbeat & mesh events -------------------------------------

	private _sendHeartbeat(): void {
		const localPeer = this._peers.get(this._localPeerId);
		if (localPeer) {
			localPeer.lastHeartbeat = Date.now();
			localPeer.cognitiveLoad = this._calculateLocalLoad();
		}

		const timestamp = Date.now();
		this._mesh.broadcast({
			kind: 'flarecog-heartbeat',
			peerId: this._localPeerId,
			cognitiveLoad: localPeer?.cognitiveLoad ?? 0,
			capabilities: localPeer?.capabilities,
			timestamp,
		});

		this._onDidReceiveHeartbeat.fire({
			peerId: this._localPeerId,
			timestamp,
		});
	}

	private _handleMeshEvent(envelope: CognitiveMeshEnvelope): void {
		this._onDidReceiveMessage.fire(envelope);

		const payload = envelope.payload as {
			kind?: string;
			peer?: FlareCogPeer;
			peerId?: string;
			cognitiveLoad?: number;
			capabilities?: PeerCapabilities;
			timestamp?: number;
		} | undefined;

		if (!payload || typeof payload !== 'object') {
			return;
		}

		if (payload.kind === 'flarecog-hello' && payload.peer && payload.peer.id !== this._localPeerId) {
			this._ingestDiscoveredPeer(payload.peer, envelope.fromPeerId);
			return;
		}

		if (payload.kind === 'flarecog-heartbeat') {
			const peerId = payload.peerId || envelope.fromPeerId;
			if (peerId === this._localPeerId) {
				return;
			}
			let peer = this._peers.get(peerId);
			if (!peer && payload.peer) {
				this._ingestDiscoveredPeer(payload.peer as FlareCogPeer, peerId);
				peer = this._peers.get(peerId);
			}
			if (peer) {
				peer.online = true;
				peer.lastHeartbeat = payload.timestamp ?? envelope.timestamp;
				if (typeof payload.cognitiveLoad === 'number') {
					peer.cognitiveLoad = payload.cognitiveLoad;
				}
				if (payload.capabilities) {
					peer.capabilities = payload.capabilities;
				}
				this._onDidReceiveHeartbeat.fire({ peerId: peer.id, timestamp: peer.lastHeartbeat });
				this._onDidChangePeer.fire(peer);
			}
		}
	}

	private _ingestDiscoveredPeer(discovered: FlareCogPeer, fromPeerId: string): void {
		const id = discovered.id || fromPeerId;
		if (id === this._localPeerId) {
			return;
		}
		let peer = this._peers.get(id);
		if (!peer) {
			peer = {
				id,
				name: discovered.name || `peer-${id.substring(0, 8)}`,
				address: discovered.address || id,
				discoveryMethod: discovered.discoveryMethod || 'broadcast',
				online: true,
				lastHeartbeat: Date.now(),
				capabilities: discovered.capabilities || {
					maxConcurrentTasks: 5,
					supportedAgentRoles: [],
					availableLLMProviders: [],
					hypergraphCapacity: 50000,
					acceptsMigration: true,
					customCapabilities: [],
				},
				cognitiveLoad: discovered.cognitiveLoad ?? 0,
				authenticated: !this._config.security.tokenAuthEnabled,
			};
			this._peers.set(id, peer);
			// Prefer logical in-process routing by peer id when no network address
			this._mesh.connectPeer(id, peer.address || id);
			this._onDidChangePeer.fire(peer);
			this._fireClusterStateChange();
			this.logService.info(`FlareCogService: discovered peer ${id} via mesh`);
		} else {
			peer.online = true;
			peer.lastHeartbeat = Date.now();
			if (discovered.capabilities) {
				peer.capabilities = discovered.capabilities;
			}
			this._onDidChangePeer.fire(peer);
		}
	}

	private _checkPeerTimeouts(): void {
		const now = Date.now();
		const timeout = this._config.peerTimeoutMs || DEFAULT_PEER_TIMEOUT_MS;

		for (const peer of this._peers.values()) {
			if (peer.id === this._localPeerId) {
				continue;
			}

			if (peer.online && peer.lastHeartbeat > 0 && now - peer.lastHeartbeat > timeout) {
				peer.online = false;
				this._onDidChangePeer.fire(peer);
				this._fireClusterStateChange();
				this.logService.info(`FlareCogService: peer ${peer.id} timed out`);
			}
		}
	}

	private _calculateLocalLoad(): number {
		const activeWorkloads = Array.from(this._pendingWorkloads.values())
			.filter(w => w.originPeerId === this._localPeerId).length;
		const capacity = this.getLocalPeer().capabilities.maxConcurrentTasks;
		return Math.min(1, activeWorkloads / capacity);
	}

	// -- Private: Events ------------------------------------------------------

	private _fireClusterStateChange(): void {
		this._onDidChangeClusterState.fire(this.getClusterState());
	}
}
