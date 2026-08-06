/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICollaborationBackendService,
	ICollaborationChannel,
	CollaborationBackendConfig,
	CollaborationDocument,
	CollaborationFocus,
	CollaborationIdentity,
	CollaborationMessage,
	CollaborationParticipant,
	CollaborationPermission,
	CollaborationRole,
	CollaborationSession,
	CollaborationState,
	CollaborationTransportKind,
	CollaborationVote,
	CollaborationVoteResult,
	DEFAULT_COLLABORATION_CONFIG,
	roleHasPermission,
} from 'sql/workbench/services/zonecog/common/collaborationBackend';
import {
	TextOperation,
	applyOperation,
	composeOperations,
	parseTextOperation,
	replaceOperation,
	transformOperations,
	transformPosition,
} from 'sql/workbench/services/zonecog/common/collaborationOT';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/** BroadcastChannel name prefix for same-machine sessions. */
const CHANNEL_PREFIX = 'zonecog-collaboration-';

/** Node type used to persist session snapshots for recovery. */
const SESSION_SNAPSHOT_NODE_TYPE = 'CollaborationSessionSnapshot';

/** Bound on the per-document operation history retained for sequencing. */
const MAX_DOCUMENT_HISTORY = 500;

/** Bound on messages queued while a relay connection is being (re)established. */
const MAX_QUEUED_MESSAGES = 200;

/** Role granted to a participant who joins without being assigned one. */
const DEFAULT_JOIN_ROLE: CollaborationRole = 'editor';

/**
 * Generate a session code that is safe to share out of band.
 *
 * The code is the only credential needed to join a session, so its entropy must
 * come directly from the platform CSPRNG.
 */
function generateSessionCode(): string {
	const hex = generateSecureHex(6);
	return `ZC-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function generateSecureHex(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function generateSecureIdentifier(prefix: string): string {
	return `${prefix}-${generateSecureHex(16)}`;
}

/**
 * Accept session codes the way a user would type them.
 *
 * Separators and case are cosmetic, but the shape is not: a code that does
 * not name a real session would otherwise open an empty room of its own
 * rather than reporting a typo, so anything that is not a session code is
 * rejected outright.
 */
function normalizeSessionCode(code: string): string {
	const compact = code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
	const match = /^ZC([0-9A-F]{12})$/.exec(compact);
	if (!match) {
		return '';
	}
	const body = match[1];
	return `ZC-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * Per-document synchronization state.
 *
 * `outstanding` is the operation currently awaiting sequencing by the host
 * and `buffer` accumulates everything typed since; together they are the
 * client half of the operational transformation control algorithm. `history`
 * keeps the sequenced operations in server order so that this window can take
 * over sequencing if the host leaves.
 */
class DocumentSyncState {
	outstanding: TextOperation | undefined;
	outstandingId: string | undefined;
	buffer: TextOperation | undefined;
	bufferId: string | undefined;
	/** Sequenced operations, oldest first. */
	readonly history: TextOperation[] = [];
	/** Identities of the retained history entries, in the same order. */
	private readonly _sequencedIds: string[] = [];
	/** Revision the first retained history entry produced minus one. */
	historyBase = 0;

	constructor(public revision: number) {
		this.historyBase = revision;
	}

	record(operation: TextOperation, operationId: string): void {
		this.history.push(operation);
		this._sequencedIds.push(operationId);
		this.revision++;
		if (this.history.length > MAX_DOCUMENT_HISTORY) {
			this.history.shift();
			this._sequencedIds.shift();
			this.historyBase++;
		}
	}

	/** Whether this operation is already part of the retained server order. */
	hasSequenced(operationId: string): boolean {
		return this._sequencedIds.indexOf(operationId) !== -1;
	}

	/** Sequenced operations applied after `revision`, or undefined if trimmed away. */
	since(revision: number): TextOperation[] | undefined {
		if (revision > this.revision || revision < this.historyBase) {
			return undefined;
		}
		return this.history.slice(revision - this.historyBase);
	}

	pendingCount(): number {
		return (this.outstanding ? 1 : 0) + (this.buffer ? 1 : 0);
	}
}

/**
 * Real WebSocket channel to a collaboration relay.
 *
 * The relay is any endpoint that fans a session's messages out to the other
 * participants connected with the same session code; this class owns the
 * client half - connection lifecycle, send queueing while the socket opens,
 * and bounded exponential-backoff reconnection.
 */
class WebSocketCollaborationChannel implements ICollaborationChannel {

	onmessage: ((event: { data: unknown }) => void) | null = null;

	private _socket: WebSocket | undefined;
	private _queue: string[] = [];
	private _closed = false;
	private _attempts = 0;
	private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly url: string,
		private readonly reconnectDelayMs: number,
		private readonly maxReconnectAttempts: number,
		private readonly onStatusChange: (open: boolean) => void,
		private readonly logService: ILogService
	) {
		this._connect();
	}

	private _connect(): void {
		let socket: WebSocket;
		try {
			socket = new WebSocket(this.url);
		} catch (error) {
			this.logService.warn(`CollaborationBackendService: relay connection failed: ${error instanceof Error ? error.message : String(error)}`);
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
			this.onStatusChange(true);
		};

		socket.onmessage = event => {
			if (typeof event.data !== 'string') {
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(event.data);
			} catch {
				this.logService.warn('CollaborationBackendService: discarded malformed relay message');
				return;
			}
			this.onmessage?.({ data: parsed });
		};

		socket.onerror = () => {
			this.logService.warn('CollaborationBackendService: relay socket reported an error');
		};

		socket.onclose = () => {
			this.onStatusChange(false);
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
		const payload = JSON.stringify(message);
		if (this._socket && this._socket.readyState === 1 /* OPEN */) {
			this._socket.send(payload);
			return;
		}
		// Buffer until the socket opens so edits made during a reconnect are
		// not silently lost, but never without bound.
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
				// A socket that never opened throws on close; nothing to clean up.
			}
		}
	}
}

/** Snapshot persisted for session recovery. */
interface PersistedSession {
	sessionId: string;
	title: string;
	createdAt: number;
	role: CollaborationRole;
	documents: CollaborationDocument[];
	votes: CollaborationVote[];
	savedAt: number;
}

/**
 * Collaboration backend service.
 *
 * Carries Zone-Cog's cognitive workspaces across machines: a real transport
 * (WebSocket relay, or BroadcastChannel when no relay is configured), user
 * presence with cursor and cognitive focus, operational transformation over
 * shared documents sequenced by the session host, a role-based permission
 * model, and consensus voting.
 */
export class CollaborationBackendService extends Disposable implements ICollaborationBackendService {

