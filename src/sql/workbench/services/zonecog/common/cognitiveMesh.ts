/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cognitive mesh transport types for Zone-Cog distributed coordination.
 *
 * Used by FlareCog, FederatedQuery, AAR remote orchestration, and the
 * distributed Cognitive Loop. Channels are transport-agnostic: the same
 * envelope flows over WebSocket, BroadcastChannel, or an in-process hub.
 */

/** Minimal duplex channel surface shared by all mesh transports. */
export interface ICognitiveMeshChannel {
	postMessage(message: unknown): void;
	close(): void;
	onmessage: ((event: { data: unknown }) => void) | null;
	/** Optional open-state observer for connection-oriented transports. */
	onopen?: ((event: { open: boolean }) => void) | null;
}

/** Well-known mesh message kinds. */
export type CognitiveMeshMessageType =
	| 'hello'
	| 'heartbeat'
	| 'request'
	| 'response'
	| 'event'
	| 'broadcast';

/**
 * Envelope wrapped around every mesh payload.
 * `replyTo` correlates a response with its originating request id.
 */
export interface CognitiveMeshEnvelope<T = unknown> {
	/** Envelope kind. */
	type: CognitiveMeshMessageType;
	/** Unique envelope id. */
	id: string;
	/** Originating peer id. */
	fromPeerId: string;
	/** Optional destination peer id (omit for broadcast). */
	toPeerId?: string;
	/** When set on a response, the request envelope id being answered. */
	replyTo?: string;
	/** Epoch-ms timestamp. */
	timestamp: number;
	/** Application payload. */
	payload: T;
	/** Optional auth token for secured meshes. */
	token?: string;
}

/** Application-level request payload carried inside a request envelope. */
export interface CognitiveMeshRequestPayload {
	/** Logical operation name (e.g. 'agent-execute', 'query', 'loop-sync'). */
	op: string;
	/** Operation arguments. */
	args?: unknown;
}

/** Application-level response payload. */
export interface CognitiveMeshResponsePayload {
	/** Whether the handler completed successfully. */
	ok: boolean;
	/** Result value on success. */
	result?: unknown;
	/** Error message on failure. */
	error?: string;
}

/** Handler registered for inbound request operations. */
export type CognitiveMeshRequestHandler = (
	envelope: CognitiveMeshEnvelope<CognitiveMeshRequestPayload>
) => Promise<CognitiveMeshResponsePayload> | CognitiveMeshResponsePayload;

/**
 * Normalize a peer address into a WebSocket URL when possible.
 * Accepts `ws://`, `wss://`, bare `host:port`, or `host`.
 */
export function normalizeMeshAddress(address: string): string {
	const trimmed = (address || '').trim();
	if (!trimmed) {
		return trimmed;
	}
	if (/^wss?:\/\//i.test(trimmed)) {
		return trimmed;
	}
	// host:port or host
	if (trimmed.includes('://')) {
		// Unknown scheme — leave untouched for caller to reject.
		return trimmed;
	}
	return `ws://${trimmed}`;
}

/** True when the address is a WebSocket URL (after normalization). */
export function isWebSocketUrl(address: string): boolean {
	return /^wss?:\/\//i.test((address || '').trim());
}
