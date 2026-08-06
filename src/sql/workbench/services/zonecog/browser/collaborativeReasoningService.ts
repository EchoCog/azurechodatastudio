/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICollaborativeReasoningService,
	CollaborativeReasoningState,
	CollaborativePhaseEvent,
	CollaborativeAnnotation,
	CollaborativeDecisionEvent,
	CollaborativeSessionEntry
} from 'sql/workbench/services/zonecog/common/collaborativeReasoning';
import {
	ICollaborationBackendService,
	CollaborationVote,
	CollaborationVoteResult
} from 'sql/workbench/services/zonecog/common/collaborationBackend';
import { IZoneCogService, ICognitiveMembraneService, ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

/** Channel name shared by all participating workbench windows. */
const CHANNEL_NAME = 'zonecog-collaborative-reasoning';

/** Name of the phase that always starts a new query (see ZONECOG.md protocol). */
const QUERY_START_PHASE = 'Initial Engagement';

/** Bound on the retained transcript so a long-running session cannot grow unbounded. */
const MAX_LOG_ENTRIES = 500;

/** Minimal channel surface so tests can substitute a fake transport. */
export interface ICollaborativeReasoningChannel {
	postMessage(message: unknown): void;
	close(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
}

interface HelloMessage { type: 'hello'; peerId: string; reply: boolean; userId?: string; displayName?: string }
interface PhaseMessage { type: 'phase'; peerId: string; querySeq: number; query: string; phase: ThinkingPhase; userId?: string; displayName?: string }
interface AnnotationMessage {
	type: 'annotation';
	peerId: string;
	targetPeerId: string;
	targetQuerySeq: number;
	targetPhaseName: string;
	text: string;
	timestamp: number;
	userId?: string;
	displayName?: string;
}
type CollaborativeReasoningMessage = HelloMessage | PhaseMessage | AnnotationMessage;

/**
 * Implementation of the collaborative reasoning service.
 *
 * Broadcasts this window's live thinking phases to the other participants
 * and merges everyone's phases, annotations and decisions into one unified
 * transcript. The transcript rides on whichever transport has the widest
 * reach: a sub-channel of the active multi-user collaboration session when
 * `ICollaborationBackendService` has one open - which carries it to other
 * machines and brings user attribution, annotation permissions and consensus
 * voting with it - and otherwise a same-machine BroadcastChannel.
 */
export class CollaborativeReasoningService extends Disposable implements ICollaborativeReasoningService {

	declare readonly _serviceBrand: undefined;

	private readonly _peerId = generateUuid();
	private readonly _knownPeers = new Set<string>();
	private _channel: ICollaborativeReasoningChannel | undefined;
	private _sessionDisposables: DisposableStore | undefined;
	private _querySeq = 0;
	private _currentQuery = '';
	private _log: CollaborativeSessionEntry[] = [];
	private _phasesSent = 0;
	private _phasesReceived = 0;
	private _annotationsSent = 0;
	private _annotationsReceived = 0;

	private readonly _onDidReceivePhase = this._register(new Emitter<CollaborativePhaseEvent>());
	readonly onDidReceivePhase: Event<CollaborativePhaseEvent> = this._onDidReceivePhase.event;

	private readonly _onDidReceiveAnnotation = this._register(new Emitter<CollaborativeAnnotation>());
	readonly onDidReceiveAnnotation: Event<CollaborativeAnnotation> = this._onDidReceiveAnnotation.event;

	private readonly _onDidChangeSessionState = this._register(new Emitter<CollaborativeReasoningState>());
	readonly onDidChangeSessionState: Event<CollaborativeReasoningState> = this._onDidChangeSessionState.event;

	private readonly _onDidChangeDecision = this._register(new Emitter<CollaborativeDecisionEvent>());
	readonly onDidChangeDecision: Event<CollaborativeDecisionEvent> = this._onDidChangeDecision.event;

	/** Whether the open channel belongs to a multi-user session. */
	private _channelIsShared = false;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IZoneCogService private readonly zoneCogService: IZoneCogService,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@ICollaborationBackendService private readonly collaborationBackend: ICollaborationBackendService
	) {
		super();
		// A multi-user session may be created or left long after the reasoning
		// session started; re-home the transcript when that happens so it
		// always reaches as far as the session allows.
		this._register(this.collaborationBackend.onDidChangeState(() => this._syncTransport()));
	}

	// -- Session lifecycle -----------------------------------------------------------

	startSession(): boolean {
		if (this._channel) {
			return true;
		}
		const channel = this._openChannel();
		if (!channel) {
			this.logService.warn('CollaborativeReasoningService: no collaboration transport available, cannot start collaborative session');
			return false;
		}
		this.membraneService.recordActivity('somatic');
		this._channel = channel;
		channel.onmessage = event => this._onMessage(event.data);

		this._sessionDisposables = new DisposableStore();
		this._sessionDisposables.add(this.zoneCogService.onDidCompleteThinkingPhase(phase => this._onLocalPhase(phase)));
		this._sessionDisposables.add(this.collaborationBackend.onDidChangeVote(vote => this._recordDecision(vote)));

		const identity = this._identity();
		this._post({ type: 'hello', peerId: this._peerId, reply: false, ...identity });
		this.logService.info(`CollaborativeReasoningService: collaborative reasoning session started (peer ${this._peerId})`);
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
		this._channelIsShared = false;
		this.logService.info('CollaborativeReasoningService: collaborative reasoning session stopped');
		this._onDidChangeSessionState.fire(this.getState());
	}

	getState(): CollaborativeReasoningState {
		const backendState = this.collaborationBackend.getState();
		const inSharedSession = this._channelIsShared && backendState.session !== undefined;
		return {
			active: this._channel !== undefined,
			peerId: this._peerId,
			knownPeers: Array.from(this._knownPeers),
			phasesSent: this._phasesSent,
			phasesReceived: this._phasesReceived,
			annotationsSent: this._annotationsSent,
			annotationsReceived: this._annotationsReceived,
			transport: this._channel === undefined ? 'none' : (inSharedSession ? backendState.transport : 'broadcast'),
			sessionId: inSharedSession ? backendState.session!.id : undefined,
			userId: inSharedSession ? backendState.localUserId : undefined,
			displayName: inSharedSession ? backendState.localDisplayName : undefined
		};
	}

	postAnnotation(targetPeerId: string, targetQuerySeq: number, targetPhaseName: string, text: string): boolean {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}
		// In a multi-user session an observer may watch the reasoning stream
		// without being able to write on it.
		if (this.collaborationBackend.getSession() && !this.collaborationBackend.hasPermission('annotation:write')) {
			this.logService.warn('CollaborativeReasoningService: annotation rejected, this participant may not annotate');
			return false;
		}
		const annotation: CollaborativeAnnotation = {
			peerId: this._peerId,
			targetPeerId,
			targetQuerySeq,
			targetPhaseName,
			text: trimmed,
			timestamp: Date.now(),
			...this._identity()
		};
		this._appendLog({ kind: 'annotation', event: annotation });
		this._annotationsSent++;
		this._onDidReceiveAnnotation.fire(annotation);
		this._post({ type: 'annotation', ...annotation });
		return true;
	}

	// -- Collaborative decisions ------------------------------------------------------

	proposeDecision(topic: string, options: string[]): CollaborativeDecisionEvent | undefined {
		const vote = this.collaborationBackend.createVote(topic, options);
		if (!vote) {
			return undefined;
		}
		this.membraneService.recordActivity('cerebral');
		return this._recordDecision(vote);
	}

	castDecisionVote(decisionId: string, option: string): boolean {
		return this.collaborationBackend.castVote(decisionId, option);
	}

	resolveDecision(decisionId: string): CollaborationVoteResult | undefined {
		return this.collaborationBackend.closeVote(decisionId);
	}

	getDecisions(): CollaborationVote[] {
		return this.collaborationBackend.getVotes();
	}

	/**
	 * Fold a session decision into the transcript. Decisions evolve - they are
	 * raised, collect ballots, then close - so the entry is updated in place
	 * rather than appended again on every change.
	 */
	private _recordDecision(vote: CollaborationVote): CollaborativeDecisionEvent {
		const participant = this.collaborationBackend.getParticipant(vote.createdBy);
		const event: CollaborativeDecisionEvent = {
			decisionId: vote.id,
			topic: vote.topic,
			options: [...vote.options],
			userId: vote.createdBy,
			displayName: participant?.displayName,
			outcome: vote.closed ? (vote.result ?? this.collaborationBackend.tallyVote(vote.id)) : undefined,
			timestamp: vote.createdAt
		};
		const existing = this._log.find((entry): entry is { kind: 'decision'; event: CollaborativeDecisionEvent } =>
			entry.kind === 'decision' && entry.event.decisionId === vote.id);
		if (existing) {
			existing.event = event;
		} else {
			this._appendLog({ kind: 'decision', event });
		}
		this._onDidChangeDecision.fire(event);
		return event;
	}

	getSessionLog(): CollaborativeSessionEntry[] {
		return [...this._log];
	}

	clear(): void {
		this._log = [];
	}

	override dispose(): void {
		this.stopSession();
		super.dispose();
	}

	// -- Local phase capture ----------------------------------------------------------

	private _onLocalPhase(phase: ThinkingPhase): void {
		if (phase.name === QUERY_START_PHASE) {
			this._querySeq++;
			const history = this.zoneCogService.getQueryHistory();
			this._currentQuery = history.length > 0 ? history[history.length - 1].query : '';
		}
		const event: CollaborativePhaseEvent = {
			peerId: this._peerId,
			querySeq: this._querySeq,
			query: this._currentQuery,
			phase,
			...this._identity()
		};
		this._appendLog({ kind: 'phase', event });
		this._phasesSent++;
		this._onDidReceivePhase.fire(event);
		this._post({ type: 'phase', ...event });
	}

	// -- Transport ------------------------------------------------------------------------

	/**
	 * Who this window's contributions are attributed to.
	 *
	 * Attribution only means something inside a multi-user session, so outside
	 * one the phases and annotations stay anonymous rather than carrying a
	 * user id no peer can resolve.
	 */
	private _identity(): { userId?: string; displayName?: string } {
		if (!this.collaborationBackend.getSession()) {
			return {};
		}
		const identity = this.collaborationBackend.getLocalIdentity();
		return { userId: identity.userId, displayName: identity.displayName };
	}

	/**
	 * Open the widest transport available: a sub-channel of the active
	 * multi-user session, so the transcript reaches every collaborator, and
	 * otherwise the same-machine fallback.
	 */
	private _openChannel(): ICollaborativeReasoningChannel | undefined {
		const shared = this.collaborationBackend.createChannel(CHANNEL_NAME);
		if (shared) {
			this._channelIsShared = true;
			return shared;
		}
		this._channelIsShared = false;
		return this._createChannel(CHANNEL_NAME);
	}

	/**
	 * Create the same-machine channel that carries the transcript between the
	 * windows on this host. Overridable so tests can substitute a transport;
	 * returns undefined when BroadcastChannel is unavailable.
	 */
	protected _createChannel(name: string): ICollaborativeReasoningChannel | undefined {
		if (typeof BroadcastChannel === 'undefined') {
			return undefined;
		}
		const raw = new BroadcastChannel(name);
		const adapter: ICollaborativeReasoningChannel = {
			postMessage: message => raw.postMessage(message),
			close: () => raw.close(),
			onmessage: null
		};
		raw.onmessage = event => adapter.onmessage?.({ data: event.data });
		return adapter;
	}

	/**
	 * Move the transcript onto the widest transport currently available.
	 *
	 * Joining a multi-user session mid-conversation should extend the reach of
	 * the reasoning stream, and leaving one should not silence it; either way
	 * the transcript already gathered is kept.
	 */
	private _syncTransport(): void {
		if (!this._channel) {
			return;
		}
		const shouldBeShared = this.collaborationBackend.getSession() !== undefined;
		if (shouldBeShared === this._channelIsShared) {
			return;
		}
		this._channel.onmessage = null;
		this._channel.close();
		this._channel = undefined;
		this._channelIsShared = false;

		const channel = this._openChannel();
		if (!channel) {
			this.logService.warn('CollaborativeReasoningService: lost the collaboration transport, stopping the reasoning session');
			this._sessionDisposables?.dispose();
			this._sessionDisposables = undefined;
			this._onDidChangeSessionState.fire(this.getState());
			return;
		}
		this._channel = channel;
		channel.onmessage = event => this._onMessage(event.data);
		this._knownPeers.clear();
		this._post({ type: 'hello', peerId: this._peerId, reply: false, ...this._identity() });
		this.membraneService.recordActivity('somatic');
		this._onDidChangeSessionState.fire(this.getState());
	}

	private _post(message: CollaborativeReasoningMessage): void {
		if (!this._channel) {
			return;
		}
		try {
			this._channel.postMessage(message);
		} catch (e) {
			this.logService.warn(`CollaborativeReasoningService: failed to post message: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	private _appendLog(entry: CollaborativeSessionEntry): void {
		this._log.push(entry);
		if (this._log.length > MAX_LOG_ENTRIES) {
			this._log.shift();
		}
	}

	private _onMessage(data: unknown): void {
		const message = data as CollaborativeReasoningMessage;
		if (typeof message !== 'object' || message === null || typeof message.peerId !== 'string' || message.peerId === this._peerId) {
			return;
		}

		if (message.type === 'hello') {
			const isNewPeer = !this._knownPeers.has(message.peerId);
			this._knownPeers.add(message.peerId);
			// Reply once so the new window learns about us too; the reply is
			// marked so it is never answered again (prevents a hello storm).
			if (isNewPeer && !message.reply) {
				this._post({ type: 'hello', peerId: this._peerId, reply: true, ...this._identity() });
			}
			this._onDidChangeSessionState.fire(this.getState());
			return;
		}

		if (message.type === 'phase' && message.phase && typeof message.querySeq === 'number') {
			this._knownPeers.add(message.peerId);
			const event: CollaborativePhaseEvent = {
				peerId: message.peerId,
				querySeq: message.querySeq,
				query: message.query,
				phase: message.phase,
				userId: message.userId,
				displayName: message.displayName
			};
			this._appendLog({ kind: 'phase', event });
			this._phasesReceived++;
			this._onDidReceivePhase.fire(event);
			return;
		}

		if (message.type === 'annotation' && typeof message.text === 'string') {
			// Annotations from an identified collaborator are held to the same
			// permission as our own, so a session observer cannot write on the
			// shared transcript by posting straight to the channel.
			if (!this._mayAnnotate(message.userId)) {
				this.logService.warn(`CollaborativeReasoningService: dropped annotation from ${message.userId} without annotate permission`);
				return;
			}
			this._knownPeers.add(message.peerId);
			const annotation: CollaborativeAnnotation = {
				peerId: message.peerId,
				targetPeerId: message.targetPeerId,
				targetQuerySeq: message.targetQuerySeq,
				targetPhaseName: message.targetPhaseName,
				text: message.text,
				timestamp: message.timestamp,
				userId: message.userId,
				displayName: message.displayName
			};
			this._appendLog({ kind: 'annotation', event: annotation });
			this._annotationsReceived++;
			this._onDidReceiveAnnotation.fire(annotation);
		}
	}

	/** Whether an identified peer holds the session's annotate permission. */
	private _mayAnnotate(userId: string | undefined): boolean {
		if (!userId || !this.collaborationBackend.getSession()) {
			return true;
		}
		return this.collaborationBackend.hasPermission('annotation:write', userId);
	}
}
