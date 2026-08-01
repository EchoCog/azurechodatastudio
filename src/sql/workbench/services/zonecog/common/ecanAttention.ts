/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IECANAttentionService = createDecorator<IECANAttentionService>('ecanAttentionService');

// ---------------------------------------------------------------------------
// Attention value types
// ---------------------------------------------------------------------------

/**
 * Short-term importance (STI) and long-term importance (LTI) pair.
 *
 * In the Economic Attention Network:
 *   - STI determines which nodes enter the attentional focus
 *   - LTI determines which nodes are retained across focus cycles
 */
export interface AttentionValue {
	/** Short-Term Importance in [-1, 1]. Positive = attentional focus, negative = below threshold. */
	sti: number;
	/** Long-Term Importance in [0, 1]. High values survive rent collection. */
	lti: number;
}

/**
 * A snapshot of the ECAN state used for diagnostics and UI.
 */
export interface ECANSnapshot {
	/** Current attentional focus boundary (STI threshold). */
	attentionalFocusBoundary: number;
	/** Number of nodes currently in the attentional focus (STI above boundary). */
	nodesInFocus: number;
	/** Total number of nodes tracked by ECAN. */
	totalTrackedNodes: number;
	/** Total rent collected in the current cycle. */
	rentCollected: number;
	/** Number of spreading cycles completed. */
	spreadingCycles: number;
	/** Timestamp of the snapshot. */
	timestamp: number;
}

/**
 * Backward-compatible ECAN state shape used by existing UI components.
 */
export interface ECANState {
	totalNodes: number;
	importantCount: number;
	totalAttention: number;
	rentCycles: number;
	importantThreshold: number;
}

/**
 * Fired when an ECAN spreading activation cycle completes.
 */
export interface ECANSpreadEvent {
	/** Node IDs that gained attention (STI increased). */
	boosted: string[];
	/** Node IDs that lost attention (STI decreased). */
	decayed: string[];
	/** Node IDs evicted due to insufficient STI after rent. */
	evicted: string[];
	/** Duration of the spreading cycle in ms. */
	durationMs: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Economic Attention Network (ECAN) Service.
 *
 * Implements the OpenCog-inspired attention allocation mechanism:
 *   1. Attention values (STI + LTI) are assigned to hypergraph nodes
 *   2. Spreading activation diffuses STI along links
 *   3. Rent collection taxes STI from all nodes each cycle
 *   4. Nodes below the attentional focus boundary lose activation
 *   5. Importance diffusion boosts neighbors of high-STI nodes
 *
 * This provides a principled, economic mechanism for the cognitive
 * system to allocate its limited processing resources.
 */
export interface IECANAttentionService {
	readonly _serviceBrand: undefined;

	/** Fired after each spreading activation cycle. */
	readonly onDidSpread: Event<ECANSpreadEvent>;

	/** Backward-compatible event fired whenever tracked attention values change. */
	readonly onDidChangeAttention: Event<void>;

	/** Backward-compatible alias for onDidSpread. */
	readonly onDidSpreadingActivation: Event<ECANSpreadEvent>;

	/** Fired when the attentional focus boundary changes. */
	readonly onDidChangeFocusBoundary: Event<number>;

	// -- Attention value management -------------------------------------------

	/**
	 * Set the attention value for a hypergraph node.
	 * Creates the tracking entry if it doesn't exist.
	 */
	setAttentionValue(nodeId: string, av: AttentionValue): void;

	/**
	 * Get the attention value for a hypergraph node.
	 * Returns a default (sti=0, lti=0) if the node is not tracked.
	 */
	getAttentionValue(nodeId: string): AttentionValue;

	/**
	 * Stimulate a node by adding to its STI. Clamps to [-1, 1].
	 */
	stimulate(nodeId: string, stiDelta: number): void;

	/**
	 * Get all node IDs currently in the attentional focus (STI >= boundary).
	 */
	getAttentionalFocus(): string[];

	/**
	 * Get the top N nodes sorted by attention value.
	 */
	getTopByAttention(n: number): Array<{ nodeId: string; attentionValue: number }>;

	// -- Spreading activation ------------------------------------------------

	/**
	 * Run one cycle of spreading activation across the hypergraph.
	 * Diffuses STI along links, collects rent, and updates the focus boundary.
	 */
	spreadActivation(): ECANSpreadEvent;

	// -- Configuration -------------------------------------------------------

	/**
	 * Get the current attentional focus boundary.
	 */
	getFocusBoundary(): number;

	/**
	 * Set the attentional focus boundary. Nodes with STI below this
	 * value are not in the attentional focus.
	 */
	setFocusBoundary(boundary: number): void;

	/**
	 * Get a diagnostic snapshot of the ECAN state.
	 */
	getSnapshot(): ECANSnapshot;

	/**
	 * Backward-compatible state summary used by existing UI components.
	 */
	getState(): ECANState;

	/**
	 * Reset all attention values and cycle counters.
	 */
	reset(): void;
}
