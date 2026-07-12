/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IAgiStudioService = createDecorator<IAgiStudioService>('agiStudioService');

// ---------------------------------------------------------------------------
// Studio Agent types
// ---------------------------------------------------------------------------

/**
 * Roles that studio agents can play in the Agent-Zero hierarchy.
 */
export type StudioAgentRole =
	| 'orchestrator'       // Root agent that decomposes the goal
	| 'sql-analyzer'       // Wraps ISQLAnalyzerAgent
	| 'schema-reasoner'    // Wraps ISchemaReasonerAgent
	| 'performance-advisor'// Wraps IPerformanceAdvisorAgent
	| 'data-pattern'       // Wraps IDataPatternAgent
	| 'llm-reasoner'       // Uses ILLMProviderService directly
	| 'synthesizer';       // Synthesizes subordinate results

/**
 * Status of an individual studio agent.
 */
export type StudioAgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

/**
 * A single entry in an agent's local (agent-scoped) memory.
 */
export interface StudioAgentMemoryItem {
	/** Memory key used for recall. */
	key: string;
	/** Stored value. */
	value: string;
	/** Epoch-ms when this item was stored. */
	timestamp: number;
}

/**
 * An autonomous Studio Agent in the Agent-Zero hierarchy.
 *
 * Agents form a tree rooted at depth 0 (the orchestrator). Each agent can
 * spawn subordinates (depth+1) up to the configured maximum depth.
 */
export interface StudioAgent {
	/** Unique identifier for this agent within the run. */
	id: string;
	/** Human-readable display name. */
	name: string;
	/** Functional role of this agent. */
	role: StudioAgentRole;
	/** ID of the agent that spawned this one (undefined for the root). */
	superiorId: string | undefined;
	/** IDs of agents spawned by this agent. */
	subordinateIds: string[];
	/** Current lifecycle status. */
	status: StudioAgentStatus;
	/** Depth in the agent tree (root = 0). */
	depth: number;
	/** System prompt injected at construction time. */
	systemPrompt: string;
	/** Epoch-ms when this agent was created. */
	createdAt: number;
	/** Agent-local memory items (key-value pairs). */
	localMemory: StudioAgentMemoryItem[];
}

// ---------------------------------------------------------------------------
// Agent message types
// ---------------------------------------------------------------------------

/**
 * Types of messages agents exchange in the hierarchy.
 */
export type AgentMessageType =
	| 'task-assignment'  // Superior assigns a subtask to a subordinate
	| 'result-report'    // Subordinate reports its result back to its superior
	| 'status-update';   // Agent broadcasts a status change

/**
 * A message passed between two agents in the hierarchy.
 */