	declare readonly _serviceBrand: undefined;

	private _config: CollaborationBackendConfig = { ...DEFAULT_COLLABORATION_CONFIG };
	private readonly _localUserId = generateSecureIdentifier('zonecog-user');

	private _session: CollaborationSession | undefined;
	private _channel: ICollaborationChannel | undefined;
	private _transportKind: CollaborationTransportKind = 'none';
	private _connected = false;
	private _localRole: CollaborationRole = 'observer';
	private _localJoinedAt = 0;
	private _localFocus: CollaborationFocus | undefined;

	private readonly _participants = new Map<string, CollaborationParticipant>();
	private readonly _documents = new Map<string, CollaborationDocument>();
	private readonly _sync = new Map<string, DocumentSyncState>();
	/** Sequenced operations received before their sender was known to host. */
	private readonly _deferred: Array<Extract<CollaborationMessage, { type: 'operation-applied' }>> = [];
	private readonly _votes = new Map<string, CollaborationVote>();
	private readonly _subChannels = new Map<string, Set<ICollaborationChannel>>();

	private _presenceTimer: ReturnType<typeof setInterval> | undefined;
	private _pendingJoin: { resolve: (session: CollaborationSession | undefined) => void; timer: ReturnType<typeof setTimeout> } | undefined;

	private readonly _onDidChangeState = this._register(new Emitter<CollaborationState>());
	readonly onDidChangeState: Event<CollaborationState> = this._onDidChangeState.event;

	private readonly _onDidChangeParticipants = this._register(new Emitter<CollaborationParticipant[]>());
	readonly onDidChangeParticipants: Event<CollaborationParticipant[]> = this._onDidChangeParticipants.event;

	private readonly _onDidChangeDocument = this._register(new Emitter<CollaborationDocument>());
	readonly onDidChangeDocument: Event<CollaborationDocument> = this._onDidChangeDocument.event;

