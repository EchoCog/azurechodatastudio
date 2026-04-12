/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IZoneCogService, IHypergraphStore, ICognitiveMembraneService } from 'sql/workbench/services/zonecog/common/zonecogService';
import { ZoneCogService } from 'sql/workbench/services/zonecog/browser/zonecogService';
import { HypergraphStore } from 'sql/workbench/services/zonecog/browser/hypergraphStore';
import { CognitiveMembraneService } from 'sql/workbench/services/zonecog/browser/cognitiveMembraneService';
import { ILLMProviderService } from 'sql/workbench/services/zonecog/common/llmProvider';
import { LLMProviderService } from 'sql/workbench/services/zonecog/browser/llmProviderService';
import { IECANAttentionService } from 'sql/workbench/services/zonecog/common/ecanAttention';
import { ECANAttentionService } from 'sql/workbench/services/zonecog/browser/ecanAttentionService';
import { IEmbodiedCognitionService } from 'sql/workbench/services/zonecog/common/embodiedCognition';
import { EmbodiedCognitionService } from 'sql/workbench/services/zonecog/browser/embodiedCognitionService';
import { ICognitiveWorkspaceService } from 'sql/workbench/services/zonecog/common/cognitiveWorkspace';
import { CognitiveWorkspaceService } from 'sql/workbench/services/zonecog/browser/cognitiveWorkspaceService';
import { ICognitiveLoopService } from 'sql/workbench/services/zonecog/common/cognitiveLoop';
import { CognitiveLoopService } from 'sql/workbench/services/zonecog/browser/cognitiveLoopService';
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

		const llmProviderService = instantiationService.createInstance(LLMProviderService);
		instantiationService.stub(ILLMProviderService, llmProviderService);

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
		// Deep thinking should produce all 11 phases
		assert.ok(response.phases.length >= 9);
		// Verify phase names include key protocol phases
		const phaseNames = response.phases.map(p => p.name);
		assert.ok(phaseNames.includes('Initial Engagement'));
		assert.ok(phaseNames.includes('Knowledge Synthesis'));
		assert.ok(phaseNames.includes('Pattern Recognition and Analysis'));
		assert.ok(phaseNames.includes('Progress Tracking'));
		assert.ok(phaseNames.includes('Recursive Thinking'));
		assert.ok(phaseNames.includes('Response Preparation'));
	});

	test('should include Progress Tracking phase for moderate queries', async () => {
		await zoneCogService.initialize();
		const moderateQuery = 'How can I connect to my database and optimize my queries?';
		const response = await zoneCogService.processQuery(moderateQuery);

		const phaseNames = response.phases.map(p => p.name);
		assert.ok(phaseNames.includes('Progress Tracking'), 'Moderate queries should include Progress Tracking');
	});

	test('should include Recursive Thinking phase for deep queries', async () => {
		await zoneCogService.initialize();
		const complexQuery = 'Please analyze and compare the multi-tenant database architecture, synthesize optimization strategies, and evaluate the performance implications across all cloud providers.';
		const response = await zoneCogService.processQuery(complexQuery);

		const phaseNames = response.phases.map(p => p.name);
		assert.ok(phaseNames.includes('Recursive Thinking'), 'Deep queries should include Recursive Thinking');
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

		// Should have created query, thinking, response, and history nodes
		assert.ok(store.nodeCount() >= 4);
		assert.ok(store.getNodesByType('QueryInput').length > 0);
		assert.ok(store.getNodesByType('ThinkingProcess').length > 0);
		assert.ok(store.getNodesByType('CognitiveResponse').length > 0);
		assert.ok(store.getNodesByType('QueryHistory').length > 0);

		// Should have created links between nodes
		assert.ok(store.linkCount() > 0);
	});

	test('should track query history in hypergraph', async () => {
		await zoneCogService.initialize();
		const store = zoneCogService.getHypergraphStore();

		await zoneCogService.processQuery('First query');
		await zoneCogService.processQuery('Second query');
		await zoneCogService.processQuery('Third query');

		const historyNodes = store.getNodesByType('QueryHistory');
		assert.strictEqual(historyNodes.length, 3);

		// Verify history content
		const contents = historyNodes.map(n => n.content);
		assert.ok(contents.includes('First query'));
		assert.ok(contents.includes('Second query'));
		assert.ok(contents.includes('Third query'));
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

	test('should stream thinking phase events', async () => {
		const streamedPhases: string[] = [];
		zoneCogService.onDidCompleteThinkingPhase((phase) => {
			streamedPhases.push(phase.name);
		});

		await zoneCogService.initialize();
		await zoneCogService.processQuery('Stream test');

		assert.ok(streamedPhases.length > 0, 'Should stream at least one thinking phase');
		assert.ok(streamedPhases.includes('Initial Engagement'));
		assert.ok(streamedPhases.includes('Response Preparation'));
	});

	test('should expose query history', async () => {
		await zoneCogService.initialize();
		assert.strictEqual(zoneCogService.getQueryHistory().length, 0);

		await zoneCogService.processQuery('First query');
		await zoneCogService.processQuery('Second query');

		const history = zoneCogService.getQueryHistory();
		assert.strictEqual(history.length, 2);
		assert.strictEqual(history[0].query, 'First query');
		assert.strictEqual(history[1].query, 'Second query');
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

suite('LLMProviderService Tests', () => {

	let instantiationService: TestInstantiationService;
	let llmService: ILLMProviderService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());
		llmService = instantiationService.createInstance(LLMProviderService);
	});

	test('should initialize with built-in provider', () => {
		const providers = llmService.getProviders();
		assert.strictEqual(providers.length, 1);
		assert.strictEqual(providers[0].id, 'builtin-fallback');
		assert.strictEqual(providers[0].displayName, 'Built-in (Rule-Based)');
	});

	test('should use built-in provider by default', () => {
		const active = llmService.getActiveProvider();
		assert.strictEqual(active.id, 'builtin-fallback');
		assert.strictEqual(llmService.isExternalProviderActive(), false);
	});

	test('should register and switch providers', () => {
		const registered = llmService.registerProvider({
			id: 'test-llm',
			displayName: 'Test LLM',
			baseUrl: 'http://localhost:8080',
			model: 'test-model',
			maxContextLength: 4096,
		});
		assert.strictEqual(registered, true);
		assert.strictEqual(llmService.getProviders().length, 2);

		const switched = llmService.setActiveProvider('test-llm');
		assert.strictEqual(switched, true);
		assert.strictEqual(llmService.getActiveProvider().id, 'test-llm');
		assert.strictEqual(llmService.isExternalProviderActive(), true);
	});

	test('should not register duplicate providers', () => {
		llmService.registerProvider({
			id: 'dup', displayName: 'D', baseUrl: '', model: '', maxContextLength: 0,
		});
		const dup = llmService.registerProvider({
			id: 'dup', displayName: 'D2', baseUrl: '', model: '', maxContextLength: 0,
		});
		assert.strictEqual(dup, false);
	});

	test('should not unregister built-in provider', () => {
		assert.strictEqual(llmService.unregisterProvider('builtin-fallback'), false);
	});

	test('should fall back to built-in when unregistering active provider', () => {
		llmService.registerProvider({
			id: 'temp', displayName: 'Temp', baseUrl: '', model: '', maxContextLength: 0,
		});
		llmService.setActiveProvider('temp');
		assert.strictEqual(llmService.getActiveProvider().id, 'temp');

		llmService.unregisterProvider('temp');
		assert.strictEqual(llmService.getActiveProvider().id, 'builtin-fallback');
	});

	test('should complete with built-in fallback', async () => {
		const response = await llmService.complete({
			systemPrompt: 'test',
			userMessage: 'analyze the data',
		});
		assert.ok(response.content);
		assert.strictEqual(response.providerId, 'builtin-fallback');
		assert.strictEqual(response.isFallback, true);
	});

	test('should generate different responses for different query types', async () => {
		const analysis = await llmService.complete({
			systemPrompt: 'test',
			userMessage: 'analyze the performance data',
		});
		assert.ok(analysis.content.includes('analysis'));

		const question = await llmService.complete({
			systemPrompt: 'test',
			userMessage: 'How does this work?',
		});
		assert.ok(question.content.includes('Zone-Cog'));

		const request = await llmService.complete({
			systemPrompt: 'test',
			userMessage: 'please help me with this',
		});
		assert.ok(request.content.includes('request'));
	});

	test('should fire events on provider changes', () => {
		let providerChanges = 0;
		let availabilityChanges = 0;
		llmService.onDidChangeProvider(() => providerChanges++);
		llmService.onDidChangeAvailability(() => availabilityChanges++);

		llmService.registerProvider({
			id: 'evt', displayName: 'Evt', baseUrl: '', model: '', maxContextLength: 0,
		});
		assert.strictEqual(availabilityChanges, 1);

		llmService.setActiveProvider('evt');
		assert.strictEqual(providerChanges, 1);

		llmService.unregisterProvider('evt');
		assert.strictEqual(availabilityChanges, 2);
		assert.strictEqual(providerChanges, 2); // Falls back to built-in
	});

	test('should not switch to unknown provider', () => {
		assert.strictEqual(llmService.setActiveProvider('nonexistent'), false);
		assert.strictEqual(llmService.getActiveProvider().id, 'builtin-fallback');
	});
});

suite('ECANAttentionService Tests', () => {

	let instantiationService: TestInstantiationService;
	let ecanService: IECANAttentionService;
	let store: IHypergraphStore;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		store = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, store);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		ecanService = instantiationService.createInstance(ECANAttentionService);
	});

	test('should initialize with default state', () => {
		const snapshot = ecanService.getSnapshot();
		assert.strictEqual(snapshot.totalTrackedNodes, 0);
		assert.strictEqual(snapshot.nodesInFocus, 0);
		assert.strictEqual(snapshot.spreadingCycles, 0);
		assert.strictEqual(snapshot.attentionalFocusBoundary, 0);
	});

	test('should set and get attention values', () => {
		ecanService.setAttentionValue('node1', { sti: 0.5, lti: 0.3 });
		const av = ecanService.getAttentionValue('node1');
		assert.strictEqual(av.sti, 0.5);
		assert.strictEqual(av.lti, 0.3);
	});

	test('should return default AV for untracked nodes', () => {
		const av = ecanService.getAttentionValue('unknown');
		assert.strictEqual(av.sti, 0);
		assert.strictEqual(av.lti, 0);
	});

	test('should clamp STI to [-1, 1]', () => {
		ecanService.setAttentionValue('n1', { sti: 5.0, lti: 0 });
		assert.strictEqual(ecanService.getAttentionValue('n1').sti, 1);

		ecanService.setAttentionValue('n2', { sti: -3.0, lti: 0 });
		assert.strictEqual(ecanService.getAttentionValue('n2').sti, -1);
	});

	test('should clamp LTI to [0, 1]', () => {
		ecanService.setAttentionValue('n1', { sti: 0, lti: 2.0 });
		assert.strictEqual(ecanService.getAttentionValue('n1').lti, 1);

		ecanService.setAttentionValue('n2', { sti: 0, lti: -1.0 });
		assert.strictEqual(ecanService.getAttentionValue('n2').lti, 0);
	});

	test('should stimulate nodes', () => {
		ecanService.setAttentionValue('n1', { sti: 0.2, lti: 0.5 });
		ecanService.stimulate('n1', 0.3);
		assert.strictEqual(ecanService.getAttentionValue('n1').sti, 0.5);
		assert.strictEqual(ecanService.getAttentionValue('n1').lti, 0.5); // LTI unchanged
	});

	test('should compute attentional focus', () => {
		ecanService.setAttentionValue('above', { sti: 0.5, lti: 0 });
		ecanService.setAttentionValue('at_boundary', { sti: 0.0, lti: 0 });
		ecanService.setAttentionValue('below', { sti: -0.3, lti: 0 });

		const focus = ecanService.getAttentionalFocus();
		assert.ok(focus.includes('above'));
		assert.ok(focus.includes('at_boundary'));
		assert.ok(!focus.includes('below'));
	});

	test('should spread activation along links', () => {
		// Create two linked nodes in the hypergraph
		store.addNode({ id: 'src', node_type: 'A', content: '', links: [], metadata: {}, salience_score: 0.8 });
		store.addNode({ id: 'dst', node_type: 'B', content: '', links: [], metadata: {}, salience_score: 0.2 });
		store.addLink({ id: 'l1', link_type: 'Test', outgoing: ['src', 'dst'], metadata: {} });

		ecanService.setAttentionValue('src', { sti: 0.8, lti: 0.5 });
		ecanService.setAttentionValue('dst', { sti: 0.1, lti: 0.2 });

		const result = ecanService.spreadActivation();

		// dst should have received some STI from src
		const dstAv = ecanService.getAttentionValue('dst');
		// src had STI=0.8, spread fraction = 0.1 → 0.08 spread to each neighbor
		// dst had STI=0.1, gains 0.08, loses rent 0.02 → ~0.16
		assert.ok(dstAv.sti > 0.05, `dst STI should have increased, got ${dstAv.sti}`);

		assert.ok(result.boosted.length > 0 || result.decayed.length > 0);
		assert.strictEqual(ecanService.getSnapshot().spreadingCycles, 1);
	});

	test('should collect rent each cycle', () => {
		ecanService.setAttentionValue('n1', { sti: 0.1, lti: 0.5 });

		ecanService.spreadActivation();

		// After rent collection (0.02), STI should decrease
		const av = ecanService.getAttentionValue('n1');
		assert.ok(av.sti < 0.1, `STI should have decreased after rent, got ${av.sti}`);
	});

	test('should fire spread events', () => {
		let eventFired = false;
		ecanService.onDidSpread(() => { eventFired = true; });

		ecanService.setAttentionValue('n1', { sti: 0.5, lti: 0 });
		ecanService.spreadActivation();

		assert.ok(eventFired);
	});

	test('should set and get focus boundary', () => {
		ecanService.setFocusBoundary(0.3);
		assert.strictEqual(ecanService.getFocusBoundary(), 0.3);

		// Node at 0.2 should now be below the boundary
		ecanService.setAttentionValue('n1', { sti: 0.2, lti: 0 });
		assert.ok(!ecanService.getAttentionalFocus().includes('n1'));
	});

	test('should fire focus boundary change events', () => {
		let newBoundary = -1;
		ecanService.onDidChangeFocusBoundary(b => { newBoundary = b; });

		ecanService.setFocusBoundary(0.5);
		assert.strictEqual(newBoundary, 0.5);
	});

	test('should reset all state', () => {
		ecanService.setAttentionValue('n1', { sti: 0.5, lti: 0.5 });
		ecanService.setFocusBoundary(0.3);
		ecanService.spreadActivation();

		ecanService.reset();

		const snapshot = ecanService.getSnapshot();
		assert.strictEqual(snapshot.totalTrackedNodes, 0);
		assert.strictEqual(snapshot.spreadingCycles, 0);
		assert.strictEqual(snapshot.attentionalFocusBoundary, 0);
	});
});