export interface AgentMessage {
	/** Unique identifier. */
	id: string;
	/** Agent ID of the sender. */
	fromAgentId: string;
	/** Agent ID of the receiver. */
	toAgentId: string;
	/** Semantic type of the message. */
	messageType: AgentMessageType;
	/** Message payload as a human-readable string. */
	content: string;
	/** Epoch-ms timestamp. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Studio Run types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a studio run.
 */
export type StudioRunStatus = 'running' | 'completed' | 'failed' | 'stopped';

/**
 * A single end-to-end autonomous run triggered by a user goal.
 *
 * A run creates a root orchestrator agent which decomposes the goal and
 * delegates subtasks to subordinate agents.  The run is complete when the
 * root agent synthesizes a final result.
 */
export interface StudioRun {
	/** Unique run identifier. */
	id: string;
	/** The top-level goal provided by the user. */
	goal: string;
	/** ID of the root orchestrator agent. */
	rootAgentId: string;
	/** Current lifecycle status. */
	status: StudioRunStatus;
	/** Epoch-ms when the run started. */
	startTime: number;
	/** Epoch-ms when the run finished (undefined while running). */
	endTime?: number;
	/** Synthesized result string (set on completion). */
	result?: string;
}

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

/**
 * Record of a single tool invocation by an agent.
 */
export interface AgentToolCall {
	/** Tool identifier. */
	toolId: string;
	/** ID of the agent that invoked the tool. */
	agentId: string;
	/** Serialised input passed to the tool. */
	input: string;
	/** Serialised output returned by the tool. */
	output: string;
	/** Whether the invocation succeeded. */
	success: boolean;
	/** Wall-clock time in milliseconds for the invocation. */
	durationMs: number;
	/** Epoch-ms timestamp of the invocation. */
	timestamp: number;
}

/**
 * A tool that an agent can invoke to accomplish part of its task.
 */
export interface AgentTool {
	/** Unique tool identifier. */
	id: string;
	/** Human-readable tool name. */
	name: string;
	/** One-line description of what this tool does. */
	description: string;
	/** Invoke the tool with the given input text and calling agent context. */
	invoke(input: string, agent: StudioAgent): Promise<string>;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * AGI Studio Service — Agent-Zero-style hierarchical autonomous agents.
 *
 * Provides an Agent-Zero-inspired orchestration layer on top of the ZoneCog
 * cognitive services.  A root studio agent receives a high-level goal,
 * decomposes it into subtasks using the LLM provider, delegates each subtask
 * to a spawned subordinate agent, and synthesises a final result.
 *
 * Agents communicate via typed {@link AgentMessage}s (task-assignment /
 * result-report / status-update).  Each agent has an agent-local memory store
 * and may invoke any registered {@link AgentTool}.  All run/agent/message
 * state is persisted as hypergraph nodes.
 */
export interface IAgiStudioService {
	readonly _serviceBrand: undefined;

	/** Fired whenever a run's status changes (created, completed, failed, stopped). */
	readonly onDidChangeRun: Event<StudioRun>;

	/** Fired whenever a new subordinate agent is spawned. */
	readonly onDidSpawnAgent: Event<StudioAgent>;

	/** Fired whenever an agent sends a message to another agent. */
	readonly onDidSendMessage: Event<AgentMessage>;

	// -- Run management ------------------------------------------------------

	/**
	 * Start an autonomous run for the given user goal.
	 *
	 * Immediately spawns a root orchestrator agent, fires `onDidSpawnAgent`,
	 * then executes the full autonomous loop asynchronously.  Returns the
	 * initial run object (status = 'running'); subscribe to `onDidChangeRun`
	 * to observe completion.
	 *
	 * Any previously active run is stopped before starting the new one.
	 */
	startRun(goal: string): Promise<StudioRun>;

	/**
	 * Stop a running run.  Marks the run as 'stopped' synchronously and fires
	 * `onDidChangeRun`.  The async execution loop respects the stop flag and
	 * exits at its next checkpoint.
	 *
	 * @param runId  The run to stop.  Defaults to the currently active run.
	 */
	stopRun(runId?: string): void;

	/**
	 * Get the currently active (running) run, or undefined if none.
	 */
	getActiveRun(): StudioRun | undefined;

	/**
	 * Get all runs ever started in this session (newest first).
	 */
	getRuns(): StudioRun[];

	// -- Query helpers -------------------------------------------------------

	/**
	 * Get all agents belonging to a given run (or all agents if no runId).
	 */
	getAgents(runId?: string): StudioAgent[];

	/**
	 * Get all messages belonging to a given run (or all messages).
	 */
	getMessages(runId?: string): AgentMessage[];

	/**
	 * Get all tool-call records belonging to a given run (or all calls).
	 */
	getToolCalls(runId?: string): AgentToolCall[];

	// -- Tool registry -------------------------------------------------------

	/**
	 * Get all registered agent tools.
	 */
	getTools(): AgentTool[];

	/**
	 * Register a new agent tool.  No-op if a tool with the same ID already
	 * exists.
	 */
	registerTool(tool: AgentTool): void;
}
