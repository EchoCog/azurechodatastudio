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
exports.AAROrchestrationService = exports.BUILTIN_AGENT_IDS = void 0;
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const embodiedCognition_1 = require("sql/workbench/services/zonecog/common/embodiedCognition");
const ecanAttention_1 = require("sql/workbench/services/zonecog/common/ecanAttention");
const cognitiveWorkspace_1 = require("sql/workbench/services/zonecog/common/cognitiveWorkspace");
const cognitiveLoop_1 = require("sql/workbench/services/zonecog/common/cognitiveLoop");
const zonecogService_2 = require("sql/workbench/services/zonecog/common/zonecogService");
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
// ---------------------------------------------------------------------------
// Built-in agent IDs
// ---------------------------------------------------------------------------
exports.BUILTIN_AGENT_IDS = {
	PERCEIVER: 'perceive-agent',
	ATTENDER: 'attend-agent',
	THINKER: 'think-agent',
	ACTOR: 'act-agent',
	REFLECTOR: 'reflect-agent',
	ORCHESTRATOR: 'orchestrator-agent',
};
// Default perceive → attend → think → act → reflect pipeline
const DEFAULT_PIPELINE = [
	exports.BUILTIN_AGENT_IDS.PERCEIVER,
	exports.BUILTIN_AGENT_IDS.ATTENDER,
	exports.BUILTIN_AGENT_IDS.THINKER,
	exports.BUILTIN_AGENT_IDS.ACTOR,
	exports.BUILTIN_AGENT_IDS.REFLECTOR,
];
// ---------------------------------------------------------------------------
// AAR Orchestration Service implementation
// ---------------------------------------------------------------------------
/**
 * Agent-Arena-Relation (AAR) Orchestration Service.
 *
 * Registers the five built-in cognitive agents at construction time and
 * defines the canonical relation chain:
 *
 *   perceive-agent  feeds-into  attend-agent
 *   attend-agent    feeds-into  think-agent
 *   think-agent     feeds-into  act-agent
 *   act-agent       feeds-into  reflect-agent
 *
 * Task routing:
 * 1. Resolve the set of active agents whose capabilities satisfy the task.
 * 2. Walk the relation graph (BFS, highest-weight edges first) to build a path.
 * 3. If no path can be found, fall back to the default pipeline.
 * 4. Call each agent's handler function in order, chaining the output.
 */
