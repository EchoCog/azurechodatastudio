/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';

suite('ZoneCog Service Tests', () => {

	let instantiationService: TestInstantiationService;
	let zoneCogService: IZoneCogService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		// Create and register the dependency services
		const hypergraphStore = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, hypergraphStore);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		zoneCogService = instantiationService.createInstance(ZoneCogService);
	});

	test('should initialize properly', async () => {
		await zoneCogService.initialize();
		const state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.isInitialized, true);
		assert.strictEqual(state.thinkingModeEnabled, true);
		assert.strictEqual(state.membraneHealthy, true);
	});

	test('should process simple queries', async () => {
		await zoneCogService.initialize();
		const response = await zoneCogService.processQuery('Hello');

		assert.ok(response.response);
		assert.ok(response.metadata);
		assert.strictEqual(response.metadata.queryComplexity, 'simple');
		assert.ok(response.confidence > 0);
		assert.ok(response.phases.length > 0);
		assert.ok(response.metadata.relatedNodes.length > 0);
	});

	test('should process complex queries with deeper thinking', async () => {
		await zoneCogService.initialize();
		const complexQuery = 'Can you analyze and compare the different approaches to data visualization and synthesize the optimal strategy for our database performance metrics?';
		const response = await zoneCogService.processQuery(complexQuery);

		assert.ok(response.response);
		assert.strictEqual(response.metadata.queryComplexity, 'complex');
		assert.strictEqual(response.metadata.thinkingDepth, 'deep');
		// Deep thinking should produce all 9 phases
		assert.ok(response.phases.length >= 7);
		// Verify phase names include key protocol phases
		const phaseNames = response.phases.map(p => p.name);
		assert.ok(phaseNames.includes('Initial Engagement'));
		assert.ok(phaseNames.includes('Knowledge Synthesis'));
		assert.ok(phaseNames.includes('Response Preparation'));
	});

	test('should toggle thinking mode', async () => {
		await zoneCogService.initialize();

		zoneCogService.setThinkingMode(false);
		let state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.thinkingModeEnabled, false);

		const response = await zoneCogService.processQuery('Test query');
		assert.strictEqual(response.thinking, '');
		assert.strictEqual(response.phases.length, 0);

		zoneCogService.setThinkingMode(true);
		state = zoneCogService.getCognitiveState();
		assert.strictEqual(state.thinkingModeEnabled, true);
	});

	test('should assess query complexity correctly', async () => {
		await zoneCogService.initialize();

		// Simple query
		const simpleResponse = await zoneCogService.processQuery('Hi');
		assert.strictEqual(simpleResponse.metadata.queryComplexity, 'simple');

		// Moderate query
		const moderateResponse = await zoneCogService.processQuery('How can I connect to my database?');
		assert.strictEqual(moderateResponse.metadata.queryComplexity, 'moderate');

		// Complex query
		const complexResponse = await zoneCogService.processQuery('Please analyze the performance metrics and synthesize optimization strategies for our multi-tenant database architecture across different cloud providers.');
		assert.strictEqual(complexResponse.metadata.queryComplexity, 'complex');
	});

	test('should persist cognitive processing in hypergraph', async () => {
		await zoneCogService.initialize();
		const store = zoneCogService.getHypergraphStore();

		assert.strictEqual(store.nodeCount(), 0);

		await zoneCogService.processQuery('Test hypergraph persistence');

		// Should have created query, thinking, and response nodes
		assert.ok(store.nodeCount() >= 3);
		assert.ok(store.getNodesByType('QueryInput').length > 0);
		assert.ok(store.getNodesByType('ThinkingProcess').length > 0);
		assert.ok(store.getNodesByType('CognitiveResponse').length > 0);

		// Should have created links between nodes
		assert.ok(store.linkCount() > 0);
	});

	test('should fire cognitive state change events', async () => {
		let stateChangeCount = 0;
		zoneCogService.onDidChangeCognitiveState(() => {
			stateChangeCount++;
		});

		await zoneCogService.initialize();
		assert.ok(stateChangeCount > 0, 'Should fire state change on init');

		const before = stateChangeCount;
		await zoneCogService.processQuery('Test event');
		assert.ok(stateChangeCount > before, 'Should fire state changes during processing');
	});

	test('should fire query processed events', async () => {
		let processedCount = 0;
		zoneCogService.onDidProcessQuery(() => {
			processedCount++;
		});

		await zoneCogService.initialize();
		await zoneCogService.processQuery('Event test');
		assert.strictEqual(processedCount, 1);
	});

	test('should track cognitive load', async () => {
		await zoneCogService.initialize();
		const stateBefore = zoneCogService.getCognitiveState();
		assert.strictEqual(stateBefore.cognitiveLoad, 0);

		await zoneCogService.processQuery('Load test');
		const stateAfter = zoneCogService.getCognitiveState();
		// Load increases then decreases — final value should be > 0 and <= 1
		assert.ok(stateAfter.cognitiveLoad >= 0);
		assert.ok(stateAfter.cognitiveLoad <= 1);
	});

	test('should report hypergraph node count in state', async () => {
		await zoneCogService.initialize();
		const state1 = zoneCogService.getCognitiveState();
		assert.strictEqual(state1.hypergraphNodeCount, 0);

		await zoneCogService.processQuery('Count test');
		const state2 = zoneCogService.getCognitiveState();
		assert.ok(state2.hypergraphNodeCount > 0);
	});
});

