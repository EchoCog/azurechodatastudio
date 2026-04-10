/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ICognitiveWorkspaceService,
	WorkingMemoryItem,
	CognitiveEpisode,
	TaskContext,
	WorkspaceSummary
} from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';

/**
 * Maximum number of items that working memory can hold simultaneously.
 * Mirrors the cognitive science finding of ~7 +/- 2 chunks.
 */
const WORKING_MEMORY_CAPACITY = 9;

/**
 * Relevance threshold below which items are evicted from working memory.
 */
const RELEVANCE_EVICTION_THRESHOLD = 0.1;

/**
 * Decay factor applied to working memory relevance on each decay cycle.
 */
const RELEVANCE_DECAY_FACTOR = 0.92;

/**
 * Maximum number of episodes retained.
 */
const MAX_EPISODES = 500;

/**
 * Generate a workspace-scoped short id.
 */
function wsId(prefix: string, seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
	}
	return `ws_${prefix}_${Math.abs(hash).toString(36)}`;
}

/**
 * Cognitive Workspace Service implementation.
 *
 * Manages three memory systems:
 * 1. **Working memory** -- capacity-limited, relevance-decayed short-term store
 * 2. **Episodic memory** -- temporally indexed long-term event store
 * 3. **Task contexts** -- goal-oriented groupings of memory and episodes
 *
 * All items are persisted as nodes in the hypergraph store so that the
 * cognitive protocol can reference them during thinking phases.
 */
export class CognitiveWorkspaceService extends Disposable implements ICognitiveWorkspaceService {

	declare readonly _serviceBrand: undefined;

	private readonly _workingMemory: Map<string, WorkingMemoryItem> = new Map();
	private readonly _episodes: CognitiveEpisode[] = [];
	private readonly _tasks: Map<string, TaskContext> = new Map();
	private _activeTaskId: string | null = null;

	private readonly _onDidChangeWorkingMemory = this._register(new Emitter<WorkingMemoryItem[]>());
	readonly onDidChangeWorkingMemory: Event<WorkingMemoryItem[]> = this._onDidChangeWorkingMemory.event;

	private readonly _onDidRecordEpisode = this._register(new Emitter<CognitiveEpisode>());
	readonly onDidRecordEpisode: Event<CognitiveEpisode> = this._onDidRecordEpisode.event;