let AAROrchestrationService = class AAROrchestrationService extends lifecycle_1.Disposable {
	logService;
	hypergraphStore;
	membraneService;
	embodiedService;
	ecanService;
	zonecogService;
	workspaceService;
	_loopService;
	_agents = new Map();
	_relations = new Map();
	_activeTasks = new Map();
	_sharedContext = new Map();
	_sessionId = `arena-${Date.now()}`;
	_startTime = Date.now();
	_totalTasksOrchestrated = 0;
	_successfulTasks = 0;
	/** Per-instance monotonic counter used to generate unique task IDs. */
	_taskCounter = 0;
	/** Per-agent async handlers for cognitive processing. */
	_agentHandlers = new Map();
	_onDidChangeAgent = this._register(new event_1.Emitter());
	onDidChangeAgent = this._onDidChangeAgent.event;
	_onDidChangeRelation = this._register(new event_1.Emitter());
	onDidChangeRelation = this._onDidChangeRelation.event;
	_onDidCompleteTask = this._register(new event_1.Emitter());
	onDidCompleteTask = this._onDidCompleteTask.event;
	constructor(logService, hypergraphStore, membraneService, embodiedService, ecanService, zonecogService, workspaceService, _loopService) {
		super();
		this.logService = logService;
		this.hypergraphStore = hypergraphStore;
		this.membraneService = membraneService;
		this.embodiedService = embodiedService;
		this.ecanService = ecanService;
		this.zonecogService = zonecogService;
		this.workspaceService = workspaceService;
		this._loopService = _loopService;
		this._bootstrapBuiltinAgents();
		this._bootstrapBuiltinRelations();
		this.logService.info(`AAROrchestrationService: Arena '${this._sessionId}' ready - ` +
			`${this._agents.size} agents, ${this._relations.size} relations`);
		this.membraneService.recordActivity('autonomic');
	}
	// -------------------------------------------------------------------------
	// Bootstrap
	// -------------------------------------------------------------------------
	_bootstrapBuiltinAgents() {
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.ORCHESTRATOR, 'AAR Orchestrator', 'orchestrator', ['orchestration', 'routing'], async (payload) => payload); // identity - orchestrator just routes
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.PERCEIVER, 'Perceive Agent', 'perceiver', ['perception', 'sensing', 'embodiment'], async (payload, ctx) => {
			const query = typeof payload === 'string' ? payload : JSON.stringify(payload);
			const percept = this.embodiedService.perceive('interaction', `AAR task input: ${query.substring(0, 120)}`, query, 0.6);
			ctx.set('percept_id', percept.id);
			ctx.set('percept_salience', percept.salience);
			this.membraneService.recordActivity('somatic');
			return { percept, query };
		});
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.ATTENDER, 'Attend Agent', 'attender', ['attention', 'ecan', 'salience'], async (_payload, ctx) => {
			const spreadResult = this.ecanService.spreadActivation();
			const focus = this.ecanService.getAttentionalFocus();
			ctx.set('attention_focus', focus);
			ctx.set('spread_result', spreadResult);
			this.membraneService.recordActivity('cerebral');
			return { focusNodeIds: focus, spreadResult };
		});
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.THINKER, 'Think Agent', 'thinker', ['reasoning', 'cognition', 'synthesis'], async (payload, ctx) => {
			const query = this._extractQuery(payload, ctx);
			try {
				await this.zonecogService.initialize();
				const response = await this.zonecogService.processQuery(query);
				ctx.set('cognitive_response', response);
				ctx.set('cognitive_confidence', response.confidence);
				this.membraneService.recordActivity('cerebral');
				return { response, query };
			}
			catch (err) {
				this.logService.error('AAROrchestrationService: think-agent error', err);
				return { response: null, query, error: String(err) };
			}
		});
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.ACTOR, 'Act Agent', 'actor', ['action', 'workspace', 'output'], async (payload, ctx) => {
			const cogResponse = ctx.get('cognitive_response');
			const content = cogResponse?.response ?? this._extractQuery(payload, ctx);
			const confidence = ctx.get('cognitive_confidence') ?? 0.5;
			const action = this.embodiedService.act('insight', 'AAR cognitive insight', content, confidence, ctx.has('percept_id') ? [ctx.get('percept_id')] : []);
			// Add insight to working memory
			this.workspaceService.addToWorkingMemory('insight', content, confidence);
			ctx.set('motor_action', action);
			this.membraneService.recordActivity('somatic');
			return { action, content };
		});
		this._registerBuiltin(exports.BUILTIN_AGENT_IDS.REFLECTOR, 'Reflect Agent', 'reflector', ['reflection', 'meta-cognition', 'episodic'], async (_payload, ctx) => {
			// Record an episode summarising what happened in this iteration
			const confidence = ctx.get('cognitive_confidence') ?? 0.5;
			const episodeSummary = this._buildEpisodeSummary(ctx);
			const episode = this.workspaceService.recordEpisode('AAR Orchestration', episodeSummary);
			// Persist state snapshot to hypergraph
			this.hypergraphStore.addNode({
				id: `aar-reflection-${Date.now()}`,
				node_type: 'AARReflection',
				content: episodeSummary,
				links: [],
				metadata: { episodeId: episode.id, sessionId: this._sessionId },
				salience_score: confidence * 0.8,
			});
			this.membraneService.recordActivity('autonomic');
			return { episode, summary: episodeSummary };
		});
	}
	_registerBuiltin(id, name, role, capabilities, handler) {
		const agent = {
			id, name, role, capabilities, active: true,
			lastActivationTime: 0, totalTasksProcessed: 0,
		};
		this._agents.set(id, agent);
		this._agentHandlers.set(id, handler);
	}
	_bootstrapBuiltinRelations() {
		const chain = [
			[exports.BUILTIN_AGENT_IDS.PERCEIVER, exports.BUILTIN_AGENT_IDS.ATTENDER, 'feeds-into'],
			[exports.BUILTIN_AGENT_IDS.ATTENDER, exports.BUILTIN_AGENT_IDS.THINKER, 'feeds-into'],
			[exports.BUILTIN_AGENT_IDS.THINKER, exports.BUILTIN_AGENT_IDS.ACTOR, 'feeds-into'],
			[exports.BUILTIN_AGENT_IDS.ACTOR, exports.BUILTIN_AGENT_IDS.REFLECTOR, 'feeds-into'],
			[exports.BUILTIN_AGENT_IDS.ORCHESTRATOR, exports.BUILTIN_AGENT_IDS.PERCEIVER, 'requests'],
		];
		for (const [src, tgt, type] of chain) {
			const rel = {
				id: `${src}→${tgt}`,
				sourceAgentId: src,
				targetAgentId: tgt,
				relationType: type,
				weight: 1.0,
				active: true,
			};
			this._relations.set(rel.id, rel);
		}
	}
	// -------------------------------------------------------------------------
	// Agent management
	// -------------------------------------------------------------------------
	registerAgent(agent) {
		if (this._agents.has(agent.id)) {
			this.logService.warn(`AAROrchestrationService: agent '${agent.id}' already registered`);
			return false;
		}
		const full = { ...agent, lastActivationTime: 0, totalTasksProcessed: 0 };
		this._agents.set(agent.id, full);
		this._onDidChangeAgent.fire(full);
		this.logService.info(`AAROrchestrationService: registered agent '${agent.name}' (${agent.id})`);
		return true;
	}
	unregisterAgent(agentId) {
		const agent = this._agents.get(agentId);
		if (!agent) {
			return false;
		}
		this._agents.delete(agentId);
		this._agentHandlers.delete(agentId);
		this.logService.info(`AAROrchestrationService: unregistered agent '${agentId}'`);
		return true;
	}
	getAgent(agentId) { return this._agents.get(agentId); }
	getAllAgents() { return Array.from(this._agents.values()); }
	setAgentActive(agentId, active) {
		const agent = this._agents.get(agentId);
		if (agent) {
			agent.active = active;
			this._onDidChangeAgent.fire(agent);
		}
	}
	// -------------------------------------------------------------------------
	// Relation management
	// -------------------------------------------------------------------------
	defineRelation(relation) {
		if (this._relations.has(relation.id)) {
			return false;
		}
		this._relations.set(relation.id, relation);
		this._onDidChangeRelation.fire(relation);
		return true;
	}
	removeRelation(relationId) {
		const rel = this._relations.get(relationId);
		if (!rel) {
			return false;
		}
		this._relations.delete(relationId);
		return true;
	}
	getRelationsFrom(agentId) {
		return Array.from(this._relations.values()).filter(r => r.sourceAgentId === agentId && r.active);
	}
	getRelationsTo(agentId) {
		return Array.from(this._relations.values()).filter(r => r.targetAgentId === agentId && r.active);
	}
	async dispatchAction(agentId, action) {
		const handler = this._agentHandlers.get(agentId);
		if (!handler) {
			throw new Error(`AAROrchestrationService: unknown agent '${agentId}'`);
		}
		this.membraneService.recordActivity('somatic');
		return handler(action.parameters ?? action.target, new Map());
	}
	// -------------------------------------------------------------------------
	// Orchestration
	// -------------------------------------------------------------------------
	async orchestrate(taskSpec) {
		const task = {
			...taskSpec,
			id: `aar-task-${Date.now()}-${++this._taskCounter}`,
			createdAt: Date.now(),
		};
		// Check deadline
		if (task.deadline && task.deadline < Date.now()) {
			return this._failTask(task, [], 'Task expired before orchestration');
		}
		const t0 = Date.now();
		const activeTask = {
			task,
			startTime: t0,
			currentAgentId: exports.BUILTIN_AGENT_IDS.ORCHESTRATOR,
		};
		this._activeTasks.set(task.id, activeTask);
		this._totalTasksOrchestrated++;
		// Resolve the agent pipeline for this task
		const pipeline = this._resolvePipeline(task);
		const agentDurations = {};
		const taskContext = new Map(this._sharedContext);
		taskContext.set('task_id', task.id);
		taskContext.set('task_payload', task.payload);
		let currentPayload = task.payload;
		const agentPath = [];
		try {
			for (const agentId of pipeline) {
				const agent = this._agents.get(agentId);
				if (!agent || !agent.active) {
					continue;
				}
				activeTask.currentAgentId = agentId;
				agentPath.push(agentId);
				const handler = this._agentHandlers.get(agentId);
				if (!handler) {
					continue;
				}
				const agentT0 = Date.now();
				try {
					currentPayload = await handler(currentPayload, taskContext);
				}
				catch (err) {
					this.logService.warn(`AAROrchestrationService: agent '${agentId}' error - ${err}`);
					this.membraneService.recordError('autonomic', `AAR agent ${agentId}: ${err}`);
					// Continue pipeline even on agent error (graceful degradation)
				}
				agentDurations[agentId] = Date.now() - agentT0;
				agent.lastActivationTime = Date.now();
				agent.totalTasksProcessed++;
			}
			this._activeTasks.delete(task.id);
			this._successfulTasks++;
			const result = {
				task,
				agentPath,
				output: currentPayload,
				success: true,
				totalDurationMs: Date.now() - t0,
				agentDurations,
			};
			this._onDidCompleteTask.fire(result);
			return result;
		}
		catch (err) {
			this._activeTasks.delete(task.id);
			const result = this._failTask(task, agentPath, String(err));
			result.totalDurationMs = Date.now() - t0;
			result.agentDurations = agentDurations;
			this._onDidCompleteTask.fire(result);
			return result;
		}
	}
	_resolvePipeline(task) {
		if (task.requiredCapabilities.length === 0) {
			return DEFAULT_PIPELINE;
		}
		// Find agents that satisfy required capabilities
		const candidates = Array.from(this._agents.values()).filter(a => a.active &&
			task.requiredCapabilities.every((cap) => a.capabilities.includes(cap)));
		if (candidates.length === 0) {
			return DEFAULT_PIPELINE;
		}
		// BFS from orchestrator through relations, collecting capability-matching nodes
		const visited = new Set();
		const pipeline = [];
		const queue = [exports.BUILTIN_AGENT_IDS.ORCHESTRATOR];
		while (queue.length > 0) {
			const current = queue.shift();
			if (visited.has(current)) {
				continue;
			}
			visited.add(current);
			// Include in pipeline if it satisfies any required capability
			if (candidates.some(c => c.id === current)) {
				pipeline.push(current);
			}
			// Follow outgoing relations (highest weight first)
			const outgoing = this.getRelationsFrom(current)
				.sort((a, b) => b.weight - a.weight);
			for (const rel of outgoing) {
				if (!visited.has(rel.targetAgentId)) {
					queue.push(rel.targetAgentId);
				}
			}
		}
		return pipeline.length > 0 ? pipeline : DEFAULT_PIPELINE;
	}
	_failTask(task, agentPath, error) {
		this.logService.error(`AAROrchestrationService: task '${task.id}' failed - ${error}`);
		this.membraneService.recordError('autonomic', `AAR task failed: ${error}`);
		return {
			task, agentPath, output: null, success: false, error,
			totalDurationMs: 0, agentDurations: {},
		};
	}
	getActiveTasks() {
		return Array.from(this._activeTasks.values());
	}
	// -------------------------------------------------------------------------
	// Arena state
	// -------------------------------------------------------------------------
	getArenaState() {
		return {
			sessionId: this._sessionId,
			startTime: this._startTime,
			totalTasksOrchestrated: this._totalTasksOrchestrated,
			successfulTasks: this._successfulTasks,
			agentCount: this._agents.size,
			relationCount: this._relations.size,
			activeTaskCount: this._activeTasks.size,
			sharedContextKeys: Array.from(this._sharedContext.keys()),
		};
	}
	setSharedContext(key, value) { this._sharedContext.set(key, value); }
	getSharedContext(key) { return this._sharedContext.get(key); }
	reset() {
		this._activeTasks.clear();
		this._sharedContext.clear();
		this._totalTasksOrchestrated = 0;
		this._successfulTasks = 0;
		// Reset agent counters
		for (const agent of this._agents.values()) {
			agent.totalTasksProcessed = 0;
			agent.lastActivationTime = 0;
		}
		this.logService.info('AAROrchestrationService: Arena reset');
	}
	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------
	_extractQuery(payload, ctx) {
		if (typeof payload === 'string') {
			return payload;
		}
		if (payload && typeof payload === 'object') {
			const p = payload;
			if (typeof p['query'] === 'string') {
				return p['query'];
			}
			if (typeof p['percept'] === 'object' && p['percept'] !== null) {
				return p['percept']['summary'] ?? '';
			}
		}
		const ctxPayload = ctx.get('task_payload');
		if (typeof ctxPayload === 'string') {
			return ctxPayload;
		}
		return '';
	}
	_buildEpisodeSummary(ctx) {
		const parts = [];
		const perceptId = ctx.get('percept_id');
		const confidence = ctx.get('cognitive_confidence');
		const focusNodes = ctx.get('attention_focus');
		if (perceptId) {
			parts.push(`percept:${perceptId}`);
		}
		if (confidence !== undefined) {
			parts.push(`conf:${confidence.toFixed(2)}`);
		}
		if (focusNodes?.length) {
			parts.push(`focus:${focusNodes.length}nodes`);
		}
		return `AAR orchestration - ${parts.join(', ') || 'no context'}`;
	}
	// -------------------------------------------------------------------------
	// Cognitive loop integration
	// -------------------------------------------------------------------------
	/**
	 * Query the current state of the cognitive loop to inform orchestration
	 * decisions (e.g., defer heavy processing if loop is under load).
	 */
	getCognitiveLoopState() {
		return this._loopService.getState();
	}
	/**
	 * Check whether the cognitive loop is currently available to receive
	 * new orchestration tasks without causing backpressure.
	 */
	isLoopReadyForOrchestration() {
		const loopState = this._loopService.getState();
		// Ready if the loop is running and not paused
		return loopState.running && !loopState.paused;
	}
};
exports.AAROrchestrationService = AAROrchestrationService;
exports.AAROrchestrationService = AAROrchestrationService = __decorate([
	__param(0, log_1.ILogService),
	__param(1, zonecogService_1.IHypergraphStore),
	__param(2, zonecogService_1.ICognitiveMembraneService),
	__param(3, embodiedCognition_1.IEmbodiedCognitionService),
	__param(4, ecanAttention_1.IECANAttentionService),
	__param(5, zonecogService_2.IZoneCogService),
	__param(6, cognitiveWorkspace_1.ICognitiveWorkspaceService),
	__param(7, cognitiveLoop_1.ICognitiveLoopService)
], AAROrchestrationService);
