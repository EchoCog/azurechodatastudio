/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IFederatedQueryService,
	FederatedQueryFilter,
	FederatedQueryResult,
	FederatedQueryState
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

interface HelloMessage { type: 'hello'; peerId: string; reply: boolean }
interface QueryRequestMessage { type: 'query-request'; peerId: string; requestId: string; filter: FederatedQueryFilter }
interface QueryResponseMessage { type: 'query-response'; peerId: string; requestId: string; nodes: HypergraphNode[] }
type FederatedQueryMessage = HelloMessage | QueryRequestMessage | QueryResponseMessage;

interface PendingQuery {
	results: FederatedQueryResult[];
	awaiting: Set<string>;
	timer: ReturnType<typeof setTimeout>;
	resolve: (results: FederatedQueryResult[]) => void;
}

/**
 * Implementation of the federated hypergraph query service.
 *
 * Broadcasts query requests to same-machine peer windows over a
 * BroadcastChannel (mirroring {@link ISharedCognitionService}'s transport)
 * and aggregates their matching nodes alongside the local result set.
 */
export class FederatedQueryService extends Disposable implements IFederatedQueryService {

	declare readonly _serviceBrand: undefined;

	private readonly _peerId = generateUuid();
	private readonly _knownPeers = new Set<string>();
	private readonly _pending = new Map<string, PendingQuery>();
	private _channel: ISharedCognitionChannel | undefined;
	private _queriesSent = 0;
	private _responsesReceived = 0;
	private _requestsAnswered = 0;

	private readonly _onDidChangeSessionState = this._register(new Emitter<FederatedQueryState>());
	readonly onDidChangeSessionState: Event<FederatedQueryState> = this._onDidChangeSessionState.event;

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
			requestsAnswered: this._requestsAnswered
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
	}
}
