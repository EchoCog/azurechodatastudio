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
exports.EmbodiedCognitionService = void 0;
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
/**
 * Maximum number of percepts retained in the sensory buffer.
 */
const MAX_PERCEPTS = 200;
/**
 * Maximum number of motor actions retained in the action log.
 */
const MAX_ACTIONS = 100;
/**
 * Generate a stable short id from a string seed.
 */
function embodiedId(prefix, seed) {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}
	return `ec_${prefix}_${Math.abs(hash).toString(36)}`;
}
/**
 * Implementation of the Embodied Cognition Service.
 *
 * Bridges abstract cognitive processing with the concrete workspace
 * environment through a sensorimotor grounding loop:
 *
 *   Perceive (sensory) --> Think (cognitive) --> Act (motor) --> Observe (proprioception)
 *
 * Percepts and actions are persisted in the hypergraph store as
 * `SensoryPercept` and `MotorAction` node types, creating an
 * experiential trace that cognitive processing can reference.
 */
let EmbodiedCognitionService = class EmbodiedCognitionService extends lifecycle_1.Disposable {
	logService;
	hypergraphStore;
	membraneService;
	_percepts = [];
	_actions = [];
	_attentionalFocus = null;
	_onDidPerceive = this._register(new event_1.Emitter());
	onDidPerceive = this._onDidPerceive.event;
	_onDidAct = this._register(new event_1.Emitter());
	onDidAct = this._onDidAct.event;
	_onDidUpdateProprioception = this._register(new event_1.Emitter());
	onDidUpdateProprioception = this._onDidUpdateProprioception.event;
	constructor(logService, hypergraphStore, membraneService) {
		super();
		this.logService = logService;
		this.hypergraphStore = hypergraphStore;
		this.membraneService = membraneService;
		this.logService.info('EmbodiedCognitionService: initialized sensorimotor grounding layer');
	}
	// -- Sensory input -------------------------------------------------------
	perceive(modality, summary, payload, salience = 0.5) {
		const timestamp = Date.now();
		const id = embodiedId('p', `${modality}:${timestamp}:${summary}`);
		const clampedSalience = Math.max(0, Math.min(1, salience));
		const percept = {
			id,
			modality,
			summary,
			payload,
			salience: clampedSalience,
			timestamp,
		};
		this._percepts.push(percept);
		if (this._percepts.length > MAX_PERCEPTS) {
			this._percepts.shift();
		}
		// Persist in hypergraph for cognitive access
		this.hypergraphStore.addNode({
			id,
			node_type: 'SensoryPercept',
			content: summary,
			links: [],
			metadata: { modality, payloadLength: payload.length, timestamp },
			salience_score: clampedSalience,
		});
		this.membraneService.recordActivity('somatic');
		this._onDidPerceive.fire(percept);
		this._fireProprioception();
		this.logService.trace(`EmbodiedCognitionService: perceived [${modality}] ${summary}`);
		return percept;
	}
	getRecentPercepts(modality, limit = 20) {
		let filtered = this._percepts;
		if (modality) {
			filtered = filtered.filter(p => p.modality === modality);
		}
		return filtered.slice(-limit);
	}
	// -- Motor output --------------------------------------------------------
	act(kind, label, payload, confidence, sourcePercepts = []) {
		const timestamp = Date.now();
		const id = embodiedId('a', `${kind}:${timestamp}:${label}`);
		const clampedConfidence = Math.max(0, Math.min(1, confidence));
		const action = {
			id,
			kind,
			label,
			payload,
			confidence: clampedConfidence,
			sourcePercepts,
			timestamp,
		};
		this._actions.push(action);
		if (this._actions.length > MAX_ACTIONS) {
			this._actions.shift();
		}
		// Persist in hypergraph
		this.hypergraphStore.addNode({
			id,
			node_type: 'MotorAction',
			content: label,
			links: [],
			metadata: { kind, confidence: clampedConfidence, sourcePercepts, timestamp },
			salience_score: clampedConfidence,
		});
		// Link action to its source percepts
		for (const perceptId of sourcePercepts) {
			const linkId = embodiedId('l', `${id}:${perceptId}`);
			this.hypergraphStore.addLink({
				id: linkId,
				link_type: 'MotivatedBy',
				outgoing: [id, perceptId],
				metadata: {},
			});
		}
		this.membraneService.recordActivity('somatic');
		this._onDidAct.fire(action);
		this._fireProprioception();
		this.logService.trace(`EmbodiedCognitionService: acted [${kind}] ${label}`);
		return action;
	}
	getRecentActions(kind, limit = 20) {
		let filtered = this._actions;
		if (kind) {
			filtered = filtered.filter(a => a.kind === kind);
		}
		return filtered.slice(-limit);
	}
	// -- Proprioception ------------------------------------------------------
	getProprioceptiveState() {
		const activeModalities = new Set(this._percepts.slice(-50).map(p => p.modality));
		return {
			cognitiveLoad: this._estimateCognitiveLoad(),
			attentionalFocus: this._attentionalFocus,
			activeSensoryChannels: activeModalities.size,
			pendingMotorActions: this._actions.filter(a => Date.now() - a.timestamp < 60_000).length,
			healthy: this.membraneService.isSystemHealthy(),
			lastUpdate: Date.now(),
		};
	}
	setAttentionalFocus(focus) {
		this._attentionalFocus = focus;
		this.logService.info(`EmbodiedCognitionService: attentional focus ${focus ? `set to "${focus}"` : 'cleared'}`);
		this._fireProprioception();
	}
	// -- Environment ---------------------------------------------------------
	getEnvironmentSnapshot() {
		const schemaPercepts = this._percepts.filter(p => p.modality === 'schema');
		const queryPercepts = this._percepts.filter(p => p.modality === 'query');
		return {
			knownSchemas: [...new Set(schemaPercepts.map(p => p.summary))],
			recentQueryPatterns: [...new Set(queryPercepts.slice(-10).map(p => p.summary))],
			activeContext: this._attentionalFocus,
			totalPercepts: this._percepts.length,
			totalActions: this._actions.length,
			timestamp: Date.now(),
		};
	}
	reset() {
		this._percepts.length = 0;
		this._actions.length = 0;
		this._attentionalFocus = null;
		this.logService.info('EmbodiedCognitionService: reset all sensory and motor history');
		this._fireProprioception();
	}
	// -- Private helpers -----------------------------------------------------
	_estimateCognitiveLoad() {
		const recentWindow = 30_000; // 30 seconds
		const now = Date.now();
		const recentPercepts = this._percepts.filter(p => now - p.timestamp < recentWindow).length;
		const recentActions = this._actions.filter(a => now - a.timestamp < recentWindow).length;
		// Normalize: 10 percepts + 5 actions in 30s = load of ~1.0
		return Math.min(1, (recentPercepts / 10 + recentActions / 5) / 2);
	}
	_fireProprioception() {
		this._onDidUpdateProprioception.fire(this.getProprioceptiveState());
	}
};
exports.EmbodiedCognitionService = EmbodiedCognitionService;
exports.EmbodiedCognitionService = EmbodiedCognitionService = __decorate([
	__param(0, log_1.ILogService),
	__param(1, zonecogService_1.IHypergraphStore),
	__param(2, zonecogService_2.ICognitiveMembraneService)
], EmbodiedCognitionService);
