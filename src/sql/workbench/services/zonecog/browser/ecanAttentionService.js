"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
	var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
	if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
	else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
	return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
	return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ECANAttentionService = void 0;
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
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
let ECANAttentionService = class ECANAttentionService extends lifecycle_1.Disposable {
	logService;
	hypergraphStore;
	membraneService;
	_attentionValues = new Map();
	_focusBoundary = DEFAULT_FOCUS_BOUNDARY;
	_spreadingCycles = 0;
	_totalRentCollected = 0;
	_onDidSpread = this._register(new event_1.Emitter());
	onDidSpread = this._onDidSpread.event;
	_onDidChangeAttention = this._register(new event_1.Emitter());
	onDidChangeAttention = this._onDidChangeAttention.event;
	onDidSpreadingActivation = this._onDidSpread.event;
	_onDidChangeFocusBoundary = this._register(new event_1.Emitter());
	onDidChangeFocusBoundary = this._onDidChangeFocusBoundary.event;
	constructor(logService, hypergraphStore, membraneService) {
		super();
		this.logService = logService;
		this.hypergraphStore = hypergraphStore;
		this.membraneService = membraneService;
		this.logService.info('ECANAttentionService: initialized Economic Attention Network');
	}
	// -- Attention value management -------------------------------------------
	setAttentionValue(nodeId, av) {
		this._attentionValues.set(nodeId, {
			sti: this._clampSTI(av.sti),
			lti: this._clampLTI(av.lti),
		});
		this._onDidChangeAttention.fire();
	}
	getAttentionValue(nodeId) {
		return this._attentionValues.get(nodeId) ?? { sti: 0, lti: 0 };
	}
	stimulate(nodeId, stiDelta) {
		const current = this.getAttentionValue(nodeId);
		this.setAttentionValue(nodeId, {
			sti: current.sti + stiDelta,
			lti: current.lti,
		});
	}
	getAttentionalFocus() {
		const result = [];
		for (const [nodeId, av] of this._attentionValues) {
			if (av.sti >= this._focusBoundary) {
				result.push(nodeId);
			}
		}
		return result;
	}
	getTopByAttention(n) {
		return Array.from(this._attentionValues.entries())
			.sort((a, b) => b[1].sti - a[1].sti)
			.slice(0, n)
			.map(([nodeId, av]) => ({ nodeId, attentionValue: av.sti }));
	}
	// -- Spreading activation ------------------------------------------------
	spreadActivation() {
		const startTime = Date.now();
		this.membraneService.recordActivity('autonomic');
		const boosted = [];
		const decayed = [];
		const evicted = [];
		// Phase 1: Compute STI deltas from spreading along links
		const stiDeltas = new Map();
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
			}
			else if (delta < 0) {
				decayed.push(nodeId);
			}
		}
		// Phase 3: Rent collection - charge flat rent from all nodes
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
		const event = { boosted, decayed, evicted, durationMs };
		this._onDidSpread.fire(event);
		this._onDidChangeAttention.fire();
		this.logService.trace(`ECANAttentionService: spreading cycle ${this._spreadingCycles} - ` +
			`boosted=${boosted.length} decayed=${decayed.length} evicted=${evicted.length} (${durationMs}ms)`);
		return event;
	}
	// -- Configuration -------------------------------------------------------
	getFocusBoundary() {
		return this._focusBoundary;
	}
	setFocusBoundary(boundary) {
		this._focusBoundary = this._clampSTI(boundary);
		this._onDidChangeFocusBoundary.fire(this._focusBoundary);
		this.logService.info(`ECANAttentionService: focus boundary set to ${this._focusBoundary}`);
	}
	getSnapshot() {
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
	getState() {
		let totalAttention = 0;
		for (const av of this._attentionValues.values()) {
			totalAttention += av.sti;
		}
		return {
			totalNodes: this._attentionValues.size,
			importantCount: this.getAttentionalFocus().length,
			totalAttention,
			rentCycles: this._spreadingCycles,
			importantThreshold: this._focusBoundary,
		};
	}
	reset() {
		this._attentionValues.clear();
		this._focusBoundary = DEFAULT_FOCUS_BOUNDARY;
		this._spreadingCycles = 0;
		this._totalRentCollected = 0;
		this._onDidChangeAttention.fire();
		this.logService.info('ECANAttentionService: reset all attention values and counters');
	}
	// -- Private helpers -----------------------------------------------------
	_clampSTI(value) {
		return Math.max(-1, Math.min(1, value));
	}
	_clampLTI(value) {
		return Math.max(0, Math.min(1, value));
	}
};
exports.ECANAttentionService = ECANAttentionService;
exports.ECANAttentionService = ECANAttentionService = __decorate([
	__param(0, log_1.ILogService),
	__param(1, zonecogService_1.IHypergraphStore),
	__param(2, zonecogService_1.ICognitiveMembraneService)
], ECANAttentionService);
