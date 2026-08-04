/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { TextOperation } from 'sql/workbench/services/zonecog/common/collaborationOT';

export const ICollaborationBackendService = createDecorator<ICollaborationBackendService>('collaborationBackendService');

// ---------------------------------------------------------------------------
// Identity and access control
// ---------------------------------------------------------------------------

/**
 * What a participant is allowed to do in a session.
 *
 * Roles are ordered by capability - `owner` ⊃ `editor` ⊃ `commenter` ⊃
 * `observer` - so that a session host can hand out exactly as much authority
 * as a collaborator needs.
 */
export type CollaborationRole = 'owner' | 'editor' | 'commenter' | 'observer';

/** A single capability that a role may grant. */
export type CollaborationPermission =
	| 'session:manage'    // Rename/close the session and change participant roles
	| 'document:create'   // Add a new shared workspace document
	| 'document:edit'     // Submit text operations against shared documents
	| 'annotation:write'  // Attach annotations to reasoning artifacts
	| 'presence:share'    // Publish cursor / cognitive-focus position
	| 'vote:create'       // Open a decision for the session to vote on
	| 'vote:cast';        // Cast a ballot in an open decision

/**
 * The permission set granted by each role. Membership in the session is
 * itself the read gate: every participant can observe the shared transcript,
 * documents and presence, and these permissions govern mutation only.
 */
export const COLLABORATION_ROLE_PERMISSIONS: Readonly<Record<CollaborationRole, ReadonlyArray<CollaborationPermission>>> = {
	owner: ['session:manage', 'document:create', 'document:edit', 'annotation:write', 'presence:share', 'vote:create', 'vote:cast'],
	editor: ['document:create', 'document:edit', 'annotation:write', 'presence:share', 'vote:create', 'vote:cast'],
	commenter: ['annotation:write', 'presence:share', 'vote:cast'],
	observer: ['presence:share'],
};

/** Whether `role` grants `permission`. */
export function roleHasPermission(role: CollaborationRole, permission: CollaborationPermission): boolean {
	return COLLABORATION_ROLE_PERMISSIONS[role].indexOf(permission) !== -1;
}

/** Stable identity of a collaborator. */
export interface CollaborationIdentity {
	/** Stable, session-independent identifier for this user. */
	userId: string;
	/** Name shown to other participants. */
	displayName: string;
}

/**
 * Where a participant's attention currently sits.
 *
 * Cognitive focus is deliberately wider than a text cursor: a collaborator
 * may be pointing at a range inside a shared document *or* at a thinking
 * phase in the reasoning transcript, and peers benefit from seeing either.
 */
export interface CollaborationFocus {
	/** Shared document the cursor belongs to, when the focus is textual. */
	documentId?: string;
	/** Selection anchor offset within the document. */
	anchor: number;
	/** Selection head offset within the document. */
	head: number;
	/** Thinking phase being attended to, when the focus is a reasoning artifact. */
	phaseName?: string;
	/** Query sequence the focused phase belongs to. */
	querySeq?: number;
	/** Epoch milliseconds when the focus was last published. */
	updatedAt: number;
}

/** A user taking part in a session. */
export interface CollaborationParticipant extends CollaborationIdentity {
	role: CollaborationRole;
	/** Epoch milliseconds when the participant joined. */
	joinedAt: number;
	/** Epoch milliseconds of the last presence signal received. */
	lastSeenAt: number;
	/** False once the participant stops sending presence signals. */
	online: boolean;
	/** Whether this participant currently sequences operations for the session. */
	isHost: boolean;
	focus?: CollaborationFocus;
}

// ---------------------------------------------------------------------------
// Session and document types
// ---------------------------------------------------------------------------

/** A multi-user cognitive workspace session. */
export interface CollaborationSession {
	/** Session code participants use to join. */
	id: string;
	title: string;
	/** Epoch milliseconds when the session was created. */
	createdAt: number;
	/** User currently acting as the operation sequencer. */
	hostUserId: string;
}

