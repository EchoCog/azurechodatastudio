/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IEmbodiedCognitionService,
	SensoryModality,
	SensoryPercept,
	MotorAction,
	MotorActionKind,
	ProprioceptiveState,
	EnvironmentSnapshot
} from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

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
function embodiedId(prefix: string, seed: string): string {
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
export class EmbodiedCognitionService extends Disposable implements IEmbodiedCognitionService {

	declare readonly _serviceBrand: undefined;

	private readonly _percepts: SensoryPercept[] = [];
	private readonly _actions: MotorAction[] = [];
	private _attentionalFocus: string | null = null;

	private readonly _onDidPerceive = this._register(new Emitter<SensoryPercept>());
	readonly onDidPerceive: Event<SensoryPercept> = this._onDidPerceive.event;

	private readonly _onDidAct = this._register(new Emitter<MotorAction>());
	readonly onDidAct: Event<MotorAction> = this._onDidAct.event;

	private readonly _onDidUpdateProprioception = this._register(new Emitter<ProprioceptiveState>());
	readonly onDidUpdateProprioception: Event<ProprioceptiveState> = this._onDidUpdateProprioception.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService
	) {
		super();
		this.logService.info('EmbodiedCognitionService: initialized sensorimotor grounding layer');
	}

	// -- Sensory input -------------------------------------------------------

	perceive(
		modality: SensoryModality,
		summary: string,
		payload: string,
		salience: number = 0.5
	): SensoryPercept {
		const timestamp = Date.now();
		const id = embodiedId('p', `${modality}:${timestamp}:${summary}`);
		const clampedSalience = Math.max(0, Math.min(1, salience));

		const percept: SensoryPercept = {
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

	getRecentPercepts(modality?: SensoryModality, limit: number = 20): SensoryPercept[] {
		let filtered = this._percepts;
		if (modality) {
			filtered = filtered.filter(p => p.modality === modality);
		}
		return filtered.slice(-limit);
	}

	// -- Motor output --------------------------------------------------------

	act(
		kind: MotorActionKind,
		label: string,
		payload: string,
		confidence: number,
		sourcePercepts: string[] = []
	): MotorAction {
		const timestamp = Date.now();
		const id = embodiedId('a', `${kind}:${timestamp}:${label}`);
		const clampedConfidence = Math.max(0, Math.min(1, confidence));

		const action: MotorAction = {
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

	getRecentActions(kind?: MotorActionKind, limit: number = 20): MotorAction[] {
		let filtered = this._actions;
		if (kind) {
			filtered = filtered.filter(a => a.kind === kind);
		}
		return filtered.slice(-limit);
	}

	// -- Proprioception ------------------------------------------------------

	getProprioceptiveState(): ProprioceptiveState {
		const activeModalities = new Set(
			this._percepts.slice(-50).map(p => p.modality)
		);

		return {
			cognitiveLoad: this._estimateCognitiveLoad(),
			attentionalFocus: this._attentionalFocus,
			activeSensoryChannels: activeModalities.size,
			pendingMotorActions: this._actions.filter(
				a => Date.now() - a.timestamp < 60_000
			).length,
			healthy: this.membraneService.isSystemHealthy(),
			lastUpdate: Date.now(),
		};
	}

	setAttentionalFocus(focus: string | null): void {
		this._attentionalFocus = focus;
		this.logService.info(`EmbodiedCognitionService: attentional focus ${focus ? `set to "${focus}"` : 'cleared'}`);
		this._fireProprioception();
	}

	// -- Environment ---------------------------------------------------------

	getEnvironmentSnapshot(): EnvironmentSnapshot {
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

	reset(): void {
		this._percepts.length = 0;
		this._actions.length = 0;
		this._attentionalFocus = null;
		this.logService.info('EmbodiedCognitionService: reset all sensory and motor history');
		this._fireProprioception();
	}

	// -- Private helpers -----------------------------------------------------

	private _estimateCognitiveLoad(): number {
		const recentWindow = 30_000; // 30 seconds
		const now = Date.now();
		const recentPercepts = this._percepts.filter(p => now - p.timestamp < recentWindow).length;
		const recentActions = this._actions.filter(a => now - a.timestamp < recentWindow).length;

		// Normalize: 10 percepts + 5 actions in 30s = load of ~1.0
		return Math.min(1, (recentPercepts / 10 + recentActions / 5) / 2);
	}

	private _fireProprioception(): void {
		this._onDidUpdateProprioception.fire(this.getProprioceptiveState());
	}
}
