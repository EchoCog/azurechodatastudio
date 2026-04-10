/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveMembraneService,
	MembraneTriad,
	MembraneStatus
} from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Maximum number of errors before a membrane is considered unhealthy.
 */
const ERROR_THRESHOLD = 10;

interface MembraneState {
	activeProcesses: number;
	errorCount: number;
	lastActivity: number;
	errors: string[];
}

/**
 * Cognitive Membrane service implementing the Cerebral / Somatic / Autonomic
 * triad architecture mapped from the P-System Membrane model.
 *
 * - **Cerebral** (Cognitive Membrane): Core cognitive processing, thinking
 *   protocol, reasoning — maps to thought-service, processing-director,
 *   processing-service, output-service.
 * - **Somatic** (Extension Membrane): Plugin container, UI interactions,
 *   bridge communication — maps to motor-control-service, sensory-service,
 *   processing-service, output-service.
 * - **Autonomic** (Security Membrane): Validation, state monitoring, error
 *   correction — maps to monitoring-service, state-management,
 *   process-director, processing-service, trigger-service.
 */
export class CognitiveMembraneService extends Disposable implements ICognitiveMembraneService {

	declare readonly _serviceBrand: undefined;

	private readonly _membranes = new Map<MembraneTriad, MembraneState>();

	private readonly _onDidChangeMembraneStatus = this._register(new Emitter<MembraneStatus>());
	readonly onDidChangeMembraneStatus: Event<MembraneStatus> = this._onDidChangeMembraneStatus.event;

	constructor(
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Initialise all three triads
		const triads: MembraneTriad[] = ['cerebral', 'somatic', 'autonomic'];
		for (const t of triads) {
			this._membranes.set(t, {
				activeProcesses: 0,
				errorCount: 0,
				lastActivity: Date.now(),
				errors: [],
			});
		}

		this.logService.info('CognitiveMembraneService: initialized Cerebral / Somatic / Autonomic triads');
	}

	recordActivity(triad: MembraneTriad): void {
		const state = this._getState(triad);
		state.activeProcesses++;
		state.lastActivity = Date.now();
		this._fireStatus(triad);
	}

	recordError(triad: MembraneTriad, message: string): void {
		const state = this._getState(triad);
		state.errorCount++;
		state.errors.push(message);
		// Keep a bounded error log
		if (state.errors.length > 50) {
			state.errors.shift();
		}
		this.logService.warn(`CognitiveMembraneService [${triad}]: ${message}`);
		this._fireStatus(triad);
	}

	getStatus(triad: MembraneTriad): MembraneStatus {
		const state = this._getState(triad);
		return {
			triad,
			healthy: state.errorCount < ERROR_THRESHOLD,
			activeProcesses: state.activeProcesses,
			errorCount: state.errorCount,
			lastActivity: state.lastActivity,
		};
	}

	getAllStatuses(): MembraneStatus[] {
		const triads: MembraneTriad[] = ['cerebral', 'somatic', 'autonomic'];
		return triads.map(t => this.getStatus(t));
	}

	isSystemHealthy(): boolean {
		return this.getAllStatuses().every(s => s.healthy);
	}

	resetErrors(triad: MembraneTriad): void {
		const state = this._getState(triad);
		state.errorCount = 0;
		state.errors = [];
		this.logService.info(`CognitiveMembraneService: reset errors for ${triad}`);
		this._fireStatus(triad);
	}

	// -- Private helpers -----------------------------------------------------

	private _getState(triad: MembraneTriad): MembraneState {
		const state = this._membranes.get(triad);
		if (!state) {
			throw new Error(`Unknown membrane triad: ${triad}`);
		}
		return state;
	}

	private _fireStatus(triad: MembraneTriad): void {
		this._onDidChangeMembraneStatus.fire(this.getStatus(triad));
	}
}
