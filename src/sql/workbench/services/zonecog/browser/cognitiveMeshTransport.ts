/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveMeshChannel,
	CognitiveMeshEnvelope,
	CognitiveMeshRequestPayload,
	CognitiveMeshResponsePayload,
	CognitiveMeshRequestHandler,
	normalizeMeshAddress,
	isWebSocketUrl,
} from 'sql/workbench/services/zonecog/common/cognitiveMesh';
import { generateUuid } from 'vs/base/common/uuid';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

/** Bound on messages queued while a WebSocket is opening / reconnecting. */
const MAX_QUEUED_MESSAGES = 256;

/** Default request timeout. */
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

/** Default reconnect base delay. */
const DEFAULT_RECONNECT_DELAY_MS = 250;

/** Default max reconnect attempts. */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;

// ---------------------------------------------------------------------------
// WebSocket channel
// ---------------------------------------------------------------------------

/**
 * Production WebSocket mesh channel.
 *
 * Owns connection lifecycle, outbound queueing while the socket opens, and
 * bounded exponential-backoff reconnection. Same pattern as the collaboration
 * backend relay client.
 */
export class WebSocketMeshChannel implements ICognitiveMeshChannel {

	onmessage: ((event: { data: unknown }) => void) | null = null;
	onopen: ((event: { open: boolean }) => void) | null = null;

	private _socket: WebSocket | undefined;
	private _queue: string[] = [];
	private _closed = false;
	private _attempts = 0;
	private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly url: string,
		private readonly reconnectDelayMs: number = DEFAULT_RECONNECT_DELAY_MS,
		private readonly maxReconnectAttempts: number = DEFAULT_MAX_RECONNECT_ATTEMPTS,
		private readonly onLog?: (level: 'info' | 'warn', message: string) => void
	) {
		this._connect();
	}

	get readyState(): number {
		return this._socket?.readyState ?? 3 /* CLOSED */;
	}

	private _connect(): void {
		if (this._closed) {
			return;
		}
		if (typeof WebSocket === 'undefined') {
			this.onLog?.('warn', `WebSocketMeshChannel: WebSocket unavailable for ${this.url}`);
			return;
		}

		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch (error) {
			this.onLog?.('warn', `WebSocketMeshChannel: connect failed for ${this.url}: ${error instanceof Error ? error.message : String(error)}`);
			this._scheduleReconnect();
			return;
		}
		this._socket = socket;

		socket.onopen = () => {
			this._attempts = 0;
			const queued = this._queue;
			this._queue = [];
			for (const message of queued) {
				socket.send(message);
			}
			this.onopen?.({ open: true });
		};

		socket.onmessage = event => {
			if (typeof event.data !== 'string') {
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(event.data);
			} catch {
				this.onLog?.('warn', 'WebSocketMeshChannel: discarded malformed message');
				return;
			}
			this.onmessage?.({ data: parsed });
		};

		socket.onerror = () => {
			this.onLog?.('warn', `WebSocketMeshChannel: socket error on ${this.url}`);
		};

		socket.onclose = () => {
			this.onopen?.({ open: false });
			this._scheduleReconnect();
		};
	}

	private _scheduleReconnect(): void {
		if (this._closed || this._attempts >= this.maxReconnectAttempts) {
			return;
		}
		const delay = this.reconnectDelayMs * Math.pow(2, this._attempts);
		this._attempts++;
		this._reconnectTimer = setTimeout(() => this._connect(), delay);
	}

	postMessage(message: unknown): void {
		if (this._closed) {
			return;
		}
		const payload = typeof message === 'string' ? message : JSON.stringify(message);
		if (this._socket && this._socket.readyState === 1 /* OPEN */) {
			this._socket.send(payload);
			return;
		}
		this._queue.push(payload);
		if (this._queue.length > MAX_QUEUED_MESSAGES) {
			this._queue.shift();
		}
	}

	close(): void {
		this._closed = true;
		if (this._reconnectTimer !== undefined) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = undefined;
		}
		this.onmessage = null;
		this.onopen = null;
		const socket = this._socket;
		this._socket = undefined;
		if (socket) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			try {
				socket.close();
			} catch {
				// A socket that never opened may throw on close.
			}
		}
	}
}

// ---------------------------------------------------------------------------
// BroadcastChannel channel
// ---------------------------------------------------------------------------