/** A text document shared by every participant of a session. */
export interface CollaborationDocument {
	id: string;
	title: string;
	/** Current content of this replica. */
	content: string;
	/** Number of sequenced operations applied to this replica. */
	revision: number;
	/** Epoch milliseconds of the last applied operation. */
	updatedAt: number;
	/** User whose operation was applied last. */
	lastEditedBy?: string;
}

/** How session traffic reaches other participants. */
export type CollaborationTransportKind = 'websocket' | 'broadcast' | 'none';

/** Snapshot of the local collaboration state. */
export interface CollaborationState {
	/** Whether a transport is currently open. */
	connected: boolean;
	transport: CollaborationTransportKind;
	session?: CollaborationSession;
	localUserId: string;
	localDisplayName: string;
	localRole: CollaborationRole;
	/** Whether this window sequences operations for the session. */
	isHost: boolean;
	participantCount: number;
	/** Local operations submitted but not yet sequenced by the host. */
	pendingOperations: number;
}

// ---------------------------------------------------------------------------
// Voting / consensus types
// ---------------------------------------------------------------------------

/** Outcome of a decision once the ballots are tallied. */
export interface CollaborationVoteResult {
	/** Ballot count per option. */
	tally: Record<string, number>;
	/** Option with the most ballots, absent on a tie with no clear winner. */
	winningOption?: string;
	/** Fraction of online participants who cast a ballot (0-1). */
	turnout: number;
	/** True when every ballot cast agreed on the winning option. */
	consensus: boolean;
	/** Epoch milliseconds when the decision was closed. */
	decidedAt: number;
}

