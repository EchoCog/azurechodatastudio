/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { HypergraphNode } from 'sql/workbench/services/zonecog/common/zonecogService';

export const IFederatedQueryService = createDecorator<IFederatedQueryService>('federatedQueryService');

// ---------------------------------------------------------------------------
// Federated query types
// ---------------------------------------------------------------------------

/** Criteria used to match hypergraph nodes, locally and on remote peers. */
export interface FederatedQueryFilter {
	/** Exact node_type match. */
	nodeType?: string;
	/** Case-insensitive substring match against node content. */
	keyword?: string;
	/** Minimum salience_score, inclusive. */
	minSalience?: number;
	/** Maximum nodes returned per participant (local or remote). Default 25. */
	limit?: number;
}

/** Nodes contributed by a single participant (self or a remote peer) for one query. */
export interface FederatedQueryResult {
	peerId: string;
	/** True for the participant that issued the query. */
	isSelf: boolean;
	nodes: HypergraphNode[];
}

/** State of the federated query session. */
export interface FederatedQueryState {
	active: boolean;
	/** Stable identifier of this participant. */
	peerId: string;
	/** Peer ids seen since the session started (excluding self). */
	knownPeers: string[];
	/** Query requests broadcast to peers since the session started. */
	queriesSent: number;
	/** Query responses received from peers since the session started. */
	responsesReceived: number;
	/** Query requests answered on behalf of a peer since the session started. */
	requestsAnswered: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Federated hypergraph query service.
 *
 * Same-machine slice of the Phase 3.4 "Federated hypergraph queries" roadmap
 * item, built on the same BroadcastChannel transport as
 * {@link ISharedCognitionService}: a query is answered locally and, while a
 * session is active, also broadcast to every other workbench window on this
 * machine, whose matching nodes are collected back and returned per
 * participant. A true FlareCog cross-machine federation transport remains
 * future work.
 */
export interface IFederatedQueryService {
	readonly _serviceBrand: undefined;

	/** Fired when the session starts or stops, or peers/counters change. */
	readonly onDidChangeSessionState: Event<FederatedQueryState>;

	/**
	 * Start federating: opens the channel and announces this peer. Returns
	 * false when BroadcastChannel is unavailable in the current environment.
	 * Local-only querying via {@link query} still works without a session.
	 */
	startSession(): boolean;

	/** Stop federating and close the channel. */
	stopSession(): void;

	/** Current session state. */
	getState(): FederatedQueryState;

	/**
	 * Run a query against the local hypergraph and, when a session is
	 * active, against every known peer. Resolves once every known peer has
	 * answered or `timeoutMs` elapses, whichever is first.
	 */
	query(filter: FederatedQueryFilter, timeoutMs?: number): Promise<FederatedQueryResult[]>;

	/**
	 * Convenience wrapper over {@link query} that flattens every
	 * participant's nodes into a single list, deduplicated by node id
	 * (highest salience_score wins), sorted by salience_score descending.
	 */
	queryMerged(filter: FederatedQueryFilter, timeoutMs?: number): Promise<HypergraphNode[]>;
}