/**
 * Production BroadcastChannel mesh channel for same-machine multi-window peers.
 */
export class BroadcastMeshChannel implements ICognitiveMeshChannel {

	onmessage: ((event: { data: unknown }) => void) | null = null;
	onopen: ((event: { open: boolean }) => void) | null = null;

	private readonly _channel: BroadcastChannel;

	constructor(name: string) {
		this._channel = new BroadcastChannel(name);
		this._channel.onmessage = (event: MessageEvent) => {
			this.onmessage?.({ data: event.data });
		};
		// BroadcastChannel is immediately usable.
		queueMicrotask(() => this.onopen?.({ open: true }));
	}

	postMessage(message: unknown): void {
		this._channel.postMessage(message);
	}

	close(): void {
		this.onmessage = null;
		this.onopen = null;
		this._channel.onmessage = null;
		this._channel.close();
	}
}

// ---------------------------------------------------------------------------
// In-process mesh hub
// ---------------------------------------------------------------------------

/**
 * Process-local multi-endpoint bus.
 *
 * Delivers every posted envelope to every other open endpoint on the same hub.
 * This is the production path for same-realm multi-node registration (AAR
 * remote nodes, cognitive-loop cluster members, unit tests) — real message
 * routing with no artificial delay.
 */
export class InProcessMeshHub {

	private readonly _endpoints = new Set<InProcessMeshChannel>();

	connect(endpointId?: string): InProcessMeshChannel {
		const channel = new InProcessMeshChannel(this, endpointId ?? generateUuid());
		this._endpoints.add(channel);
		return channel;
	}

	/** @internal Deliver from one endpoint to all others. */
	_broadcast(sender: InProcessMeshChannel, message: unknown): void {
		for (const endpoint of this._endpoints) {
			if (endpoint !== sender && !endpoint.closed && endpoint.onmessage) {
				endpoint.onmessage({ data: message });
			}
		}
	}

	/** @internal */
	_remove(endpoint: InProcessMeshChannel): void {
		this._endpoints.delete(endpoint);
	}

	get size(): number {
		return this._endpoints.size;
	}

	clear(): void {
		for (const endpoint of [...this._endpoints]) {
			endpoint.close();
		}
		this._endpoints.clear();
	}
}

export class InProcessMeshChannel implements ICognitiveMeshChannel {

	onmessage: ((event: { data: unknown }) => void) | null = null;
	onopen: ((event: { open: boolean }) => void) | null = null;
	closed = false;

	constructor(
		private readonly hub: InProcessMeshHub,
		readonly endpointId: string
	) {
		queueMicrotask(() => {
			if (!this.closed) {
				this.onopen?.({ open: true });
			}
		});
	}

	postMessage(message: unknown): void {
		if (this.closed) {
			return;
		}
		this.hub._broadcast(this, message);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.onmessage = null;
		this.onopen = null;
		this.hub._remove(this);
	}
}

// ---------------------------------------------------------------------------
// Global default hub (shared by AAR / Loop / FlareCog within one workbench)
// ---------------------------------------------------------------------------

let _defaultHub: InProcessMeshHub | undefined;

/** Shared in-process hub for the workbench process. */
export function getDefaultMeshHub(): InProcessMeshHub {
	if (!_defaultHub) {
		_defaultHub = new InProcessMeshHub();
	}
	return _defaultHub;
}

/** Test helper: replace the default hub. */
export function setDefaultMeshHub(hub: InProcessMeshHub | undefined): void {
	_defaultHub = hub;
}

// ---------------------------------------------------------------------------
// Channel factory helpers
// ---------------------------------------------------------------------------

export interface CreateMeshChannelOptions {
	reconnectDelayMs?: number;
	maxReconnectAttempts?: number;
	onLog?: (level: 'info' | 'warn', message: string) => void;
	/** Prefer in-process hub instead of WebSocket (same-realm peers). */
	hub?: InProcessMeshHub;
	/** Force BroadcastChannel with this name. */
	broadcastName?: string;
}

/**
 * Create the most appropriate mesh channel for an address.
 * - broadcastName set → BroadcastMeshChannel
 * - hub provided and address is not a remote ws URL → InProcess endpoint
 * - ws/wss or host:port → WebSocketMeshChannel
 */
