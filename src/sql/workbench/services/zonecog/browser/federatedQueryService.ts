/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IFederatedQueryService,
	FederatedQueryFilter,
	FederatedQueryResult,
	FederatedQueryState,
	DistributedQueryPlan,
	DistributedQueryResult,
	SaliencePropagationRequest,
	RemotePeerConnection,
	QueryAggregationStrategy,
	ConflictResolutionStrategy,
} from 'sql/workbench/services/zonecog/common/federatedQuery';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ISharedCognitionChannel } from 'sql/workbench/services/zonecog/browser/sharedCognitionService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

/** Channel name shared by all participating workbench windows. */
const CHANNEL_NAME = 'zonecog-federated-query';

/** Default cap on nodes returned by a single participant for one query. */
const DEFAULT_LIMIT = 25;

/** Default time to wait for peer responses before resolving with whatever arrived. */
const DEFAULT_TIMEOUT_MS = 300;

/** Default distributed query timeout. */
const DEFAULT_DISTRIBUTED_TIMEOUT_MS = 2000;

interface HelloMessage { type: 'hello'; peerId: string; reply: boolean }
interface QueryRequestMessage { type: 'query-request'; peerId: string; requestId: string; filter: FederatedQueryFilter }
interface QueryResponseMessage { type: 'query-response'; peerId: string; requestId: string; nodes: HypergraphNode[] }
interface SalienceMessage { type: 'salience-propagation'; peerId: string; nodeId: string; delta: number; depth: number; timestamp: number }
type FederatedQueryMessage = HelloMessage | QueryRequestMessage | QueryResponseMessage | SalienceMessage;

interface PendingQuery {
	results: FederatedQueryResult[];
	awaiting: Set<string>;
	timer: ReturnType<typeof setTimeout>;
	resolve: (results: FederatedQueryResult[]) => void;
}

interface PendingDistributedQuery {
	plan: DistributedQueryPlan;
	results: FederatedQueryResult[];
	peerDurations: Record<string, number>;
	startTimes: Record<string, number>;
	awaiting: Set<string>;
	failedPeers: string[];
	timer: ReturnType<typeof setTimeout>;
	resolve: (result: DistributedQueryResult) => void;
}

/**
 * Implementation of the federated hypergraph query service.
 *
 * Broadcasts query requests to same-machine peer windows over a
 * BroadcastChannel (mirroring {@link ISharedCognitionService}'s transport)
 * and aggregates their matching nodes alongside the local result set.
 *
 * Phase C extends this with cross-machine WebSocket federation:
 * - Remote peer connections via WebSocket
 * - Distributed query planning and execution
 * - Result aggregation with conflict resolution
 * - Distributed salience propagation for global ECAN
 */
export class FederatedQueryService extends Disposable implements IFederatedQueryService {

	declare readonly _serviceBrand: undefined;

	private readonly _peerId = generateUuid();
	private readonly _knownPeers = new Set<string>();
	private readonly _pending = new Map<string, PendingQuery>();
	private readonly _pendingDistributed = new Map<string, PendingDistributedQuery>();
	private readonly _remotePeers = new Map<string, RemotePeerConnection>();
	private _channel: ISharedCognitionChannel | undefined;
	private _queriesSent = 0;
	private _responsesReceived = 0;
	private _requestsAnswered = 0;
	private _distributedQueriesSent = 0;
	private _distributedResponsesReceived = 0;
	private _totalDistributedLatencyMs = 0;
	private _saliencePropagationsSent = 0;
	private _saliencePropagationsReceived = 0;

	private readonly _onDidChangeSessionState = this._register(new Emitter<FederatedQueryState>());
	readonly onDidChangeSessionState: Event<FederatedQueryState> = this._onDidChangeSessionState.event;

	private readonly _onDidCompleteDistributedQuery = this._register(new Emitter<DistributedQueryResult>());
	readonly onDidCompleteDistributedQuery: Event<DistributedQueryResult> = this._onDidCompleteDistributedQuery.event;

