/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IAAROrchestrationService = createDecorator<IAAROrchestrationService>('aarOrchestrationService');

// ---------------------------------------------------------------------------
// Agent-Arena-Relation types
// ---------------------------------------------------------------------------

/**
 * A cognitive Agent — an autonomous participant in the Arena.
 *
 * In the Zone-Cog system the built-in agents map directly to the
 * existing cognitive services (EmbodiedCognition, ECAN, ZoneCog, etc.)
 * and are registered at startup.
 */
export interface AARAgent {
	/** Unique identifier (e.g. "perceive-agent", "think-agent"). */
	id: string;
	/** Human-readable name. */
	name: string;
	/** The cognitive role this agent plays. */
	role: AARAgentRole;
	/**
	 * Capability tags that determine which task types this agent can handle.
	 * Relations can be constrained to agents with specific capabilities.
	 */
	capabilities: string[];
	/** Whether the agent is currently active and available for tasks. */
	active: boolean;
	/** ISO timestamp of last activation. */
	lastActivationTime: number;
	/** Total tasks this agent has processed. */
	totalTasksProcessed: number;
}

/**
 * Canonical agent roles that map to the perceive→attend→think→act→reflect cycle.
 */
export type AARAgentRole =
	| 'perceiver'    // EmbodiedCognitionService — senses the environment
	| 'attender'     // ECANAttentionService — focuses cognitive resources
	| 'thinker'      // ZoneCogService — performs deep reasoning
	| 'actor'        // CognitiveWorkspaceService — produces outputs / actions
	| 'reflector'    // CognitiveLoopService — meta-cognition / self-model update
	| 'orchestrator' // AAROrchestrationService itself
	| 'custom';      // User-defined extension agents

/**
 * The Arena — the shared computational environment in which agents operate.
 *
 * The Arena holds global state that all agents can read/write via Relations.
 */
export interface AARArenaState {
	/** Unique arena session identifier. */
	sessionId: string;
	/** ISO epoch-ms when this arena session started. */
	startTime: number;
	/** All registered agents by ID. */
	agents: Map<string, AARAgent>;
	/** All defined relations by ID. */
	relations: Map<string, AARRelation>;
	/** Number of tasks orchestrated in this session. */
	totalTasksOrchestrated: number;
	/** Number of successful task orchestrations. */
	successfulTasks: number;
	/** Shared key-value context visible to all agents. */
	sharedContext: Map<string, unknown>;
}

/**
 * A typed directed Relation between two agents within the Arena.
 *
 * Relations describe the permitted interactions: what agent A can
 * request from agent B, and with what priority/weight.
 */
export interface AARRelation {
	/** Unique identifier for this relation. */
	id: string;
	/** Source agent ID. */
	sourceAgentId: string;
	/** Target agent ID. */
	targetAgentId: string;
	/** Semantic type of the relation. */
	relationType: AARRelationType;
	/**
	 * Strength/priority weight in [0, 1].
	 * Higher weight = preferred when multiple relations match.
	 */
	weight: number;
	/** Whether this relation is currently active. */
	active: boolean;
}

/**
 * Semantic types for relations between agents.
 */
export type AARRelationType =
	| 'feeds-into'      // Output of source becomes input of target
	| 'modulates'       // Source adjusts target's behaviour parameters
	| 'requests'        // Source sends a task request to target
	| 'responds-to'     // Source is the canonical responder for target
	| 'monitors'        // Source observes and records target's activity
	| 'inhibits'        // Source suppresses / reduces target's activation
	| 'excites';        // Source boosts / amplifies target's activation

// ---------------------------------------------------------------------------
// Task / orchestration types
// ---------------------------------------------------------------------------

/**
 * A cognitive task submitted to the AAR orchestrator.
 */
export interface AARTask {
	/** Unique task identifier (UUID-like). */
	id: string;
	/** Human-readable task description. */
	description: string;
	/** Task payload (query text, data, command, etc.). */
	payload: unknown;
	/**
	 * Required capabilities that the handling agents must possess.
	 * If empty, any agent may handle the task.
	 */
	requiredCapabilities: string[];
	/** Task priority in [0, 1] (1 = highest). */
	priority: number;
	/** Epoch-ms when the task was created. */
	createdAt: number;
	/** Optional deadline (epoch-ms). Tasks past deadline are dropped. */
	deadline?: number;
}

