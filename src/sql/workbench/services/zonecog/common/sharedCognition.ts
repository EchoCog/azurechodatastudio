/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ISharedCognitionService = createDecorator<ISharedCognitionService>('sharedCognitionService');

// ---------------------------------------------------------------------------
// Shared cognition types
// ---------------------------------------------------------------------------

/** State of the shared cognition session. */
export interface SharedCognitionState {
	active: boolean;
	/** Stable identifier of this participant. */
	peerId: string;
	/** Peer ids seen since the session started (excluding self). */
	knownPeers: string[];
	/** Node/link updates sent to peers since the session started. */
	sentUpdates: number;
	/** Node/link updates applied from peers since the session started. */
	appliedUpdates: number;
}

/** A change to shared state received from another participant. */
export interface SharedCognitionUpdate {
	peerId: string;
	kind: 'node' | 'link';
	/** Id of the node or link that was upserted. */
	id: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Shared cognition service.
 *
 * First increment of the Phase 4.4 "Shared hypergraph state" roadmap item:
 * synchronizes hypergraph node and link upserts across workbench windows on
 * the same machine over a BroadcastChannel. While a session is active,
 * every local hypergraph change is broadcast to peers and every peer change
 * is applied to the local store, with echo suppression so applied updates
 * are not re-broadcast in a loop. True multi-user sharing across machines
 * requires a sync backend and remains future work.
 */
export interface ISharedCognitionService {
	readonly _serviceBrand: undefined;

	/** Fired when a peer update has been applied to the local store. */
	readonly onDidApplyPeerUpdate: Event<SharedCognitionUpdate>;

	/** Fired when the session starts or stops. */
	readonly onDidChangeSessionState: Event<SharedCognitionState>;

	/**
	 * Start sharing: opens the channel, announces this peer, and begins
	 * mirroring hypergraph changes. Returns false when BroadcastChannel is
	 * unavailable in the current environment.
	 */
	startSession(): boolean;

	/** Stop sharing and close the channel. */
	stopSession(): void;

	/** Current session state. */
	getState(): SharedCognitionState;
}