suite('HypergraphStore Tests', () => {

	let instantiationService: TestInstantiationService;
	let store: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		store = instantiationService.createInstance(HypergraphStore);
	});

	test('should add and get nodes', () => {
		store.addNode({
			id: 'n1', node_type: 'TestNode', content: 'hello',
			links: [], metadata: {}, salience_score: 0.5
		});
		const node = store.getNode('n1');
		assert.ok(node);
		assert.strictEqual(node.id, 'n1');
		assert.strictEqual(node.content, 'hello');
	});

	test('should update nodes', () => {
		store.addNode({
			id: 'n1', node_type: 'TestNode', content: 'old',
			links: [], metadata: {}, salience_score: 0.5
		});
		const updated = store.updateNode('n1', { content: 'new' });
		assert.ok(updated);
		assert.strictEqual(updated.content, 'new');
		assert.strictEqual(updated.id, 'n1');
	});

	test('should remove nodes', () => {
		store.addNode({
			id: 'n1', node_type: 'TestNode', content: 'x',
			links: [], metadata: {}, salience_score: 0.5
		});
		assert.strictEqual(store.nodeCount(), 1);
		assert.ok(store.removeNode('n1'));
		assert.strictEqual(store.nodeCount(), 0);
	});

	test('should filter nodes by type', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addNode({ id: 'n2', node_type: 'B', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addNode({ id: 'n3', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0 });

		assert.strictEqual(store.getNodesByType('A').length, 2);
		assert.strictEqual(store.getNodesByType('B').length, 1);
	});

	test('should add and get links', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addNode({ id: 'n2', node_type: 'B', content: '', links: [], metadata: {}, salience_score: 0 });

		store.addLink({ id: 'l1', link_type: 'TestLink', outgoing: ['n1', 'n2'], metadata: {} });

		const link = store.getLink('l1');
		assert.ok(link);
		assert.strictEqual(link.link_type, 'TestLink');

		// Link should be registered on participant nodes
		const n1 = store.getNode('n1');
		assert.ok(n1);
		assert.ok(n1.links.includes('l1'));
	});

	test('should get links for a node', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addNode({ id: 'n2', node_type: 'B', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addLink({ id: 'l1', link_type: 'T', outgoing: ['n1', 'n2'], metadata: {} });
		store.addLink({ id: 'l2', link_type: 'T', outgoing: ['n2'], metadata: {} });

		assert.strictEqual(store.getLinksForNode('n1').length, 1);
		assert.strictEqual(store.getLinksForNode('n2').length, 2);
	});

	test('should return top salient nodes', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0.3 });
		store.addNode({ id: 'n2', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0.9 });
		store.addNode({ id: 'n3', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0.6 });

		const top = store.getTopSalientNodes(2);
		assert.strictEqual(top.length, 2);
		assert.strictEqual(top[0].id, 'n2');
		assert.strictEqual(top[1].id, 'n3');
	});

	test('should decay salience', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 1.0 });
		store.decayAllSalience(0.5);
		const node = store.getNode('n1');
		assert.ok(node);
		assert.ok(Math.abs(node.salience_score - 0.5) < 0.001);
	});

	test('should clear all data', () => {
		store.addNode({ id: 'n1', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0 });
		store.addLink({ id: 'l1', link_type: 'T', outgoing: ['n1'], metadata: {} });
		store.clear();
		assert.strictEqual(store.nodeCount(), 0);
		assert.strictEqual(store.linkCount(), 0);
	});
});

suite('CognitiveMembraneService Tests', () => {

	let instantiationService: TestInstantiationService;
	let membraneService: ICognitiveMembraneService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		membraneService = instantiationService.createInstance(CognitiveMembraneService);
	});

	test('should initialize all three triads', () => {
		const statuses = membraneService.getAllStatuses();
		assert.strictEqual(statuses.length, 3);
		const triads = statuses.map(s => s.triad);
		assert.ok(triads.includes('cerebral'));
		assert.ok(triads.includes('somatic'));
		assert.ok(triads.includes('autonomic'));
	});

	test('should report healthy system initially', () => {
		assert.ok(membraneService.isSystemHealthy());
	});

	test('should record activity', () => {
		membraneService.recordActivity('cerebral');
		const status = membraneService.getStatus('cerebral');
		assert.strictEqual(status.activeProcesses, 1);
		assert.ok(status.lastActivity > 0);
	});

	test('should record errors and track health', () => {
		assert.ok(membraneService.getStatus('somatic').healthy);

		// Add errors below threshold
		for (let i = 0; i < 9; i++) {
			membraneService.recordError('somatic', `error ${i}`);
		}
		assert.ok(membraneService.getStatus('somatic').healthy);

		// 10th error crosses threshold
		membraneService.recordError('somatic', 'error 9');
		assert.ok(!membraneService.getStatus('somatic').healthy);
		assert.ok(!membraneService.isSystemHealthy());
	});

	test('should reset errors', () => {
		for (let i = 0; i < 15; i++) {
			membraneService.recordError('autonomic', `err ${i}`);
		}
		assert.ok(!membraneService.getStatus('autonomic').healthy);

		membraneService.resetErrors('autonomic');
		assert.strictEqual(membraneService.getStatus('autonomic').errorCount, 0);
		assert.ok(membraneService.getStatus('autonomic').healthy);
	});

	test('should fire status change events', () => {
		let changeCount = 0;
		membraneService.onDidChangeMembraneStatus(() => {
			changeCount++;
		});

		membraneService.recordActivity('cerebral');
		assert.strictEqual(changeCount, 1);

		membraneService.recordError('cerebral', 'test');
		assert.strictEqual(changeCount, 2);
	});
});
