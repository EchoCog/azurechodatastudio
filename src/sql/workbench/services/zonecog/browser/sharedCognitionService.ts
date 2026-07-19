/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ISharedCognitionService,
	SharedCognitionState,
	SharedCognitionUpdate
} from 'sql/workbench/services/zonecog/common/sharedCognition';
import { IHypergraphStore, ICognitiveMembraneService, HypergraphNode, HypergraphLink } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

/** Channel name shared by all participating workbench windows. */
const CHANNEL_NAME = 'zonecog-shared-cognition';

/** Minimal channel surface so tests can substitute a fake transport. */
export interface ISharedCognitionChannel {
	postMessage(message: unknown): void;
	close(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
}

interface HelloMessage { type: 'hello'; peerId: string; reply: boolean }
interface NodeMessage { type: 'node'; peerId: string; node: HypergraphNode }
interface LinkMessage { type: 'link'; peerId: string; link: HypergraphLink }
type SharedCognitionMessage = HelloMessage | NodeMessage | LinkMessage;

/**
 * Implementation of the shared cognition service.
 *
 * Mirrors hypergraph node/link upserts between same-machine workbench
 * windows over a BroadcastChannel. Echo suppression: while a peer update is
 * being applied to the local store, the resulting local change events are
 * not re-broadcast.
 */
export class SharedCognitionService extends Disposable implements ISharedCognitionService {

	declare readonly _serviceBrand: undefined;

	private readonly _peerId = generateUuid();
	private readonly _knownPeers = new Set<string>();
	private _channel: ISharedCognitionChannel | undefined;
	private _sessionDisposables: DisposableStore | undefined;
	private _applyingPeerUpdate = false;
	private _sentUpdates = 0;
	private _appliedUpdates = 0;

	private readonly _onDidApplyPeerUpdate = this._register(new Emitter<SharedCognitionUpdate>());
	readonly onDidApplyPeerUpdate: Event<SharedCognitionUpdate> = this._onDidApplyPeerUpdate.event;

	private readonly _onDidChangeSessionState = this._register(new Emitter<SharedCognitionState>());
	readonly onDidChangeSessionState: Event<SharedCognitionState> = this._onDidChangeSessionState.event;

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
			this.logService.warn('SharedCognitionService: BroadcastChannel unavailable, cannot start shared session');
			return false;
		}
		this.membraneService.recordActivity('somatic');
		this._channel = channel;
		channel.onmessage = event => this._onMessage(event.data);

		this._sessionDisposables = new DisposableStore();
		this._sessionDisposables.add(this.hypergraphStore.onDidChangeNode(node => {
			if (!this._applyingPeerUpdate) {
				this._post({ type: 'node', peerId: this._peerId, node });
			}
		}));
		this._sessionDisposables.add(this.hypergraphStore.onDidChangeLink(link => {
			if (!this._applyingPeerUpdate) {
				this._post({ type: 'link', peerId: this._peerId, link });
			}
		}));

		this._post({ type: 'hello', peerId: this._peerId, reply: false });
		this.logService.info(`SharedCognitionService: shared cognition session started (peer ${this._peerId})`);
		this._onDidChangeSessionState.fire(this.getState());
		return true;
	}

	stopSession(): void {
		if (!this._channel) {
			return;
		}
		this._sessionDisposables?.dispose();
		this._sessionDisposables = undefined;
		this._channel.onmessage = null;
		this._channel.close();
		this._channel = undefined;
		this.logService.info('SharedCognitionService: shared cognition session stopped');
		this._onDidChangeSessionState.fire(this.getState());
	}

	getState(): SharedCognitionState {
		return {
			active: this._channel !== undefined,
			peerId: this._peerId,
			knownPeers: Array.from(this._knownPeers),
			sentUpdates: this._sentUpdates,
			appliedUpdates: this._appliedUpdates
		};
	}

	override dispose(): void {
		this.stopSession();
		super.dispose();
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

	private _post(message: SharedCognitionMessage): void {
		if (!this._channel) {
			return;
		}
		try {
			this._channel.postMessage(message);
			if (message.type !== 'hello') {
				this._sentUpdates++;
			}
		} catch (e) {
			this.logService.warn(`SharedCognitionService: failed to post update: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private _onMessage(data: unknown): void {
		const message = data as SharedCognitionMessage;
		if (typeof message !== 'object' || message === null || typeof message.peerId !== 'string' || message.peerId === this._peerId) {
			return;
		}

		if (message.type === 'hello') {
			const isNewPeer = !this._knownPeers.has(message.peerId);
			this._knownPeers.add(message.peerId);
			// Reply once so the new window learns about us too; the reply is
			// marked so it is never answered again (prevents a hello storm).
			if (isNewPeer && !message.reply) {
				this._post({ type: 'hello', peerId: this._peerId, reply: true });
			}
			this._onDidChangeSessionState.fire(this.getState());
			return;
		}

		if (message.type === 'node' && message.node && typeof message.node.id === 'string') {
			this._knownPeers.add(message.peerId);
			this._applyingPeerUpdate = true;
			try {
				this.hypergraphStore.addNode(message.node);
			} finally {
				this._applyingPeerUpdate = false;
			}
			this._appliedUpdates++;
			this._onDidApplyPeerUpdate.fire({ peerId: message.peerId, kind: 'node', id: message.node.id });
			return;
		}

		if (message.type === 'link' && message.link && typeof message.link.id === 'string') {
			this._knownPeers.add(message.peerId);
			this._applyingPeerUpdate = true;
			try {
				this.hypergraphStore.addLink(message.link);
			} finally {
				this._applyingPeerUpdate = false;
			}
			this._appliedUpdates++;
			this._onDidApplyPeerUpdate.fire({ peerId: message.peerId, kind: 'link', id: message.link.id });
		}
	}
}
