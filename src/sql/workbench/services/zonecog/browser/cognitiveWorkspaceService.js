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
exports.CognitiveWorkspaceService = void 0;
const zonecogService_1 = require("sql/workbench/services/zonecog/common/zonecogService");
const lifecycle_1 = require("vs/base/common/lifecycle");
const event_1 = require("vs/base/common/event");
const log_1 = require("vs/platform/log/common/log");
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
function wsId(prefix, seed) {
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
let CognitiveWorkspaceService = class CognitiveWorkspaceService extends lifecycle_1.Disposable {
    logService;
    hypergraphStore;
    _workingMemory = new Map();
    _episodes = [];
    _tasks = new Map();
    _activeTaskId = null;
    _onDidChangeWorkingMemory = this._register(new event_1.Emitter());
    onDidChangeWorkingMemory = this._onDidChangeWorkingMemory.event;
    onDidChangeWorkspace = this._onDidChangeWorkingMemory.event;
    _onDidRecordEpisode = this._register(new event_1.Emitter());
    onDidRecordEpisode = this._onDidRecordEpisode.event;
    _onDidChangeActiveTask = this._register(new event_1.Emitter());
    onDidChangeActiveTask = this._onDidChangeActiveTask.event;
    constructor(logService, hypergraphStore) {
        super();
        this.logService = logService;
        this.hypergraphStore = hypergraphStore;
        this.logService.info('CognitiveWorkspaceService: initialized working memory, episodic memory, and task contexts');
    }
    // -- Working memory ------------------------------------------------------
    addToWorkingMemory(category, content, relevance = 0.7) {
        const now = Date.now();
        const id = wsId('wm', `${category}:${now}:${content}`);
        const clampedRelevance = Math.max(0, Math.min(1, relevance));
        const item = {
            id,
            type: category,
            category,
            content,
            activation: clampedRelevance,
            relevance: clampedRelevance,
            timestamp: now,
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
    touchWorkingMemory(id) {
        const item = this._workingMemory.get(id);
        if (!item) {
            return false;
        }
        item.lastAccessed = Date.now();
        // Boost relevance slightly on access
        item.relevance = Math.min(1, item.relevance + 0.1);
        item.activation = item.relevance;
        this._fireWorkingMemoryChange();
        return true;
    }
    removeFromWorkingMemory(id) {
        const deleted = this._workingMemory.delete(id);
        if (deleted) {
            this._fireWorkingMemoryChange();
        }
        return deleted;
    }
    getWorkingMemory() {
        return Array.from(this._workingMemory.values())
            .sort((a, b) => b.relevance - a.relevance);
    }
    decayWorkingMemory() {
        const toEvict = [];
        for (const [id, item] of this._workingMemory) {
            item.relevance *= RELEVANCE_DECAY_FACTOR;
            item.activation = item.relevance;
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
    recordEpisode(title, content, relatedNodes = []) {
        const now = Date.now();
        const id = wsId('ep', `${now}:${title}`);
        const episode = {
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
    getRecentEpisodes(limit = 20) {
        return this._episodes.slice(-limit).reverse();
    }
    searchEpisodes(keyword) {
        const lower = keyword.toLowerCase();
        return this._episodes.filter(e => e.title.toLowerCase().includes(lower) || e.content.toLowerCase().includes(lower));
    }
    // -- Task context --------------------------------------------------------
    createTask(description, activate = true) {
        const now = Date.now();
        const id = wsId('task', `${now}:${description}`);
        const task = {
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
    setActiveTask(taskId) {
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
        }
        else {
            this._onDidChangeActiveTask.fire(null);
        }
        return true;
    }
    getActiveTask() {
        if (!this._activeTaskId) {
            return null;
        }
        return this._tasks.get(this._activeTaskId) ?? null;
    }
    getAllTasks() {
        return Array.from(this._tasks.values());
    }
    // -- Summary -------------------------------------------------------------
    getSummary() {
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
    reset() {
        this._workingMemory.clear();
        this._episodes.length = 0;
        this._tasks.clear();
        this._activeTaskId = null;
        this._fireWorkingMemoryChange();
        this._onDidChangeActiveTask.fire(null);
        this.logService.info('CognitiveWorkspaceService: reset all workspace state');
    }
    // -- Private helpers -----------------------------------------------------
    _evictLeastRelevant() {
        let minRelevance = Infinity;
        let minId = null;
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
    _fireWorkingMemoryChange() {
        this._onDidChangeWorkingMemory.fire(this.getWorkingMemory());
    }
};
exports.CognitiveWorkspaceService = CognitiveWorkspaceService;
exports.CognitiveWorkspaceService = CognitiveWorkspaceService = __decorate([
    __param(0, log_1.ILogService),
    __param(1, zonecogService_1.IHypergraphStore)
], CognitiveWorkspaceService);