	private readonly _onDidChangeActiveTask = this._register(new Emitter<TaskContext | null>());
	readonly onDidChangeActiveTask: Event<TaskContext | null> = this._onDidChangeActiveTask.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IHypergraphStore private readonly hypergraphStore: IHypergraphStore
	) {
		super();
		this.logService.info('CognitiveWorkspaceService: initialized working memory, episodic memory, and task contexts');
	}

	// -- Working memory ------------------------------------------------------

	addToWorkingMemory(category: string, content: string, relevance: number = 0.7): WorkingMemoryItem {
		const now = Date.now();
		const id = wsId('wm', `${category}:${now}:${content}`);
		const clampedRelevance = Math.max(0, Math.min(1, relevance));

		const item: WorkingMemoryItem = {
			id,
			category,
			content,
			relevance: clampedRelevance,
			addedAt: now,
			lastAccessed: now,
		};

		// Evict if at capacity
		if (this._workingMemory.size >= WORKING_MEMORY_CAPACITY) {
			this._evictLeastRelevant();
		}

		this._workingMemory.set(id, item);

		// Persist in hypergraph
		this.hypergraphStore.addNode({
			id,
			node_type: 'WorkingMemory',
			content,
			links: [],
			metadata: { category, relevance: clampedRelevance, addedAt: now },
			salience_score: clampedRelevance,
		});

		// Associate with active task
		if (this._activeTaskId) {
			const task = this._tasks.get(this._activeTaskId);
			if (task) {
				task.workingMemoryIds.push(id);
			}
		}

		this._fireWorkingMemoryChange();
		this.logService.trace(`CognitiveWorkspaceService: added to working memory [${category}] ${content.substring(0, 60)}`);
		return item;
	}

	touchWorkingMemory(id: string): boolean {
		const item = this._workingMemory.get(id);
		if (!item) {
			return false;
		}
		item.lastAccessed = Date.now();
		// Boost relevance slightly on access
		item.relevance = Math.min(1, item.relevance + 0.1);
		this._fireWorkingMemoryChange();
		return true;
	}

	removeFromWorkingMemory(id: string): boolean {
		const deleted = this._workingMemory.delete(id);
		if (deleted) {
			this._fireWorkingMemoryChange();
		}
		return deleted;
	}

	getWorkingMemory(): WorkingMemoryItem[] {
		return Array.from(this._workingMemory.values())
			.sort((a, b) => b.relevance - a.relevance);
	}

	decayWorkingMemory(): void {
		const toEvict: string[] = [];
		for (const [id, item] of this._workingMemory) {
			item.relevance *= RELEVANCE_DECAY_FACTOR;
			if (item.relevance < RELEVANCE_EVICTION_THRESHOLD) {
				toEvict.push(id);
			}
		}
		for (const id of toEvict) {
			this._workingMemory.delete(id);
			this.logService.trace(`CognitiveWorkspaceService: evicted working memory item ${id} (below threshold)`);
		}
		if (toEvict.length > 0) {
			this._fireWorkingMemoryChange();
		}
	}

	// -- Episodic memory -----------------------------------------------------

	recordEpisode(title: string, content: string, relatedNodes: string[] = []): CognitiveEpisode {
		const now = Date.now();
		const id = wsId('ep', `${now}:${title}`);

		const episode: CognitiveEpisode = {
			id,
			title,
			content,
			relatedNodes,
			startTime: now,
			endTime: now,
			salience: 0.6,
		};

		this._episodes.push(episode);
		if (this._episodes.length > MAX_EPISODES) {
			this._episodes.shift();
		}

		// Persist in hypergraph
		this.hypergraphStore.addNode({
			id,
			node_type: 'CognitiveEpisode',
			content: title,
			links: [],
			metadata: { contentLength: content.length, relatedNodes, startTime: now },
			salience_score: 0.6,
		});

		// Link episode to related nodes
		for (const nodeId of relatedNodes) {
			const linkId = wsId('el', `${id}:${nodeId}`);
			this.hypergraphStore.addLink({
				id: linkId,
				link_type: 'EpisodeReference',
				outgoing: [id, nodeId],
				metadata: {},
			});
		}

		// Associate with active task
		if (this._activeTaskId) {
			const task = this._tasks.get(this._activeTaskId);
			if (task) {
				task.episodeIds.push(id);
			}
		}

		this._onDidRecordEpisode.fire(episode);
		this.logService.trace(`CognitiveWorkspaceService: recorded episode "${title}"`);
		return episode;
	}

	getRecentEpisodes(limit: number = 20): CognitiveEpisode[] {
		return this._episodes.slice(-limit).reverse();
	}

	searchEpisodes(keyword: string): CognitiveEpisode[] {
		const lower = keyword.toLowerCase();
		return this._episodes.filter(
			e => e.title.toLowerCase().includes(lower) || e.content.toLowerCase().includes(lower)
		);
	}

	// -- Task context --------------------------------------------------------

	createTask(description: string, activate: boolean = true): TaskContext {
		const now = Date.now();
		const id = wsId('task', `${now}:${description}`);

		const task: TaskContext = {
			id,
			description,
			workingMemoryIds: [],
			episodeIds: [],
			active: false,
			createdAt: now,
		};

		this._tasks.set(id, task);

		// Persist in hypergraph
		this.hypergraphStore.addNode({
			id,
			node_type: 'TaskContext',
			content: description,
			links: [],
			metadata: { createdAt: now },
			salience_score: 0.7,
		});

		if (activate) {
			this.setActiveTask(id);
		}

		this.logService.trace(`CognitiveWorkspaceService: created task "${description}"`);
		return task;
	}

	setActiveTask(taskId: string | null): boolean {
		if (taskId !== null && !this._tasks.has(taskId)) {
			return false;
		}

		// Deactivate current task
		if (this._activeTaskId) {
			const prev = this._tasks.get(this._activeTaskId);
			if (prev) {
				prev.active = false;
			}
		}

		this._activeTaskId = taskId;

		if (taskId) {
			const task = this._tasks.get(taskId);
			if (task) {
				task.active = true;
				this._onDidChangeActiveTask.fire(task);
			}
		} else {
			this._onDidChangeActiveTask.fire(null);
		}

		return true;
	}

	getActiveTask(): TaskContext | null {
		if (!this._activeTaskId) {
			return null;
		}
		return this._tasks.get(this._activeTaskId) ?? null;
	}

	getAllTasks(): TaskContext[] {
		return Array.from(this._tasks.values());
	}

	// -- Summary -------------------------------------------------------------

	getSummary(): WorkspaceSummary {
		const activeTask = this.getActiveTask();
		return {
			workingMemorySize: this._workingMemory.size,
			workingMemoryCapacity: WORKING_MEMORY_CAPACITY,
			episodeCount: this._episodes.length,
			activeTask: activeTask ? activeTask.description : null,
			taskCount: this._tasks.size,
			timestamp: Date.now(),
		};
	}

	reset(): void {
		this._workingMemory.clear();
		this._episodes.length = 0;
		this._tasks.clear();
		this._activeTaskId = null;
		this._fireWorkingMemoryChange();
		this._onDidChangeActiveTask.fire(null);
		this.logService.info('CognitiveWorkspaceService: reset all workspace state');
	}

	// -- Private helpers -----------------------------------------------------

	private _evictLeastRelevant(): void {
		let minRelevance = Infinity;
		let minId: string | null = null;
		for (const [id, item] of this._workingMemory) {
			if (item.relevance < minRelevance) {
				minRelevance = item.relevance;
				minId = id;
			}
		}
		if (minId) {
			this._workingMemory.delete(minId);
			this.logService.trace(`CognitiveWorkspaceService: evicted working memory item ${minId} (capacity)`);
		}
	}

	private _fireWorkingMemoryChange(): void {
		this._onDidChangeWorkingMemory.fire(this.getWorkingMemory());
	}
}
