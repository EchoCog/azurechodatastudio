/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { ThinkingPhase } from 'sql/workbench/services/zonecog/common/zonecogService';

export const ICognitiveTraceService = createDecorator<ICognitiveTraceService>('cognitiveTraceService');

// ---------------------------------------------------------------------------
// Trace types
// ---------------------------------------------------------------------------

/** Format version stamped into exported traces. */
export const TRACE_FORMAT_VERSION = 1;

/**
 * One fully processed query captured in a cognitive trace.
 */
export interface TracedQuery {
	/** The original query text, when known. */
	query: string;
	/** Ordered thinking phases the protocol went through. */
	phases: ThinkingPhase[];
	/** The final response text. */
	response: string;
	confidence: number;
	complexity: string;
	depth: string;
	processingTimeMs: number;
	/** Epoch milliseconds when processing completed. */
	completedAt: number;
}

/**
 * A shareable cognitive trace: an ordered record of the session's thinking.
 */
export interface CognitiveTrace {
	formatVersion: number;
	/** Label describing the trace origin (free-form). */
	label: string;
	/** Epoch milliseconds when the trace was exported. */
	exportedAt: number;
	queries: TracedQuery[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive trace service.
 *
 * Closes the "Cognitive trace sharing and replay" roadmap item (Phase 4.4):
 * passively records every processed query with its full thinking-phase
 * sequence, exports the session trace as a versioned JSON document that can
 * be shared out-of-band, imports such documents back, and replays any
 * traced query by re-emitting its phases through `onDidReplayPhase` so
 * observers (e.g. the Thinking Process view) can show another session's
 * reasoning step by step.
 */
export interface ICognitiveTraceService {
	readonly _serviceBrand: undefined;

	/** Fired for each phase re-emitted during a replay, in original order. */
	readonly onDidReplayPhase: Event<{ queryIndex: number; phase: ThinkingPhase }>;

	/** Fired when a replay of a traced query completes. */
	readonly onDidCompleteReplay: Event<TracedQuery>;

	/** Queries recorded in the current session, oldest first. */
	getSessionTrace(): TracedQuery[];

	/** Serialize the current session trace to a shareable JSON string. */
	exportTrace(label?: string): string;

	/**
	 * Parse and validate a trace JSON string produced by `exportTrace`.
	 * Throws on malformed input or unsupported format version. The imported
	 * trace becomes the active imported trace for replay.
	 */
	importTrace(json: string): CognitiveTrace;

	/** The most recently imported trace, if any. */
	getImportedTrace(): CognitiveTrace | undefined;

	/**
	 * Replay one query of the given trace (defaults to the imported trace),
	 * re-emitting its phases synchronously through `onDidReplayPhase`.
	 * Returns the replayed query, or undefined if the index is out of range
	 * or no trace is available.
	 */
	replay(queryIndex?: number, trace?: CognitiveTrace): TracedQuery | undefined;

	/** Clear the recorded session trace (does not affect an imported trace). */
	clear(): void;
}