export function createMeshChannel(address: string, options: CreateMeshChannelOptions = {}): ICognitiveMeshChannel | undefined {
	if (options.broadcastName) {
		if (typeof BroadcastChannel === 'undefined') {
			return undefined;
		}
		return new BroadcastMeshChannel(options.broadcastName);
	}

	const normalized = normalizeMeshAddress(address);
	if (options.hub && !isWebSocketUrl(address) && !isWebSocketUrl(normalized)) {
		return options.hub.connect(address || generateUuid());
	}

	// Prefer in-process hub when the caller explicitly wants local mesh and
	// the address is a logical node id (no scheme).
	if (options.hub && address && !address.includes('://') && !/:\d+$/.test(address)) {
		return options.hub.connect(address);
	}

	if (!normalized || (!isWebSocketUrl(normalized) && !isWebSocketUrl(address))) {
		// Logical id — attach to default/in-process hub.
		const hub = options.hub ?? getDefaultMeshHub();
		return hub.connect(address || generateUuid());
	}

	if (typeof WebSocket === 'undefined') {
		// Fall back to in-process so local multi-node still works.
		const hub = options.hub ?? getDefaultMeshHub();
		return hub.connect(normalized);
	}

	return new WebSocketMeshChannel(
		normalized,
		options.reconnectDelayMs,
		options.maxReconnectAttempts,
		options.onLog
	);
}

// ---------------------------------------------------------------------------
// Request / response correlator
// ---------------------------------------------------------------------------

interface PendingRequest {
	resolve: (value: CognitiveMeshResponsePayload) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Correlates mesh request envelopes with their responses.
 * Also dispatches inbound requests to registered operation handlers.
 */
export class MeshRequestCorrelator extends Disposable {

	private readonly _pending = new Map<string, PendingRequest>();
	private readonly _handlers = new Map<string, CognitiveMeshRequestHandler>();
	private readonly _onDidReceiveEvent = this._register(new Emitter<CognitiveMeshEnvelope>());
	readonly onDidReceiveEvent: Event<CognitiveMeshEnvelope> = this._onDidReceiveEvent.event;

	constructor(
		private readonly peerId: string,
		private readonly send: (envelope: CognitiveMeshEnvelope) => void,
		private readonly defaultTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
	) {
		super();
	}

	/** Register a handler for an inbound request operation. */
	registerHandler(op: string, handler: CognitiveMeshRequestHandler): IDisposable {
		this._handlers.set(op, handler);
		return toDisposable(() => {
			if (this._handlers.get(op) === handler) {
				this._handlers.delete(op);
			}
		});
	}