	private readonly _onDidChangeVote = this._register(new Emitter<CollaborationVote>());
	readonly onDidChangeVote: Event<CollaborationVote> = this._onDidChangeVote.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
	}

	override dispose(): void {
		this.leaveSession();
		super.dispose();
	}

	// -- Configuration --------------------------------------------------------

	configure(config: Partial<CollaborationBackendConfig>): void {
		this._config = { ...this._config, ...config };
		const participant = this._participants.get(this._localUserId);
		if (participant) {
			participant.displayName = this._config.displayName;
			this._onDidChangeParticipants.fire(this.getParticipants());
		}
	}

	getConfig(): CollaborationBackendConfig {
		return { ...this._config };
	}

	getLocalIdentity(): CollaborationIdentity {
		return { userId: this._localUserId, displayName: this._config.displayName };
	}

	// -- Session lifecycle ----------------------------------------------------

	async createSession(title: string): Promise<CollaborationSession | undefined> {
		this.leaveSession();
		const sessionId = generateSessionCode();
		const session: CollaborationSession = {
			id: sessionId,
			title: title.trim() || 'Cognitive Workspace',
			createdAt: Date.now(),
			hostUserId: this._localUserId,
		};
		if (!this._openTransport(sessionId)) {
			return undefined;
		}
		this._enterSession(session, 'owner');
		this.logService.info(`CollaborationBackendService: created session ${sessionId} over ${this._transportKind} transport`);
		this._persistSnapshot();
		return session;
	}

	async joinSession(sessionId: string, role: CollaborationRole = DEFAULT_JOIN_ROLE): Promise<CollaborationSession | undefined> {
		const code = normalizeSessionCode(sessionId);
		if (!code) {
			return undefined;
		}
		this.leaveSession();
		if (!this._openTransport(code)) {
			return undefined;
		}
		// The host is not known until it answers, so start out sequencing
		// nothing and let the snapshot fill in the session metadata.
		const session: CollaborationSession = { id: code, title: code, createdAt: Date.now(), hostUserId: '' };
		this._enterSession(session, role === 'owner' ? DEFAULT_JOIN_ROLE : role);

		const answered = await new Promise<CollaborationSession | undefined>(resolve => {
			const timer = setTimeout(() => {
				this._pendingJoin = undefined;
				resolve(undefined);
			}, this._config.joinTimeoutMs);
			this._pendingJoin = { resolve, timer };
			this._post({ type: 'state-request', sessionId: code, userId: this._localUserId });
		});

		if (!answered) {
			this.logService.warn(`CollaborationBackendService: no host answered for session ${code}`);
			this.leaveSession();
			return undefined;
		}
		this.logService.info(`CollaborationBackendService: joined session ${code} over ${this._transportKind} transport`);
		this._persistSnapshot();
		return answered;
	}

	leaveSession(): void {
		if (!this._session) {
			return;
		}
		this._post({ type: 'leave', sessionId: this._session.id, userId: this._localUserId });
		this._persistSnapshot();

		if (this._pendingJoin) {
			clearTimeout(this._pendingJoin.timer);
			this._pendingJoin.resolve(undefined);
			this._pendingJoin = undefined;
		}
		if (this._presenceTimer !== undefined) {
			clearInterval(this._presenceTimer);
			this._presenceTimer = undefined;
		}
		for (const channels of this._subChannels.values()) {
			for (const channel of channels) {
				channel.onmessage = null;
			}
		}
		this._subChannels.clear();
		if (this._channel) {
			this._channel.onmessage = null;
			this._channel.close();
			this._channel = undefined;
		}

		this._session = undefined;
		this._transportKind = 'none';
		this._connected = false;
		this._localRole = 'observer';
		this._localFocus = undefined;
		this._participants.clear();
		this._documents.clear();
		this._sync.clear();
		this._deferred.length = 0;
		this._votes.clear();

		this.membraneService.recordActivity('somatic');
		this._onDidChangeParticipants.fire([]);
		this._onDidChangeState.fire(this.getState());
	}

	getState(): CollaborationState {
		let pending = 0;
		for (const sync of this._sync.values()) {
			pending += sync.pendingCount();
		}
		return {
			connected: this._connected,
			transport: this._transportKind,
			session: this._session ? { ...this._session } : undefined,
			localUserId: this._localUserId,
			localDisplayName: this._config.displayName,
			localRole: this._localRole,
			isHost: this._isHost(),
			participantCount: this._participants.size,
			pendingOperations: pending,
		};
	}

	getSession(): CollaborationSession | undefined {
		return this._session ? { ...this._session } : undefined;
	}

	// -- Participants ---------------------------------------------------------

	getParticipants(): CollaborationParticipant[] {
		return Array.from(this._participants.values()).map(participant => ({ ...participant }));
	}

	getParticipant(userId: string): CollaborationParticipant | undefined {
		const participant = this._participants.get(userId);
		return participant ? { ...participant } : undefined;
	}

	setParticipantRole(userId: string, role: CollaborationRole): boolean {
		if (!this._session || !this.hasPermission('session:manage')) {
			return false;
		}
		const participant = this._participants.get(userId);
		if (!participant || participant.role === role) {
			return false;
		}
		this._assignRole(userId, role);
		this._post({ type: 'role-changed', sessionId: this._session.id, userId: this._localUserId, targetUserId: userId, role });
		return true;
	}

	updateFocus(focus: Omit<CollaborationFocus, 'updatedAt'>): boolean {
		if (!this._session || !this.hasPermission('presence:share')) {
			return false;
		}
		this._localFocus = { ...focus, updatedAt: Date.now() };
		const participant = this._participants.get(this._localUserId);
		if (participant) {
			participant.focus = this._localFocus;
		}
		this._postPresence();
		this._onDidChangeParticipants.fire(this.getParticipants());
		return true;
	}

	hasPermission(permission: CollaborationPermission, userId?: string): boolean {
		if (!this._session) {
			return false;
		}
		const role = userId === undefined || userId === this._localUserId
			? this._localRole
			: this._participants.get(userId)?.role;
		return role !== undefined && roleHasPermission(role, permission);
	}

	// -- Shared documents -----------------------------------------------------

	createDocument(title: string, content: string = ''): CollaborationDocument | undefined {
		if (!this._session || !this.hasPermission('document:create')) {
			return undefined;
		}
		const document: CollaborationDocument = {
			id: generateSecureIdentifier('zonecog-document'),
			title: title.trim() || 'Untitled',
			content,
			revision: 0,
			updatedAt: Date.now(),
			lastEditedBy: this._localUserId,
		};
		this._installDocument(document);
		this._post({ type: 'document-created', sessionId: this._session.id, userId: this._localUserId, document: { ...document } });
		this.membraneService.recordActivity('cerebral');
		this._onDidChangeDocument.fire({ ...document });
		return { ...document };
	}

	getDocument(documentId: string): CollaborationDocument | undefined {
		const document = this._documents.get(documentId);
		return document ? { ...document } : undefined;
	}

	getDocuments(): CollaborationDocument[] {
		return Array.from(this._documents.values()).map(document => ({ ...document }));
	}

	applyLocalOperation(documentId: string, operation: TextOperation): boolean {
		const session = this._session;
		const document = this._documents.get(documentId);
		const sync = this._sync.get(documentId);
		if (!session || !document || !sync || !this.hasPermission('document:edit')) {
			return false;
		}
		let content: string;
		try {
			content = applyOperation(operation, document.content);
		} catch (error) {
			this.logService.warn(`CollaborationBackendService: rejected local operation: ${error instanceof Error ? error.message : String(error)}`);
			return false;
		}

		document.content = content;
		document.updatedAt = Date.now();
		document.lastEditedBy = this._localUserId;
		this._transformFocusPositions(documentId, operation);

		if (this._isHost()) {
			// The host sequences its own edits directly: they are, by
			// construction, based on the newest revision.
			const operationId = generateSecureIdentifier('zonecog-operation');
			sync.record(operation, operationId);
			document.revision = sync.revision;
			this._post({
				type: 'operation-applied',
				sessionId: session.id,
				userId: this._localUserId,
				documentId,
				revision: sync.revision,
				authorUserId: this._localUserId,
				operationId,
				operation,
			});
		} else if (!sync.outstanding) {
			sync.outstanding = operation;
			sync.outstandingId = generateSecureIdentifier('zonecog-operation');
			this._post({
				type: 'operation',
				sessionId: session.id,
				userId: this._localUserId,
				documentId,
				baseRevision: sync.revision,
				operationId: sync.outstandingId,
				operation,
			});
		} else {
			// One operation may be in flight at a time; everything typed since
			// is composed into a single follow-up.
			sync.buffer = sync.buffer ? composeOperations(sync.buffer, operation) : operation;
			if (!sync.bufferId) {
				sync.bufferId = generateSecureIdentifier('zonecog-operation');
			}
		}

		this.membraneService.recordActivity('cerebral');
		this._onDidChangeDocument.fire({ ...document });
		this._onDidChangeState.fire(this.getState());
		return true;
	}

	editDocument(documentId: string, position: number, deleteCount: number, insertText: string): boolean {
		const document = this._documents.get(documentId);
		if (!document) {
			return false;
		}
		return this.applyLocalOperation(documentId, replaceOperation(document.content.length, position, deleteCount, insertText));
	}

	// -- Decisions ------------------------------------------------------------

	createVote(topic: string, options: string[]): CollaborationVote | undefined {
		const session = this._session;
		const trimmedTopic = topic.trim();
		const trimmedOptions = options.map(option => option.trim()).filter(option => option.length > 0);
		if (!session || !trimmedTopic || trimmedOptions.length < 2 || !this.hasPermission('vote:create')) {
			return undefined;
		}
		const vote: CollaborationVote = {
			id: generateSecureIdentifier('zonecog-vote'),
			topic: trimmedTopic,
			options: trimmedOptions,
			createdBy: this._localUserId,
			createdAt: Date.now(),
			ballots: {},
			closed: false,
		};
		this._votes.set(vote.id, vote);
		this._post({ type: 'vote-opened', sessionId: session.id, userId: this._localUserId, vote: { ...vote, ballots: {} } });
		this.membraneService.recordActivity('cerebral');
		this._onDidChangeVote.fire({ ...vote });
		return { ...vote };
	}

	castVote(voteId: string, option: string): boolean {
		const session = this._session;
		const vote = this._votes.get(voteId);
		if (!session || !vote || vote.closed || vote.options.indexOf(option) === -1 || !this.hasPermission('vote:cast')) {
			return false;
		}
		vote.ballots[this._localUserId] = option;
		this._post({ type: 'vote-cast', sessionId: session.id, userId: this._localUserId, voteId, option });
		this._onDidChangeVote.fire({ ...vote });
		return true;
	}

	closeVote(voteId: string): CollaborationVoteResult | undefined {
		const session = this._session;
		const vote = this._votes.get(voteId);
		if (!session || !vote || vote.closed) {
			return undefined;
		}
		if (vote.createdBy !== this._localUserId && !this.hasPermission('session:manage')) {
			return undefined;
		}
		const result = this._tally(vote);
		vote.closed = true;
		vote.result = result;
		this._post({ type: 'vote-closed', sessionId: session.id, userId: this._localUserId, voteId, result });
		this.membraneService.recordActivity('cerebral');
		this._persistSnapshot();
		this._onDidChangeVote.fire({ ...vote });
		return result;
	}

	getVotes(): CollaborationVote[] {
		return Array.from(this._votes.values())
			.sort((a, b) => a.createdAt - b.createdAt)
			.map(vote => ({ ...vote, ballots: { ...vote.ballots } }));
	}

	tallyVote(voteId: string): CollaborationVoteResult | undefined {
		const vote = this._votes.get(voteId);
		return vote ? (vote.result ?? this._tally(vote)) : undefined;
	}

	private _tally(vote: CollaborationVote): CollaborationVoteResult {
		const tally: Record<string, number> = {};
		for (const option of vote.options) {
			tally[option] = 0;
		}
		let ballotCount = 0;
		for (const option of Object.values(vote.ballots)) {
			if (option in tally) {
				tally[option]++;
				ballotCount++;
			}
		}
		let winningOption: string | undefined;
		let best = 0;
		let tied = false;
		for (const option of vote.options) {
			if (tally[option] > best) {
				best = tally[option];
				winningOption = option;
				tied = false;
			} else if (tally[option] === best && best > 0) {
				tied = true;
			}
		}
		const electorate = Array.from(this._participants.values()).filter(participant => participant.online).length;
		return {
			tally,
			winningOption: tied ? undefined : winningOption,
			turnout: electorate > 0 ? ballotCount / electorate : 0,
			consensus: ballotCount > 0 && !tied && best === ballotCount,
			decidedAt: Date.now(),
		};
	}

	// -- Sub-channels ---------------------------------------------------------

	createChannel(name: string): ICollaborationChannel | undefined {
		if (!this._session) {
			return undefined;
		}
		let channels = this._subChannels.get(name);
		if (!channels) {
			channels = new Set<ICollaborationChannel>();
			this._subChannels.set(name, channels);
		}
		const registry = channels;
		const channel: ICollaborationChannel = {
			onmessage: null,
			postMessage: (message: unknown) => {
				const session = this._session;
				if (session) {
					this._post({ type: 'relay', sessionId: session.id, userId: this._localUserId, channel: name, payload: message });
				}
			},
			close: () => {
				channel.onmessage = null;
				registry.delete(channel);
			},
		};
		registry.add(channel);
		return channel;
	}

	// -- Persistence and recovery --------------------------------------------

	async recoverSession(): Promise<CollaborationSession | undefined> {
		const persisted = this._readLatestSnapshot();
		if (!persisted) {
			return undefined;
		}
		// Prefer the live session: if anyone is still hosting, their state is
		// newer than anything this window wrote before it went away.
		const rejoined = await this.joinSession(persisted.sessionId, persisted.role);
		if (rejoined) {
			return rejoined;
		}
		// Nobody is left hosting, so restore the snapshot and host it again.
		if (!this._openTransport(persisted.sessionId)) {
			return undefined;
		}
		const session: CollaborationSession = {
			id: persisted.sessionId,
			title: persisted.title,
			createdAt: persisted.createdAt,
			hostUserId: this._localUserId,
		};
		this._enterSession(session, 'owner');
		for (const document of persisted.documents) {
			this._installDocument({ ...document });
		}
		for (const vote of persisted.votes) {
			this._votes.set(vote.id, { ...vote, ballots: { ...vote.ballots } });
		}
		this.logService.info(`CollaborationBackendService: recovered session ${persisted.sessionId} with ${persisted.documents.length} document(s)`);
		this._persistSnapshot();
		for (const document of this._documents.values()) {
			this._onDidChangeDocument.fire({ ...document });
		}
		return session;
	}

	private _persistSnapshot(): void {
		const session = this._session;
		if (!session) {
			return;
		}
		const snapshot: PersistedSession = {
			sessionId: session.id,
			title: session.title,
			createdAt: session.createdAt,
			role: this._localRole,
			documents: this.getDocuments(),
			votes: this.getVotes(),
			savedAt: Date.now(),
		};
		const existing = this.hypergraphStore.getNodesByType(SESSION_SNAPSHOT_NODE_TYPE)
			.find(node => node.metadata['sessionId'] === session.id);
		const content = `Collaboration session "${session.title}" (${session.id}) with ${snapshot.documents.length} document(s) and ${snapshot.votes.length} decision(s)`;
		if (existing) {
			this.hypergraphStore.updateNode(existing.id, {
				content,
				metadata: { ...snapshot, snapshot: JSON.stringify(snapshot) },
				salience_score: 0.5,
			});
			return;
		}
		this.hypergraphStore.addNode({
			node_type: SESSION_SNAPSHOT_NODE_TYPE,
			content,
			links: [],
			metadata: { ...snapshot, snapshot: JSON.stringify(snapshot) },
			salience_score: 0.5,
		});
	}

	private _readLatestSnapshot(): PersistedSession | undefined {
		let latest: PersistedSession | undefined;
		for (const node of this.hypergraphStore.getNodesByType(SESSION_SNAPSHOT_NODE_TYPE)) {
			const raw = node.metadata['snapshot'];
			if (typeof raw !== 'string') {
				continue;
			}
			let parsed: PersistedSession;
			try {
				parsed = JSON.parse(raw) as PersistedSession;
			} catch {
				continue;
			}
			if (typeof parsed?.sessionId !== 'string' || !Array.isArray(parsed.documents)) {
				continue;
			}
			if (!latest || parsed.savedAt > latest.savedAt) {
				latest = parsed;
			}
		}
		return latest;
	}

	// -- Session plumbing -----------------------------------------------------

	private _enterSession(session: CollaborationSession, role: CollaborationRole): void {
		this._session = session;
		this._localRole = role;
		this._localJoinedAt = Date.now();
		this._participants.set(this._localUserId, {
			userId: this._localUserId,
			displayName: this._config.displayName,
			role,
			joinedAt: this._localJoinedAt,
			lastSeenAt: this._localJoinedAt,
			online: true,
			isHost: session.hostUserId === this._localUserId,
		});
		this._postPresence();
		this._startPresenceTimer();
		this.membraneService.recordActivity('somatic');
		this._onDidChangeParticipants.fire(this.getParticipants());
		this._onDidChangeState.fire(this.getState());
	}

	private _startPresenceTimer(): void {
		if (this._presenceTimer !== undefined) {
			clearInterval(this._presenceTimer);
			this._presenceTimer = undefined;
		}
		if (this._config.presenceIntervalMs <= 0) {
			return;
		}
		this._presenceTimer = setInterval(() => {
			this._postPresence();
			this._pruneParticipants();
		}, this._config.presenceIntervalMs);
	}

	private _postPresence(): void {
		const session = this._session;
		if (!session) {
			return;
		}
		this._post({
			type: 'presence',
			sessionId: session.id,
			userId: this._localUserId,
			displayName: this._config.displayName,
			role: this._localRole,
			joinedAt: this._localJoinedAt,
			focus: this._localFocus,
		});
	}

	/** Mark participants that stopped signalling as offline and re-derive the host. */
	private _pruneParticipants(): void {
		const cutoff = Date.now() - this._config.participantTimeoutMs;
		let changed = false;
		for (const participant of this._participants.values()) {
			if (participant.userId === this._localUserId) {
				continue;
			}
			if (participant.online && participant.lastSeenAt < cutoff) {
				participant.online = false;
				changed = true;
			}
		}
		if (changed) {
			this.membraneService.recordActivity('autonomic');
			this._recomputeHost();
			this._onDidChangeParticipants.fire(this.getParticipants());
		}
	}

	/**
	 * Derive the session host from the participant list.
	 *
	 * The longest-present online participant sequences operations, with the
	 * user id breaking ties. Because every participant runs the same rule over
	 * the same announced join times, hosting survives the host disconnecting
	 * without an election protocol - and cannot be seized by a peer simply
	 * declaring itself the host.
	 */
	private _recomputeHost(): void {
		const session = this._session;
		if (!session) {
			return;
		}
		// A participant that has not yet been admitted knows nothing about the
		// session, so it must not decide it is hosting one.
		if (this._pendingJoin) {
			return;
		}
		const incumbent = session.hostUserId ? this._participants.get(session.hostUserId) : undefined;
		let host = incumbent?.online ? incumbent : undefined;
		if (!host) {
			// The host is gone, so every remaining participant elects the same
			// successor: the longest-standing one, with the user id breaking a
			// tie so peers cannot disagree.
			for (const participant of this._participants.values()) {
				if (!participant.online) {
					continue;
				}
				if (!host
					|| participant.joinedAt < host.joinedAt
					|| (participant.joinedAt === host.joinedAt && participant.userId < host.userId)) {
					host = participant;
				}
			}
		}
		const hostUserId = host?.userId ?? '';
		for (const participant of this._participants.values()) {
			participant.isHost = participant.userId === hostUserId;
		}
		if (session.hostUserId === hostUserId) {
			return;
		}
		session.hostUserId = hostUserId;
		if (hostUserId === this._localUserId) {
			// Taking over sequencing requires the authority to manage the
			// session, otherwise role changes could never be made again.
			this._localRole = 'owner';
			const local = this._participants.get(this._localUserId);
			if (local) {
				local.role = 'owner';
			}
			this.logService.info(`CollaborationBackendService: took over hosting session ${session.id}`);
			this._sequencePendingAsHost();
			// Peers may still be holding edits submitted to the previous host,
			// and may have noticed its departure before this window did. Asking
			// them to resubmit closes that window regardless of the order the
			// departure reached each of them.
			this._post({ type: 'host-changed', sessionId: session.id, userId: this._localUserId });
		} else if (hostUserId) {
			this._resubmitPendingToHost();
		}
		this._replayDeferredOperations(hostUserId);
		this._onDidChangeState.fire(this.getState());
	}

	/**
	 * Publish edits that were in flight when this window took over hosting.
	 *
	 * They were submitted to a host that is now gone, so their acknowledgement
	 * is never coming. The local replica already contains them, and no peer
	 * does, so sequencing them here is what stops the replicas diverging.
	 */
	private _sequencePendingAsHost(): void {
		const session = this._session;
		if (!session) {
			return;
		}
		for (const [documentId, sync] of this._sync) {
			const outstanding = sync.outstanding;
			const buffer = sync.buffer;
			const outstandingId = sync.outstandingId;
			const bufferId = sync.bufferId;
			sync.outstanding = undefined;
			sync.buffer = undefined;
			sync.outstandingId = undefined;
			sync.bufferId = undefined;
			const document = this._documents.get(documentId);
			if (!document || (!outstanding && !buffer)) {
				continue;
			}
			let pending: TextOperation;
			try {
				pending = outstanding && buffer ? composeOperations(outstanding, buffer) : (outstanding ?? buffer)!;
			} catch (error) {
				this.logService.warn(`CollaborationBackendService: could not sequence pending edits on ${documentId}: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			// Composing two pending edits produces a new operation, so it needs
			// an identity of its own; a lone edit keeps the one it was already
			// submitted under so that it is recognisably the same operation.
			const operationId = outstanding && buffer ? generateSecureIdentifier('zonecog-operation') : (outstandingId ?? bufferId ?? generateSecureIdentifier('zonecog-operation'));
			sync.record(pending, operationId);
			document.revision = sync.revision;
			document.updatedAt = Date.now();
			document.lastEditedBy = this._localUserId;
			this._post({
				type: 'operation-applied',
				sessionId: session.id,
				userId: this._localUserId,
				documentId,
				revision: sync.revision,
				authorUserId: this._localUserId,
				operationId,
				operation: pending,
			});
			this._onDidChangeDocument.fire({ ...document });
		}
	}

	/**
	 * Apply held operations now that the host is settled.
	 *
	 * Anything from a participant that did not become the host was not the
	 * session's to apply, so it is dropped rather than replayed.
	 */
	private _replayDeferredOperations(hostUserId: string): void {
		if (this._deferred.length === 0) {
			return;
		}
		const held = this._deferred.splice(0, this._deferred.length);
		if (!hostUserId || hostUserId === this._localUserId) {
			return;
		}
		for (const message of held) {
			if (message.userId === hostUserId) {
				this._onSequencedOperation(message);
			}
		}
	}

	/**
	 * Answer a new host's request for unacknowledged work.
	 *
	 * The sender is taken at its word only if this window had already derived
	 * the same host, so the message cannot be used to divert edits.
	 */
	private _onHostChanged(message: Extract<CollaborationMessage, { type: 'host-changed' }>): void {
		if (this._session?.hostUserId !== message.userId) {
			return;
		}
		this._resubmitPendingToHost();
	}

	/**
	 * Resend in-flight edits to a host that has just taken over.
	 *
	 * The acknowledgement from the previous host is never arriving, so without
	 * this the edit would stay pending forever and only ever exist on this
	 * replica. The stable operation identity is what lets the new host tell a
	 * genuine resend apart from one it has already sequenced.
	 */
	private _resubmitPendingToHost(): void {
		const session = this._session;
		if (!session) {
			return;
		}
		for (const [documentId, sync] of this._sync) {
			if (!sync.outstanding || !sync.outstandingId) {
				continue;
			}
			this._post({
				type: 'operation',
				sessionId: session.id,
				userId: this._localUserId,
				documentId,
				baseRevision: sync.revision,
				operationId: sync.outstandingId,
				operation: sync.outstanding,
			});
		}
	}

	private _isHost(): boolean {
		return this._session !== undefined && this._session.hostUserId === this._localUserId;
	}

	private _installDocument(document: CollaborationDocument): void {
		this._documents.set(document.id, document);
		this._sync.set(document.id, new DocumentSyncState(document.revision));
	}

	private _assignRole(userId: string, role: CollaborationRole): void {
		const participant = this._participants.get(userId);
		if (participant) {
			participant.role = role;
		}
		if (userId === this._localUserId) {
			this._localRole = role;
			this._onDidChangeState.fire(this.getState());
		}
		this._onDidChangeParticipants.fire(this.getParticipants());
	}

	// -- Transport ------------------------------------------------------------

	private _openTransport(sessionId: string): boolean {
		const transport = this._createTransport(sessionId);
		if (!transport) {
			this.logService.warn('CollaborationBackendService: no collaboration transport is available in this environment');
			this._transportKind = 'none';
			this._connected = false;
			return false;
		}
		this._channel = transport.channel;
		this._transportKind = transport.kind;
		this._connected = true;
		this._channel.onmessage = event => this._onMessage(event.data);
		return true;
	}

	/**
	 * Open the transport for a session.
	 *
	 * A configured relay URL gives cross-machine collaboration; without one,
	 * the same-machine BroadcastChannel still connects every Zone-Cog window
	 * on this host. Overridable so tests can supply their own channel.
	 */
	protected _createTransport(sessionId: string): { channel: ICollaborationChannel; kind: CollaborationTransportKind } | undefined {
		const relayUrl = this._config.relayUrl;
		if (relayUrl) {
			const channel = this._createWebSocketChannel(relayUrl, sessionId);
			if (channel) {
				return { channel, kind: 'websocket' };
			}
		}
		const channel = this._createBroadcastChannel(CHANNEL_PREFIX + sessionId);
		return channel ? { channel, kind: 'broadcast' } : undefined;
	}

	private _createWebSocketChannel(relayUrl: string, sessionId: string): ICollaborationChannel | undefined {
		if (typeof WebSocket === 'undefined') {
			return undefined;
		}
		const url = this._buildRelayUrl(relayUrl, sessionId);
		if (!url) {
			this.logService.warn(`CollaborationBackendService: ignoring relay URL "${relayUrl}" - only ws: and wss: endpoints are supported`);
			return undefined;
		}
		return new WebSocketCollaborationChannel(
			url,
			this._config.reconnectDelayMs,
			this._config.maxReconnectAttempts,
			open => this._onTransportStatus(open),
			this.logService
		);
	}

	/**
	 * Build the relay endpoint for a session, rejecting anything that is not
	 * a WebSocket URL so a mistyped or hostile configuration value cannot
	 * redirect session traffic to another protocol.
	 */
	private _buildRelayUrl(relayUrl: string, sessionId: string): string | undefined {
		let parsed: URL;
		try {
			parsed = new URL(relayUrl);
		} catch {
			return undefined;
		}
		if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
			return undefined;
		}
		parsed.searchParams.set('session', sessionId);
		return parsed.toString();
	}

	private _createBroadcastChannel(name: string): ICollaborationChannel | undefined {
		if (typeof BroadcastChannel === 'undefined') {
			return undefined;
		}
		const raw = new BroadcastChannel(name);
		const channel: ICollaborationChannel = {
			onmessage: null,
			postMessage: message => raw.postMessage(message),
			close: () => raw.close(),
		};
		raw.onmessage = event => channel.onmessage?.({ data: event.data });
		return channel;
	}

	private _onTransportStatus(open: boolean): void {
		if (this._connected === open) {
			return;
		}
		this._connected = open;
		if (open && this._session) {
			// Re-announce after a reconnect so peers stop counting this window
			// as gone, and re-sync in case edits were sequenced while away.
			this._postPresence();
			if (!this._isHost()) {
				this._post({ type: 'state-request', sessionId: this._session.id, userId: this._localUserId });
			}
		}
		this.membraneService.recordActivity('somatic');
		this._onDidChangeState.fire(this.getState());
	}

	private _post(message: CollaborationMessage): void {
		if (!this._channel) {
			return;
		}
		try {
			this._channel.postMessage(message);
		} catch (error) {
			this.logService.warn(`CollaborationBackendService: failed to post message: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	// -- Inbound messages -----------------------------------------------------

	private _onMessage(data: unknown): void {
		const session = this._session;
		if (!session || typeof data !== 'object' || data === null) {
			return;
		}
		const message = data as CollaborationMessage;
		if (typeof message.type !== 'string' || message.sessionId !== session.id) {
			return;
		}
		if (typeof message.userId !== 'string' || message.userId === this._localUserId) {
			return;
		}

		switch (message.type) {
			case 'presence':
				this._onPresence(message);
				break;
			case 'leave':
				this._onLeave(message.userId);
				break;
			case 'state-request':
				this._onStateRequest(message.userId);
				break;
			case 'state-snapshot':
				this._onStateSnapshot(message);
				break;
			case 'host-changed':
				this._onHostChanged(message);
				break;
			case 'operation':
				this._onRemoteOperation(message);
				break;
			case 'operation-applied':
				this._onSequencedOperation(message);
				break;
			case 'document-created':
				this._onDocumentCreated(message);
				break;
			case 'role-changed':
				this._onRoleChanged(message);
				break;
			case 'vote-opened':
				this._onVoteOpened(message);
				break;
			case 'vote-cast':
				this._onVoteCast(message);
				break;
			case 'vote-closed':
				this._onVoteClosed(message);
				break;
			case 'relay':
				this._onRelay(message);
				break;
		}
	}

	private _onPresence(message: Extract<CollaborationMessage, { type: 'presence' }>): void {
		const session = this._session;
		if (!session || typeof message.displayName !== 'string' || typeof message.joinedAt !== 'number') {
			return;
		}
		const existing = this._participants.get(message.userId);
		if (existing) {
			existing.displayName = message.displayName;
			existing.lastSeenAt = Date.now();
			existing.online = true;
			existing.focus = message.focus;
		} else {
			// A peer announces the role it would like; the host is the only one
			// that can grant more than the default, and broadcasts the decision.
			const requested = this._isKnownRole(message.role) && message.role !== 'owner' ? message.role : DEFAULT_JOIN_ROLE;
			this._participants.set(message.userId, {
				userId: message.userId,
				displayName: message.displayName,
				role: requested,
				joinedAt: message.joinedAt,
				lastSeenAt: Date.now(),
				online: true,
				isHost: false,
				focus: message.focus,
			});
			// Answer a participant we have not met so both sides become aware
			// of each other immediately. Only unknown senders get a reply, so
			// the exchange terminates instead of echoing forever.
			this._postPresence();
			if (this._isHost()) {
				this._post({ type: 'role-changed', sessionId: session.id, userId: this._localUserId, targetUserId: message.userId, role: requested });
			}
		}
		this._recomputeHost();
		this._onDidChangeParticipants.fire(this.getParticipants());
	}

	private _isKnownRole(role: unknown): role is CollaborationRole {
		return role === 'owner' || role === 'editor' || role === 'commenter' || role === 'observer';
	}

	private _onLeave(userId: string): void {
		if (!this._participants.delete(userId)) {
			return;
		}
		this._recomputeHost();
		this.membraneService.recordActivity('somatic');
		this._onDidChangeParticipants.fire(this.getParticipants());
	}

	private _onStateRequest(userId: string): void {
		const session = this._session;
		if (!session || !this._isHost()) {
			return;
		}
		// Announce first: the joiner needs to know who is hosting before it can
		// tell an authoritative sequenced operation from an impostor's.
		this._postPresence();
		const roles: Record<string, CollaborationRole> = {};
		for (const participant of this._participants.values()) {
			roles[participant.userId] = participant.role;
		}
		this._post({
			type: 'state-snapshot',
			sessionId: session.id,
			userId: this._localUserId,
			targetUserId: userId,
			title: session.title,
			createdAt: session.createdAt,
			documents: this.getDocuments(),
			roles,
			votes: this.getVotes(),
		});
	}

	private _onStateSnapshot(message: Extract<CollaborationMessage, { type: 'state-snapshot' }>): void {
		const session = this._session;
		if (!session || message.targetUserId !== this._localUserId || !Array.isArray(message.documents)) {
			return;
		}
		session.title = typeof message.title === 'string' ? message.title : session.title;
		session.createdAt = typeof message.createdAt === 'number' ? message.createdAt : session.createdAt;
		// Only the host answers a state request, so the peer that admitted us
		// is by definition the one sequencing this session.
		session.hostUserId = message.userId;

		this._documents.clear();
		this._sync.clear();
		// The snapshot is authoritative, so anything held from before it is
		// either already reflected in it or was never the session's to apply.
		this._deferred.length = 0;
		for (const document of message.documents) {
			if (typeof document?.id === 'string' && typeof document.content === 'string' && typeof document.revision === 'number') {
				this._installDocument({ ...document });
			}
		}
		this._votes.clear();
		if (Array.isArray(message.votes)) {
			for (const vote of message.votes) {
				if (typeof vote?.id === 'string' && Array.isArray(vote.options)) {
					this._votes.set(vote.id, { ...vote, ballots: { ...vote.ballots } });
				}
			}
		}
		if (message.roles && typeof message.roles === 'object') {
			for (const [userId, role] of Object.entries(message.roles)) {
				if (this._isKnownRole(role)) {
					const participant = this._participants.get(userId);
					if (participant) {
						participant.role = role;
					}
					if (userId === this._localUserId) {
						this._localRole = role;
					}
				}
			}
		}
		const pending = this._pendingJoin;
		this._pendingJoin = undefined;
		if (pending) {
			clearTimeout(pending.timer);
		}
		this._recomputeHost();
		pending?.resolve({ ...session });

		for (const document of this._documents.values()) {
			this._onDidChangeDocument.fire({ ...document });
		}
		this._onDidChangeParticipants.fire(this.getParticipants());
		this._onDidChangeState.fire(this.getState());
	}

	private _onDocumentCreated(message: Extract<CollaborationMessage, { type: 'document-created' }>): void {
		const document = message.document;
		if (!document || typeof document.id !== 'string' || typeof document.content !== 'string') {
			return;
		}
		if (this._documents.has(document.id) || !this.hasPermission('document:create', message.userId)) {
			return;
		}
		this._installDocument({ ...document, revision: typeof document.revision === 'number' ? document.revision : 0 });
		this._onDidChangeDocument.fire({ ...document });
	}

	/**
	 * Sequence an operation submitted by another participant.
	 *
	 * Only the host runs this. The operation was written against
	 * `baseRevision`, so it is transformed forward over everything sequenced
	 * since before being applied and broadcast - that transformation is what
	 * resolves simultaneous edits rather than dropping one of them.
	 */
	private _onRemoteOperation(message: Extract<CollaborationMessage, { type: 'operation' }>): void {
		const session = this._session;
		const document = this._documents.get(message.documentId);
		const sync = this._sync.get(message.documentId);
		if (!session || !this._isHost() || !document || !sync) {
			return;
		}
		if (!this.hasPermission('document:edit', message.userId)) {
			this.logService.warn(`CollaborationBackendService: rejected operation from ${message.userId} without edit permission`);
			return;
		}
		const parsed = parseTextOperation(message.operation);
		if (!parsed || typeof message.baseRevision !== 'number' || typeof message.operationId !== 'string' || !message.operationId) {
			this.logService.warn('CollaborationBackendService: discarded malformed operation');
			return;
		}
		if (sync.hasSequenced(message.operationId)) {
			// A resend that crossed a change of host: this operation is already
			// in the server order, so applying it again would duplicate the
			// edit. The submitter is brought back in line with a snapshot.
			this._onStateRequest(message.userId);
			return;
		}
		const concurrent = sync.since(message.baseRevision);
		if (!concurrent) {
			// The submitter is further behind than the retained history, so it
			// cannot be caught up by transformation; resend the full state.
			this._onStateRequest(message.userId);
			return;
		}
		let operation = parsed;
		try {
			for (const applied of concurrent) {
				operation = transformOperations(operation, applied)[0];
			}
			document.content = applyOperation(operation, document.content);
		} catch (error) {
			this.logService.warn(`CollaborationBackendService: could not sequence operation: ${error instanceof Error ? error.message : String(error)}`);
			this._onStateRequest(message.userId);
			return;
		}
		sync.record(operation, message.operationId);
		document.revision = sync.revision;
		document.updatedAt = Date.now();
		document.lastEditedBy = message.userId;
		this._transformFocusPositions(message.documentId, operation);

		this._post({
			type: 'operation-applied',
			sessionId: session.id,
			userId: this._localUserId,
			documentId: message.documentId,
			revision: sync.revision,
			authorUserId: message.userId,
			operationId: message.operationId,
			operation,
		});
		this._onDidChangeDocument.fire({ ...document });
		this._onDidChangeParticipants.fire(this.getParticipants());
	}

	/**
	 * Apply an operation the host has sequenced.
	 *
	 * When it is this window's own operation coming back, it is the
	 * acknowledgement: the local replica already contains it, so only the
	 * pending queue advances. Otherwise the operation is transformed past
	 * whatever this window has in flight before being applied, which is what
	 * keeps every replica converging on identical content.
	 */
	private _onSequencedOperation(message: Extract<CollaborationMessage, { type: 'operation-applied' }>): void {
		const session = this._session;
		const document = this._documents.get(message.documentId);
		const sync = this._sync.get(message.documentId);
		if (!session || !document || !sync || typeof message.revision !== 'number') {
			return;
		}
		if (message.userId !== session.hostUserId) {
			// Either a peer forging sequencing, or the new host getting here
			// before the notice that the old one left. Holding the message
			// instead of dropping it lets the election decide which: it is
			// replayed only if the sender turns out to be the host, so a forged
			// operation is still never applied.
			this._deferred.push(message);
			if (this._deferred.length > MAX_QUEUED_MESSAGES) {
				this._deferred.shift();
			}
			return;
		}
		const parsed = parseTextOperation(message.operation);
		if (!parsed || typeof message.operationId !== 'string' || !message.operationId) {
			this.logService.warn('CollaborationBackendService: discarded malformed sequenced operation');
			return;
		}
		if (message.revision !== sync.revision + 1) {
			// A sequenced operation was missed. Transformation can only carry a
			// replica forward from the revision it actually holds, so the honest
			// repair is to take a fresh snapshot rather than apply out of order.
			this.logService.warn(`CollaborationBackendService: revision gap on document ${message.documentId} (expected ${sync.revision + 1}, received ${message.revision})`);
			this._post({ type: 'state-request', sessionId: session.id, userId: this._localUserId });
			return;
		}

		if (message.authorUserId === this._localUserId) {
			sync.record(parsed, message.operationId);
			document.revision = sync.revision;
			sync.outstanding = sync.buffer;
			sync.outstandingId = sync.bufferId;
			sync.buffer = undefined;
			sync.bufferId = undefined;
			if (sync.outstanding && sync.outstandingId) {
				this._post({
					type: 'operation',
					sessionId: session.id,
					userId: this._localUserId,
					documentId: message.documentId,
					baseRevision: sync.revision,
					operationId: sync.outstandingId,
					operation: sync.outstanding,
				});
			}
			this._onDidChangeState.fire(this.getState());
			return;
		}

		let operation = parsed;
		try {
			if (sync.outstanding) {
				const [outstanding, transformed] = transformOperations(sync.outstanding, operation);
				sync.outstanding = outstanding;
				operation = transformed;
			}
			if (sync.buffer) {
				const [buffer, transformed] = transformOperations(sync.buffer, operation);
				sync.buffer = buffer;
				operation = transformed;
			}
			document.content = applyOperation(operation, document.content);
		} catch (error) {
			this.logService.warn(`CollaborationBackendService: could not apply sequenced operation: ${error instanceof Error ? error.message : String(error)}`);
			this._post({ type: 'state-request', sessionId: session.id, userId: this._localUserId });
			return;
		}
		sync.record(parsed, message.operationId);
		document.revision = sync.revision;
		document.updatedAt = Date.now();
		document.lastEditedBy = message.authorUserId;
		this._transformFocusPositions(message.documentId, operation);
		this._onDidChangeDocument.fire({ ...document });
		this._onDidChangeParticipants.fire(this.getParticipants());
	}

	/** Keep shared cursors anchored to the text they pointed at. */
	private _transformFocusPositions(documentId: string, operation: TextOperation): void {
		for (const participant of this._participants.values()) {
			const focus = participant.focus;
			if (!focus || focus.documentId !== documentId) {
				continue;
			}
			participant.focus = {
				...focus,
				anchor: transformPosition(operation, focus.anchor),
				head: transformPosition(operation, focus.head),
			};
			if (participant.userId === this._localUserId) {
				this._localFocus = participant.focus;
			}
		}
	}

	private _onRoleChanged(message: Extract<CollaborationMessage, { type: 'role-changed' }>): void {
		if (!this._isKnownRole(message.role) || typeof message.targetUserId !== 'string') {
			return;
		}
		if (!this.hasPermission('session:manage', message.userId)) {
			this.logService.warn(`CollaborationBackendService: ignored role change from ${message.userId} without manage permission`);
			return;
		}
		this._assignRole(message.targetUserId, message.role);
	}

	private _onVoteOpened(message: Extract<CollaborationMessage, { type: 'vote-opened' }>): void {
		const vote = message.vote;
		if (!vote || typeof vote.id !== 'string' || !Array.isArray(vote.options) || vote.options.length < 2) {
			return;
		}
		if (this._votes.has(vote.id) || !this.hasPermission('vote:create', message.userId)) {
			return;
		}
		this._votes.set(vote.id, { ...vote, createdBy: message.userId, ballots: {}, closed: false, result: undefined });
		this._onDidChangeVote.fire({ ...this._votes.get(vote.id)! });
	}

	private _onVoteCast(message: Extract<CollaborationMessage, { type: 'vote-cast' }>): void {
		const vote = this._votes.get(message.voteId);
		if (!vote || vote.closed || vote.options.indexOf(message.option) === -1) {
			return;
		}
		if (!this.hasPermission('vote:cast', message.userId)) {
			this.logService.warn(`CollaborationBackendService: ignored ballot from ${message.userId} without vote permission`);
			return;
		}
		vote.ballots[message.userId] = message.option;
		this._onDidChangeVote.fire({ ...vote, ballots: { ...vote.ballots } });
	}

	private _onVoteClosed(message: Extract<CollaborationMessage, { type: 'vote-closed' }>): void {
		const vote = this._votes.get(message.voteId);
		if (!vote || vote.closed || !message.result) {
			return;
		}
		if (vote.createdBy !== message.userId && !this.hasPermission('session:manage', message.userId)) {
			this.logService.warn(`CollaborationBackendService: ignored decision close from ${message.userId}`);
			return;
		}
		vote.closed = true;
		vote.result = message.result;
		this._onDidChangeVote.fire({ ...vote, ballots: { ...vote.ballots } });
	}

	private _onRelay(message: Extract<CollaborationMessage, { type: 'relay' }>): void {
		if (typeof message.channel !== 'string') {
			return;
		}
		const channels = this._subChannels.get(message.channel);
		if (!channels) {
			return;
		}
		for (const channel of channels) {
			channel.onmessage?.({ data: message.payload });
		}
	}
}
