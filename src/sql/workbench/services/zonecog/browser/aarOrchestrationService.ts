/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IAAROrchestrationService,
	AARAgent,
	AARAgentRole,
	AARRelation,
	AARRelationType,
	AARTask,
	AARTaskResult,
	AARActiveTask,
	RemoteCognitiveNode,
	RemoteAgent,
	AgentSpawnRequest,
	AgentSpawnResult,
	AgentMigrationRequest,
	AgentMigrationResult,
	DistributedAgentMessage,
	ConsensusProposal,
} from 'sql/workbench/services/zonecog/common/aarOrchestration';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { IZoneCogService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';

// ---------------------------------------------------------------------------
// Built-in agent IDs
// ---------------------------------------------------------------------------

export const BUILTIN_AGENT_IDS = {
	PERCEIVER: 'perceive-agent',
	ATTENDER: 'attend-agent',
	THINKER: 'think-agent',
	ACTOR: 'act-agent',
	REFLECTOR: 'reflect-agent',
	ORCHESTRATOR: 'orchestrator-agent',
} as const;

// Default perceive → attend → think → act → reflect pipeline
const DEFAULT_PIPELINE: string[] = [
	BUILTIN_AGENT_IDS.PERCEIVER,
	BUILTIN_AGENT_IDS.ATTENDER,
	BUILTIN_AGENT_IDS.THINKER,
	BUILTIN_AGENT_IDS.ACTOR,
	BUILTIN_AGENT_IDS.REFLECTOR,
];

/** Default consensus quorum (majority). */
const DEFAULT_CONSENSUS_QUORUM = 0.51;

/** Default consensus deadline (30 seconds). */
const DEFAULT_CONSENSUS_DEADLINE_MS = 30000;

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
export class AAROrchestrationService extends Disposable implements IAAROrchestrationService {

	declare readonly _serviceBrand: undefined;

	private readonly _agents = new Map<string, AARAgent>();
	private readonly _relations = new Map<string, AARRelation>();
	private readonly _activeTasks = new Map<string, AARActiveTask>();
	private readonly _sharedContext = new Map<string, unknown>();
	private readonly _sessionId = `arena-${Date.now()}`;
	private readonly _startTime = Date.now();
	private _totalTasksOrchestrated = 0;
	private _successfulTasks = 0;
	/** Per-instance monotonic counter used to generate unique task IDs. */
	private _taskCounter = 0;

	/** Per-agent async handlers for cognitive processing. */
	private readonly _agentHandlers = new Map<string, (payload: unknown, context: Map<string, unknown>) => Promise<unknown>>();

	// Distributed AAR state (Phase C: FlareCog)
	private readonly _remoteNodes = new Map<string, RemoteCognitiveNode>();
	private readonly _remoteAgents = new Map<string, RemoteAgent>();
	private readonly _consensusProposals = new Map<string, ConsensusProposal>();
	private _messagesSent = 0;
	private _messagesReceived = 0;
	private _migrationCount = 0;
	private _consensusProposalsResolved = 0;

	private readonly _onDidChangeAgent = this._register(new Emitter<AARAgent>());
	readonly onDidChangeAgent: Event<AARAgent> = this._onDidChangeAgent.event;

	private readonly _onDidChangeRelation = this._register(new Emitter<AARRelation>());
	readonly onDidChangeRelation: Event<AARRelation> = this._onDidChangeRelation.event;

	private readonly _onDidCompleteTask = this._register(new Emitter<AARTaskResult>());
	readonly onDidCompleteTask: Event<AARTaskResult> = this._onDidCompleteTask.event;

	private readonly _onDidChangeRemoteNode = this._register(new Emitter<RemoteCognitiveNode>());
	readonly onDidChangeRemoteNode: Event<RemoteCognitiveNode> = this._onDidChangeRemoteNode.event;

	private readonly _onDidMigrateAgent = this._register(new Emitter<AgentMigrationResult>());
	readonly onDidMigrateAgent: Event<AgentMigrationResult> = this._onDidMigrateAgent.event;

	private readonly _onDidResolveConsensus = this._register(new Emitter<ConsensusProposal>());
	readonly onDidResolveConsensus: Event<ConsensusProposal> = this._onDidResolveConsensus.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@IEmbodiedCognitionService private readonly embodiedService: IEmbodiedCognitionService,
		@IECANAttentionService private readonly ecanService: IECANAttentionService,
		@IZoneCogService private readonly zonecogService: IZoneCogService,
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService,
		@ICognitiveLoopService private readonly _loopService: ICognitiveLoopService,
	) {
		super();
		this._bootstrapBuiltinAgents();
		this._bootstrapBuiltinRelations();
		this.logService.info(`AAROrchestrationService: Arena '${this._sessionId}' ready - ` +
			`${this._agents.size} agents, ${this._relations.size} relations`);
		this.membraneService.recordActivity('autonomic');
	}

	// -------------------------------------------------------------------------
	// Bootstrap
	// -------------------------------------------------------------------------

	private _bootstrapBuiltinAgents(): void {
		this._registerBuiltin(BUILTIN_AGENT_IDS.ORCHESTRATOR, 'AAR Orchestrator', 'orchestrator',
			['orchestration', 'routing'],
			async (payload) => payload); // identity - orchestrator just routes

		this._registerBuiltin(BUILTIN_AGENT_IDS.PERCEIVER, 'Perceive Agent', 'perceiver',
			['perception', 'sensing', 'embodiment'],
			async (payload, ctx) => {
				const query = typeof payload === 'string' ? payload : JSON.stringify(payload);
				const percept = this.embodiedService.perceive('interaction',
					`AAR task input: ${query.substring(0, 120)}`, query, 0.6);
				ctx.set('percept_id', percept.id);
				ctx.set('percept_salience', percept.salience);
				this.membraneService.recordActivity('somatic');
				return { percept, query };
			});

		this._registerBuiltin(BUILTIN_AGENT_IDS.ATTENDER, 'Attend Agent', 'attender',
			['attention', 'ecan', 'salience'],
			async (_payload, ctx) => {
				const spreadResult = this.ecanService.spreadActivation();
				const focus = this.ecanService.getAttentionalFocus();
				ctx.set('attention_focus', focus);
				ctx.set('spread_result', spreadResult);
				this.membraneService.recordActivity('cerebral');
				return { focusNodeIds: focus, spreadResult };
			});

		this._registerBuiltin(BUILTIN_AGENT_IDS.THINKER, 'Think Agent', 'thinker',
			['reasoning', 'cognition', 'synthesis'],
			async (payload, ctx) => {
				const query = this._extractQuery(payload, ctx);
				try {
					await this.zonecogService.initialize();
					const response = await this.zonecogService.processQuery(query);
					ctx.set('cognitive_response', response);
					ctx.set('cognitive_confidence', response.confidence);
					this.membraneService.recordActivity('cerebral');
					return { response, query };
				} catch (err) {
					this.logService.error('AAROrchestrationService: think-agent error', err);
					return { response: null, query, error: String(err) };
				}
			});

		this._registerBuiltin(BUILTIN_AGENT_IDS.ACTOR, 'Act Agent', 'actor',
			['action', 'workspace', 'output'],
			async (payload, ctx) => {
				const cogResponse = ctx.get('cognitive_response') as { response: string } | undefined;
				const content = cogResponse?.response ?? this._extractQuery(payload, ctx);
				const confidence = (ctx.get('cognitive_confidence') as number | undefined) ?? 0.5;
				const action = this.embodiedService.act(
					'insight',
					'AAR cognitive insight',
					content,
					confidence,
					ctx.has('percept_id') ? [ctx.get('percept_id') as string] : []
				);
				// Add insight to working memory
				this.workspaceService.addToWorkingMemory('insight', content, confidence);
				ctx.set('motor_action', action);
				this.membraneService.recordActivity('somatic');
				return { action, content };
			});

		this._registerBuiltin(BUILTIN_AGENT_IDS.REFLECTOR, 'Reflect Agent', 'reflector',
			['reflection', 'meta-cognition', 'episodic'],
			async (_payload, ctx) => {
				// Record an episode summarising what happened in this iteration
				const confidence = (ctx.get('cognitive_confidence') as number | undefined) ?? 0.5;
				const episodeSummary = this._buildEpisodeSummary(ctx);
				const episode = this.workspaceService.recordEpisode(
					'AAR Orchestration',
					episodeSummary
				);
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

	private _registerBuiltin(
		id: string, name: string, role: AARAgentRole, capabilities: string[],
		handler: (payload: unknown, ctx: Map<string, unknown>) => Promise<unknown>
	): void {
		const agent: AARAgent = {
			id, name, role, capabilities, active: true,
			lastActivationTime: 0, totalTasksProcessed: 0,
		};
		this._agents.set(id, agent);
		this._agentHandlers.set(id, handler);
	}

	private _bootstrapBuiltinRelations(): void {
		const chain: Array<[string, string, AARRelationType]> = [
			[BUILTIN_AGENT_IDS.PERCEIVER, BUILTIN_AGENT_IDS.ATTENDER, 'feeds-into'],
			[BUILTIN_AGENT_IDS.ATTENDER, BUILTIN_AGENT_IDS.THINKER, 'feeds-into'],
			[BUILTIN_AGENT_IDS.THINKER, BUILTIN_AGENT_IDS.ACTOR, 'feeds-into'],
			[BUILTIN_AGENT_IDS.ACTOR, BUILTIN_AGENT_IDS.REFLECTOR, 'feeds-into'],
			[BUILTIN_AGENT_IDS.ORCHESTRATOR, BUILTIN_AGENT_IDS.PERCEIVER, 'requests'],
		];
		for (const [src, tgt, type] of chain) {
			const rel: AARRelation = {
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

	registerAgent(agent: Omit<AARAgent, 'lastActivationTime' | 'totalTasksProcessed'>): boolean {
		if (this._agents.has(agent.id)) {
			this.logService.warn(`AAROrchestrationService: agent '${agent.id}' already registered`);
			return false;
		}
		const full: AARAgent = { ...agent, lastActivationTime: 0, totalTasksProcessed: 0 };
		this._agents.set(agent.id, full);
		this._onDidChangeAgent.fire(full);
		this.logService.info(`AAROrchestrationService: registered agent '${agent.name}' (${agent.id})`);
		return true;
	}

	unregisterAgent(agentId: string): boolean {
		const agent = this._agents.get(agentId);
		if (!agent) { return false; }
		this._agents.delete(agentId);
		this._agentHandlers.delete(agentId);
		this.logService.info(`AAROrchestrationService: unregistered agent '${agentId}'`);
		return true;
	}

	getAgent(agentId: string): AARAgent | undefined { return this._agents.get(agentId); }

	getAllAgents(): AARAgent[] { return Array.from(this._agents.values()); }

	setAgentActive(agentId: string, active: boolean): void {
		const agent = this._agents.get(agentId);
		if (agent) {
			agent.active = active;
			this._onDidChangeAgent.fire(agent);
		}
	}

	// -------------------------------------------------------------------------
	// Relation management
	// -------------------------------------------------------------------------

	defineRelation(relation: AARRelation): boolean {
		if (this._relations.has(relation.id)) { return false; }
		this._relations.set(relation.id, relation);
		this._onDidChangeRelation.fire(relation);
		return true;
	}

	removeRelation(relationId: string): boolean {
		const rel = this._relations.get(relationId);
		if (!rel) { return false; }
		this._relations.delete(relationId);
		return true;
	}

	getRelationsFrom(agentId: string): AARRelation[] {
		return Array.from(this._relations.values()).filter(r => r.sourceAgentId === agentId && r.active);
	}

	getRelationsTo(agentId: string): AARRelation[] {
		return Array.from(this._relations.values()).filter(r => r.targetAgentId === agentId && r.active);
	}

	async dispatchAction(agentId: string, action: import('sql/workbench/services/zonecog/common/aarOrchestration').AgentAction): Promise<unknown> {
		const handler = this._agentHandlers.get(agentId);
		if (!handler) {
			throw new Error(`AAROrchestrationService: unknown agent '${agentId}'`);
		}

		this.membraneService.recordActivity('somatic');
		return handler(action.parameters ?? action.target, new Map<string, unknown>());
	}

	// -------------------------------------------------------------------------
	// Orchestration
	// -------------------------------------------------------------------------

	async orchestrate(taskSpec: Omit<AARTask, 'id' | 'createdAt'>): Promise<AARTaskResult> {
		const task: AARTask = {
			...taskSpec,
			id: `aar-task-${Date.now()}-${++this._taskCounter}`,
			createdAt: Date.now(),
		};

		// Check deadline
		if (task.deadline && task.deadline < Date.now()) {
			return this._failTask(task, [], 'Task expired before orchestration');
		}

		const t0 = Date.now();
		const activeTask: AARActiveTask = {
			task,
			startTime: t0,
			currentAgentId: BUILTIN_AGENT_IDS.ORCHESTRATOR,
		};
		this._activeTasks.set(task.id, activeTask);
		this._totalTasksOrchestrated++;

		// Resolve the agent pipeline for this task
		const pipeline = this._resolvePipeline(task);
		const agentDurations: Record<string, number> = {};
		const taskContext = new Map<string, unknown>(this._sharedContext);
		taskContext.set('task_id', task.id);
		taskContext.set('task_payload', task.payload);

		let currentPayload: unknown = task.payload;
		const agentPath: string[] = [];

		try {
			for (const agentId of pipeline) {
				const agent = this._agents.get(agentId);
				if (!agent || !agent.active) { continue; }

				activeTask.currentAgentId = agentId;
				agentPath.push(agentId);

				const handler = this._agentHandlers.get(agentId);
				if (!handler) { continue; }

				const agentT0 = Date.now();
				try {
					currentPayload = await handler(currentPayload, taskContext);
				} catch (err) {
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

			const result: AARTaskResult = {
				task,
				agentPath,
				output: currentPayload,
				success: true,
				totalDurationMs: Date.now() - t0,
				agentDurations,
			};
			this._onDidCompleteTask.fire(result);
			return result;

		} catch (err) {
			this._activeTasks.delete(task.id);
			const result = this._failTask(task, agentPath, String(err));
			result.totalDurationMs = Date.now() - t0;
			result.agentDurations = agentDurations;
			this._onDidCompleteTask.fire(result);
			return result;
		}
	}

	private _resolvePipeline(task: AARTask): string[] {
		if (task.requiredCapabilities.length === 0) {
			return DEFAULT_PIPELINE;
		}

		// Find agents that satisfy required capabilities
		const candidates = Array.from(this._agents.values()).filter(a =>
			a.active &&
			task.requiredCapabilities.every((cap: string) => a.capabilities.includes(cap))
		);

		if (candidates.length === 0) {
			return DEFAULT_PIPELINE;
		}

		// BFS from orchestrator through relations, collecting capability-matching nodes
		const visited = new Set<string>();
		const pipeline: string[] = [];
		const queue: string[] = [BUILTIN_AGENT_IDS.ORCHESTRATOR];

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (visited.has(current)) { continue; }
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

	private _failTask(task: AARTask, agentPath: string[], error: string): AARTaskResult {
		this.logService.error(`AAROrchestrationService: task '${task.id}' failed - ${error}`);
		this.membraneService.recordError('autonomic', `AAR task failed: ${error}`);
		return {
			task, agentPath, output: null, success: false, error,
			totalDurationMs: 0, agentDurations: {},
		};
	}

	getActiveTasks(): AARActiveTask[] {
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

	setSharedContext(key: string, value: unknown): void { this._sharedContext.set(key, value); }
	getSharedContext(key: string): unknown { return this._sharedContext.get(key); }

	reset(): void {
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

	private _extractQuery(payload: unknown, ctx: Map<string, unknown>): string {
		if (typeof payload === 'string') { return payload; }
		if (payload && typeof payload === 'object') {
			const p = payload as Record<string, unknown>;
			if (typeof p['query'] === 'string') { return p['query']; }
			if (typeof p['percept'] === 'object' && p['percept'] !== null) {
				return (p['percept'] as Record<string, unknown>)['summary'] as string ?? '';
			}
		}
		const ctxPayload = ctx.get('task_payload');
		if (typeof ctxPayload === 'string') { return ctxPayload; }
		return '';
	}

	private _buildEpisodeSummary(ctx: Map<string, unknown>): string {
		const parts: string[] = [];
		const perceptId = ctx.get('percept_id');
		const confidence = ctx.get('cognitive_confidence');
		const focusNodes = ctx.get('attention_focus') as string[] | undefined;
		if (perceptId) { parts.push(`percept:${perceptId}`); }
		if (confidence !== undefined) { parts.push(`conf:${(confidence as number).toFixed(2)}`); }
		if (focusNodes?.length) { parts.push(`focus:${focusNodes.length}nodes`); }
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
	isLoopReadyForOrchestration(): boolean {
		const loopState = this._loopService.getState();
		// Ready if the loop is running and not paused
		return loopState.running && !loopState.paused;
	}

	// -------------------------------------------------------------------------
	// Distributed AAR (Phase C: FlareCog)
	// -------------------------------------------------------------------------

	registerRemoteNode(node: Omit<RemoteCognitiveNode, 'hostedAgents' | 'load'>): boolean {
		if (this._remoteNodes.has(node.id)) {
			this.logService.warn(`AAROrchestrationService: remote node '${node.id}' already registered`);
			return false;
		}

		const fullNode: RemoteCognitiveNode = {
			...node,
			hostedAgents: [],
			load: 0,
		};

		this._remoteNodes.set(node.id, fullNode);
		this._onDidChangeRemoteNode.fire(fullNode);
		this.membraneService.recordActivity('somatic');
		this.logService.info(`AAROrchestrationService: registered remote node '${node.name}' (${node.id})`);
		return true;
	}

	unregisterRemoteNode(nodeId: string): boolean {
		const node = this._remoteNodes.get(nodeId);
		if (!node) {
			return false;
		}

		// Unregister all hosted agents
		for (const agentId of node.hostedAgents) {
			this._remoteAgents.delete(agentId);
			this._agents.delete(agentId);
			this._agentHandlers.delete(agentId);
		}

		node.online = false;
		this._remoteNodes.delete(nodeId);
		this._onDidChangeRemoteNode.fire(node);
		this.logService.info(`AAROrchestrationService: unregistered remote node '${nodeId}'`);
		return true;
	}

	getRemoteNodes(): RemoteCognitiveNode[] {
		return Array.from(this._remoteNodes.values());
	}

	getOnlineRemoteNodes(): RemoteCognitiveNode[] {
		return Array.from(this._remoteNodes.values()).filter(n => n.online);
	}

	async spawnRemoteAgent(request: AgentSpawnRequest): Promise<AgentSpawnResult> {
		this.membraneService.recordActivity('somatic');

		// Select target node
		let targetNode: RemoteCognitiveNode | undefined;

		if (request.targetNodeId) {
			targetNode = this._remoteNodes.get(request.targetNodeId);
			if (!targetNode || !targetNode.online) {
				return {
					success: false,
					error: `Target node '${request.targetNodeId}' not available`,
				};
			}
		} else {
			// Auto-select node with lowest load that has capacity
			const candidates = this.getOnlineRemoteNodes()
				.filter(n => n.hostedAgents.length < n.maxAgents)
				.sort((a, b) => a.load - b.load);

			targetNode = candidates[0];
			if (!targetNode) {
				return {
					success: false,
					error: 'No available nodes with capacity',
				};
			}
		}

		// Create remote agent
		const remoteAgent: RemoteAgent = {
			...request.agent,
			lastActivationTime: 0,
			totalTasksProcessed: 0,
			hostNodeId: targetNode.id,
			communicationHealthy: true,
			lastCommunication: Date.now(),
			pendingMessages: 0,
		};

		// Register agent
		this._remoteAgents.set(remoteAgent.id, remoteAgent);
		this._agents.set(remoteAgent.id, remoteAgent);
		targetNode.hostedAgents.push(remoteAgent.id);

		// Create a proxy handler for remote agent execution
		this._agentHandlers.set(remoteAgent.id, async (payload, ctx) => {
			return this._executeOnRemoteAgent(remoteAgent, payload, ctx);
		});

		this._onDidChangeAgent.fire(remoteAgent);
		this._onDidChangeRemoteNode.fire(targetNode);

		this.logService.info(`AAROrchestrationService: spawned remote agent '${remoteAgent.name}' on node '${targetNode.name}'`);

		return {
			success: true,
			agent: remoteAgent,
			nodeId: targetNode.id,
		};
	}

	private async _executeOnRemoteAgent(
		agent: RemoteAgent,
		payload: unknown,
		_ctx: Map<string, unknown>
	): Promise<unknown> {
		agent.pendingMessages++;
		this._messagesSent++;

		// In real implementation, would send message via network
		// Simulate remote execution
		await new Promise<void>(resolve => setTimeout(resolve, 50));

		agent.pendingMessages--;
		agent.lastCommunication = Date.now();
		this._messagesReceived++;

		// Return simulated result
		return {
			remoteExecution: true,
			agentId: agent.id,
			nodeId: agent.hostNodeId,
			payload,
		};
	}

	async migrateAgent(request: AgentMigrationRequest): Promise<AgentMigrationResult> {
		this.membraneService.recordActivity('somatic');
		const startTime = Date.now();

		const agent = this._remoteAgents.get(request.agentId);
		if (!agent) {
			return {
				success: false,
				agentId: request.agentId,
				sourceNodeId: request.sourceNodeId,
				targetNodeId: request.targetNodeId ?? 'unknown',
				durationMs: 0,
				error: `Agent '${request.agentId}' not found`,
			};
		}

		const sourceNode = this._remoteNodes.get(request.sourceNodeId);
		if (!sourceNode) {
			return {
				success: false,
				agentId: request.agentId,
				sourceNodeId: request.sourceNodeId,
				targetNodeId: request.targetNodeId ?? 'unknown',
				durationMs: 0,
				error: `Source node '${request.sourceNodeId}' not found`,
			};
		}

		// Select target node
		let targetNode: RemoteCognitiveNode | undefined;
		if (request.targetNodeId) {
			targetNode = this._remoteNodes.get(request.targetNodeId);
		} else {
			// Auto-select node with lowest load
			const candidates = this.getOnlineRemoteNodes()
				.filter(n => n.id !== request.sourceNodeId && n.hostedAgents.length < n.maxAgents)
				.sort((a, b) => a.load - b.load);
			targetNode = candidates[0];
		}

		if (!targetNode || !targetNode.online) {
			return {
				success: false,
				agentId: request.agentId,
				sourceNodeId: request.sourceNodeId,
				targetNodeId: request.targetNodeId ?? 'unknown',
				durationMs: Date.now() - startTime,
				error: 'No suitable target node available',
			};
		}

		// Perform migration
		// Remove from source
		sourceNode.hostedAgents = sourceNode.hostedAgents.filter(id => id !== request.agentId);

		// Add to target
		agent.hostNodeId = targetNode.id;
		targetNode.hostedAgents.push(request.agentId);

		this._migrationCount++;
		const durationMs = Date.now() - startTime;

		const result: AgentMigrationResult = {
			success: true,
			agentId: request.agentId,
			sourceNodeId: request.sourceNodeId,
			targetNodeId: targetNode.id,
			durationMs,
		};

		this._onDidMigrateAgent.fire(result);
		this._onDidChangeRemoteNode.fire(sourceNode);
		this._onDidChangeRemoteNode.fire(targetNode);

		this.logService.info(`AAROrchestrationService: migrated agent '${request.agentId}' from '${request.sourceNodeId}' to '${targetNode.id}' (${request.reason})`);

		return result;
	}

	async sendAgentMessage(message: Omit<DistributedAgentMessage, 'id' | 'timestamp'>): Promise<void> {
		this.membraneService.recordActivity('somatic');

		const fullMessage: DistributedAgentMessage = {
			...message,
			id: generateUuid(),
			timestamp: Date.now(),
		};

		const targetAgent = this._remoteAgents.get(message.toAgentId);
		if (targetAgent) {
			targetAgent.pendingMessages++;
		}

		this._messagesSent++;

		// In real implementation, would route through network
		// Simulate message delivery
		await new Promise<void>(resolve => setTimeout(resolve, 10));

		if (targetAgent) {
			targetAgent.pendingMessages--;
			targetAgent.lastCommunication = Date.now();
		}

		this._messagesReceived++;
		this.logService.trace(`AAROrchestrationService: sent message ${fullMessage.id} from ${message.fromAgentId} to ${message.toAgentId}`);
	}

	getRemoteAgents(): RemoteAgent[] {
		return Array.from(this._remoteAgents.values());
	}

	async proposeConsensus(
		type: ConsensusProposal['type'],
		proposal: unknown,
		voters: string[],
		quorum: number = DEFAULT_CONSENSUS_QUORUM,
		deadlineMs: number = DEFAULT_CONSENSUS_DEADLINE_MS
	): Promise<ConsensusProposal> {
		this.membraneService.recordActivity('cerebral');

		const consensusProposal: ConsensusProposal = {
			id: generateUuid(),
			proposerId: BUILTIN_AGENT_IDS.ORCHESTRATOR,
			type,
			proposal,
			voters,
			votes: new Map(),
			quorum,
			deadline: Date.now() + deadlineMs,
			status: 'pending',
		};

		this._consensusProposals.set(consensusProposal.id, consensusProposal);

		// Persist to hypergraph
		this.hypergraphStore.addNode({
			id: `consensus-${consensusProposal.id}`,
			node_type: 'ConsensusProposal',
			content: JSON.stringify({ type, proposal, voters, quorum }),
			links: [],
			metadata: {
				proposalId: consensusProposal.id,
				status: 'pending',
			},
			salience_score: 0.8,
		});

		this.logService.info(`AAROrchestrationService: created consensus proposal ${consensusProposal.id} with ${voters.length} voters`);

		// Start deadline timer
		setTimeout(() => {
			this._checkConsensusDeadline(consensusProposal.id);
		}, deadlineMs);

		return consensusProposal;
	}

	voteOnConsensus(proposalId: string, agentId: string, vote: boolean): boolean {
		const proposal = this._consensusProposals.get(proposalId);
		if (!proposal || proposal.status !== 'pending') {
			return false;
		}

		if (!proposal.voters.includes(agentId)) {
			this.logService.warn(`AAROrchestrationService: agent '${agentId}' not authorized to vote on proposal '${proposalId}'`);
			return false;
		}

		proposal.votes.set(agentId, vote);

		// Check if quorum reached
		const yesVotes = Array.from(proposal.votes.values()).filter(v => v).length;
		const totalVotes = proposal.votes.size;
		const voteFraction = totalVotes / proposal.voters.length;

		if (voteFraction >= proposal.quorum) {
			const yesFraction = yesVotes / totalVotes;
			if (yesFraction > 0.5) {
				proposal.status = 'accepted';
			} else {
				proposal.status = 'rejected';
			}

			this._consensusProposalsResolved++;
			this._onDidResolveConsensus.fire(proposal);

			// Update hypergraph
			this.hypergraphStore.updateNode(`consensus-${proposal.id}`, {
				metadata: { proposalId: proposal.id, status: proposal.status },
			});

			this.logService.info(`AAROrchestrationService: consensus proposal ${proposal.id} ${proposal.status} (${yesVotes}/${totalVotes} yes)`);
		}

		return true;
	}

	private _checkConsensusDeadline(proposalId: string): void {
		const proposal = this._consensusProposals.get(proposalId);
		if (!proposal || proposal.status !== 'pending') {
			return;
		}

		if (Date.now() >= proposal.deadline) {
			proposal.status = 'expired';
			this._consensusProposalsResolved++;
			this._onDidResolveConsensus.fire(proposal);

			this.hypergraphStore.updateNode(`consensus-${proposal.id}`, {
				metadata: { proposalId: proposal.id, status: 'expired' },
			});

			this.logService.info(`AAROrchestrationService: consensus proposal ${proposal.id} expired`);
		}
	}

	getPendingConsensusProposals(): ConsensusProposal[] {
		return Array.from(this._consensusProposals.values()).filter(p => p.status === 'pending');
	}

	getDistributedStats(): {
		remoteNodeCount: number;
		onlineNodeCount: number;
		remoteAgentCount: number;
		messagesSent: number;
		messagesReceived: number;
		migrationCount: number;
		consensusProposalsResolved: number;
	} {
		return {
			remoteNodeCount: this._remoteNodes.size,
			onlineNodeCount: this.getOnlineRemoteNodes().length,
			remoteAgentCount: this._remoteAgents.size,
			messagesSent: this._messagesSent,
			messagesReceived: this._messagesReceived,
			migrationCount: this._migrationCount,
			consensusProposalsResolved: this._consensusProposalsResolved,
		};
	}
}
