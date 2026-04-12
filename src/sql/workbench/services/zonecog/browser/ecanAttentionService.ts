/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IECANAttentionService,
	AttentionValue,
	ECANSnapshot,
	ECANSpreadEvent
} from 'sql/workbench/services/zonecog/common/ecanAttention';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Default attentional focus boundary.
 * Nodes with STI below this value are outside the attentional focus.
 */
const DEFAULT_FOCUS_BOUNDARY = 0.0;

/**
 * Rent charged per ECAN cycle. Each node's STI is reduced by this amount.
 */
const RENT_PER_CYCLE = 0.02;

/**
 * Fraction of a node's STI that spreads to each linked neighbor.
 */
const SPREAD_FRACTION = 0.1;

/**
 * Maximum number of spreading cycles to track for diagnostics.
 */
const MAX_CYCLE_HISTORY = 100;

/**
 * Implementation of the Economic Attention Network (ECAN) Service.
 *
 * Provides attention allocation for the hypergraph knowledge store using
 * the OpenCog-inspired ECAN mechanism:
 *
 * - **Attention Values (AV)**: Each tracked node has an STI (Short-Term
 *   Importance) and LTI (Long-Term Importance) pair.
 * - **Spreading Activation**: STI diffuses from each node to its linked
 *   neighbors proportionally. This implements importance diffusion.
 * - **Rent Collection**: A flat rent is charged per cycle, creating an
 *   economic pressure that forces low-importance nodes out of the
 *   attentional focus.
 * - **Focus Boundary**: Nodes with STI above the boundary are in the
 *   attentional focus and receive priority processing.
 */
export class ECANAttentionService extends Disposable implements IECANAttentionService {

	declare readonly _serviceBrand: undefined;

	private readonly _attentionValues = new Map<string, AttentionValue>();
	private _focusBoundary = DEFAULT_FOCUS_BOUNDARY;
	private _spreadingCycles = 0;
	private _totalRentCollected = 0;

	private readonly _onDidSpread = this._register(new Emitter<ECANSpreadEvent>());
	readonly onDidSpread: Event<ECANSpreadEvent> = this._onDidSpread.event;

