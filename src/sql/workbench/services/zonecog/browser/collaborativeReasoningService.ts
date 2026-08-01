/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICollaborativeReasoningService,
	CollaborativeReasoningState,
	CollaborativePhaseEvent,
	CollaborativeAnnotation,
	CollaborativeSessionEntry
} from 'sql/workbench/services/zonecog/common/collaborativeReasoning';
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

interface HelloMessage { type: 'hello'; peerId: string; reply: boolean }
interface PhaseMessage { type: 'phase'; peerId: string; querySeq: number; query: string; phase: ThinkingPhase }
interface AnnotationMessage {
	type: 'annotation';
	peerId: string;
	targetPeerId: string;
	targetQuerySeq: number;
	targetPhaseName: string;
	text: string;
	timestamp: number;
}
type CollaborativeReasoningMessage = HelloMessage | PhaseMessage | AnnotationMessage;

/**
 * Implementation of the collaborative reasoning service.
 *
 * Broadcasts this window's live thinking phases to same-machine peer
 * windows over a BroadcastChannel and merges every participant's phases and
 * annotations into one unified transcript.
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

	constructor(
		@ILogService private readonly logService: ILogService,
		@IZoneCogService private readonly zoneCogService: IZoneCogService,
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
			this.logService.warn('CollaborativeReasoningService: BroadcastChannel unavailable, cannot start collaborative session');
			return false;
		}
		this.membraneService.recordActivity('somatic');
		this._channel = channel;
		channel.onmessage = event => this._onMessage(event.data);

		this._sessionDisposables = new DisposableStore();
		this._sessionDisposables.add(this.zoneCogService.onDidCompleteThinkingPhase(phase => this._onLocalPhase(phase)));

		this._post({ type: 'hello', peerId: this._peerId, reply: false });
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
		this.logService.info('CollaborativeReasoningService: collaborative reasoning session stopped');
		this._onDidChangeSessionState.fire(this.getState());
	}

	getState(): CollaborativeReasoningState {
		return {
			active: this._channel !== undefined,
			peerId: this._peerId,
			knownPeers: Array.from(this._knownPeers),
			phasesSent: this._phasesSent,
			phasesReceived: this._phasesReceived,
			annotationsSent: this._annotationsSent,
			annotationsReceived: this._annotationsReceived
		};
	}

	postAnnotation(targetPeerId: string, targetQuerySeq: number, targetPhaseName: string, text: string): void {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		const annotation: CollaborativeAnnotation = {
			peerId: this._peerId,
			targetPeerId,
			targetQuerySeq,
			targetPhaseName,
			text: trimmed,
			timestamp: Date.now()
		};
		this._appendLog({ kind: 'annotation', event: annotation });
		this._annotationsSent++;
		this._onDidReceiveAnnotation.fire(annotation);
		this._post({ type: 'annotation', ...annotation });
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
			phase
		};
		this._appendLog({ kind: 'phase', event });
		this._phasesSent++;
		this._onDidReceivePhase.fire(event);
		this._post({ type: 'phase', peerId: this._peerId, querySeq: this._querySeq, query: this._currentQuery, phase });
	}

	// -- Transport ------------------------------------------------------------------------

	/**
	 * Create the underlying channel. Overridable so tests can substitute a
	 * fake transport; returns undefined when BroadcastChannel is unavailable.
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
				this._post({ type: 'hello', peerId: this._peerId, reply: true });
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
				phase: message.phase
			};
			this._appendLog({ kind: 'phase', event });
			this._phasesReceived++;
			this._onDidReceivePhase.fire(event);
			return;
		}

		if (message.type === 'annotation' && typeof message.text === 'string') {
			this._knownPeers.add(message.peerId);
			const annotation: CollaborativeAnnotation = {
				peerId: message.peerId,
				targetPeerId: message.targetPeerId,
				targetQuerySeq: message.targetQuerySeq,
				targetPhaseName: message.targetPhaseName,
				text: message.text,
				timestamp: message.timestamp
			};
			this._appendLog({ kind: 'annotation', event: annotation });
			this._annotationsReceived++;
			this._onDidReceiveAnnotation.fire(annotation);
		}
	}
}