	/** Build and send a request; resolve when a matching response arrives. */
	request(
		toPeerId: string | undefined,
		op: string,
		args?: unknown,
		timeoutMs: number = this.defaultTimeoutMs,
		token?: string
	): Promise<CognitiveMeshResponsePayload> {
		const id = generateUuid();
		const envelope: CognitiveMeshEnvelope<CognitiveMeshRequestPayload> = {
			type: 'request',
			id,
			fromPeerId: this.peerId,
			toPeerId,
			timestamp: Date.now(),
			payload: { op, args },
			token,
		};

		return new Promise<CognitiveMeshResponsePayload>((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pending.delete(id);
				reject(new Error(`Mesh request '${op}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this._pending.set(id, { resolve, reject, timer });
			this.send(envelope);
		});
	}

	/** Fire-and-forget event / broadcast. */
	emit(
		type: 'event' | 'broadcast' | 'hello' | 'heartbeat',
		payload: unknown,
		toPeerId?: string,
		token?: string
	): void {
		const envelope: CognitiveMeshEnvelope = {
			type,
			id: generateUuid(),
			fromPeerId: this.peerId,
			toPeerId,
			timestamp: Date.now(),
			payload,
			token,
		};
		this.send(envelope);
	}

	/** Ingest a raw channel message; routes responses and requests. */
	async handleMessage(data: unknown): Promise<void> {
		const envelope = this._asEnvelope(data);
		if (!envelope) {
			return;
		}

		// Drop our own echoes.
		if (envelope.fromPeerId === this.peerId && envelope.type !== 'response') {
			// Still allow responses we originated? Responses come from peers.
		}
		if (envelope.fromPeerId === this.peerId && envelope.type !== 'response') {
			return;
		}

		// Destination filter when toPeerId is set.
		if (envelope.toPeerId && envelope.toPeerId !== this.peerId && envelope.type !== 'broadcast') {
			return;
		}

		if (envelope.type === 'response' && envelope.replyTo) {
			const pending = this._pending.get(envelope.replyTo);
			if (pending) {
				clearTimeout(pending.timer);
				this._pending.delete(envelope.replyTo);
				const payload = envelope.payload as CognitiveMeshResponsePayload;
				pending.resolve(payload ?? { ok: false, error: 'empty response' });
			}
			return;
		}

		if (envelope.type === 'request') {
			const req = envelope as CognitiveMeshEnvelope<CognitiveMeshRequestPayload>;
			const op = req.payload?.op;
			const handler = op ? this._handlers.get(op) : undefined;
			let response: CognitiveMeshResponsePayload;
			if (!handler) {
				response = { ok: false, error: `no handler for op '${op}'` };
			} else {
				try {
					response = await handler(req);
				} catch (error) {
					response = {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}
			const reply: CognitiveMeshEnvelope<CognitiveMeshResponsePayload> = {
				type: 'response',
				id: generateUuid(),
				fromPeerId: this.peerId,
				toPeerId: envelope.fromPeerId,
				replyTo: envelope.id,
				timestamp: Date.now(),
				payload: response,
			};
			this.send(reply);
			return;
		}

		// hello / heartbeat / event / broadcast
		this._onDidReceiveEvent.fire(envelope);
	}

	private _asEnvelope(data: unknown): CognitiveMeshEnvelope | undefined {
		if (!data || typeof data !== 'object') {
			return undefined;
		}
		const candidate = data as Partial<CognitiveMeshEnvelope>;
		if (typeof candidate.type !== 'string' || typeof candidate.id !== 'string' || typeof candidate.fromPeerId !== 'string') {
			return undefined;
		}
		return candidate as CognitiveMeshEnvelope;
	}

	override dispose(): void {
		for (const pending of this._pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Mesh correlator disposed'));
		}
		this._pending.clear();
		this._handlers.clear();
		super.dispose();
	}
}

// ---------------------------------------------------------------------------
// Peer connection registry
// ---------------------------------------------------------------------------

export interface MeshPeerConnection {
	peerId: string;
	address: string;
	channel: ICognitiveMeshChannel;
	open: boolean;
}

/**
 * Manages a set of peer channels and a shared correlator for one local peer.
 */
export class CognitiveMeshNode extends Disposable {

	private readonly _peers = new Map<string, MeshPeerConnection>();
	private readonly _correlator: MeshRequestCorrelator;
	private _discoveryChannel: ICognitiveMeshChannel | undefined;

	private readonly _onDidChangePeerConnection = this._register(new Emitter<MeshPeerConnection>());
	readonly onDidChangePeerConnection: Event<MeshPeerConnection> = this._onDidChangePeerConnection.event;

	readonly onDidReceiveEvent: Event<CognitiveMeshEnvelope>;

	constructor(
		readonly localPeerId: string,
		private readonly createChannel: (address: string) => ICognitiveMeshChannel | undefined = (address) => createMeshChannel(address),
		defaultTimeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
	) {
		super();
		this._correlator = this._register(new MeshRequestCorrelator(
			localPeerId,
			envelope => this._routeSend(envelope),
			defaultTimeoutMs
		));
		this.onDidReceiveEvent = this._correlator.onDidReceiveEvent;
	}

	get correlator(): MeshRequestCorrelator {
		return this._correlator;
	}

	/** Join a discovery BroadcastChannel (same-machine peers). */
	joinDiscovery(channelName: string): boolean {
		if (this._discoveryChannel) {
			return true;
		}
		if (typeof BroadcastChannel === 'undefined') {
			return false;
		}
		const channel = new BroadcastMeshChannel(channelName);
		this._discoveryChannel = channel;
		channel.onmessage = event => {
			void this._correlator.handleMessage(event.data);
		};
		return true;
	}

	/** Connect to a peer address; returns the connection once channel is created. */
	connectPeer(peerId: string, address: string): MeshPeerConnection | undefined {
		const existing = this._peers.get(peerId);
		if (existing) {
			return existing;
		}
		const channel = this.createChannel(address);
		if (!channel) {
			return undefined;
		}
		const connection: MeshPeerConnection = {
			peerId,
			address,
			channel,
			open: false,
		};
		channel.onmessage = event => {
			void this._correlator.handleMessage(event.data);
		};
		channel.onopen = ({ open }) => {
			connection.open = open;
			this._onDidChangePeerConnection.fire(connection);
			if (open) {
				// Announce ourselves.
				this._correlator.emit('hello', { address }, peerId);
			}
		};
		// In-process channels open on microtask; WebSocket when socket opens.
		// If the channel has no onopen wiring support beyond our field, mark
		// in-process as open immediately when it is an InProcessMeshChannel.
		if (channel instanceof InProcessMeshChannel) {
			connection.open = true;
		}
		this._peers.set(peerId, connection);
		this._onDidChangePeerConnection.fire(connection);
		return connection;
	}

	/** Attach an already-created channel (e.g. hub endpoint for a node id). */
	attachPeerChannel(peerId: string, address: string, channel: ICognitiveMeshChannel, open = true): MeshPeerConnection {
		const existing = this._peers.get(peerId);
		if (existing) {
			existing.channel.close();
		}
		const connection: MeshPeerConnection = { peerId, address, channel, open };
		channel.onmessage = event => {
			void this._correlator.handleMessage(event.data);
		};
		channel.onopen = ({ open: isOpen }) => {
			connection.open = isOpen;
			this._onDidChangePeerConnection.fire(connection);
		};
		this._peers.set(peerId, connection);
		this._onDidChangePeerConnection.fire(connection);
		return connection;
	}

	disconnectPeer(peerId: string): void {
		const connection = this._peers.get(peerId);
		if (!connection) {
			return;
		}
		connection.channel.close();
		connection.open = false;
		this._peers.delete(peerId);
		this._onDidChangePeerConnection.fire(connection);
	}

	getPeer(peerId: string): MeshPeerConnection | undefined {
		return this._peers.get(peerId);
	}

	getPeers(): MeshPeerConnection[] {
		return Array.from(this._peers.values());
	}

	sendTo(peerId: string, type: 'event' | 'broadcast' | 'hello' | 'heartbeat', payload: unknown): boolean {
		const peer = this._peers.get(peerId);
		if (!peer) {
			return false;
		}
		const envelope: CognitiveMeshEnvelope = {
			type,
			id: generateUuid(),
			fromPeerId: this.localPeerId,
			toPeerId: peerId,
			timestamp: Date.now(),
			payload,
		};
		peer.channel.postMessage(envelope);
		return true;
	}

	broadcast(payload: unknown): void {
		const envelope: CognitiveMeshEnvelope = {
			type: 'broadcast',
			id: generateUuid(),
			fromPeerId: this.localPeerId,
			timestamp: Date.now(),
			payload,
		};
		for (const peer of this._peers.values()) {
			peer.channel.postMessage(envelope);
		}
		this._discoveryChannel?.postMessage(envelope);
	}

	request(peerId: string, op: string, args?: unknown, timeoutMs?: number): Promise<CognitiveMeshResponsePayload> {
		return this._correlator.request(peerId, op, args, timeoutMs);
	}

	registerHandler(op: string, handler: CognitiveMeshRequestHandler): IDisposable {
		return this._correlator.registerHandler(op, handler);
	}

	private _routeSend(envelope: CognitiveMeshEnvelope): void {
		if (envelope.toPeerId) {
			const peer = this._peers.get(envelope.toPeerId);
			if (peer) {
				peer.channel.postMessage(envelope);
				return;
			}
		}
		// Broadcast to all known peers + discovery when untargeted or peer missing.
		for (const peer of this._peers.values()) {
			if (!envelope.toPeerId || peer.peerId === envelope.toPeerId) {
				peer.channel.postMessage(envelope);
			}
		}
		if (!envelope.toPeerId || envelope.type === 'broadcast' || envelope.type === 'hello' || envelope.type === 'heartbeat') {
			this._discoveryChannel?.postMessage(envelope);
		}
	}

	override dispose(): void {
		for (const peer of this._peers.values()) {
			peer.channel.close();
		}
		this._peers.clear();
		this._discoveryChannel?.close();
		this._discoveryChannel = undefined;
		super.dispose();
	}
}