/** A decision the session votes on. */
export interface CollaborationVote {
	id: string;
	/** What the session is deciding. */
	topic: string;
	/** The options participants may choose between. */
	options: string[];
	createdBy: string;
	createdAt: number;
	/** Latest ballot per user; re-voting replaces the previous ballot. */
	ballots: Record<string, string>;
	closed: boolean;
	result?: CollaborationVoteResult;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/**
 * Minimal duplex message channel.
 *
 * Both real transports - a WebSocket relay for cross-machine sessions and a
 * BroadcastChannel for same-machine windows - are reduced to this shape, so
 * the session, OT and access-control layers never depend on which one is in
 * use. It is also the shape `ICollaborativeReasoningService` consumes, which
 * is what lets a same-machine reasoning session become a multi-user one
 * without changing the reasoning code.
 */
export interface ICollaborationChannel {
	postMessage(message: unknown): void;
	close(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
}

/** Configuration for the collaboration backend. */
export interface CollaborationBackendConfig {
	/**
	 * WebSocket URL of the relay that fans session traffic out to other
	 * machines (for example `wss://relay.example.com/zonecog`). When unset,
	 * sessions fall back to same-machine BroadcastChannel transport.
	 */
	relayUrl?: string;
	/** Name this window publishes to other participants. */
	displayName: string;
	/** How often presence signals are published, in milliseconds. */
	presenceIntervalMs: number;
	/** Silence after which a participant is treated as offline, in milliseconds. */
	participantTimeoutMs: number;
	/** How long a join waits for the host to answer, in milliseconds. */
	joinTimeoutMs: number;
	/** Delay before the first reconnect attempt, in milliseconds. */
	reconnectDelayMs: number;
	/** How many times to retry a dropped relay connection. */
	maxReconnectAttempts: number;
}

/** Default backend configuration: same-machine transport, no relay. */
export const DEFAULT_COLLABORATION_CONFIG: CollaborationBackendConfig = {
	relayUrl: undefined,
	displayName: 'Zone-Cog Collaborator',
	presenceIntervalMs: 5000,
	participantTimeoutMs: 20000,
	joinTimeoutMs: 5000,
	reconnectDelayMs: 1000,
	maxReconnectAttempts: 5,
};

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/**
 * Messages exchanged by participants of a session.
 *
 * Every message carries the session code and the sending user so that
 * receivers can drop traffic from other sessions sharing the same relay (or
 * the same machine-wide BroadcastChannel) and attribute what remains.
 */
export type CollaborationMessage =
	/**
	 * Periodic "I am here" signal, also used as the join announcement.
	 * Note that hosting is never claimed here: every participant derives the
	 * same host from the announced join times, so a peer cannot promote
	 * itself to sequencer by asserting it.
	 */
	| { type: 'presence'; sessionId: string; userId: string; displayName: string; role: CollaborationRole; joinedAt: number; focus?: CollaborationFocus }
	/** Explicit departure. */
	| { type: 'leave'; sessionId: string; userId: string }
	/** A joining participant asking the host for the current session state. */
	| { type: 'state-request'; sessionId: string; userId: string }
	/** The host's answer: everything needed to start collaborating. */
	| { type: 'state-snapshot'; sessionId: string; userId: string; targetUserId: string; title: string; createdAt: number; documents: CollaborationDocument[]; roles: Record<string, CollaborationRole>; votes: CollaborationVote[] }
	/** A participant's edit, still expressed against `baseRevision`. */
	| { type: 'operation'; sessionId: string; userId: string; documentId: string; baseRevision: number; operation: TextOperation }
	/** The host's sequenced edit, authoritative for every replica. */
	| { type: 'operation-applied'; sessionId: string; userId: string; documentId: string; revision: number; authorUserId: string; operation: TextOperation }
	/** A new shared document. */
	| { type: 'document-created'; sessionId: string; userId: string; document: CollaborationDocument }
	/** A role change made by a participant holding `session:manage`. */
	| { type: 'role-changed'; sessionId: string; userId: string; targetUserId: string; role: CollaborationRole }
	/** A decision opened for the session. */
	| { type: 'vote-opened'; sessionId: string; userId: string; vote: CollaborationVote }
	/** A ballot cast in an open decision. */
	| { type: 'vote-cast'; sessionId: string; userId: string; voteId: string; option: string }
	/** A decision closed and tallied. */
	| { type: 'vote-closed'; sessionId: string; userId: string; voteId: string; result: CollaborationVoteResult }
	/** Payload for a named sub-channel riding on the session transport. */
	| { type: 'relay'; sessionId: string; userId: string; channel: string; payload: unknown };

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Collaboration backend service (Phase D.1 / D.2).
 *
 * Lifts Zone-Cog's cognitive workspaces from same-machine sharing to true
 * multi-user collaboration. `ISharedCognitionService` and
 * `ICollaborativeReasoningService` already merge hypergraph state and live
 * reasoning transcripts across workbench windows, but only within one
 * machine; this service supplies what cross-machine collaboration needs on
 * top of that:
 *
 * 1. **Transport** - a real WebSocket relay connection for cross-machine
 *    sessions, degrading to the same-machine BroadcastChannel when no relay
 *    is configured. Both are exposed as `ICollaborationChannel`, so the
 *    layers above are transport-agnostic and can later be re-homed onto
 *    FlareCog's secure peer transport without changing.
 *
 * 2. **Presence** - join/leave with user awareness, liveness tracking, and
 *    shared cursor / cognitive focus.
 *
 * 3. **Convergence** - concurrent edits to shared workspace documents are
 *    reconciled with operational transformation, sequenced by the session
 *    host, so every replica converges on the same content.
 *
 * 4. **Access control** - a role model gating document edits, annotations
 *    and voting.
 *
 * 5. **Consensus** - decisions the session votes on, tallied against the
 *    live participant list.
 */
export interface ICollaborationBackendService {
	readonly _serviceBrand: undefined;

	/** Fired when the connection, session or local role changes. */
	readonly onDidChangeState: Event<CollaborationState>;

	/** Fired when a participant joins, leaves, changes role, or moves focus. */
	readonly onDidChangeParticipants: Event<CollaborationParticipant[]>;

	/** Fired whenever a shared document's content changes. */
	readonly onDidChangeDocument: Event<CollaborationDocument>;

	/** Fired when a decision is opened, receives a ballot, or is closed. */
	readonly onDidChangeVote: Event<CollaborationVote>;

