/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

import {
	IAgiStudioService,
	StudioAgent,
	StudioAgentRole,
	StudioAgentStatus,
	StudioAgentMemoryItem,
	AgentMessage,
	AgentMessageType,
	AgentTool,
	AgentToolCall,
	StudioRun,
	StudioRunStatus,
} from 'sql/workbench/services/zonecog/common/agiStudio';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { ISQLAnalyzerAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { ISchemaReasonerAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { IPerformanceAdvisorAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';
import { IDataPatternAgent } from 'sql/workbench/services/zonecog/common/cognitiveAgents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum depth of the agent spawning tree (root = 0). */
const MAX_DEPTH = 2;

/** Maximum total agents per run (guards against runaway spawning). */
const MAX_AGENTS_PER_RUN = 8;

/** Maximum subordinates the root agent spawns per run. */
const MAX_SUBORDINATES = 4;

/** System prompt for the root orchestrator agent. */
const ORCHESTRATOR_SYSTEM_PROMPT =
	'You are an AGI Studio orchestrator. Your role is to decompose a high-level goal ' +
	'into 2-4 concrete, executable subtasks and delegate them to specialist agents.';

/** System prompt for LLM reasoning agents. */
const LLM_REASONER_SYSTEM_PROMPT =
	'You are a specialist reasoning agent. Apply careful analysis to the assigned subtask ' +
	'and produce a concise, actionable insight or recommendation.';

// ---------------------------------------------------------------------------
// AGI Studio Service implementation
// ---------------------------------------------------------------------------

/**
 * AGI Studio Service.
 *
 * Implements Agent-Zero-style hierarchical autonomous agents on top of the
 * Zone-Cog cognitive services.  The root orchestrator agent decomposes a
 * user goal into subtasks, spawns specialist subordinate agents (one per
 * subtask, up to MAX_SUBORDINATES), each subordinate executes via registered
 * tools, and the root synthesises a final result.
 *
 * All state (runs, agents, messages, tool calls) is persisted as hypergraph
 * nodes and membrane activity is recorded throughout.
 */
export class AgiStudioService extends Disposable implements IAgiStudioService {

	declare readonly _serviceBrand: undefined;

	// -- Internal state ------------------------------------------------------

	private readonly _runs = new Map<string, StudioRun>();
	private readonly _runOrder: string[] = [];
	private readonly _agents = new Map<string, StudioAgent>();
	private readonly _messages = new Map<string, AgentMessage>();
	private readonly _toolCalls = new Map<string, AgentToolCall>();
	private readonly _tools = new Map<string, AgentTool>();

	/** IDs of agents belonging to a run: runId → agentId[]. */
	private readonly _runAgents = new Map<string, string[]>();
	/** IDs of messages belonging to a run: runId → messageId[]. */
	private readonly _runMessages = new Map<string, string[]>();
	/** IDs of tool calls belonging to a run: runId → toolCallId[]. */
	private readonly _runToolCalls = new Map<string, string[]>();

	/** Run IDs for which a stop has been requested. */
	private readonly _stopRequested = new Set<string>();

	private _activeRunId: string | undefined;

	// -- Events --------------------------------------------------------------

	private readonly _onDidChangeRun = this._register(new Emitter<StudioRun>());
	readonly onDidChangeRun: Event<StudioRun> = this._onDidChangeRun.event;

	private readonly _onDidSpawnAgent = this._register(new Emitter<StudioAgent>());
	readonly onDidSpawnAgent: Event<StudioAgent> = this._onDidSpawnAgent.event;

	private readonly _onDidSendMessage = this._register(new Emitter<AgentMessage>());
	readonly onDidSendMessage: Event<AgentMessage> = this._onDidSendMessage.event;

	// -- Constructor ---------------------------------------------------------

	constructor(
		@ILogService private readonly logService: ILogService,
		@ILLMProviderService private readonly llmService: ILLMProviderService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore,
		@ICognitiveMembraneService private readonly membraneService: ICognitiveMembraneService,
		@ICognitiveWorkspaceService private readonly workspaceService: ICognitiveWorkspaceService,
		@ISQLAnalyzerAgent private readonly sqlAnalyzerAgent: ISQLAnalyzerAgent,
		@ISchemaReasonerAgent private readonly schemaReasonerAgent: ISchemaReasonerAgent,
		@IPerformanceAdvisorAgent private readonly performanceAdvisorAgent: IPerformanceAdvisorAgent,
		@IDataPatternAgent private readonly dataPatternAgent: IDataPatternAgent
	) {
		super();
		this._registerBuiltinTools();
		this.logService.info('[AgiStudioService] Initialized with ' + this._tools.size + ' tools');
	}

	// -- Tool registry -------------------------------------------------------

	getTools(): AgentTool[] {
		return Array.from(this._tools.values());
	}

	registerTool(tool: AgentTool): void {
		if (!this._tools.has(tool.id)) {
			this._tools.set(tool.id, tool);
		}
	}

	private _registerBuiltinTools(): void {
		// 1. SQL Analyzer tool
		this.registerTool({
			id: 'sql-analyze',
			name: 'SQL Analyzer',
			description: 'Analyze SQL queries for structure, complexity and optimization opportunities',
			invoke: async (input: string) => {
				try {
					const result = await this.sqlAnalyzerAgent.analyzeQuery(input);
					return JSON.stringify({
						queryType: result.queryType,
						tables: result.tablesReferenced,
						columns: result.columnsReferenced,
						complexity: result.complexity,
						performanceIssues: result.performanceIssues.length,
						semanticIntent: result.semanticIntent,
					});
				} catch (err) {
					return `SQL analysis error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 2. Schema Reasoner tool
		this.registerTool({
			id: 'schema-reason',
			name: 'Schema Reasoner',
			description: 'Analyze database schema for relationships, quality and domain model',
			invoke: async (input: string) => {
				try {
					const result = await this.schemaReasonerAgent.analyzeSchema(input);
					return JSON.stringify({
						elements: result.elements.length,
						relationships: result.relationships.length,
						qualityIssues: result.qualityIssues.length,
						normalization: result.normalization.currentForm,
						entities: result.domainModel.entities.length,
					});
				} catch (err) {
					return `Schema reasoning error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 3. Performance Advisor tool
		this.registerTool({
			id: 'perf-advise',
			name: 'Performance Advisor',
			description: 'Identify performance bottlenecks and suggest query optimizations',
			invoke: async (input: string) => {
				try {
					const issues = await this.performanceAdvisorAgent.analyzePerformance(input);
					const summary = issues.map(i => `[${i.severity}] ${i.type}: ${i.description}`).join('; ');
					return issues.length > 0
						? `Found ${issues.length} performance issue(s): ${summary}`
						: 'No significant performance issues detected.';
				} catch (err) {
					return `Performance analysis error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 4. Data Pattern tool
		this.registerTool({
			id: 'data-pattern',
			name: 'Data Pattern Detector',
			description: 'Detect statistical patterns, anomalies and correlations in data',
			invoke: async (input: string) => {
				try {
					const patterns = await this.dataPatternAgent.detectPatterns([{ context: input }]);
					if (patterns.length === 0) {
						return 'No distinct patterns detected in the provided data context.';
					}
					const summary = patterns.map(p => `[${p.type}] ${p.description} (confidence: ${(p.confidence * 100).toFixed(0)}%)`).join('; ');
					return `Detected ${patterns.length} pattern(s): ${summary}`;
				} catch (err) {
					return `Data pattern detection error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 5. LLM Reasoning tool
		this.registerTool({
			id: 'llm-reason',
			name: 'LLM Reasoning',
			description: 'Apply LLM-based reasoning and analysis to a task',
			invoke: async (input: string, agent: StudioAgent) => {
				try {
					const response = await this.llmService.complete({
						systemPrompt: agent.systemPrompt || LLM_REASONER_SYSTEM_PROMPT,
						userMessage: input,
						maxTokens: 512,
						temperature: 0.3,
					});
					return response.content;
				} catch (err) {
					return `LLM reasoning error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 6. Memory Save tool
		this.registerTool({
			id: 'memory-save',
			name: 'Memory Save',
			description: 'Save a key-value pair to agent-local memory and episodic memory',
			invoke: async (input: string, agent: StudioAgent) => {
				try {
					// input format: "key::value" or plain text saved under 'insight' key
					const sepIdx = input.indexOf('::');
					const key = sepIdx >= 0 ? input.slice(0, sepIdx).trim() : 'insight';
					const value = sepIdx >= 0 ? input.slice(sepIdx + 2).trim() : input;

					// Agent-local memory
					const existing = agent.localMemory.findIndex(m => m.key === key);
					const item: StudioAgentMemoryItem = { key, value, timestamp: Date.now() };
					if (existing >= 0) {
						agent.localMemory[existing] = item;
					} else {
						agent.localMemory.push(item);
					}

					// Shared episodic memory
					this.workspaceService.recordEpisode(`AGI Studio: ${key}`, value);
					this.workspaceService.addToWorkingMemory('agi-studio', `${key}: ${value}`, 0.7);

					return `Saved to memory: ${key}`;
				} catch (err) {
					return `Memory save error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});

		// 7. Memory Recall tool
		this.registerTool({
			id: 'memory-recall',
			name: 'Memory Recall',
			description: 'Recall information from agent-local memory and episodic memory',
			invoke: async (input: string, agent: StudioAgent) => {
				try {
					const keyword = input.trim();

					// Agent-local memory search
					const localHits = agent.localMemory.filter(m =>
						m.key.includes(keyword) || m.value.includes(keyword)
					);

					// Episodic memory search
					const episodes = this.workspaceService.searchEpisodes(keyword);

					const localSummary = localHits.map(m => `[local:${m.key}] ${m.value}`).join('; ');
					const episodeSummary = episodes.slice(0, 3).map(ep => ep.title + ': ' + ep.content.slice(0, 80)).join('; ');

					if (!localSummary && !episodeSummary) {
						return `No memories found for: ${keyword}`;
					}
					return [localSummary, episodeSummary].filter(Boolean).join(' | Episodes: ');
				} catch (err) {
					return `Memory recall error: ${err instanceof Error ? err.message : String(err)}`;
				}
			},
		});
	}

	// -- Run management ------------------------------------------------------

	async startRun(goal: string): Promise<StudioRun> {
		// Stop any previously active run
		if (this._activeRunId) {
			this.stopRun(this._activeRunId);
		}

		const runId = `agi-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

		const run: StudioRun = {
			id: runId,
			goal,
			rootAgentId: '', // Will be set after spawning root agent
			status: 'running',
			startTime: Date.now(),
		};

		// Spawn root orchestrator agent
		const rootAgent = this._spawnAgent(run.id, 'orchestrator', ORCHESTRATOR_SYSTEM_PROMPT, undefined, 0);
		run.rootAgentId = rootAgent.id;

		this._runs.set(runId, run);
		this._runOrder.unshift(runId);
		this._activeRunId = runId;

		// Persist initial run node
		this._persistRunNode(run);

		this.membraneService.recordActivity('cerebral');
		this.logService.info(`[AgiStudioService] Starting run ${runId} for goal: ${goal}`);

		// Fire the onDidChangeRun for the initial 'running' state
		this._onDidChangeRun.fire({ ...run });

		// Execute run asynchronously
		this._executeRunAsync(run, rootAgent).catch(err => {
			this.logService.error('[AgiStudioService] Uncaught run error:', err);
			if (run.status === 'running') {
				this._failRun(run, err instanceof Error ? err.message : String(err));
			}
		});

		return { ...run };
	}

	stopRun(runId?: string): void {
		const id = runId ?? this._activeRunId;
		if (!id) {
			return;
		}

		const run = this._runs.get(id);
		if (!run || run.status !== 'running') {
			return;
		}

		this._stopRequested.add(id);
		run.status = 'stopped';
		run.endTime = Date.now();
		this._runs.set(id, run);

		if (this._activeRunId === id) {
			this._activeRunId = undefined;
		}

		// Mark all running agents of this run as stopped
		const agentIds = this._runAgents.get(id) ?? [];
		for (const agentId of agentIds) {
			const agent = this._agents.get(agentId);
			if (agent && agent.status === 'running') {
				agent.status = 'stopped';
			}
		}

		this._persistRunNode(run);
		this.membraneService.recordActivity('autonomic');
		this._onDidChangeRun.fire({ ...run });

		this.logService.info(`[AgiStudioService] Run ${id} stopped`);
	}

	getActiveRun(): StudioRun | undefined {
		if (!this._activeRunId) {
			return undefined;
		}
		const run = this._runs.get(this._activeRunId);
		return run ? { ...run } : undefined;
	}

	getRuns(): StudioRun[] {
		return this._runOrder.map(id => this._runs.get(id)).filter((r): r is StudioRun => r !== undefined).map(r => ({ ...r }));
	}

	getAgents(runId?: string): StudioAgent[] {
		if (runId !== undefined) {
			const ids = this._runAgents.get(runId) ?? [];
			return ids.map(id => this._agents.get(id)).filter((a): a is StudioAgent => a !== undefined).map(a => ({ ...a, subordinateIds: [...a.subordinateIds], localMemory: [...a.localMemory] }));
		}
		return Array.from(this._agents.values()).map(a => ({ ...a, subordinateIds: [...a.subordinateIds], localMemory: [...a.localMemory] }));
	}

	getMessages(runId?: string): AgentMessage[] {
		if (runId !== undefined) {
			const ids = this._runMessages.get(runId) ?? [];
			return ids.map(id => this._messages.get(id)).filter((m): m is AgentMessage => m !== undefined).map(m => ({ ...m }));
		}
		return Array.from(this._messages.values()).map(m => ({ ...m }));
	}

	getToolCalls(runId?: string): AgentToolCall[] {
		if (runId !== undefined) {
			const ids = this._runToolCalls.get(runId) ?? [];
			return ids.map(id => this._toolCalls.get(id)).filter((t): t is AgentToolCall => t !== undefined).map(t => ({ ...t }));
		}
		return Array.from(this._toolCalls.values()).map(t => ({ ...t }));
	}

	// -- Core execution loop -------------------------------------------------

	private async _executeRunAsync(run: StudioRun, rootAgent: StudioAgent): Promise<void> {
		try {
			this.membraneService.recordActivity('cerebral');

			// Step 1: Decompose the goal into subtasks
			const subtasks = await this._decomposeGoal(run.goal, rootAgent, run.id);

			if (this._stopRequested.has(run.id)) {
				return;
			}

			// Step 2: Spawn subordinate agents and execute subtasks
			const results: string[] = [];
			const cap = Math.min(subtasks.length, MAX_SUBORDINATES);

			for (let i = 0; i < cap; i++) {
				if (this._stopRequested.has(run.id)) {
					break;
				}

				// Enforce total agent cap
				const agentCount = (this._runAgents.get(run.id) ?? []).length;
				if (agentCount >= MAX_AGENTS_PER_RUN) {
					this.logService.warn(`[AgiStudioService] Max agents (${MAX_AGENTS_PER_RUN}) reached for run ${run.id}`);
					break;
				}

				const subtask = subtasks[i];
				const role = this._assignRole(subtask);
				const subordinate = this._spawnAgent(run.id, role, LLM_REASONER_SYSTEM_PROMPT, rootAgent.id, 1);

				// Notify root hierarchy and add to root's subordinates
				const rootInner = this._agents.get(rootAgent.id);
				if (rootInner) {
					rootInner.subordinateIds.push(subordinate.id);
				}

				// Send task-assignment message
				this._sendMessage(rootAgent.id, subordinate.id, 'task-assignment', subtask, run.id);

				// Execute the subordinate's task using its tool
				const result = await this._executeAgentTask(subordinate, subtask, run.id);

				if (this._stopRequested.has(run.id)) {
					break;
				}

				// Send result-report back to root
				this._sendMessage(subordinate.id, rootAgent.id, 'result-report', result, run.id);

				// Mark subordinate complete
				this._setAgentStatus(subordinate.id, 'completed');

				results.push(`[${role}] ${result}`);
			}

			if (this._stopRequested.has(run.id)) {
				return; // run was already marked 'stopped' by stopRun()
			}

			// Step 3: Synthesise final result
			const synthesis = await this._synthesiseResults(run.goal, results, rootAgent, run.id);

			if (this._stopRequested.has(run.id)) {
				return; // stopped during synthesis; stopRun() already finalised state
			}

			// Mark root agent complete
			this._setAgentStatus(rootAgent.id, 'completed');

			// Complete the run
			run.status = 'completed';
			run.endTime = Date.now();
			run.result = synthesis;

			this._runs.set(run.id, run);
			if (this._activeRunId === run.id) {
				this._activeRunId = undefined;
			}

			this._persistRunNode(run);
			this.membraneService.recordActivity('cerebral');
			this._onDidChangeRun.fire({ ...run });

			// Record in episodic memory
			this.workspaceService.recordEpisode(
				`AGI Studio run: ${run.goal.slice(0, 60)}`,
				synthesis,
			);

			this.logService.info(`[AgiStudioService] Run ${run.id} completed`);

		} catch (err) {
			this._failRun(run, err instanceof Error ? err.message : String(err));
		} finally {
			this._stopRequested.delete(run.id);
		}
	}

	// -- Agent spawning ------------------------------------------------------

	private _spawnAgent(
		runId: string,
		role: StudioAgentRole,
		systemPrompt: string,
		superiorId: string | undefined,
		depth: number,
	): StudioAgent {
		const agentId = `agi-agent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
		const agent: StudioAgent = {
			id: agentId,
			name: this._agentName(role),
			role,
			superiorId,
			subordinateIds: [],
			status: 'idle',
			depth,
			systemPrompt,
			createdAt: Date.now(),
			localMemory: [],
		};

		this._agents.set(agentId, agent);

		// Index agent under run
		let runAgents = this._runAgents.get(runId);
		if (!runAgents) {
			runAgents = [];
			this._runAgents.set(runId, runAgents);
		}
		runAgents.push(agentId);

		// Persist agent node
		this._persistAgentNode(agent, runId);

		this.membraneService.recordActivity('cerebral');
		this._onDidSpawnAgent.fire({ ...agent, subordinateIds: [...agent.subordinateIds], localMemory: [...agent.localMemory] });

		return agent;
	}

	private _agentName(role: StudioAgentRole): string {
		const names: Record<StudioAgentRole, string> = {
			'orchestrator': 'Root Orchestrator',
			'sql-analyzer': 'SQL Analyzer Agent',
			'schema-reasoner': 'Schema Reasoner Agent',
			'performance-advisor': 'Performance Advisor Agent',
			'data-pattern': 'Data Pattern Agent',
			'llm-reasoner': 'LLM Reasoner Agent',
			'synthesizer': 'Synthesizer Agent',
		};
		return names[role];
	}

	private _setAgentStatus(agentId: string, status: StudioAgentStatus): void {
		const agent = this._agents.get(agentId);
		if (agent) {
			agent.status = status;
		}
	}

	// -- Role assignment -----------------------------------------------------

	/**
	 * Choose the best agent role based on keyword matching in a subtask string.
	 * Falls back to 'llm-reasoner' when no specialist keywords are found.
	 */
	private _assignRole(subtask: string): StudioAgentRole {
		const lower = subtask.toLowerCase();
		if (/\bsql\b|query|select|insert|update|delete|join|having|group by/.test(lower)) {
			return 'sql-analyzer';
		}
		if (/schema|table|column|relationship|model|foreign.?key|database design/.test(lower)) {
			return 'schema-reasoner';
		}
		if (/performance|optimis|optimi[sz]|slow|index|bottleneck|execution.?plan/.test(lower)) {
			return 'performance-advisor';
		}
		if (/data.?pattern|anomaly|statistic|correlation|trend|cluster|outlier/.test(lower)) {
			return 'data-pattern';
		}
		return 'llm-reasoner';
	}

	/** Select the primary tool ID for a given agent role. */
	private _toolForRole(role: StudioAgentRole): string {
		const map: Partial<Record<StudioAgentRole, string>> = {
			'sql-analyzer': 'sql-analyze',
			'schema-reasoner': 'schema-reason',
			'performance-advisor': 'perf-advise',
			'data-pattern': 'data-pattern',
			'llm-reasoner': 'llm-reason',
			'synthesizer': 'llm-reason',
			'orchestrator': 'llm-reason',
		};
		return map[role] ?? 'llm-reason';
	}

	// -- Goal decomposition --------------------------------------------------

	/**
	 * Decompose a goal into subtasks using the LLM provider.
	 *
	 * On fallback responses (keyless / no external provider) or if the LLM
	 * output cannot be parsed as a JSON string array, the structural
	 * deterministic fallback is used instead so the loop always produces
	 * meaningful subtasks.
	 */
	private async _decomposeGoal(goal: string, rootAgent: StudioAgent, runId: string): Promise<string[]> {
		this.membraneService.recordActivity('cerebral');

		// Record task-decomposition tool call
		const toolCallId = `tc-decompose-${Date.now()}`;
		const toolCallStart = Date.now();

		try {
			const response = await this.llmService.complete({
				systemPrompt:
					'You are a task decomposition engine. Given a goal, return ONLY a JSON array of ' +
					'2-4 concrete subtask strings. Example: ["analyze sql patterns","check schema quality"]. ' +
					'No markdown, no explanation. Return only the JSON array.',
				userMessage: `Decompose this goal into concrete subtasks: ${goal}`,
				maxTokens: 256,
				temperature: 0.2,
			});

			let subtasks: string[] | undefined;

			// Try to parse as JSON array even on fallback responses
			if (!response.isFallback) {
				try {
					const parsed = JSON.parse(response.content.trim());
					if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string') && parsed.length > 0) {
						subtasks = parsed;
					}
				} catch {
					// fall through to fallback decomposition
				}
			}

			if (!subtasks) {
				subtasks = this._fallbackDecompose(goal);
			}

			// Record decomposition in tool calls
			const toolCall: AgentToolCall = {
				toolId: 'llm-reason',
				agentId: rootAgent.id,
				input: goal,
				output: subtasks.join(' | '),
				success: true,
				durationMs: Date.now() - toolCallStart,
				timestamp: Date.now(),
			};
			this._recordToolCall(toolCall, runId);

			return subtasks;

		} catch (err) {
			const toolCall: AgentToolCall = {
				toolId: 'llm-reason',
				agentId: rootAgent.id,
				input: goal,
				output: `error: ${err instanceof Error ? err.message : String(err)}`,
				success: false,
				durationMs: Date.now() - toolCallStart,
				timestamp: Date.now(),
			};
			this._recordToolCall(toolCall, runId);

			return this._fallbackDecompose(goal);
		}
	}

	/**
	 * Deterministic fallback decomposition based on keyword matching.
	 * Always returns 2–4 subtasks regardless of LLM availability.
	 */
	private _fallbackDecompose(goal: string): string[] {
		const lower = goal.toLowerCase();
		const tasks: string[] = [];

		if (/sql|query|select|insert|update|delete|join/.test(lower)) {
			tasks.push(`Analyze the SQL query structure and semantics for: ${goal}`);
		}
		if (/schema|table|column|database|model|relationship/.test(lower)) {
			tasks.push(`Analyze the database schema and relationships for: ${goal}`);
		}
		if (/performance|optim|slow|index|bottleneck/.test(lower)) {
			tasks.push(`Identify performance issues and optimizations for: ${goal}`);
		}
		if (/data|pattern|anomaly|statistic|analysis/.test(lower)) {
			tasks.push(`Detect relevant data patterns for: ${goal}`);
		}

		if (tasks.length === 0) {
			tasks.push(`Research and understand the context for: ${goal}`);
			tasks.push(`Apply reasoning and domain knowledge to address: ${goal}`);
		}

		tasks.push(`Synthesise findings and produce recommendations for: ${goal}`);

		return tasks.slice(0, MAX_SUBORDINATES);
	}

	// -- Agent task execution ------------------------------------------------

	private async _executeAgentTask(agent: StudioAgent, task: string, runId: string): Promise<string> {
		this._setAgentStatus(agent.id, 'running');
		this.membraneService.recordActivity('somatic');

		const toolId = this._toolForRole(agent.role);
		const tool = this._tools.get(toolId);

		if (!tool) {
			this._setAgentStatus(agent.id, 'failed');
			return `No tool found for role ${agent.role}`;
		}

		const callStart = Date.now();
		let output: string;
		let success = true;

		try {
			// Get the actual agent object (with mutable localMemory)
			const liveAgent = this._agents.get(agent.id) ?? agent;
			output = await tool.invoke(task, liveAgent);
		} catch (err) {
			output = err instanceof Error ? err.message : String(err);
			success = false;
			this._setAgentStatus(agent.id, 'failed');
		}

		const toolCall: AgentToolCall = {
			toolId,
			agentId: agent.id,
			input: task,
			output,
			success,
			durationMs: Date.now() - callStart,
			timestamp: Date.now(),
		};

		this._recordToolCall(toolCall, runId);
		this._persistToolCallNode(toolCall, runId);

		this.membraneService.recordActivity('somatic');

		return output;
	}

	// -- Result synthesis ----------------------------------------------------

	private async _synthesiseResults(
		goal: string,
		results: string[],
		rootAgent: StudioAgent,
		runId: string,
	): Promise<string> {
		this.membraneService.recordActivity('cerebral');

		const context = results.join('\n');
		const callStart = Date.now();

		try {
			const response = await this.llmService.complete({
				systemPrompt:
					'You are a synthesis agent. Given a goal and the findings from specialist agents, ' +
					'produce a concise, actionable summary and set of recommendations.',
				userMessage: `Goal: ${goal}\n\nSpecialist Findings:\n${context}\n\nSynthesise the above into a final report.`,
				maxTokens: 512,
				temperature: 0.3,
			});

			const synthContent = response.content || `Goal: ${goal}\n\nFindings:\n${context}`;

			const toolCall: AgentToolCall = {
				toolId: 'llm-reason',
				agentId: rootAgent.id,
				input: `Synthesise: ${goal}`,
				output: synthContent,
				success: true,
				durationMs: Date.now() - callStart,
				timestamp: Date.now(),
			};
			this._recordToolCall(toolCall, runId);

			return synthContent;

		} catch (err) {
			// Structural fallback synthesis
			const fallback = `AGI Studio Report — Goal: ${goal}\n\n` +
				results.map((r, i) => `Finding ${i + 1}: ${r}`).join('\n\n') +
				'\n\nRecommendation: Review the above findings and apply them to the original goal.';

			const toolCall: AgentToolCall = {
				toolId: 'llm-reason',
				agentId: rootAgent.id,
				input: `Synthesise: ${goal}`,
				output: fallback,
				success: false,
				durationMs: Date.now() - callStart,
				timestamp: Date.now(),
			};
			this._recordToolCall(toolCall, runId);

			return fallback;
		}
	}

	// -- Messaging -----------------------------------------------------------

	private _sendMessage(
		fromAgentId: string,
		toAgentId: string,
		messageType: AgentMessageType,
		content: string,
		runId: string,
	): AgentMessage {
		const msgId = `agi-msg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
		const message: AgentMessage = {
			id: msgId,
			fromAgentId,
			toAgentId,
			messageType,
			content,
			timestamp: Date.now(),
		};

		this._messages.set(msgId, message);

		let runMessages = this._runMessages.get(runId);
		if (!runMessages) {
			runMessages = [];
			this._runMessages.set(runId, runMessages);
		}
		runMessages.push(msgId);

		this._persistMessageNode(message, runId);
		this._onDidSendMessage.fire({ ...message });

		return message;
	}

	// -- Run failure ---------------------------------------------------------

	private _failRun(run: StudioRun, reason: string): void {
		if (run.status !== 'running') {
			return; // never overwrite a stopped/completed run
		}
		run.status = 'failed';
		run.endTime = Date.now();
		run.result = `Run failed: ${reason}`;
		this._runs.set(run.id, run);

		if (this._activeRunId === run.id) {
			this._activeRunId = undefined;
		}

		this._persistRunNode(run);
		this.membraneService.recordError('autonomic', `AGI Studio run ${run.id} failed: ${reason}`);
		this._onDidChangeRun.fire({ ...run });

		this.logService.error(`[AgiStudioService] Run ${run.id} failed: ${reason}`);
	}

	// -- Tool call tracking --------------------------------------------------

	private _recordToolCall(toolCall: AgentToolCall, runId: string): void {
		const tcId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
		const keyed = { ...toolCall };
		this._toolCalls.set(tcId, keyed);

		let runCalls = this._runToolCalls.get(runId);
		if (!runCalls) {
			runCalls = [];
			this._runToolCalls.set(runId, runCalls);
		}
		runCalls.push(tcId);
	}

	// -- Hypergraph persistence ----------------------------------------------

	private _persistRunNode(run: StudioRun): void {
		try {
			const existing = this.hypergraphStore.getNodesByType('agiStudio.run')
				.find(n => n.metadata['runId'] === run.id);

			if (existing) {
				this.hypergraphStore.updateNode(existing.id, {
					content: JSON.stringify({ status: run.status, goal: run.goal, result: run.result }),
					metadata: {
						runId: run.id,
						status: run.status,
						startTime: run.startTime,
						endTime: run.endTime,
					},
				});
			} else {
				this.hypergraphStore.addNode({
					node_type: 'agiStudio.run',
					content: JSON.stringify({ status: run.status, goal: run.goal }),
					links: [],
					metadata: {
						runId: run.id,
						status: run.status,
						startTime: run.startTime,
					},
					salience_score: 0.8,
				});
			}
		} catch (err) {
			this.logService.warn('[AgiStudioService] Failed to persist run node:', err);
		}
	}

	private _persistAgentNode(agent: StudioAgent, runId: string): void {
		try {
			this.hypergraphStore.addNode({
				node_type: 'agiStudio.agent',
				content: JSON.stringify({ name: agent.name, role: agent.role, depth: agent.depth }),
				links: [],
				metadata: {
					agentId: agent.id,
					runId,
					role: agent.role,
					depth: agent.depth,
					superiorId: agent.superiorId ?? null,
				},
				salience_score: 0.6,
			});
		} catch (err) {
			this.logService.warn('[AgiStudioService] Failed to persist agent node:', err);
		}
	}

	private _persistMessageNode(message: AgentMessage, runId: string): void {
		try {
			this.hypergraphStore.addNode({
				node_type: 'agiStudio.message',
				content: message.content,
				links: [],
				metadata: {
					messageId: message.id,
					runId,
					fromAgentId: message.fromAgentId,
					toAgentId: message.toAgentId,
					messageType: message.messageType,
					timestamp: message.timestamp,
				},
				salience_score: 0.4,
			});
		} catch (err) {
			this.logService.warn('[AgiStudioService] Failed to persist message node:', err);
		}
	}

	private _persistToolCallNode(toolCall: AgentToolCall, runId: string): void {
		try {
			this.hypergraphStore.addNode({
				node_type: 'agiStudio.toolCall',
				content: `${toolCall.toolId}: ${toolCall.output.slice(0, 200)}`,
				links: [],
				metadata: {
					runId,
					agentId: toolCall.agentId,
					toolId: toolCall.toolId,
					success: toolCall.success,
					durationMs: toolCall.durationMs,
					timestamp: toolCall.timestamp,
				},
				salience_score: 0.3,
			});
		} catch (err) {
			this.logService.warn('[AgiStudioService] Failed to persist tool call node:', err);
		}
	}
}