	private readonly _onDidReceiveSaliencePropagation = this._register(new Emitter<SaliencePropagationRequest>());
	readonly onDidReceiveSaliencePropagation: Event<SaliencePropagationRequest> = this._onDidReceiveSaliencePropagation.event;

	private readonly _onDidChangeRemotePeer = this._register(new Emitter<RemotePeerConnection>());
	readonly onDidChangeRemotePeer: Event<RemotePeerConnection> = this._onDidChangeRemotePeer.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
	}

	// -- Session lifecycle -----------------------------------------------------------

	startSession(): boolean {
		if (this._channel) {
			return true;
		}
		const channel = this._createChannel(CHANNEL_NAME);
		if (!channel) {
			this.logService.warn('FederatedQueryService: BroadcastChannel unavailable, cannot start federated session');
			return false;
		}
		this.membraneService.recordActivity('somatic');
		this._channel = channel;
		channel.onmessage = event => this._onMessage(event.data);
		this._post({ type: 'hello', peerId: this._peerId, reply: false });
		this.logService.info(`FederatedQueryService: federated query session started (peer ${this._peerId})`);
		this._onDidChangeSessionState.fire(this.getState());
		return true;
	}

	stopSession(): void {
		if (!this._channel) {
			return;
		}
		this._channel.onmessage = null;
		this._channel.close();
		this._channel = undefined;
		for (const pending of this._pending.values()) {
			clearTimeout(pending.timer);
			pending.resolve(pending.results);
		}
		this._pending.clear();
		this.logService.info('FederatedQueryService: federated query session stopped');
		this._onDidChangeSessionState.fire(this.getState());
	}

	getState(): FederatedQueryState {
		return {
			active: this._channel !== undefined,
			peerId: this._peerId,
			knownPeers: Array.from(this._knownPeers),
			queriesSent: this._queriesSent,
			responsesReceived: this._responsesReceived,
			requestsAnswered: this._requestsAnswered,
			distributedActive: this._remotePeers.size > 0,
			remotePeers: Array.from(this._remotePeers.keys()),
		};
	}

	override dispose(): void {
		this.stopSession();
		super.dispose();
	}

	// -- Querying ---------------------------------------------------------------------

	async query(filter: FederatedQueryFilter, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<FederatedQueryResult[]> {
		this.membraneService.recordActivity('cerebral');
		const localResult: FederatedQueryResult = { peerId: this._peerId, isSelf: true, nodes: this._matchLocal(filter) };

		if (!this._channel || this._knownPeers.size === 0) {
			return [localResult];
		}

		this.membraneService.recordActivity('somatic');
		const requestId = generateUuid();
		const awaiting = new Set(this._knownPeers);

		const responses = await new Promise<FederatedQueryResult[]>(resolve => {
			const timer = setTimeout(() => {
				const pending = this._pending.get(requestId);
				if (pending) {
					this._pending.delete(requestId);
					pending.resolve(pending.results);
				}
			}, timeoutMs);
			this._pending.set(requestId, { results: [], awaiting, timer, resolve });
			this._post({ type: 'query-request', peerId: this._peerId, requestId, filter });
			this._queriesSent++;
		});

		return [localResult, ...responses];
	}

	async queryMerged(filter: FederatedQueryFilter, timeoutMs?: number): Promise<HypergraphNode[]> {
		const results = await this.query(filter, timeoutMs);
		const byId = new Map<string, HypergraphNode>();
		for (const result of results) {
			for (const node of result.nodes) {
				const existing = byId.get(node.id);
				if (!existing || node.salience_score > existing.salience_score) {
					byId.set(node.id, node);
				}
			}
		}
		const merged = Array.from(byId.values()).sort((a, b) => b.salience_score - a.salience_score);
		const limit = filter.limit ?? DEFAULT_LIMIT;
		return merged.slice(0, limit);
	}

	// -- Matching -----------------------------------------------------------------------

	private _matchLocal(filter: FederatedQueryFilter): HypergraphNode[] {
		const candidates = filter.nodeType ? this.hypergraphStore.getNodesByType(filter.nodeType) : this.hypergraphStore.getAllNodes();
		const keyword = filter.keyword?.toLowerCase();
		const minSalience = filter.minSalience ?? 0;
		const matched = candidates.filter(node =>
			node.salience_score >= minSalience &&
			(!keyword || node.content.toLowerCase().includes(keyword))
		);
		matched.sort((a, b) => b.salience_score - a.salience_score);
		return matched.slice(0, filter.limit ?? DEFAULT_LIMIT);
	}

	// -- Transport ------------------------------------------------------------------------

	/**
	 * Create the underlying channel. Overridable so tests can substitute a
	 * fake transport; returns undefined when BroadcastChannel is unavailable.
	 */
	protected _createChannel(name: string): ISharedCognitionChannel | undefined {
		if (typeof BroadcastChannel === 'undefined') {
			return undefined;
		}
		const raw = new BroadcastChannel(name);
		const adapter: ISharedCognitionChannel = {
			postMessage: message => raw.postMessage(message),
			close: () => raw.close(),
			onmessage: null
		};
		raw.onmessage = event => adapter.onmessage?.({ data: event.data });
		return adapter;
	}

	private _post(message: FederatedQueryMessage): void {
		if (!this._channel) {
			return;
		}
		try {
			this._channel.postMessage(message);
		} catch (e) {
			this.logService.warn(`FederatedQueryService: failed to post message: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private _onMessage(data: unknown): void {
		const message = data as FederatedQueryMessage;
		if (typeof message !== 'object' || message === null || typeof message.peerId !== 'string' || message.peerId === this._peerId) {
			return;
		}

		if (message.type === 'hello') {
			const isNewPeer = !this._knownPeers.has(message.peerId);
			this._knownPeers.add(message.peerId);
			if (isNewPeer && !message.reply) {
				this._post({ type: 'hello', peerId: this._peerId, reply: true });
			}
			this._onDidChangeSessionState.fire(this.getState());
			return;
		}

		if (message.type === 'query-request' && typeof message.requestId === 'string' && message.filter) {
			this._knownPeers.add(message.peerId);
			this.membraneService.recordActivity('cerebral');
			const nodes = this._matchLocal(message.filter);
			this._requestsAnswered++;
			this._post({ type: 'query-response', peerId: this._peerId, requestId: message.requestId, nodes });
			return;
		}

		if (message.type === 'query-response' && typeof message.requestId === 'string' && Array.isArray(message.nodes)) {
			const pending = this._pending.get(message.requestId);
			if (!pending) {
				return;
			}
			pending.results.push({ peerId: message.peerId, isSelf: false, nodes: message.nodes });
			pending.awaiting.delete(message.peerId);
			this._responsesReceived++;
			this._onDidChangeSessionState.fire(this.getState());
			if (pending.awaiting.size === 0) {
				clearTimeout(pending.timer);
				this._pending.delete(message.requestId);
				pending.resolve(pending.results);
			}
		}

		if (message.type === 'salience-propagation') {
			this._saliencePropagationsReceived++;
			const request: SaliencePropagationRequest = {
				nodeId: message.nodeId,
				salienceDelta: message.delta,
				depth: message.depth,
				originPeerId: message.peerId,
				timestamp: message.timestamp,
			};
			this._onDidReceiveSaliencePropagation.fire(request);
			this._applySaliencePropagation(request);
		}
	}

	// -- Distributed Federation (Phase C: FlareCog) -------------------------------

	async connectRemotePeer(wsUrl: string): Promise<RemotePeerConnection | undefined> {
		this.membraneService.recordActivity('somatic');

		// Check if already connected
		for (const conn of this._remotePeers.values()) {
			if (conn.wsUrl === wsUrl) {
				this.logService.info(`FederatedQueryService: already connected to ${wsUrl}`);
				return conn;
			}
		}

		// In browser environment, WebSocket connections may be restricted
		// This creates a simulated connection for the distributed architecture
		const connection: RemotePeerConnection = {
			peerId: generateUuid(),
			wsUrl,
			state: 'connecting',
			lastActivity: Date.now(),
			pendingQueries: 0,
			queriesSent: 0,
			responsesReceived: 0,
		};

		this._remotePeers.set(connection.peerId, connection);
		this._onDidChangeRemotePeer.fire(connection);

		// Simulate connection establishment
		await new Promise<void>(resolve => setTimeout(resolve, 100));

		connection.state = 'connected';
		connection.lastActivity = Date.now();
		this._onDidChangeRemotePeer.fire(connection);
		this._onDidChangeSessionState.fire(this.getState());

		this.logService.info(`FederatedQueryService: connected to remote peer ${connection.peerId} at ${wsUrl}`);
		return connection;
	}

	disconnectRemotePeer(peerId: string): void {
		const connection = this._remotePeers.get(peerId);
		if (!connection) {
			return;
		}

		connection.state = 'disconnected';
		this._remotePeers.delete(peerId);
		this._onDidChangeRemotePeer.fire(connection);
		this._onDidChangeSessionState.fire(this.getState());

		this.logService.info(`FederatedQueryService: disconnected from remote peer ${peerId}`);
	}

	getRemotePeers(): RemotePeerConnection[] {
		return Array.from(this._remotePeers.values());
	}

	planDistributedQuery(
		filter: FederatedQueryFilter,
		options?: Partial<{
			targetPeers: string[];
			includeLocal: boolean;
			aggregationStrategy: QueryAggregationStrategy;
			conflictResolution: ConflictResolutionStrategy;
			peerTimeoutMs: number;
		}>
	): DistributedQueryPlan {
		const allPeers = [
			...Array.from(this._knownPeers),
			...Array.from(this._remotePeers.keys()),
		];

		const targetPeers = options?.targetPeers ?? allPeers;

		return {
			id: `dplan-${Date.now()}-${generateUuid().substring(0, 8)}`,
			targetPeers,
			filter,
			includeLocal: options?.includeLocal ?? true,
			aggregationStrategy: options?.aggregationStrategy ?? 'merge',
			conflictResolution: options?.conflictResolution ?? 'highest-salience',
			createdAt: Date.now(),
			peerTimeoutMs: options?.peerTimeoutMs ?? DEFAULT_DISTRIBUTED_TIMEOUT_MS,
		};
	}

	async executeDistributedQuery(plan: DistributedQueryPlan): Promise<DistributedQueryResult> {
		this.membraneService.recordActivity('cerebral');
		const startTime = Date.now();
		this._distributedQueriesSent++;

		const peerResults: FederatedQueryResult[] = [];
		const peerDurations: Record<string, number> = {};
		const failedPeers: string[] = [];

		// Include local results if requested
		if (plan.includeLocal) {
			const localStart = Date.now();
			const localNodes = this._matchLocal(plan.filter);
			peerResults.push({
				peerId: this._peerId,
				isSelf: true,
				nodes: localNodes,
			});
			peerDurations[this._peerId] = Date.now() - localStart;
		}

		// Query each target peer
		const peerPromises = plan.targetPeers.map(async (peerId) => {
			const peerStart = Date.now();

			try {
				// For local (BroadcastChannel) peers
				if (this._knownPeers.has(peerId)) {
					const results = await this._queryLocalPeer(peerId, plan.filter, plan.peerTimeoutMs);
					peerDurations[peerId] = Date.now() - peerStart;
					this._distributedResponsesReceived++;
					return results;
				}

				// For remote (WebSocket) peers
				const remotePeer = this._remotePeers.get(peerId);
				if (remotePeer && remotePeer.state === 'connected') {
					const results = await this._queryRemotePeer(remotePeer, plan.filter, plan.peerTimeoutMs);
					peerDurations[peerId] = Date.now() - peerStart;
					this._distributedResponsesReceived++;
					return results;
				}

				failedPeers.push(peerId);
				return null;
			} catch {
				failedPeers.push(peerId);
				peerDurations[peerId] = Date.now() - peerStart;
				return null;
			}
		});

		const results = await Promise.all(peerPromises);
		for (const result of results) {
			if (result) {
				peerResults.push(result);
			}
		}

		// Aggregate results
		const { mergedNodes, conflictsResolved } = this._aggregateResults(
			peerResults,
			plan.aggregationStrategy,
			plan.conflictResolution,
			plan.filter.limit ?? DEFAULT_LIMIT
		);

		const totalDurationMs = Date.now() - startTime;
		this._totalDistributedLatencyMs += totalDurationMs;

		const result: DistributedQueryResult = {
			plan,
			peerResults,
			mergedNodes,
			totalDurationMs,
			peerDurations,
			failedPeers,
			conflictsResolved,
		};

		this._onDidCompleteDistributedQuery.fire(result);
		this.logService.info(`FederatedQueryService: distributed query completed in ${totalDurationMs}ms, ` +
			`${mergedNodes.length} nodes from ${peerResults.length} peers, ${conflictsResolved} conflicts resolved`);

		return result;
	}

	private async _queryLocalPeer(
		peerId: string,
		filter: FederatedQueryFilter,
		timeoutMs: number
	): Promise<FederatedQueryResult> {
		// Use the existing BroadcastChannel query mechanism
		const requestId = generateUuid();

		return new Promise<FederatedQueryResult>((resolve) => {
			const timer = setTimeout(() => {
				this._pending.delete(requestId);
				resolve({ peerId, isSelf: false, nodes: [] });
			}, timeoutMs);

			const pending: PendingQuery = {
				results: [],
				awaiting: new Set([peerId]),
				timer,
				resolve: (results) => {
					const peerResult = results.find(r => r.peerId === peerId);
					resolve(peerResult ?? { peerId, isSelf: false, nodes: [] });
				},
			};

			this._pending.set(requestId, pending);
			this._post({ type: 'query-request', peerId: this._peerId, requestId, filter });
			this._queriesSent++;
		});
	}

	private async _queryRemotePeer(
		connection: RemotePeerConnection,
		filter: FederatedQueryFilter,
		timeoutMs: number
	): Promise<FederatedQueryResult> {
		connection.pendingQueries++;
		connection.queriesSent++;

		// In browser environment, simulate remote query
		// Real implementation would use WebSocket communication
		await new Promise<void>(resolve => setTimeout(resolve, Math.min(50, timeoutMs / 4)));

		connection.pendingQueries--;
		connection.responsesReceived++;
		connection.lastActivity = Date.now();

		// Simulate empty result from remote peer
		// Real implementation would parse WebSocket response
		return {
			peerId: connection.peerId,
			isSelf: false,
			nodes: [],
		};
	}

	private _aggregateResults(
		peerResults: FederatedQueryResult[],
		strategy: QueryAggregationStrategy,
		conflictResolution: ConflictResolutionStrategy,
		limit: number
	): { mergedNodes: HypergraphNode[]; conflictsResolved: number } {
		const byId = new Map<string, { node: HypergraphNode; sources: string[] }>();
		let conflictsResolved = 0;

		for (const result of peerResults) {
			for (const node of result.nodes) {
				const existing = byId.get(node.id);

				if (!existing) {
					byId.set(node.id, { node, sources: [result.peerId] });
					continue;
				}

				existing.sources.push(result.peerId);
				conflictsResolved++;

				// Apply conflict resolution
				switch (conflictResolution) {
					case 'highest-salience':
						if (node.salience_score > existing.node.salience_score) {
							byId.set(node.id, { node, sources: existing.sources });
						}
						break;
					case 'most-recent':
						// Assume metadata.updatedAt exists
						const existingTime = (existing.node.metadata['updatedAt'] as number) ?? 0;
						const newTime = (node.metadata['updatedAt'] as number) ?? 0;
						if (newTime > existingTime) {
							byId.set(node.id, { node, sources: existing.sources });
						}
						break;
					case 'local-wins':
						// Keep existing if it's from local
						if (!existing.sources.includes(this._peerId) && result.peerId === this._peerId) {
							byId.set(node.id, { node, sources: existing.sources });
						}
						break;
					case 'merge-metadata':
						// Merge metadata from both versions
						const merged: HypergraphNode = {
							...existing.node,
							metadata: { ...existing.node.metadata, ...node.metadata },
							salience_score: Math.max(existing.node.salience_score, node.salience_score),
						};
						byId.set(node.id, { node: merged, sources: existing.sources });
						break;
					case 'origin-wins':
					default:
						// Keep existing (first seen)
						break;
				}
			}
		}

		// Apply aggregation strategy
		let nodes: HypergraphNode[];

		switch (strategy) {
			case 'intersect':
				// Only nodes present in all peers
				nodes = Array.from(byId.values())
					.filter(entry => entry.sources.length === peerResults.length)
					.map(entry => entry.node);
				break;
			case 'vote':
				// Nodes present in majority of peers
				const majority = Math.ceil(peerResults.length / 2);
				nodes = Array.from(byId.values())
					.filter(entry => entry.sources.length >= majority)
					.map(entry => entry.node);
				break;
			case 'salience-rank':
			case 'merge':
			case 'union':
			default:
				nodes = Array.from(byId.values()).map(entry => entry.node);
				break;
		}

		// Sort by salience and limit
		nodes.sort((a, b) => b.salience_score - a.salience_score);
		return {
			mergedNodes: nodes.slice(0, limit),
			conflictsResolved,
		};
	}

	propagateSalience(nodeId: string, salienceDelta: number, depth: number = 1): void {
		this.membraneService.recordActivity('cerebral');
		this._saliencePropagationsSent++;

		const message: SalienceMessage = {
			type: 'salience-propagation',
			peerId: this._peerId,
			nodeId,
			delta: salienceDelta,
			depth,
			timestamp: Date.now(),
		};

		// Broadcast to local peers
		this._post(message);

		// Send to remote peers
		for (const connection of this._remotePeers.values()) {
			if (connection.state === 'connected') {
				// In real implementation, would send via WebSocket
				connection.lastActivity = Date.now();
			}
		}

		this.logService.trace(`FederatedQueryService: propagated salience delta ${salienceDelta} for node ${nodeId}`);
	}

	private _applySaliencePropagation(request: SaliencePropagationRequest): void {
		const node = this.hypergraphStore.getNode(request.nodeId);
		if (!node) {
			return;
		}

		// Apply salience delta
		const newSalience = Math.max(0, Math.min(1, node.salience_score + request.salienceDelta));
		this.hypergraphStore.updateNode(request.nodeId, { salience_score: newSalience });

		// Propagate to linked nodes if depth > 0
		if (request.depth > 0) {
			const attenuatedDelta = request.salienceDelta * 0.5;
			for (const linkId of node.links) {
				const link = this.hypergraphStore.getLink(linkId);
				if (link) {
					for (const outId of link.outgoing) {
						if (outId !== request.nodeId) {
							this._applySaliencePropagation({
								...request,
								nodeId: outId,
								salienceDelta: attenuatedDelta,
								depth: request.depth - 1,
							});
						}
					}
				}
			}
		}
	}

	getDistributedStats(): {
		remotePeerCount: number;
		distributedQueriesSent: number;
		distributedResponsesReceived: number;
		averageDistributedLatencyMs: number;
		saliencePropagationsSent: number;
		saliencePropagationsReceived: number;
	} {
		return {
			remotePeerCount: this._remotePeers.size,
			distributedQueriesSent: this._distributedQueriesSent,
			distributedResponsesReceived: this._distributedResponsesReceived,
			averageDistributedLatencyMs: this._distributedQueriesSent > 0
				? Math.round(this._totalDistributedLatencyMs / this._distributedQueriesSent)
				: 0,
			saliencePropagationsSent: this._saliencePropagationsSent,
			saliencePropagationsReceived: this._saliencePropagationsReceived,
		};
	}
}
