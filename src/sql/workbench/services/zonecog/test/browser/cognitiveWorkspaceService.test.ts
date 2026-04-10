/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { IHypergraphStore } from 'sql/workbench/services/zonecog/common/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('CognitiveWorkspaceService Tests', () => {

	let instantiationService: TestInstantiationService;
	let workspaceService: ICognitiveWorkspaceService;
	let hypergraphStore: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
	});

	// -- Working memory ------------------------------------------------------

	test('should add items to working memory', () => {
		const item = workspaceService.addToWorkingMemory('schema', 'orders table has 5 columns');

		assert.ok(item.id);
		assert.strictEqual(item.category, 'schema');
		assert.strictEqual(item.content, 'orders table has 5 columns');
		assert.ok(item.relevance > 0);
	});

	test('should persist working memory in hypergraph', () => {
		workspaceService.addToWorkingMemory('query', 'SELECT * FROM orders');

		const nodes = hypergraphStore.getNodesByType('WorkingMemory');
		assert.strictEqual(nodes.length, 1);
	});

	test('should return working memory sorted by relevance', () => {
		workspaceService.addToWorkingMemory('a', 'low', 0.3);
		workspaceService.addToWorkingMemory('b', 'high', 0.9);
		workspaceService.addToWorkingMemory('c', 'mid', 0.6);

		const wm = workspaceService.getWorkingMemory();
		assert.strictEqual(wm.length, 3);
		assert.strictEqual(wm[0].content, 'high');
		assert.strictEqual(wm[2].content, 'low');
	});

	test('should evict least relevant when at capacity', () => {
		// Working memory capacity is 9
		for (let i = 0; i < 9; i++) {
			workspaceService.addToWorkingMemory('item', `item-${i}`, 0.5 + i * 0.01);
		}
		assert.strictEqual(workspaceService.getWorkingMemory().length, 9);

		// Adding one more should evict the least relevant
		workspaceService.addToWorkingMemory('item', 'item-new', 0.9);
		assert.strictEqual(workspaceService.getWorkingMemory().length, 9);

		// The new item should be present
		const contents = workspaceService.getWorkingMemory().map(i => i.content);
		assert.ok(contents.includes('item-new'));
	});

	test('should touch (refresh) working memory items', () => {
		const item = workspaceService.addToWorkingMemory('test', 'content', 0.5);
		const originalRelevance = item.relevance;

		const touched = workspaceService.touchWorkingMemory(item.id);
		assert.strictEqual(touched, true);

		const wm = workspaceService.getWorkingMemory();
		const updated = wm.find(i => i.id === item.id);
		assert.ok(updated);
		assert.ok(updated.relevance > originalRelevance);
	});

	test('should return false when touching non-existent item', () => {
		assert.strictEqual(workspaceService.touchWorkingMemory('nonexistent'), false);
	});

	test('should remove items from working memory', () => {
		const item = workspaceService.addToWorkingMemory('test', 'removable');
		assert.strictEqual(workspaceService.getWorkingMemory().length, 1);

		assert.strictEqual(workspaceService.removeFromWorkingMemory(item.id), true);
		assert.strictEqual(workspaceService.getWorkingMemory().length, 0);
	});

	test('should decay working memory relevance', () => {
		const item = workspaceService.addToWorkingMemory('test', 'decaying', 0.5);

		// Decay multiple times to bring relevance down
		for (let i = 0; i < 50; i++) {
			workspaceService.decayWorkingMemory();
		}

		// After many decay cycles, item should be evicted (below threshold)
		const wm = workspaceService.getWorkingMemory();
		const found = wm.find(i => i.id === item.id);
		assert.strictEqual(found, undefined, 'Item should be evicted after heavy decay');
	});

	test('should fire working memory change events', () => {
		let eventCount = 0;
		workspaceService.onDidChangeWorkingMemory(() => eventCount++);

		workspaceService.addToWorkingMemory('test', 'event-test');
		assert.ok(eventCount >= 1);
	});

	// -- Episodic memory -----------------------------------------------------

	test('should record episodes', () => {
		const episode = workspaceService.recordEpisode('Query analysis', 'Analyzed SELECT query');

		assert.ok(episode.id);
		assert.strictEqual(episode.title, 'Query analysis');
		assert.strictEqual(episode.content, 'Analyzed SELECT query');
		assert.ok(episode.startTime > 0);
	});

	test('should persist episodes in hypergraph', () => {
		workspaceService.recordEpisode('Test ep', 'content');

		const nodes = hypergraphStore.getNodesByType('CognitiveEpisode');
		assert.strictEqual(nodes.length, 1);
	});

	test('should link episodes to related nodes', () => {
		hypergraphStore.addNode({
			id: 'related-1', node_type: 'TestNode', content: '',
			links: [], metadata: {}, salience_score: 0.5,
		});

		workspaceService.recordEpisode('Linked ep', 'content', ['related-1']);

		const links = hypergraphStore.getLinksByType('EpisodeReference');
		assert.strictEqual(links.length, 1);
	});

	test('should get recent episodes in reverse chronological order', () => {
		workspaceService.recordEpisode('First', '');
		workspaceService.recordEpisode('Second', '');
		workspaceService.recordEpisode('Third', '');

		const episodes = workspaceService.getRecentEpisodes();
		assert.strictEqual(episodes.length, 3);
		assert.strictEqual(episodes[0].title, 'Third');
		assert.strictEqual(episodes[2].title, 'First');
	});

	test('should search episodes by keyword', () => {
		workspaceService.recordEpisode('Query perf', 'Analyzed query performance');
		workspaceService.recordEpisode('Schema review', 'Reviewed table schemas');
		workspaceService.recordEpisode('Query opt', 'Optimized slow queries');

		const results = workspaceService.searchEpisodes('query');
		assert.strictEqual(results.length, 2);
	});

	test('should fire episode events', () => {
		let eventCount = 0;
		workspaceService.onDidRecordEpisode(() => eventCount++);

		workspaceService.recordEpisode('Test', '');
		assert.strictEqual(eventCount, 1);
	});

	// -- Task context --------------------------------------------------------

	test('should create and activate tasks', () => {
		const task = workspaceService.createTask('Analyze query performance');

		assert.ok(task.id);
		assert.strictEqual(task.description, 'Analyze query performance');
		assert.strictEqual(task.active, true);

		const active = workspaceService.getActiveTask();
		assert.ok(active);
		assert.strictEqual(active.id, task.id);
	});

	test('should create tasks without activation', () => {
		const task = workspaceService.createTask('Background task', false);
		assert.strictEqual(task.active, false);
		assert.strictEqual(workspaceService.getActiveTask(), null);
	});

	test('should switch active tasks', () => {
		const task1 = workspaceService.createTask('Task 1');
		const task2 = workspaceService.createTask('Task 2');

		assert.strictEqual(workspaceService.getActiveTask()!.id, task2.id);

		workspaceService.setActiveTask(task1.id);
		assert.strictEqual(workspaceService.getActiveTask()!.id, task1.id);
	});

	test('should deactivate task when setting null', () => {
		workspaceService.createTask('Task 1');
		assert.ok(workspaceService.getActiveTask());

		workspaceService.setActiveTask(null);
		assert.strictEqual(workspaceService.getActiveTask(), null);
	});

	test('should return false when switching to unknown task', () => {
		assert.strictEqual(workspaceService.setActiveTask('nonexistent'), false);
	});

	test('should associate working memory with active task', () => {
		const task = workspaceService.createTask('Test task');
		workspaceService.addToWorkingMemory('data', 'schema info');

		const allTasks = workspaceService.getAllTasks();
		const activeTask = allTasks.find(t => t.id === task.id);
		assert.ok(activeTask);
		assert.strictEqual(activeTask.workingMemoryIds.length, 1);
	});

	test('should associate episodes with active task', () => {
		const task = workspaceService.createTask('Test task');
		workspaceService.recordEpisode('Episode 1', 'content');

		const allTasks = workspaceService.getAllTasks();
		const activeTask = allTasks.find(t => t.id === task.id);
		assert.ok(activeTask);
		assert.strictEqual(activeTask.episodeIds.length, 1);
	});

	test('should fire active task change events', () => {
		let eventCount = 0;
		workspaceService.onDidChangeActiveTask(() => eventCount++);

		workspaceService.createTask('Task 1');
		assert.strictEqual(eventCount, 1);

		workspaceService.setActiveTask(null);
		assert.strictEqual(eventCount, 2);
	});

	test('should persist tasks in hypergraph', () => {
		workspaceService.createTask('Persistent task');

		const nodes = hypergraphStore.getNodesByType('TaskContext');
		assert.strictEqual(nodes.length, 1);
	});

	// -- Summary -------------------------------------------------------------

	test('should provide workspace summary', () => {
		workspaceService.addToWorkingMemory('test', 'item');
		workspaceService.recordEpisode('ep', 'content');
		workspaceService.createTask('my task');

		const summary = workspaceService.getSummary();
		assert.strictEqual(summary.workingMemorySize, 1);
		assert.strictEqual(summary.workingMemoryCapacity, 9);
		assert.strictEqual(summary.episodeCount, 1);
		assert.strictEqual(summary.taskCount, 1);
		assert.strictEqual(summary.activeTask, 'my task');
	});

	// -- Reset ---------------------------------------------------------------

	test('should reset all workspace state', () => {
		workspaceService.addToWorkingMemory('test', 'item');
		workspaceService.recordEpisode('ep', 'content');
		workspaceService.createTask('task');

		workspaceService.reset();

		const summary = workspaceService.getSummary();
		assert.strictEqual(summary.workingMemorySize, 0);
		assert.strictEqual(summary.episodeCount, 0);
		assert.strictEqual(summary.taskCount, 0);
		assert.strictEqual(summary.activeTask, null);
	});
});