	private readonly _onDidChangeFocusBoundary = this._register(new Emitter<number>());
	readonly onDidChangeFocusBoundary: Event<number> = this._onDidChangeFocusBoundary.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('ECANAttentionService: initialized Economic Attention Network');
	}

	// -- Attention value management -------------------------------------------

	setAttentionValue(nodeId: string, av: AttentionValue): void {
		this._attentionValues.set(nodeId, {
			sti: this._clampSTI(av.sti),
			lti: this._clampLTI(av.lti),
		});
	}

	getAttentionValue(nodeId: string): AttentionValue {
		return this._attentionValues.get(nodeId) ?? { sti: 0, lti: 0 };
	}

	stimulate(nodeId: string, stiDelta: number): void {
		const current = this.getAttentionValue(nodeId);
		this.setAttentionValue(nodeId, {
			sti: current.sti + stiDelta,
			lti: current.lti,
		});
	}

	getAttentionalFocus(): string[] {
		const result: string[] = [];
		for (const [nodeId, av] of this._attentionValues) {
			if (av.sti >= this._focusBoundary) {
				result.push(nodeId);
			}
		}
		return result;
	}

	// -- Spreading activation ------------------------------------------------

	spreadActivation(): ECANSpreadEvent {
		const startTime = Date.now();
		this.membraneService.recordActivity('autonomic');

		const boosted: string[] = [];
		const decayed: string[] = [];
		const evicted: string[] = [];

		// Phase 1: Compute STI deltas from spreading along links
		const stiDeltas = new Map<string, number>();

		for (const [nodeId, av] of this._attentionValues) {
			if (av.sti <= 0) {
				continue; // Only spread from positively-valued nodes
			}

			const links = this.hypergraphStore.getLinksForNode(nodeId);
			if (links.length === 0) {
				continue;
			}

			const spreadAmount = av.sti * SPREAD_FRACTION;
			const perNeighbor = spreadAmount / links.length;

			for (const link of links) {
				for (const neighborId of link.outgoing) {
					if (neighborId === nodeId) {
						continue; // Don't spread to self
					}
					const currentDelta = stiDeltas.get(neighborId) ?? 0;
					stiDeltas.set(neighborId, currentDelta + perNeighbor);
				}
			}

			// The source loses the spread amount
			const currentSourceDelta = stiDeltas.get(nodeId) ?? 0;
			stiDeltas.set(nodeId, currentSourceDelta - spreadAmount);
		}

		// Phase 2: Apply STI deltas
		for (const [nodeId, delta] of stiDeltas) {
			const current = this.getAttentionValue(nodeId);
			const newSti = this._clampSTI(current.sti + delta);
			this._attentionValues.set(nodeId, { sti: newSti, lti: current.lti });

			if (delta > 0) {
				boosted.push(nodeId);
			} else if (delta < 0) {
				decayed.push(nodeId);
			}
		}

		// Phase 3: Rent collection — charge flat rent from all nodes
		let rentThisCycle = 0;
		for (const [nodeId, av] of this._attentionValues) {
			const newSti = this._clampSTI(av.sti - RENT_PER_CYCLE);
			this._attentionValues.set(nodeId, { sti: newSti, lti: av.lti });
			rentThisCycle += RENT_PER_CYCLE;

			// Evict nodes that fall below a hard floor
			if (newSti <= -0.5 && av.lti < 0.3) {
				this._attentionValues.delete(nodeId);
				evicted.push(nodeId);
			}
		}
		this._totalRentCollected += rentThisCycle;

		// Phase 4: Synchronize salience scores with hypergraph store
		for (const [nodeId, av] of this._attentionValues) {
			// Map STI [-1,1] to salience [0,1]
			const salience = (av.sti + 1) / 2;
			this.hypergraphStore.updateNode(nodeId, { salience_score: salience });
		}

		this._spreadingCycles++;
		const durationMs = Date.now() - startTime;

		const event: ECANSpreadEvent = { boosted, decayed, evicted, durationMs };
		this._onDidSpread.fire(event);

		this.logService.trace(
			`ECANAttentionService: spreading cycle ${this._spreadingCycles} — ` +
			`boosted=${boosted.length} decayed=${decayed.length} evicted=${evicted.length} (${durationMs}ms)`
		);

		return event;
	}

	// -- Configuration -------------------------------------------------------

	getFocusBoundary(): number {
		return this._focusBoundary;
	}

	setFocusBoundary(boundary: number): void {
		this._focusBoundary = this._clampSTI(boundary);
		this._onDidChangeFocusBoundary.fire(this._focusBoundary);
		this.logService.info(`ECANAttentionService: focus boundary set to ${this._focusBoundary}`);
	}

	getSnapshot(): ECANSnapshot {
		const focusNodes = this.getAttentionalFocus();
		return {
			attentionalFocusBoundary: this._focusBoundary,
			nodesInFocus: focusNodes.length,
			totalTrackedNodes: this._attentionValues.size,
			rentCollected: this._totalRentCollected,
			spreadingCycles: this._spreadingCycles,
			timestamp: Date.now(),
		};
	}

	reset(): void {
		this._attentionValues.clear();
		this._focusBoundary = DEFAULT_FOCUS_BOUNDARY;
		this._spreadingCycles = 0;
		this._totalRentCollected = 0;
		this.logService.info('ECANAttentionService: reset all attention values and counters');
	}

	// -- Private helpers -----------------------------------------------------

	private _clampSTI(value: number): number {
		return Math.max(-1, Math.min(1, value));
	}

	private _clampLTI(value: number): number {
		return Math.max(0, Math.min(1, value));
	}
}
