/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IAtomSpaceTransportService = createDecorator<IAtomSpaceTransportService>('atomSpaceTransportService');

/**
 * Configuration for reaching the ZoneCog Python bridge
 * (`azure_integration/data_studio_bridge.py`), which itself forwards atom
 * batches to a real AtomSpace backend when `ATOMSPACE_MODE=http`.
 */
export interface AtomSpaceTransportConfig {
	/** Base URL of the ZoneCog Python bridge (default: http://127.0.0.1:7807). */
	baseUrl: string;
	/** Request timeout in milliseconds. */
	timeoutMs: number;
	/** Bearer token forwarded as `Authorization: Bearer <token>`, if set. */
	authToken?: string;
}

/**
 * Outcome of a single hypergraph → AtomSpace sync attempt.
 */
export interface AtomSpaceSyncResult {
	requestId: string;
	/** Epoch milliseconds when the sync completed (or failed). */
	timestamp: number;
	nodeCount: number;
	linkCount: number;
	success: boolean;
	error?: string;
	durationMs: number;
}

/**
 * Real AtomSpace transport service: pushes the contents of the ZoneCog
 * in-memory hypergraph store to the Python bridge's `/ingest/atoms`
 * endpoint, closing the "Real AtomSpace transport" gap noted in Phase 3.2
 * of the ZoneCog roadmap (the in-memory `HypergraphStore` previously had no
 * externalized transport to sync with a real AtomSpace backend).
 *
 * The bridge itself decides, via `ATOMSPACE_MODE`, whether to count atoms
 * in-process ("mock", the default) or forward them over HTTP to a real
 * AtomSpace REST endpoint ("http", `ATOMSPACE_URL`) - this service is
 * transport-agnostic to that choice and only needs the bridge to be
 * reachable.
 */
export interface IAtomSpaceTransportService {
	readonly _serviceBrand: undefined;

	/** Fired after every sync attempt, success or failure. */
	readonly onDidSync: Event<AtomSpaceSyncResult>;

	/** Fired whenever the bridge reachability changes. */
	readonly onDidChangeConnectionStatus: Event<boolean>;

	/** Update transport configuration (partial patch over current config). */
	configure(config: Partial<AtomSpaceTransportConfig>): void;

	/** Current transport configuration. */
	getConfig(): AtomSpaceTransportConfig;

	/** Whether the last health check (or sync) found the bridge reachable. */
	isConnected(): boolean;

	/** Probe the bridge's `/health` endpoint. */
	healthCheck(): Promise<boolean>;

	/**
	 * Push the given hypergraph nodes and links to the bridge as an
	 * AtomSpace-shaped atom batch (Node/Link atoms keyed by stable id) and
	 * record the outcome. Never throws - failures are reported in the
	 * returned/emitted `AtomSpaceSyncResult`.
	 */
	syncHypergraph(nodes: ReadonlyArray<{ id: string; node_type: string; content: string }>,
		links: ReadonlyArray<{ id: string; link_type: string; outgoing: string[] }>): Promise<AtomSpaceSyncResult>;

	/** Sync history for this session, most recent last. */
	getSyncHistory(): AtomSpaceSyncResult[];

	/** Clear the sync history. */
	clearHistory(): void;
}
