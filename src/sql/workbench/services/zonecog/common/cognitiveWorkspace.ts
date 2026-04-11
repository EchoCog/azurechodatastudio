/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const ICognitiveWorkspaceService = createDecorator<ICognitiveWorkspaceService>('cognitiveWorkspaceService');

// ---------------------------------------------------------------------------
// Working memory types
// ---------------------------------------------------------------------------

/**
 * An item held in working memory -- the cognitive system's short-term,
 * capacity-limited store of currently relevant information.
 */
export interface WorkingMemoryItem {
	/** Unique identifier. */
	id: string;
	/** Category label (e.g. "schema", "query", "insight", "goal"). */
	category: string;
	/** Human-readable content. */
	content: string;
	/** Relevance weight in [0, 1].  Items below a threshold are evicted. */
	relevance: number;
	/** Epoch-ms when this item entered working memory. */
	addedAt: number;
	/** Epoch-ms of last access (refreshes relevance decay). */
	lastAccessed: number;
}

// ---------------------------------------------------------------------------
// Episodic memory types
// ---------------------------------------------------------------------------

/**
 * An episode -- a temporally bounded cognitive event stored in long-term
 * episodic memory.
 */
export interface CognitiveEpisode {
	/** Unique identifier. */
	id: string;
	/** Short title / summary. */
	title: string;
	/** Detailed content or transcript of the episode. */
	content: string;
	/** IDs of hypergraph nodes created during this episode. */
	relatedNodes: string[];
	/** Start and end timestamps. */
	startTime: number;
	endTime: number;
	/** Salience score for retrieval ranking. */
	salience: number;
}

// ---------------------------------------------------------------------------
// Task context types
// ---------------------------------------------------------------------------

/**
 * A cognitive task context -- the system's representation of what it is
 * currently working on.
 */
export interface TaskContext {
	/** Unique identifier. */
	id: string;
	/** Human-readable task description. */
	description: string;
	/** IDs of working-memory items relevant to this task. */
	workingMemoryIds: string[];
	/** IDs of episodes associated with this task. */
	episodeIds: string[];
	/** Whether this task is currently active. */
	active: boolean;
	/** Epoch-ms when the task was created. */
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Workspace summary
// ---------------------------------------------------------------------------

/**
 * A high-level summary of the cognitive workspace state.
 */
export interface WorkspaceSummary {
	/** Number of items in working memory. */
	workingMemorySize: number;
	/** Maximum working memory capacity. */
	workingMemoryCapacity: number;
	/** Total episodes recorded. */
	episodeCount: number;
	/** Active task description (null if none). */
	activeTask: string | null;
	/** Total task contexts created. */
	taskCount: number;
	/** Timestamp of the summary. */
	timestamp: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/**
 * Cognitive Workspace Service -- manages the cognitive system's working
 * memory, episodic memory, and task contexts.
 *
 * Working memory is capacity-limited and uses relevance-based eviction.
 * Episodic memory stores temporally bounded cognitive events.
 * Task contexts group related memory and episodes together.
 */
export interface ICognitiveWorkspaceService {
	readonly _serviceBrand: undefined;

	/** Fired when working memory changes (item added, evicted, or updated). */
	readonly onDidChangeWorkingMemory: Event<WorkingMemoryItem[]>;

	/** Fired when a new episode is recorded. */
	readonly onDidRecordEpisode: Event<CognitiveEpisode>;

	/** Fired when the active task changes. */
	readonly onDidChangeActiveTask: Event<TaskContext | null>;

	// -- Working memory ------------------------------------------------------

	/**
	 * Add an item to working memory.  If capacity is full, the least
	 * relevant item is evicted.
	 */
	addToWorkingMemory(category: string, content: string, relevance?: number): WorkingMemoryItem;

	/**
	 * Refresh an item's relevance (prevents decay-based eviction).
	 */
	touchWorkingMemory(id: string): boolean;

	/**
	 * Remove an item from working memory.
	 */
	removeFromWorkingMemory(id: string): boolean;

	/**
	 * Get all current working memory items, sorted by relevance.
	 */
	getWorkingMemory(): WorkingMemoryItem[];

	/**
	 * Run relevance decay on all working memory items and evict those
	 * that fall below the threshold.
	 */
	decayWorkingMemory(): void;

	// -- Episodic memory -----------------------------------------------------

	/**
	 * Record a cognitive episode.
	 */
	recordEpisode(title: string, content: string, relatedNodes?: string[]): CognitiveEpisode;

	/**
	 * Get recent episodes, most recent first.
	 */
	getRecentEpisodes(limit?: number): CognitiveEpisode[];

	/**
	 * Search episodes by keyword in title or content.
	 */
	searchEpisodes(keyword: string): CognitiveEpisode[];

	// -- Task context --------------------------------------------------------

	/**
	 * Create a new task context and optionally make it active.
	 */
	createTask(description: string, activate?: boolean): TaskContext;

	/**
	 * Switch the active task.
	 */
	setActiveTask(taskId: string | null): boolean;

	/**
	 * Get the currently active task (null if none).
	 */
	getActiveTask(): TaskContext | null;

	/**
	 * Get all task contexts.
	 */
	getAllTasks(): TaskContext[];

	// -- Summary -------------------------------------------------------------

	/**
	 * Get a high-level summary of the cognitive workspace.
	 */
	getSummary(): WorkspaceSummary;

	/**
	 * Reset the workspace (clear working memory, episodes, tasks).
	 */
	reset(): void;
}
