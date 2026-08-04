/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';
import { CollaborationTransportKind, CollaborationVote, CollaborationVoteResult } from 'sql/workbench/services/zonecog/common/collaborationBackend';

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
	/** How this session reaches other participants. */
	transport: CollaborationTransportKind;
	/** Code of the multi-user session in use, when one is active. */
	sessionId?: string;
	/** Identity attributed to this window's contributions, when known. */
	userId?: string;
	displayName?: string;
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
	/** Collaboration identity of the contributor, in a multi-user session. */
	userId?: string;
	/** Display name of the contributor, in a multi-user session. */
	displayName?: string;
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
	/** Collaboration identity of the author, in a multi-user session. */
	userId?: string;
	/** Display name of the author, in a multi-user session. */
	displayName?: string;
}

/**
 * A decision the session is asked to settle - which interpretation to trust,
 * which follow-up query to run, whether a conclusion holds. Recorded in the
 * transcript alongside the reasoning it arises from.
 */
export interface CollaborativeDecisionEvent {
	/** Identifier of the underlying session decision. */
	decisionId: string;
	topic: string;
	options: string[];
	/** Collaboration identity of the participant who raised the decision. */
	userId?: string;
	displayName?: string;
	/** Present once the decision has been tallied. */
	outcome?: CollaborationVoteResult;
	timestamp: number;
}

/** One entry of the unified session transcript, in arrival order. */
export type CollaborativeSessionEntry =
	| { kind: 'phase'; event: CollaborativePhaseEvent }
	| { kind: 'annotation'; event: CollaborativeAnnotation }
	| { kind: 'decision'; event: CollaborativeDecisionEvent };

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Collaborative reasoning service.
 *
 * While a session is active, every thinking phase this window's
 * `IZoneCogService` completes is broadcast live to the other participants,
 * and their phases are applied to a local unified transcript alongside this
 * window's own - turning isolated cognitive processing into a shared,
 * observable reasoning stream. Participants can also attach annotations to
 * any phase (their own or a peer's), enabling lightweight co-reasoning
 * (critique, confirmation, follow-up prompts) without a shared hypergraph
 * merge, and put contested judgements to the session as decisions that are
 * voted on and tallied.
 *
 * Reach depends on the transport underneath (Phase D.3). With no multi-user
 * session the transcript is shared over a BroadcastChannel, which reaches
 * other workbench windows on this machine and closes the same-machine scope
 * of the "Collaborative reasoning sessions" roadmap item (Phase 4.4). Once
 * `ICollaborationBackendService` has a session open, the same transcript
 * flows over that session's transport instead - a WebSocket relay when one is
 * configured - so collaborators on other machines take part, contributions
 * carry user attribution, and annotations and votes are gated by the
 * session's access-control model.
 */
export interface ICollaborativeReasoningService {
	readonly _serviceBrand: undefined;

	/** Fired for every phase added to the transcript, own or peer. */
	readonly onDidReceivePhase: Event<CollaborativePhaseEvent>;

	/** Fired for every annotation added to the transcript, own or peer. */
	readonly onDidReceiveAnnotation: Event<CollaborativeAnnotation>;

	/** Fired when the session starts, stops, or peers are discovered. */
	readonly onDidChangeSessionState: Event<CollaborativeReasoningState>;

	/** Fired when a decision is raised or tallied. */
	readonly onDidChangeDecision: Event<CollaborativeDecisionEvent>;

	/**
	 * Start collaborating: opens the channel, announces this peer, and
	 * begins mirroring this window's thinking phases to peers. Joins the
	 * active multi-user session when there is one, otherwise falls back to
	 * same-machine transport. Returns false when no transport is available
	 * in the current environment.
	 */
	startSession(): boolean;

	/** Stop collaborating and close the channel. */
	stopSession(): void;

	/** Current session state. */
	getState(): CollaborativeReasoningState;

	/**
	 * Attach a short remark to a phase (own or a peer's) and share it.
	 * In a multi-user session this requires the `annotation:write`
	 * permission; returns false when the remark was rejected.
	 */
	postAnnotation(targetPeerId: string, targetQuerySeq: number, targetPhaseName: string, text: string): boolean;

	/**
	 * Put a judgement to the session. Requires an active multi-user session
	 * and the `vote:create` permission; returns undefined otherwise.
	 */
	proposeDecision(topic: string, options: string[]): CollaborativeDecisionEvent | undefined;

	/** Cast (or change) this participant's ballot on a decision. */
	castDecisionVote(decisionId: string, option: string): boolean;

	/** Close a decision and record its outcome in the transcript. */
	resolveDecision(decisionId: string): CollaborationVoteResult | undefined;

	/** Decisions raised in the current session, oldest first. */
	getDecisions(): CollaborationVote[];

	/** The unified session transcript (own and peer phases/annotations), oldest first. */
	getSessionLog(): CollaborativeSessionEntry[];

	/** Clear the recorded transcript (does not affect lifetime counters). */
	clear(): void;
}
