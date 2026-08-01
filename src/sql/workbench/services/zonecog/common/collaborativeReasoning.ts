/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';

export const ICollaborativeReasoningService = createDecorator<ICollaborativeReasoningService>('collaborativeReasoningService');

// ---------------------------------------------------------------------------
// Collaborative reasoning types
// ---------------------------------------------------------------------------

/** State of the collaborative reasoning session. */
export interface CollaborativeReasoningState {
	active: boolean;
	/** Stable identifier of this participant. */
	peerId: string;
	/** Peer ids seen since the session started (excluding self). */
	knownPeers: string[];
	phasesSent: number;
	phasesReceived: number;
	annotationsSent: number;
	annotationsReceived: number;
}

/**
 * One thinking phase contributed by a participant's live query processing.
 * `querySeq` scopes phases to a single query for the contributing peer
 * (bumped whenever that peer's "Initial Engagement" phase - always the
 * first phase of every query - is observed).
 */
export interface CollaborativePhaseEvent {
	peerId: string;
	querySeq: number;
	/** Best-effort query text, when known at broadcast time. */
	query: string;
	phase: ThinkingPhase;
}

/** A short remark one participant attaches to a (possibly own) phase. */
export interface CollaborativeAnnotation {
	peerId: string;
	targetPeerId: string;
	targetQuerySeq: number;
	targetPhaseName: string;
	text: string;
	/** Epoch milliseconds when the annotation was posted. */
	timestamp: number;
}

/** One entry of the unified session transcript, in arrival order. */
export type CollaborativeSessionEntry =
	| { kind: 'phase'; event: CollaborativePhaseEvent }
	| { kind: 'annotation'; event: CollaborativeAnnotation };

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Collaborative reasoning service.
 *
 * Closes the same-machine scope of the "Collaborative reasoning sessions"
 * roadmap item (Phase 4.4): while a session is active, every thinking phase
 * this window's `IZoneCogService` completes is broadcast live to other
 * workbench windows over a BroadcastChannel, and every peer's phases are
 * applied to a local unified transcript alongside this window's own -
 * turning isolated cognitive processing into a shared, observable reasoning
 * stream. Participants can also attach short annotations to any phase
 * (their own or a peer's), enabling lightweight co-reasoning (critique,
 * confirmation, follow-up prompts) without a shared hypergraph merge. True
 * multi-user collaboration across machines requires a sync backend and
 * remains future work.
 */
export interface ICollaborativeReasoningService {
	readonly _serviceBrand: undefined;

	/** Fired for every phase added to the transcript, own or peer. */
	readonly onDidReceivePhase: Event<CollaborativePhaseEvent>;

	/** Fired for every annotation added to the transcript, own or peer. */
	readonly onDidReceiveAnnotation: Event<CollaborativeAnnotation>;

	/** Fired when the session starts, stops, or peers are discovered. */
	readonly onDidChangeSessionState: Event<CollaborativeReasoningState>;

	/**
	 * Start collaborating: opens the channel, announces this peer, and
	 * begins mirroring this window's thinking phases to peers. Returns
	 * false when BroadcastChannel is unavailable in the current
	 * environment.
	 */
	startSession(): boolean;

	/** Stop collaborating and close the channel. */
	stopSession(): void;

	/** Current session state. */
	getState(): CollaborativeReasoningState;

	/** Attach a short remark to a phase (own or a peer's) and share it. */
	postAnnotation(targetPeerId: string, targetQuerySeq: number, targetPhaseName: string, text: string): void;

	/** The unified session transcript (own and peer phases/annotations), oldest first. */
	getSessionLog(): CollaborativeSessionEntry[];

	/** Clear the recorded transcript (does not affect lifetime counters). */
	clear(): void;
}