/**
 * The result produced after orchestrating a task through the agent network.
 */
export interface AARTaskResult {
	/** The originating task. */
	task: AARTask;
	/** Ordered list of agent IDs that processed the task. */
	agentPath: string[];
	/** Final output payload from the last agent in the path. */
	output: unknown;
	/** Whether the task completed successfully. */
	success: boolean;
	/** Error message if the task failed. */
	error?: string;
	/** Total wall-clock time in ms for the full orchestration. */
	totalDurationMs: number;
	/** Per-agent processing times in ms. */
	agentDurations: Record<string, number>;
}

/**
 * An in-flight task that is being orchestrated.
 */
export interface AARActiveTask {
	task: AARTask;
	startTime: number;
	currentAgentId: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Agent-Arena-Relation (AAR) Orchestration Service.
 *
 * Implements the triadic AAR architecture as the core orchestration layer
 * for the Zone-Cog cognitive system:
 *
 *   Agent ─── Relation ──► Agent
 *      └────────────────────── Arena (shared env)
 *
 * All cognitive services are wrapped as Agents.  The Arena holds shared
 * state.  Relations define the permitted communication pathways.
 *
 * The orchestrator routes each incoming AARTask along the highest-weight
 * relation chain that satisfies the task's required capabilities, producing
 * an AARTaskResult.
 */
export interface IAAROrchestrationService {
	readonly _serviceBrand: undefined;

	/** Fired when an agent is registered or its state changes. */
	readonly onDidChangeAgent: Event<AARAgent>;

	/** Fired when a relation is added or removed. */
	readonly onDidChangeRelation: Event<AARRelation>;

	/** Fired when a task completes (success or failure). */
	readonly onDidCompleteTask: Event<AARTaskResult>;

	// -- Agent management ----------------------------------------------------

	/**
	 * Register a cognitive agent in the Arena.
	 * @returns false if an agent with the same ID already exists.
	 */
	registerAgent(agent: Omit<AARAgent, 'lastActivationTime' | 'totalTasksProcessed'>): boolean;

	/**
	 * Unregister an agent.
	 * @returns false if the agent was not found.
	 */
	unregisterAgent(agentId: string): boolean;

	/**
	 * Get an agent by ID.
	 */
	getAgent(agentId: string): AARAgent | undefined;

	/**
	 * Get all registered agents.
	 */
	getAllAgents(): AARAgent[];

	/**
	 * Set agent active status.
	 */
	setAgentActive(agentId: string, active: boolean): void;

	// -- Relation management -------------------------------------------------

	/**
	 * Define a relation between two agents.
	 * @returns false if a relation with the same ID already exists.
	 */
	defineRelation(relation: AARRelation): boolean;

	/**
	 * Remove a relation by ID.
	 */
	removeRelation(relationId: string): boolean;

	/**
	 * Get all relations originating from a given agent.
	 */
	getRelationsFrom(agentId: string): AARRelation[];

	/**
	 * Get all relations targeting a given agent.
	 */
	getRelationsTo(agentId: string): AARRelation[];

	// -- Orchestration -------------------------------------------------------

	/**
	 * Submit a task to the AAR orchestrator.
	 *
	 * The orchestrator resolves the best agent path via active relations and
	 * required capability matching, then calls each agent's handler in order.
	 * If no path is found, the default perceive→attend→think→act chain is used.
	 */
	orchestrate(task: Omit<AARTask, 'id' | 'createdAt'>): Promise<AARTaskResult>;

	/**
	 * Get currently active (in-flight) tasks.
	 */
	getActiveTasks(): AARActiveTask[];

	// -- Arena state ---------------------------------------------------------

	/**
	 * Get the current Arena state.
	 */
	getArenaState(): Omit<AARArenaState, 'agents' | 'relations' | 'sharedContext'> & {
		agentCount: number;
		relationCount: number;
		activeTaskCount: number;
		sharedContextKeys: string[];
	};

	/**
	 * Set a value in the shared Arena context.
	 */
	setSharedContext(key: string, value: unknown): void;

	/**
	 * Get a value from the shared Arena context.
	 */
	getSharedContext(key: string): unknown;

	/**
	 * Reset the Arena: clear tasks, reset counters, clear shared context.
	 * Does NOT unregister agents or relations.
	 */
	reset(): void;
}