	// -- Configuration --------------------------------------------------------

	/** Update the backend configuration (partial patch over the current one). */
	configure(config: Partial<CollaborationBackendConfig>): void;

	/** Current backend configuration. */
	getConfig(): CollaborationBackendConfig;

	/** Stable identity of this window's user. */
	getLocalIdentity(): CollaborationIdentity;

	// -- Session lifecycle ----------------------------------------------------

	/**
	 * Create a session and join it as owner and host. Resolves to the new
	 * session, or `undefined` when no transport is available.
	 */
	createSession(title: string): Promise<CollaborationSession | undefined>;

	/**
	 * Join an existing session by its code, requesting the current state
	 * from the host. Resolves to the session once the host answers, or
	 * `undefined` when no transport is available.
	 */
	joinSession(sessionId: string, role?: CollaborationRole): Promise<CollaborationSession | undefined>;

	/** Announce departure and close the transport. */
	leaveSession(): void;

	/** Current local collaboration state. */
	getState(): CollaborationState;

	/** The active session, if any. */
	getSession(): CollaborationSession | undefined;

	// -- Participants ---------------------------------------------------------

	/** Every known participant, including this window's user. */
	getParticipants(): CollaborationParticipant[];

	/** A single participant by user id. */
	getParticipant(userId: string): CollaborationParticipant | undefined;

	/** Change a participant's role. Requires `session:manage`. */
	setParticipantRole(userId: string, role: CollaborationRole): boolean;

	/** Publish this window's cursor / cognitive focus. Requires `presence:share`. */
	updateFocus(focus: Omit<CollaborationFocus, 'updatedAt'>): boolean;

	/** Whether a user (default: the local user) holds a permission. */
	hasPermission(permission: CollaborationPermission, userId?: string): boolean;

	// -- Shared documents -----------------------------------------------------

	/** Create a shared document. Requires `document:create`. */
	createDocument(title: string, content?: string): CollaborationDocument | undefined;

	/** A shared document by id. */
	getDocument(documentId: string): CollaborationDocument | undefined;

	/** Every shared document in the session. */
	getDocuments(): CollaborationDocument[];

	/**
	 * Apply a local edit and submit it for sequencing. The edit is applied
	 * to the local replica immediately and transformed against concurrent
	 * remote edits as they arrive. Requires `document:edit`; returns false
	 * when rejected or when the operation does not fit the local replica.
	 */
	applyLocalOperation(documentId: string, operation: TextOperation): boolean;

	/**
	 * Convenience wrapper over `applyLocalOperation` for the common editor
	 * edit of replacing a range with text.
	 */
	editDocument(documentId: string, position: number, deleteCount: number, insertText: string): boolean;

	// -- Decisions ------------------------------------------------------------

	/** Open a decision for the session. Requires `vote:create`. */
	createVote(topic: string, options: string[]): CollaborationVote | undefined;

	/** Cast (or change) a ballot. Requires `vote:cast`. */
	castVote(voteId: string, option: string): boolean;

	/** Close and tally a decision. Requires `session:manage` or authorship. */
	closeVote(voteId: string): CollaborationVoteResult | undefined;

	/** Every decision in the session, oldest first. */
	getVotes(): CollaborationVote[];

	/** Tally a decision as it currently stands, without closing it. */
	tallyVote(voteId: string): CollaborationVoteResult | undefined;

	// -- Sub-channels and recovery -------------------------------------------

	/**
	 * Open a named sub-channel over the session transport, letting other
	 * Zone-Cog services (such as collaborative reasoning) exchange their own
	 * messages between participants. Returns `undefined` when no session is
	 * active, so callers can fall back to their same-machine transport.
	 */
	createChannel(name: string): ICollaborationChannel | undefined;

	/**
	 * Rejoin the most recent session persisted by this window, restoring the
	 * documents and votes captured in its last snapshot. Resolves to
	 * `undefined` when there is nothing to recover.
	 */
	recoverSession(): Promise<CollaborationSession | undefined>;
}