suite('CognitiveLoopService Tests', () => {

	let instantiationService: TestInstantiationService;
	let loopService: ICognitiveLoopService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ILogService, new NullLogService());

		const store = instantiationService.createInstance(HypergraphStore);
		instantiationService.stub(IHypergraphStore, store);

		const membraneService = instantiationService.createInstance(CognitiveMembraneService);
		instantiationService.stub(ICognitiveMembraneService, membraneService);

		const ecanService = instantiationService.createInstance(ECANAttentionService);
		instantiationService.stub(IECANAttentionService, ecanService);

		const embodiedService = instantiationService.createInstance(EmbodiedCognitionService);
		instantiationService.stub(IEmbodiedCognitionService, embodiedService);

		const workspaceService = instantiationService.createInstance(CognitiveWorkspaceService);
		instantiationService.stub(ICognitiveWorkspaceService, workspaceService);

		loopService = instantiationService.createInstance(CognitiveLoopService);
	});

	teardown(() => {
		loopService.stop();
	});

	test('should initialize in stopped state', () => {
		const state = loopService.getState();
		assert.strictEqual(state.running, false);
		assert.strictEqual(state.paused, false);
		assert.strictEqual(state.totalIterations, 0);
	});

	test('should start and stop', () => {
		loopService.start();
		assert.strictEqual(loopService.getState().running, true);
		assert.strictEqual(loopService.getState().paused, false);

		loopService.stop();
		assert.strictEqual(loopService.getState().running, false);
	});

	test('should pause and resume', () => {
		loopService.start();

		loopService.pause();
		assert.strictEqual(loopService.getState().paused, true);
		assert.strictEqual(loopService.getState().running, true);

		loopService.resume();
		assert.strictEqual(loopService.getState().paused, false);
		assert.strictEqual(loopService.getState().running, true);

		loopService.stop();
	});

	test('should run a single iteration', async () => {
		const iteration = await loopService.runOnce();

		assert.ok(iteration.success);
		assert.strictEqual(iteration.iteration, 1);
		assert.strictEqual(iteration.phases.length, 5);

		const phaseNames = iteration.phases.map(p => p.name);
		assert.ok(phaseNames.includes('perceive'));
		assert.ok(phaseNames.includes('attend'));
		assert.ok(phaseNames.includes('think'));
		assert.ok(phaseNames.includes('act'));
		assert.ok(phaseNames.includes('reflect'));
	});

	test('should track iteration history', async () => {
		await loopService.runOnce();
		await loopService.runOnce();
		await loopService.runOnce();

		const recent = loopService.getRecentIterations(10);
		assert.strictEqual(recent.length, 3);
		assert.strictEqual(recent[0].iteration, 1);
		assert.strictEqual(recent[2].iteration, 3);

		const state = loopService.getState();
		assert.strictEqual(state.totalIterations, 3);
		assert.ok(state.averageIterationMs >= 0);
	});

	test('should fire iteration events', async () => {
		let eventCount = 0;
		loopService.onDidCompleteIteration(() => { eventCount++; });

		await loopService.runOnce();
		assert.strictEqual(eventCount, 1);
	});

	test('should fire state change events', () => {
		let stateChanges = 0;
		loopService.onDidChangeState(() => { stateChanges++; });

		loopService.start();
		assert.ok(stateChanges > 0);

		const before = stateChanges;
		loopService.stop();
		assert.ok(stateChanges > before);
	});

	test('should set tick interval', () => {
		loopService.setTickInterval(2000);
		assert.strictEqual(loopService.getState().tickIntervalMs, 2000);
	});

	test('should enforce minimum tick interval', () => {
		loopService.setTickInterval(100); // Below minimum
		assert.strictEqual(loopService.getState().tickIntervalMs, 1000);
	});

	test('should reset all state', async () => {
		loopService.start();
		await loopService.runOnce();
		await loopService.runOnce();

		loopService.reset();

		const state = loopService.getState();
		assert.strictEqual(state.running, false);
		assert.strictEqual(state.totalIterations, 0);
		assert.strictEqual(state.failedIterations, 0);
		assert.strictEqual(loopService.getRecentIterations().length, 0);
	});

	test('should handle iteration with populated hypergraph', async () => {
		// Add some nodes to the hypergraph before running
		const store = instantiationService.get(IHypergraphStore);
		store.addNode({ id: 'test1', node_type: 'TestNode', content: 'test data', links: [], metadata: {}, salience_score: 0.8 });
		store.addNode({ id: 'test2', node_type: 'TestNode', content: 'more data', links: [], metadata: {}, salience_score: 0.6 });
		store.addLink({ id: 'tl1', link_type: 'Test', outgoing: ['test1', 'test2'], metadata: {} });

		const iteration = await loopService.runOnce();
		assert.ok(iteration.success);

		// The iteration should have processed the nodes
		const perceivePhase = iteration.phases.find(p => p.name === 'perceive');
		assert.ok(perceivePhase);
		assert.ok(perceivePhase.summary.includes('2 nodes'));
	});
});
