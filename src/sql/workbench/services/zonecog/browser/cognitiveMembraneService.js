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
exports.CognitiveMembraneService = void 0;
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
/**
 * Maximum number of errors before a membrane is considered unhealthy.
 */
const ERROR_THRESHOLD = 10;
/**
 * Cognitive Membrane service implementing the Cerebral / Somatic / Autonomic
 * triad architecture mapped from the P-System Membrane model.
 *
 * - **Cerebral** (Cognitive Membrane): Core cognitive processing, thinking
 *   protocol, reasoning -- maps to thought-service, processing-director,
 *   processing-service, output-service.
 * - **Somatic** (Extension Membrane): Plugin container, UI interactions,
 *   bridge communication -- maps to motor-control-service, sensory-service,
 *   processing-service, output-service.
 * - **Autonomic** (Security Membrane): Validation, state monitoring, error
 *   correction -- maps to monitoring-service, state-management,
 *   process-director, processing-service, trigger-service.
 */
let CognitiveMembraneService = class CognitiveMembraneService extends lifecycle_1.Disposable {
	logService;
	_membranes = new Map();
	_onDidChangeMembraneStatus = this._register(new event_1.Emitter());
	onDidChangeMembraneStatus = this._onDidChangeMembraneStatus.event;
	constructor(logService) {
		super();
		this.logService = logService;
		// Initialise all three triads
		const triads = ['cerebral', 'somatic', 'autonomic'];
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
	recordActivity(triad) {
		const state = this._getState(triad);
		state.activeProcesses++;
		state.lastActivity = Date.now();
		this._fireStatus(triad);
	}
	recordError(triad, message) {
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
	getStatus(triad) {
		const state = this._getState(triad);
		return {
			triad,
			healthy: state.errorCount < ERROR_THRESHOLD,
			activeProcesses: state.activeProcesses,
			errorCount: state.errorCount,
			lastActivity: state.lastActivity,
		};
	}
	getActivity(triad) {
		return this._getState(triad).activeProcesses;
	}
	getAllStatuses() {
		const triads = ['cerebral', 'somatic', 'autonomic'];
		return triads.map(t => this.getStatus(t));
	}
	isSystemHealthy() {
		return this.getAllStatuses().every(s => s.healthy);
	}
	resetErrors(triad) {
		const state = this._getState(triad);
		state.errorCount = 0;
		state.errors = [];
		this.logService.info(`CognitiveMembraneService: reset errors for ${triad}`);
		this._fireStatus(triad);
	}
	// -- Private helpers -----------------------------------------------------
	_getState(triad) {
		const state = this._membranes.get(triad);
		if (!state) {
			throw new Error(`Unknown membrane triad: ${triad}`);
		}
		return state;
	}
	_fireStatus(triad) {
		this._onDidChangeMembraneStatus.fire(this.getStatus(triad));
	}
};
exports.CognitiveMembraneService = CognitiveMembraneService;
exports.CognitiveMembraneService = CognitiveMembraneService = __decorate([
	__param(0, log_1.ILogService)
], CognitiveMembraneService);
